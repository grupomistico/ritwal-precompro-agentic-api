#!/usr/bin/env node
import "dotenv/config";

const agentId = process.env.CONVOCORE_AGENT_ID || "lcabtgiH0vI9IGB0kQ52";
const middlewareUrl = (process.env.PUBLIC_MIDDLEWARE_URL || "https://ritwal-api.grupomistico.cloud").replace(/\/$/, "");
const toolSecret = process.env.TOOL_SECRET;
const convBase = process.env.CONVOCORE_BASE_URL?.replace(/\/$/, "");
const convSecret = process.env.CONVOCORE_WORKSPACE_SECRET;
const runWriteTests = process.env.RUN_WRITE_TESTS === "true";

if (!toolSecret) throw new Error("TOOL_SECRET is required");
if (!convBase || !convSecret) throw new Error("CONVOCORE_BASE_URL and CONVOCORE_WORKSPACE_SECRET are required");

const results = [];
let createdReservation;
let smokePhone;

try {
  await checkHealth();
  await checkConvocoreConfig();
  const availability = await checkAvailability();
  await checkConvocoreRuntimeEnvelope();
  await checkUnavailableExactTime();
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
  const data = await middleware("GET", "/health");
  record("middleware.health", data.ok === true && data.service === "ritwal-precompro-middleware", data);
}

async function checkConvocoreConfig() {
  const [agent, tools] = await Promise.all([
    conv(`/agents/${agentId}`),
    conv(`/agents/${agentId}/tools`),
  ]);
  const agentData = agent.data || agent;
  const toolList = tools.data || [];
  const operationalNodes = (agentData.nodes || []).filter((node) => node.type !== "note");
  const availabilityTool = toolList.find((tool) => tool.name === "check_availability");
  const fields = availabilityTool?.fields || [];
  const hasTime = fields.some((field) => field.key === "time" && field.required === false);
  const hasTools = ["check_availability", "create_reservation", "search_reservations", "cancel_reservation"].every((name) =>
    toolList.some((tool) => tool.name === name && tool.disabled !== true),
  );
  const routeShapeOk = operationalNodes.every((node) =>
    (node.childrenNodes || []).every((child) => child && typeof child === "object" && child.nodeId && child.condition),
  );
  const modelsOk = operationalNodes.every((node) => node.llmConfig?.modelId === "gpt-4.1-2025-04-14");
  record("convocore.config", hasTime && hasTools && routeShapeOk && modelsOk, {
    title: agentData.title,
    lang: agentData.lang,
    defaultModel: agentData.vg_defaultModel,
    nodeCount: operationalNodes.length,
    availabilityFields: fields.map((field) => ({
      key: field.key,
      type: field.type,
      required: field.required,
    })),
    hasTools,
    routeShapeOk,
    modelsOk,
  });
}

async function checkAvailability() {
  const data = await middleware("POST", "/tools/availability", {
    date: "mañana",
    time: "3pm",
    partySize: "5",
  });
  const slots = Array.isArray(data.slots) ? data.slots : [];
  const slot = slots.find((item) => item.time === data.requestedTime && item.available) || slots.find((item) => item.available);
  record("middleware.availability.natural-input", data.ok === true && data.code === "AVAILABILITY_FOUND" && data.date && data.requestedTime === "15:00" && data.partySize === 5 && slots.length > 0, {
    code: data.code,
    date: data.date,
    requestedTime: data.requestedTime,
    exactTimeAvailable: data.exactTimeAvailable,
    partySize: data.partySize,
    availableCount: data.availableCount,
    selectedSlot: slot ? { time: slot.time, dateTime: slot.dateTime } : null,
  });
  return { ...data, selectedSlot: slot };
}

async function checkUnavailableExactTime() {
  const data = await middleware("POST", "/tools/availability", {
    date: "mañana",
    time: "3am",
    partySize: "2",
  });
  record("middleware.availability.unavailable-exact-time", data.ok === true && data.requestedTime === "03:00" && data.exactTimeAvailable === false, {
    code: data.code,
    requestedTime: data.requestedTime,
    exactTimeAvailable: data.exactTimeAvailable,
    availableCount: data.availableCount,
  });
}

async function checkConvocoreRuntimeEnvelope() {
  const data = await middleware("POST", "/tools/availability", {
    agent_id: agentId,
    convo_id: "production-smoke",
    session_id: "production-smoke",
    tool_metadata: { name: "check_availability" },
    tool_payload: {
      date: "mañana",
      time: "3pm",
      partySize: 5,
    },
  });

  record("middleware.availability.convocore-runtime-envelope", data.ok === true && data.code === "AVAILABILITY_FOUND" && data.requestedTime === "15:00" && data.partySize === 5, {
    code: data.code,
    requestedTime: data.requestedTime,
    exactTimeAvailable: data.exactTimeAvailable,
    partySize: data.partySize,
    availableCount: data.availableCount,
  });
}

async function createSearchCancelLifecycle(availability) {
  const slot = availability.selectedSlot;
  if (!slot?.time || !availability.date) {
    record("middleware.lifecycle.prerequisite", false, { message: "No available slot for write lifecycle." });
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
  record("middleware.lifecycle.create", create.ok === true && ["RESERVATION_CREATED", "RESERVATION_ALREADY_EXISTS"].includes(create.code) && Boolean(create.reservation?.id), {
    code: create.code,
    reservation: sanitizeReservation(create.reservation),
  });

  const search = await middleware("POST", "/tools/reservations/search", { phone: smokePhone });
  const found = (search.reservations || []).some((reservation) => reservation.id === create.reservation?.id);
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
  record("middleware.lifecycle.cancel", cancel.ok === true && cancel.code === "RESERVATION_CANCELLED", {
    code: cancel.code,
    reservationId: cancel.reservationId,
  });

  const after = await middleware("POST", "/tools/reservations/search", { phone: smokePhone });
  record("middleware.lifecycle.search-after-cancel", after.ok === true && (after.reservations || []).length === 0, {
    code: after.code,
    reservations: (after.reservations || []).map(sanitizeReservation),
  });
}

async function safeCancel(reservationId, phone) {
  try {
    await middleware("POST", "/tools/reservations/cancel", { reservationId, phone });
  } catch {
    record("middleware.lifecycle.cleanup-cancel", false, { reservationId });
  }
}

async function middleware(method, path, body) {
  const response = await fetch(`${middlewareUrl}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-tool-secret": toolSecret,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await readResponse(response);
  if (!response.ok) {
    record(`http.${path}`, false, { status: response.status, data });
  }
  return data;
}

async function conv(path) {
  const response = await fetch(`${convBase}${path}`, {
    headers: {
      Authorization: `Bearer ${convSecret}`,
      Accept: "application/json",
    },
  });
  const data = await readResponse(response);
  if (!response.ok) {
    record(`convocore.${path}`, false, { status: response.status, data });
  }
  return data;
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
