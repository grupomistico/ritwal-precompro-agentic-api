import Fastify from "fastify";
import { createHash } from "node:crypto";
import { ZodError } from "zod";
import { loadConfig } from "./config.js";
import { AppError, errorResponse } from "./errors.js";
import { InMemoryLock, IdempotencyStore } from "./locks.js";
import { PrecomproClient } from "./precompro/client.js";
import { ReservationService } from "./services/reservations.js";
import { toolSpecs } from "./tool-specs.js";

export function buildApp(config = loadConfig()) {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL || "info",
      redact: ["req.url", "req.headers.authorization", "req.headers.x-tool-secret"],
    },
  });

  const client = new PrecomproClient(config);
  const reservationService = new ReservationService({
    client,
    config,
    lock: new InMemoryLock(),
    idempotency: new IdempotencyStore(),
  });

  app.addHook("preHandler", async (request) => {
    if (!request.url.startsWith("/tools")) return;
    if (!config.toolSecret) return;

    const headerSecret = request.headers["x-tool-secret"];
    const bearer = request.headers.authorization?.replace(/^Bearer\s+/i, "");
    if (headerSecret !== config.toolSecret && bearer !== config.toolSecret) {
      throw new AppError("UNAUTHORIZED", "No autorizado.", {}, 401);
    }
  });

  app.get("/health", async () => ({
    ok: true,
    service: "ritwal-precompro-agentic-api",
  }));

  app.get("/", async () => ({
    ok: true,
    service: "ritwal-precompro-agentic-api",
    description:
      "Agent-friendly API for Ritwal reservations through Precompro. Use /tools/schema for callable tool contracts.",
    docs: {
      health: "/health",
      tools: "/tools/schema",
      diagnostics: "/tools/diagnostics/precompro",
    },
  }));

  app.get("/webhooks/whatsapp", async (request, reply) => {
    const query = normalizePayloadObject(request.query);
    const mode = query["hub.mode"];
    const token = query["hub.verify_token"];
    const challenge = query["hub.challenge"];

    if (!config.whatsapp?.verifyToken) {
      return reply.status(503).send({
        ok: false,
        code: "WHATSAPP_WEBHOOK_NOT_CONFIGURED",
        message: "WhatsApp webhook verification is not configured.",
      });
    }

    if (mode === "subscribe" && token === config.whatsapp.verifyToken) {
      return reply.type("text/plain").send(String(challenge || ""));
    }

    return reply.status(403).send({
      ok: false,
      code: "WHATSAPP_WEBHOOK_VERIFICATION_FAILED",
      message: "WhatsApp webhook verification failed.",
    });
  });

  app.post("/webhooks/whatsapp", async (request) => {
    request.log.info(
      { webhook: summarizeWhatsAppWebhook(request.body) },
      "Received WhatsApp webhook event",
    );
    return { ok: true };
  });

  app.get("/tools/restaurant/profile", async () => {
    const [vendor, sections] = await Promise.all([
      client.getVendor(),
      client.getSections(),
    ]);
    return {
      ok: true,
      vendor: vendor.data,
      sections: sections.data,
    };
  });

  app.get("/tools/schema", async () => ({
    ok: true,
    tools: toolSpecs,
  }));

  app.get("/tools/diagnostics/precompro", async () => {
    const [egressIp, vendor, availability] = await Promise.all([
      getEgressIp(),
      probe(() => client.getVendor()),
      probe(() =>
        client.getAvailability({
          people: 2,
          date: tomorrowBogota(),
          zone: 0,
          subzone: 0,
        }),
      ),
    ]);

    return {
      ok: vendor.ok && availability.ok,
      egressIp,
      precompro: {
        vendorId: config.precompro.vendorId,
        apiKeyFingerprint: fingerprint(config.precompro.apiKey),
        reservationBase: config.precompro.reservationBase,
        availabilityBase: config.precompro.availabilityBase,
        vendorBase: config.precompro.vendorBase,
        webserviceBase: config.precompro.webserviceBase,
      },
      checks: {
        vendor,
        availability,
      },
    };
  });

  app.post("/tools/availability", async (request) => {
    return reservationService.availability(toolPayload(request));
  });

  app.post("/tools/reservations/create", async (request) => {
    return reservationService.create(toolPayload(request));
  });

  app.post("/tools/reservations/search", async (request) => {
    return reservationService.search(toolPayload(request));
  });

  app.post("/tools/reservations/list-date", async (request) => {
    return reservationService.listByDate(toolPayload(request));
  });

  app.post("/tools/reservations/list-range", async (request) => {
    return reservationService.listRange(toolPayload(request));
  });

  app.post("/tools/reservations/report", async (request) => {
    return reservationService.report(toolPayload(request));
  });

  app.post("/tools/reservations/update", async (request) => {
    return reservationService.update(toolPayload(request));
  });

  app.post("/tools/reservations/cancel", async (request) => {
    return reservationService.cancel(toolPayload(request));
  });

  app.post("/tools/reservations/confirm", async (request) => {
    return reservationService.confirm(toolPayload(request));
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      request.log.warn(
        {
          err: error,
          payloadShape: summarizePayloadShape(request.body),
          queryShape: summarizePayloadShape(request.query),
          contentType: request.headers["content-type"],
        },
        "Tool payload validation failed",
      );
      return reply.status(400).send({
        ok: false,
        code: "VALIDATION_ERROR",
        message: "La solicitud no tiene el formato esperado.",
        details: error.flatten(),
      });
    }

    request.log.error(error);

    if (error instanceof AppError) {
      return reply.status(error.statusCode).send(errorResponse(error));
    }

    if (error.message === "LOCKED") {
      return reply.status(409).send({
        ok: false,
        code: "REQUEST_IN_PROGRESS",
        message: "Ya estoy procesando una solicitud igual. Intenta de nuevo en unos segundos.",
        details: {},
      });
    }

    return reply.status(500).send(errorResponse(error));
  });

  return app;
}

function fingerprint(value) {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

async function probe(fn) {
  try {
    const response = await fn();
    return {
      ok: response.ok,
      status: response.status,
      result: summarizeProbeData(response.data),
    };
  } catch (error) {
    return {
      ok: false,
      code: error.code || "PROBE_FAILED",
      status: error.statusCode || null,
      precomproStatus: error.details?.status || null,
      message: error.message,
    };
  }
}

async function getEgressIp() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2500);
    const response = await fetch("https://api.ipify.org?format=json", {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!response.ok) return null;
    const data = await response.json();
    return data.ip || null;
  } catch {
    return null;
  }
}

function summarizeProbeData(data) {
  if (Array.isArray(data)) {
    return { type: "array", count: data.length };
  }
  if (data?.vendor) {
    return { vendor: data.vendor.displayName, timezone: data.vendor.timezone };
  }
  if (data?.data && Array.isArray(data.data)) {
    return { type: "data-array", count: data.data.length };
  }
  return data?.message ? { message: data.message } : null;
}

function tomorrowBogota() {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(new Date(Date.now() + 24 * 60 * 60 * 1000));
}

export function toolPayload(request) {
  const body = normalizePayloadObject(request.body);
  const query = normalizePayloadObject(request.query);
  return {
    ...query,
    ...body,
  };
}

function normalizePayloadObject(value) {
  const parsed = parsePayload(value);
  if (!parsed || typeof parsed !== "object") return {};

  if (Array.isArray(parsed)) {
    return normalizePayloadArray(parsed);
  }

  const envelopeKeys = [
    "body",
    "input",
    "inputs",
    "args",
    "arguments",
    "parameters",
    "params",
    "data",
    "payload",
    "toolInput",
    "tool_payload",
  ];

  for (const key of envelopeKeys) {
    if (Object.prototype.hasOwnProperty.call(parsed, key)) {
      const nested = normalizePayloadObject(parsed[key]);
      if (Object.keys(nested).length) return nested;
    }
  }

  return parsed;
}

function normalizePayloadArray(values) {
  const payload = {};

  for (const item of values) {
    const parsed = parsePayload(item);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;

    const key = parsed.key || parsed.id || parsed.name;
    if (typeof key === "string" && hasParameterValue(parsed)) {
      payload[key] = parsed.value ?? parsed.defaultValue;
      continue;
    }

    Object.assign(payload, normalizePayloadObject(parsed));
  }

  return payload;
}

function hasParameterValue(value) {
  return (
    Object.prototype.hasOwnProperty.call(value, "value") ||
    Object.prototype.hasOwnProperty.call(value, "defaultValue")
  );
}

function summarizePayloadShape(value, depth = 0) {
  if (value === undefined) return { type: "undefined" };
  if (value === null) return { type: "null" };
  if (typeof value === "string") {
    return { type: "string", length: value.length, jsonLike: value.trim().startsWith("{") || value.trim().startsWith("[") };
  }
  if (typeof value !== "object") return { type: typeof value };
  if (depth >= 2) return { type: Array.isArray(value) ? "array" : "object" };

  if (Array.isArray(value)) {
    return {
      type: "array",
      length: value.length,
      items: value.slice(0, 5).map((item) => summarizePayloadShape(item, depth + 1)),
    };
  }

  const keys = Object.keys(value);
  return {
    type: "object",
    keys,
    parameterKey: typeof value.key === "string" ? value.key : undefined,
    parameterId: typeof value.id === "string" ? value.id : undefined,
    parameterName: typeof value.name === "string" ? value.name : undefined,
    hasValue: Object.prototype.hasOwnProperty.call(value, "value"),
    hasDefaultValue: Object.prototype.hasOwnProperty.call(value, "defaultValue"),
    nested: Object.fromEntries(
      keys
        .filter((key) => ["body", "input", "inputs", "args", "arguments", "parameters", "params", "data", "payload", "toolInput", "tool_payload"].includes(key))
        .map((key) => [key, summarizePayloadShape(value[key], depth + 1)]),
    ),
  };
}

export function summarizeWhatsAppWebhook(value) {
  const summary = {
    object: typeof value?.object === "string" ? value.object : undefined,
    entryCount: 0,
    changeCount: 0,
    messageCount: 0,
    statusCount: 0,
    errorCount: 0,
  };

  if (!value || typeof value !== "object" || !Array.isArray(value.entry)) {
    return summary;
  }

  summary.entryCount = value.entry.length;

  for (const entry of value.entry) {
    if (!entry || typeof entry !== "object" || !Array.isArray(entry.changes)) continue;

    summary.changeCount += entry.changes.length;

    for (const change of entry.changes) {
      const changeValue = change?.value;
      if (!changeValue || typeof changeValue !== "object") continue;

      if (Array.isArray(changeValue.messages)) {
        summary.messageCount += changeValue.messages.length;
      }
      if (Array.isArray(changeValue.statuses)) {
        summary.statusCount += changeValue.statuses.length;
      }
      if (Array.isArray(changeValue.errors)) {
        summary.errorCount += changeValue.errors.length;
      }
    }
  }

  return summary;
}

function parsePayload(value) {
  if (value === undefined || value === null || value === "") return {};
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return {};
    }
  }
  return value;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const config = loadConfig();
  const app = buildApp(config);
  await app.listen({ port: config.port, host: "0.0.0.0" });
}
