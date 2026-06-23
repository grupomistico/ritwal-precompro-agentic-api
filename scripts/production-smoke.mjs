#!/usr/bin/env node
import "dotenv/config";

const middlewareUrl = (
  process.env.PUBLIC_MIDDLEWARE_URL ||
  "https://ritwal-precompro-api.grupomistico.cloud"
).replace(/\/$/, "");
const toolSecret = process.env.TOOL_SECRET;
const runWriteTests = process.env.RUN_WRITE_TESTS === "true";

if (!toolSecret) throw new Error("TOOL_SECRET is required");

const results = [];
let createdReservation;
let smokePhone;

try {
  await checkHealth();
  await checkSchemaAuth();
  await checkSchema();
  await checkDiagnostics();
  const availability = await checkAvailability();
  await checkGenericRuntimeEnvelope();
  await checkUnavailableExactTime();
  await checkReservationReport();
  await checkCustomerDemographics();
  await checkCustomerSegment();
  if (runWriteTests) {
    await createSearchCancelLifecycle(availability);
  }
} finally {
  if (createdReservation?.id && smokePhone) {
    await safeCancel(createdReservation.id, smokePhone);
  }
}

console.log(
  JSON.stringify(
    {
      ok: results.every((item) => item.ok),
      middlewareUrl,
      writeTests: runWriteTests,
      results,
    },
    null,
    2,
  ),
);

if (results.some((item) => !item.ok)) {
  process.exitCode = 1;
}

async function checkHealth() {
  const data = await middleware("GET", "/health", undefined, { auth: false });
  record(
    "middleware.health",
    data.ok === true && data.service === "ritwal-precompro-agentic-api",
    data,
  );
}

async function checkSchemaAuth() {
  const response = await rawMiddleware("GET", "/tools/schema", undefined, { auth: false });
  record("middleware.schema.auth-required", response.status === 401, {
    status: response.status,
    code: response.data?.code,
  });
}

async function checkSchema() {
  const data = await middleware("GET", "/tools/schema");
  const toolNames = (data.tools || []).map((tool) => tool.name);
  const requiredTools = [
    "restaurant_profile",
    "check_availability",
    "create_reservation",
    "search_reservations",
    "list_reservations_by_date",
    "list_reservations_range",
    "reservation_report",
    "customer_lookup",
    "customer_segment",
    "customer_demographics",
    "customer_export",
    "update_reservation",
    "cancel_reservation",
    "confirm_reservation",
  ];
  record(
    "middleware.schema.tools",
    data.ok === true && requiredTools.every((name) => toolNames.includes(name)),
    {
      toolCount: toolNames.length,
      requiredToolsPresent: requiredTools.every((name) => toolNames.includes(name)),
      missingTools: requiredTools.filter((name) => !toolNames.includes(name)),
    },
  );
}

async function checkDiagnostics() {
  const data = await middleware("GET", "/tools/diagnostics/precompro");
  record("middleware.diagnostics.precompro", data.ok === true, {
    ok: data.ok,
    egressIp: data.egressIp,
    apiKeyFingerprint: data.precompro?.apiKeyFingerprint,
    vendorOk: data.checks?.vendor?.ok,
    availabilityOk: data.checks?.availability?.ok,
  });
}

async function checkAvailability() {
  const data = await middleware("POST", "/tools/availability", {
    date: "mañana",
    time: "3pm",
    partySize: "5",
  });
  const slots = Array.isArray(data.slots) ? data.slots : [];
  const slot =
    slots.find((item) => item.time === data.requestedTime && item.available) ||
    slots.find((item) => item.available);
  record(
    "middleware.availability.natural-input",
    data.ok === true &&
      data.code === "AVAILABILITY_FOUND" &&
      data.date &&
      data.requestedTime === "15:00" &&
      data.partySize === 5 &&
      slots.length > 0,
    {
      code: data.code,
      date: data.date,
      requestedTime: data.requestedTime,
      exactTimeAvailable: data.exactTimeAvailable,
      partySize: data.partySize,
      availableCount: data.availableCount,
      selectedSlot: slot ? { time: slot.time, dateTime: slot.dateTime } : null,
    },
  );
  return { ...data, selectedSlot: slot };
}

async function checkGenericRuntimeEnvelope() {
  const data = await middleware("POST", "/tools/availability", {
    runtime_id: "production-smoke",
    session_id: "production-smoke",
    tool_metadata: { name: "check_availability" },
    tool_payload: {
      date: "mañana",
      time: "3pm",
      partySize: 5,
    },
  });

  record(
    "middleware.availability.generic-runtime-envelope",
    data.ok === true &&
      data.code === "AVAILABILITY_FOUND" &&
      data.requestedTime === "15:00" &&
      data.partySize === 5,
    {
      code: data.code,
      requestedTime: data.requestedTime,
      exactTimeAvailable: data.exactTimeAvailable,
      partySize: data.partySize,
      availableCount: data.availableCount,
    },
  );
}

async function checkUnavailableExactTime() {
  const data = await middleware("POST", "/tools/availability", {
    date: "mañana",
    time: "3am",
    partySize: "2",
  });
  record(
    "middleware.availability.unavailable-exact-time",
    data.ok === true && data.requestedTime === "03:00" && data.exactTimeAvailable === false,
    {
      code: data.code,
      requestedTime: data.requestedTime,
      exactTimeAvailable: data.exactTimeAvailable,
      availableCount: data.availableCount,
    },
  );
}

async function checkReservationReport() {
  const data = await middleware("POST", "/tools/reservations/report", {
    from: "2026-06-15",
    to: "2026-06-19",
    groupBy: ["date", "lifecycle"],
    includeCancelled: true,
  });
  record("middleware.reservations.report", data.ok === true && data.code === "RESERVATION_REPORT_READY", {
    code: data.code,
    totalReservations: data.summary?.totalReservations,
    completedPeople: data.summary?.completedPeople,
    groupCount: Array.isArray(data.groups) ? data.groups.length : 0,
  });
}

async function checkCustomerDemographics() {
  const data = await middleware("POST", "/tools/customers/demographics", {
    from: "2026-06-15",
    to: "2026-06-19",
    groupBy: ["country"],
    includeCancelled: true,
  });
  record(
    "middleware.customers.demographics",
    data.ok === true && data.code === "CUSTOMER_DEMOGRAPHICS_READY" && data.pii === false,
    {
      code: data.code,
      pii: data.pii,
      totalCustomers: data.summary?.totalCustomers,
      topCountries: data.summary?.topCountries?.slice(0, 5),
    },
  );
}

async function checkCustomerSegment() {
  const data = await middleware("POST", "/tools/customers/segment", {
    from: "2026-06-15",
    to: "2026-06-19",
    criteria: { country: "Canada" },
    includeReservations: false,
    limit: 1,
  });
  record(
    "middleware.customers.segment-country-filter",
    data.ok === true && data.code === "CUSTOMER_SEGMENT_READY",
    {
      code: data.code,
      totalCustomers: data.pagination?.totalCustomers,
      returnedCustomers: data.pagination?.returnedCustomers,
      nextCursor: data.pagination?.nextCursor,
    },
  );
}

async function createSearchCancelLifecycle(availability) {
  const slot = availability.selectedSlot;
  if (!slot?.time || !availability.date) {
    record("middleware.lifecycle.prerequisite", false, {
      message: "No available slot for write lifecycle.",
    });
    return;
  }

  smokePhone = `300${String(Date.now()).slice(-7)}`;
  const create = await middleware("POST", "/tools/reservations/create", {
    displayName: "Ritwal Smoke Test Codex",
    phone: smokePhone,
    countryCode: 57,
    date: availability.date,
    time: slot.time,
    partySize: "2",
    comments: "Smoke test automatico; cancelar inmediatamente.",
    idempotencyKey: `smoke:${smokePhone}:${availability.date}:${slot.time}`,
  });
  createdReservation = create.reservation;
  record(
    "middleware.lifecycle.create",
    create.ok === true &&
      ["RESERVATION_CREATED", "RESERVATION_ALREADY_EXISTS"].includes(create.code) &&
      Boolean(create.reservation?.id),
    {
      code: create.code,
      reservation: sanitizeReservation(create.reservation),
    },
  );

  const search = await middleware("POST", "/tools/reservations/search", { phone: smokePhone });
  const found = (search.reservations || []).some(
    (reservation) => reservation.id === create.reservation?.id,
  );
  record("middleware.lifecycle.search", search.ok === true && found, {
    code: search.code,
    found,
    reservations: (search.reservations || []).map(sanitizeReservation),
  });

  const cancel = await middleware("POST", "/tools/reservations/cancel", {
    reservationId: create.reservation.id,
    phone: smokePhone,
  });
  createdReservation = null;
  record(
    "middleware.lifecycle.cancel",
    cancel.ok === true && cancel.code === "RESERVATION_CANCELLED",
    {
      code: cancel.code,
      reservationId: cancel.reservationId,
    },
  );

  const after = await middleware("POST", "/tools/reservations/search", { phone: smokePhone });
  record(
    "middleware.lifecycle.search-after-cancel",
    after.ok === true && (after.reservations || []).length === 0,
    {
      code: after.code,
      reservations: (after.reservations || []).map(sanitizeReservation),
    },
  );
}

async function safeCancel(reservationId, phone) {
  try {
    await middleware("POST", "/tools/reservations/cancel", { reservationId, phone });
  } catch {
    record("middleware.lifecycle.cleanup-cancel", false, { reservationId });
  }
}

async function middleware(method, path, body, options) {
  const response = await rawMiddleware(method, path, body, options);
  if (!response.ok) {
    record(`http.${path}`, false, { status: response.status, data: response.data });
  }
  return response.data;
}

async function rawMiddleware(method, path, body, options = {}) {
  const response = await fetch(`${middlewareUrl}${path}`, {
    method,
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      ...(options.auth === false ? {} : { "x-tool-secret": toolSecret }),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await readResponse(response);
  return { ok: response.ok, status: response.status, data };
}

async function readResponse(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text.slice(0, 500) };
  }
}

function record(name, ok, details = {}) {
  results.push({ name, ok, details });
}

function sanitizeReservation(reservation = {}) {
  return {
    id: reservation.id,
    displayName: reservation.displayName,
    phone: reservation.phone ? "***" + String(reservation.phone).slice(-4) : undefined,
    people: reservation.people,
    date: reservation.date,
    dateTime: reservation.dateTime,
    status: reservation.status,
  };
}
