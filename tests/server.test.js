import { describe, expect, it } from "vitest";
import { buildApp, summarizeWhatsAppWebhook, toolPayload } from "../src/server.js";

const testConfig = {
  toolSecret: "",
  precompro: {
    apiKey: "api-key-test",
    vendorId: "vendor-test",
    reservationBase: "https://precompro.test/reservation",
    availabilityBase: "https://precompro.test/availability",
    vendorBase: "https://precompro.test/vendor",
    webserviceBase: "https://precompro.test/webservice",
  },
  defaults: {
    countryCode: 57,
    timezone: "America/Bogota",
    maxAutomaticPartySize: 18,
    requestTimeoutMs: 8000,
    idempotencyTtlMs: 600000,
    lockTtlMs: 15000,
  },
  whatsapp: {
    verifyToken: "verify-test",
    accessToken: "",
    phoneNumberId: "",
    businessAccountId: "",
  },
};

describe("toolPayload", () => {
  it("accepts direct JSON bodies from normal HTTP callers", () => {
    expect(
      toolPayload({
        body: { date: "2026-05-16", partySize: 5, time: "15:00" },
        query: {},
      }),
    ).toEqual({ date: "2026-05-16", partySize: 5, time: "15:00" });
  });

  it("unwraps body envelopes used by some tool runtimes", () => {
    expect(
      toolPayload({
        body: { body: { date: "2026-05-16", partySize: 5 } },
        query: {},
      }),
    ).toEqual({ date: "2026-05-16", partySize: 5 });
  });

  it("unwraps args envelopes used by LLM tool calls", () => {
    expect(
      toolPayload({
        body: { args: { date: "2026-05-16", partySize: 5 } },
        query: {},
      }),
    ).toEqual({ date: "2026-05-16", partySize: 5 });
  });

  it("accepts generic parameter arrays", () => {
    expect(
      toolPayload({
        body: [
          { key: "date", type: "string", value: "2026-05-16" },
          { key: "partySize", type: "number", value: 5 },
          { key: "time", type: "string", value: "15:00" },
        ],
        query: {},
      }),
    ).toEqual({ date: "2026-05-16", partySize: 5, time: "15:00" });
  });

  it("accepts parameter arrays inside envelopes", () => {
    expect(
      toolPayload({
        body: {
          body: [
            { id: "date", value: "2026-05-16" },
            { id: "partySize", value: 5 },
          ],
        },
        query: {},
      }),
    ).toEqual({ date: "2026-05-16", partySize: 5 });
  });

  it("merges object arrays when a runtime sends one object per parameter", () => {
    expect(
      toolPayload({
        body: [{ date: "2026-05-16" }, { partySize: 5 }, { time: "15:00" }],
        query: {},
      }),
    ).toEqual({ date: "2026-05-16", partySize: 5, time: "15:00" });
  });

  it("accepts JSON-string envelopes", () => {
    expect(
      toolPayload({
        body: {
          arguments: JSON.stringify({
            date: "2026-05-16",
            partySize: 5,
          }),
        },
        query: {},
      }),
    ).toEqual({ date: "2026-05-16", partySize: 5 });
  });

  it("unwraps generic runtime tool_payload envelopes", () => {
    expect(
      toolPayload({
        body: {
          agent_id: "agent-test",
          convo_id: "conversation-test",
          session_id: "session-test",
          tool_metadata: { name: "check_availability" },
          tool_payload: {
            date: "2026-05-16",
            partySize: 5,
            time: "15:00",
          },
        },
        query: {},
      }),
    ).toEqual({ date: "2026-05-16", partySize: 5, time: "15:00" });
  });

  it("falls back to query parameters when the body is empty", () => {
    expect(
      toolPayload({
        body: undefined,
        query: { date: "2026-05-16", partySize: "5" },
      }),
    ).toEqual({ date: "2026-05-16", partySize: "5" });
  });

  it("lets body values override query fallbacks", () => {
    expect(
      toolPayload({
        body: { partySize: 5, time: "15:00" },
        query: { date: "2026-05-16", partySize: "3" },
      }),
    ).toEqual({ date: "2026-05-16", partySize: 5, time: "15:00" });
  });
});

describe("WhatsApp webhook", () => {
  it("returns the Meta challenge when verify token matches", async () => {
    const app = buildApp(testConfig);

    const response = await app.inject({
      method: "GET",
      url: "/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=verify-test&hub.challenge=challenge-123",
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe("challenge-123");
  });

  it("rejects webhook verification when verify token does not match", async () => {
    const app = buildApp(testConfig);

    const response = await app.inject({
      method: "GET",
      url: "/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=challenge-123",
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      ok: false,
      code: "WHATSAPP_WEBHOOK_VERIFICATION_FAILED",
    });
  });

  it("acknowledges incoming webhook events", async () => {
    const app = buildApp(testConfig);

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/whatsapp",
      payload: {
        object: "whatsapp_business_account",
        entry: [
          {
            changes: [
              {
                value: {
                  messages: [{ id: "wamid.test" }],
                  statuses: [{ id: "wamid.test", status: "delivered" }],
                },
              },
            ],
          },
        ],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
  });
});

describe("summarizeWhatsAppWebhook", () => {
  it("summarizes event counts without preserving message contents", () => {
    expect(
      summarizeWhatsAppWebhook({
        object: "whatsapp_business_account",
        entry: [
          {
            changes: [
              {
                value: {
                  messages: [{ from: "573001112233", text: { body: "hola" } }],
                  statuses: [{ recipient_id: "573001112233", status: "read" }],
                  errors: [{ code: 131000 }],
                },
              },
            ],
          },
        ],
      }),
    ).toEqual({
      object: "whatsapp_business_account",
      entryCount: 1,
      changeCount: 1,
      messageCount: 1,
      statusCount: 1,
      errorCount: 1,
    });
  });
});
