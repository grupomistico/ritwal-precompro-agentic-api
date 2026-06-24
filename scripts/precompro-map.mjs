import { readFileSync, existsSync } from "node:fs";

loadDotEnv();

const env = process.env;
const apiKey = required("PRECOMPRO_API_KEY");
const vendorId = required("PRECOMPRO_VENDOR_ID");
const availabilityBase =
  env.PRECOMPRO_AVAILABILITY_BASE || "https://serviceavailability.precompro.co/api";
const days = numberEnv("MAP_DAYS", 14);
const peopleValues = listEnv("MAP_PEOPLE", [1, 2, 4, 6, 8, 10, 12]);
const zoneValues = listEnv("MAP_ZONES", [0, 1442, 1443, 2190]);
const subzone = numberEnv("MAP_SUBZONE", 0);
const summaryOnly = env.MAP_SUMMARY === "true";

const results = [];

for (const date of nextDates(days)) {
  for (const people of peopleValues) {
    for (const zone of zoneValues) {
      const body = { vendorId, people, date, zone, subzone };
      const response = await request(`${availabilityBase}/availability/ws`, body);
      const slots = Array.isArray(response.data) ? response.data : [];
      const availableSlots = slots.filter((slot) => slot.status);
      const paidSlots = availableSlots.filter((slot) => slot.paymentInfo);

      results.push({
        date,
        people,
        zone,
        ok: response.ok,
        status: response.status,
        slotCount: slots.length,
        availableCount: availableSlots.length,
        firstAvailable: availableSlots[0]?.dateTime || null,
        lastAvailable: availableSlots.at(-1)?.dateTime || null,
        paidCount: paidSlots.length,
        error: response.ok ? null : response.data,
      });
    }
  }
}

const paidResults = results.filter((item) => item.paidCount > 0);
const erroredResults = results.filter((item) => !item.ok);
const availableResults = results.filter((item) => item.availableCount > 0);
const emptyResults = results.filter((item) => item.ok && item.availableCount === 0);
const summary = {
  totalChecks: results.length,
  availableChecks: availableResults.length,
  emptyChecks: emptyResults.length,
  erroredChecks: erroredResults.length,
  paidChecks: paidResults.length,
  paidResults,
  errors: erroredResults,
};

console.log(
  JSON.stringify(
    summaryOnly ? { days, peopleValues, zoneValues, summary } : { days, peopleValues, zoneValues, summary, results },
    null,
    2,
  ),
);

async function request(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      apiKey,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return {
    ok: response.ok,
    status: response.status,
    data: parseJson(text),
  };
}

function parseJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function loadDotEnv() {
  if (!existsSync(".env")) return;
  const lines = readFileSync(".env", "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex === -1) continue;
    const key = trimmed.slice(0, equalsIndex).trim();
    const value = trimmed.slice(equalsIndex + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}

function required(name) {
  const value = env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function numberEnv(name, fallback) {
  const value = env[name];
  if (value === undefined || value === "") return fallback;
  const number = Number(value);
  if (Number.isNaN(number)) throw new Error(`${name} must be a number.`);
  return number;
}

function listEnv(name, fallback) {
  const value = env[name];
  if (!value) return fallback;
  return value.split(",").map((item) => {
    const number = Number(item.trim());
    if (Number.isNaN(number)) throw new Error(`${name} must be comma-separated numbers.`);
    return number;
  });
}

function nextDates(count) {
  const dates = [];
  const start = new Date();
  for (let index = 1; index <= count; index += 1) {
    const date = new Date(start);
    date.setUTCDate(start.getUTCDate() + index);
    dates.push(formatBogotaDate(date));
  }
  return dates;
}

function formatBogotaDate(date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}
