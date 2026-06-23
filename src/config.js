import "dotenv/config";

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

export function loadConfig() {
  return {
    port: Number(process.env.PORT || 3000),
    toolSecret: process.env.TOOL_SECRET || "",
    precompro: {
      apiKey: required("PRECOMPRO_API_KEY"),
      vendorId: required("PRECOMPRO_VENDOR_ID"),
      reservationBase:
        process.env.PRECOMPRO_RESERVATION_BASE ||
        "https://servicereservation.precompro.com/api/ws",
      availabilityBase:
        process.env.PRECOMPRO_AVAILABILITY_BASE ||
        "https://serviceavailability.precompro.com/api",
      vendorBase:
        process.env.PRECOMPRO_VENDOR_BASE || "https://servicevendor.precompro.com/api",
      webserviceBase:
        process.env.PRECOMPRO_WEBSERVICE_BASE ||
        "https://servicewebservice.precompro.com/api",
    },
    defaults: {
      countryCode: Number(process.env.DEFAULT_COUNTRY_CODE || 57),
      timezone: "America/Bogota",
      maxAutomaticPartySize: Number(process.env.MAX_AUTOMATIC_PARTY_SIZE || 18),
      requestTimeoutMs: Number(process.env.PRECOMPRO_TIMEOUT_MS || 8000),
      idempotencyTtlMs: Number(process.env.IDEMPOTENCY_TTL_MS || 10 * 60 * 1000),
      lockTtlMs: Number(process.env.LOCK_TTL_MS || 15000),
    },
    whatsapp: {
      verifyToken: process.env.WHATSAPP_VERIFY_TOKEN || "",
      accessToken: process.env.META_ACCESS_TOKEN || "",
      phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || "",
      businessAccountId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || "",
    },
  };
}
