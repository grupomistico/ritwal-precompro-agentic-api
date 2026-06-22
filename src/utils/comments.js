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
