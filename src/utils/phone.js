export function normalizePhone(phone) {
  const raw = String(phone || "").trim();
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) {
    return null;
  }
  return digits;
}

export function normalizeCountryCode(countryCode, fallback = 57) {
  const digits = String(countryCode || fallback).replace(/\D/g, "");
  if (!digits || digits.length < 1 || digits.length > 4) {
    return null;
  }
  return Number(digits);
}
