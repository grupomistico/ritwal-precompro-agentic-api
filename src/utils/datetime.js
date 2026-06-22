const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function assertIsoDate(date) {
  if (!DATE_RE.test(date || "")) {
    return false;
  }
  const [year, month, day] = date.split("-").map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day));
  return (
    utc.getUTCFullYear() === year &&
    utc.getUTCMonth() === month - 1 &&
    utc.getUTCDate() === day
  );
}

export function assertTime(time) {
  return TIME_RE.test(time || "");
}

export function normalizeDateInput(value) {
  if (value === undefined || value === null) return value;
  const raw = String(value).trim();
  if (!raw) return raw;
  if (assertIsoDate(raw)) return raw;

  const key = raw
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

  if (["hoy", "today"].includes(key)) return bogotaDateOffset(0);
  if (["manana", "mañana", "tomorrow"].includes(raw.toLowerCase()) || key === "manana") {
    return bogotaDateOffset(1);
  }
  if (key === "pasado manana" || key === "pasado manana." || key === "day after tomorrow") {
    return bogotaDateOffset(2);
  }

  return raw;
}

export function normalizeTimeInput(value) {
  if (value === undefined || value === null) return value;
  const raw = String(value).trim().toLowerCase();
  if (!raw) return raw;
  if (assertTime(raw)) return raw;

  const compact = raw
    .replace(/\s+/g, "")
    .replace(/\./g, "")
    .replace("a.m.", "am")
    .replace("p.m.", "pm");
  const match = compact.match(/^(\d{1,2})(?::?(\d{2}))?(am|pm)$/);
  if (!match) return String(value).trim();

  let hour = Number(match[1]);
  const minute = match[2] || "00";
  const meridiem = match[3];
  if (hour < 1 || hour > 12) return String(value).trim();
  if (meridiem === "pm" && hour !== 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;
  return `${String(hour).padStart(2, "0")}:${minute}`;
}

export function bogotaDateTimeToEpochMs(date, time) {
  if (!assertIsoDate(date)) {
    throw new Error(`Invalid date ${date}`);
  }
  if (!assertTime(time)) {
    throw new Error(`Invalid time ${time}`);
  }
  return Date.parse(`${date}T${time}:00-05:00`);
}

export function epochMsToPrecomproDateTime(epochMs) {
  const date = new Date(epochMs);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  })
    .formatToParts(date)
    .reduce((acc, part) => {
      acc[part.type] = part.value;
      return acc;
    }, {});
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

export function isPastBogotaDate(date) {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  return date < today;
}

function bogotaDateOffset(days) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .formatToParts(new Date())
    .reduce((acc, part) => {
      acc[part.type] = part.value;
      return acc;
    }, {});
  const utc = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)));
  utc.setUTCDate(utc.getUTCDate() + days);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(utc);
}
