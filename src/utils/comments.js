export function buildComments({
  comments,
  allergies,
  occasion,
  requirements,
  pet,
  preferredZoneName,
  partyComposition,
}) {
  const lines = [];
  if (comments) lines.push(String(comments).trim());
  if (allergies) lines.push(`ALERGIAS: ${allergies}.`);
  if (occasion) lines.push(`OCASION: ${occasion}.`);
  if (requirements) lines.push(`REQUERIMIENTOS: ${requirements}.`);
  if (pet) lines.push(`MASCOTA: ${pet}.`);
  if (preferredZoneName) lines.push(`ZONA PREFERIDA: ${preferredZoneName}.`);
  if (partyComposition) lines.push(`COMPOSICION: ${partyComposition}.`);
  return lines.filter(Boolean).join(" ");
}

const COMMENT_LABELS = [
  ["ALERGIAS", "allergies"],
  ["OCASION", "occasion"],
  ["REQUERIMIENTOS", "requirements"],
  ["MASCOTA", "pet"],
  ["ZONA PREFERIDA", "preferredZoneName"],
  ["COMPOSICION", "partyComposition"],
];

export function parseComments(comments) {
  const raw = String(comments || "").trim();
  if (!raw) return null;

  const labelPattern = new RegExp(
    `(${COMMENT_LABELS.map(([label]) => escapeRegExp(label)).join("|")}):\\s*`,
    "gi",
  );
  const matches = [...raw.matchAll(labelPattern)];
  if (!matches.length) return { notes: raw };

  const parsed = {};
  const firstMatch = matches[0];
  const notes = raw.slice(0, firstMatch.index).trim();
  if (notes) parsed.notes = trimTrailingPeriod(notes);

  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const next = matches[index + 1];
    const label = normalizeLabel(match[1]);
    const key = COMMENT_LABELS.find(([knownLabel]) => normalizeLabel(knownLabel) === label)?.[1];
    if (!key) continue;

    const value = raw
      .slice(match.index + match[0].length, next?.index ?? raw.length)
      .trim();
    if (value) parsed[key] = trimTrailingPeriod(value);
  }

  return Object.keys(parsed).length ? parsed : { notes: raw };
}

function normalizeLabel(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toUpperCase();
}

function trimTrailingPeriod(value) {
  return String(value).trim().replace(/[.\s]+$/u, "");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
