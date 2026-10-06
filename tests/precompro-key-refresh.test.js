import { describe, expect, it } from "vitest";
import { mkdtemp, stat, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { runRotation, isDue, updateEnv, parseEnv } from "../scripts/lib/precompro-key-rotation.mjs";
import { createFileStateStore } from "../scripts/lib/precompro-key-state.mjs";

const currentTime = Date.parse("2026-10-06T16:00:00Z");
function fixture({ due = true, pending = null, key = "old-test-key" } = {}) {
  const env = { DOKPLOY_APPLICATION_ID: "app", DOKPLOY_API_KEY: "dokploy-test-key", PRECOMPRO_API_KEY: key, PRECOMPRO_WEBSERVICE_BASE: "https://provider.test/api", PUBLIC_MIDDLEWARE_URL: "https://middleware.test", TOOL_SECRET: "tool-test-key", DOKPLOY_BASE_URL: "https://dokploy.test/api" };
  const app = { env: `# Preserve me\nUNRELATED=a=b\nPRECOMPRO_API_KEY=${key}\nPRECOMPRO_API_KEY_REFRESHED_AT=${due ? "2026-09-01T00:00:00Z" : "2026-10-06T15:00:00Z"}\nPRECOMPRO_REFRESH_INTERVAL_DAYS=20\n`, buildArgs: "ARG=preserve", buildSecrets: "SECRET=preserve", createEnvFile: false };
  const events = [], calls = [], logs = [], archives = [];
  let state = pending;
  const failures = {};
  const store = { prepare: async () => events.push("prepare"), read: async () => state, write: async value => { state = structuredClone(value); events.push(`write:${value.phase}`); }, archive: async value => archives.push(structuredClone(value)) };
  const fetchImpl = async (url, options) => {
    const path = new URL(url).pathname;
    calls.push({ path, options }); events.push(path);
    if (failures[path]) {
      const result = failures[path](options);
      if (result) return result;
    }
    if (path.endsWith("application.one")) return Response.json(app);
    if (path.endsWith("application.saveEnvironment")) { const body = JSON.parse(options.body); app.env = body.env; return new Response(null, { status: 200 }); }
    if (path.endsWith("application.redeploy")) return new Response(null, { status: 200 });
    if (path.endsWith("/refresh")) return Response.json({ apiKey: "new-test-key" });
    if (path.endsWith("/diagnostics/precompro")) return Response.json({ ok: true, precompro: { apiKeyFingerprint: createHash("sha256").update(env.PRECOMPRO_API_KEY).digest("hex").slice(0, 12) }, checks: { vendor: { ok: true }, availability: { ok: true } } });
    throw new Error("Unexpected request");
  };
  const run = (args = []) => runRotation({ env, args: new Set(args), store, fetchImpl, now: () => currentTime, log: value => logs.push(value), wait: async () => {} });
  return { run, env, app, failures, calls, events, logs, archives, state: () => state, refreshes: () => calls.filter(c => c.path.endsWith("/refresh")).length };
}

describe("safe key rotation", () => {
  it("checks Dokploy authentication before any provider mutation", async () => {
    const f = fixture(); f.failures["/api/application.one"] = () => new Response(null, { status: 401 });
    await expect(f.run()).rejects.toThrow("HTTP 401"); expect(f.refreshes()).toBe(0);
  });
  it("checks write permissions before rotation", async () => {
    const f = fixture(); f.failures["/api/application.saveEnvironment"] = () => new Response(null, { status: 403 });
    await expect(f.run()).rejects.toThrow("HTTP 403"); expect(f.refreshes()).toBe(0);
  });
  it("verifies a non-due key and privately seeds its recovery ledger", async () => {
    const f = fixture({ due: false }); expect(await f.run()).toEqual({ due: false, phase: "verified" });
    expect(f.refreshes()).toBe(0); expect(f.state().newApiKey).toBe("old-test-key"); expect(f.archives).toHaveLength(1);
  });
  it("dry-run neither writes state nor rotates nor saves environment", async () => {
    const f = fixture(); expect((await f.run(["--dry-run"])).due).toBe(true);
    expect(f.events).not.toContain("prepare"); expect(f.state()).toBeNull(); expect(f.refreshes()).toBe(0);
  });
  it("backs up the received key before saving it and handles empty success bodies", async () => {
    const f = fixture(); expect((await f.run()).phase).toBe("redeploy_requested");
    expect(f.refreshes()).toBe(1);
    const received = f.events.indexOf("write:key_received");
    expect(received).toBeGreaterThan(f.events.indexOf("write:refresh_requested"));
    expect(f.events.indexOf("/api/application.saveEnvironment", received)).toBeGreaterThan(received);
    expect(parseEnv(f.app.env).PRECOMPRO_API_KEY).toBe("new-test-key");
    expect(f.app.env).toContain("# Preserve me\nUNRELATED=a=b\n");
    const body = JSON.parse(f.calls.filter(c => c.path.endsWith("saveEnvironment")).at(-1).options.body);
    expect(body).toMatchObject({ buildArgs: "ARG=preserve", buildSecrets: "SECRET=preserve", createEnvFile: false });
    expect(JSON.stringify(f.logs)).not.toMatch(/old-test-key|new-test-key|dokploy-test-key|tool-test-key/);
  });
  it("retains the received key after save failures and recovers without rotating again", async () => {
    const f = fixture(); let count = 0;
    f.failures["/api/application.saveEnvironment"] = () => ++count > 1 ? new Response(null, { status: 503 }) : null;
    await expect(f.run()).rejects.toThrow("persistent backup");
    expect(f.state().phase).toBe("key_received"); expect(f.state().newApiKey).toBe("new-test-key"); expect(count).toBe(4);
    delete f.failures["/api/application.saveEnvironment"];
    expect((await f.run(["--verify-only"])).phase).toBe("redeploy_requested"); expect(f.refreshes()).toBe(1);
  });
  it.each(["timeout", "server error", "malformed JSON", "no key"])("blocks a second rotation after ambiguous %s", async kind => {
    const f = fixture(); f.failures["/api/refresh"] = () => {
      if (kind === "timeout") throw new Error("Connection lost");
      if (kind === "server error") return new Response(null, { status: 500 });
      if (kind === "malformed JSON") return new Response("not JSON", { status: 200 });
      return Response.json({});
    };
    await expect(f.run()).rejects.toThrow(); expect(f.state().phase).toBe("refresh_requested");
    await expect(f.run()).rejects.toThrow("unknown outcome"); expect(f.refreshes()).toBe(1);
  });
  it("records definitive rejection without claiming renewal succeeded", async () => {
    const f = fixture(); f.failures["/api/refresh"] = () => new Response(null, { status: 401 });
    await expect(f.run()).rejects.toThrow("HTTP 401"); expect(f.state().phase).toBe("rejected");
  });
  it("verify-only never generates a fresh key even when due", async () => {
    const f = fixture(); expect((await f.run(["--verify-only"])).phase).toBe("verified"); expect(f.refreshes()).toBe(0);
  });
  it("marks a rotation complete only after deployed-key diagnostics succeed", async () => {
    const f = fixture(); await f.run(); f.env.PRECOMPRO_API_KEY = "new-test-key";
    expect((await f.run(["--verify-only"])).phase).toBe("verified"); expect(f.state().verifiedAt).toBeTruthy(); expect(f.refreshes()).toBe(1);
  });
  it("does not mark a failing application verified", async () => {
    const f = fixture(); await f.run(); f.env.PRECOMPRO_API_KEY = "new-test-key";
    f.failures["/tools/diagnostics/precompro"] = () => Response.json({ ok: false });
    await expect(f.run(["--verify-only"])).rejects.toThrow("verification failed"); expect(f.state().phase).toBe("redeploy_requested");
  });
  it("checks that the public application uses the expected key", async () => {
    const f = fixture({ due: false });
    f.failures["/tools/diagnostics/precompro"] = () => Response.json({ ok: true, precompro: { apiKeyFingerprint: "wrong-key" }, checks: { vendor: { ok: true }, availability: { ok: true } } });
    await expect(f.run()).rejects.toThrow("expected key"); expect(f.state()).toBeNull(); expect(f.refreshes()).toBe(0);
  });
  it("does not rotate from an unrecognized or incomplete journal", async () => {
    const f = fixture({ pending: { id: randomUUID(), phase: "unexpected" } });
    await expect(f.run()).rejects.toThrow("Invalid renewal journal"); expect(f.refreshes()).toBe(0);
    const g = fixture({ pending: { id: randomUUID(), phase: "verified" } });
    await expect(g.run()).rejects.toThrow("Incomplete renewal journal"); expect(g.refreshes()).toBe(0);
  });
  it("does not overwrite a key changed by another operator", async () => {
    const f = fixture(); await f.run(); f.app.env = updateEnv(f.app.env, { PRECOMPRO_API_KEY: "external-test-key" });
    await expect(f.run()).rejects.toThrow("outside this rotation"); expect(f.refreshes()).toBe(1);
  });
  it("explicit manual adoption resolves an ambiguous journal without refreshing", async () => {
    const f = fixture({ pending: { id: randomUUID(), phase: "refresh_requested", previousApiKey: "other-test-key" } });
    expect((await f.run(["--adopt-current"])).phase).toBe("verified"); expect(f.refreshes()).toBe(0);
    expect(f.state().source).toBe("manual-confirmed"); expect(f.archives[0].phase).toBe("refresh_requested");
  });
  it("reports a redeploy timeout without generating another key", async () => {
    const pending = { id: randomUUID(), phase: "redeploy_requested", previousApiKey: "old-test-key", newApiKey: "new-test-key", refreshedAt: "2026-10-06T15:00:00Z", redeployRequestedAt: "2026-10-06T15:00:00Z" };
    const f = fixture({ pending }); f.app.env = updateEnv(f.app.env, { PRECOMPRO_API_KEY: "new-test-key", PRECOMPRO_API_KEY_REFRESHED_AT: pending.refreshedAt });
    await expect(f.run(["--verify-only"])).rejects.toThrow("after 20 minutes"); expect(f.refreshes()).toBe(0);
  });
  it.each(["", "nonsense", "2026-10-07T00:00:00Z"])("refuses unsafe baseline %s even with force", async baseline => {
    const f = fixture(); f.app.env = updateEnv(f.app.env, { PRECOMPRO_API_KEY_REFRESHED_AT: baseline });
    await expect(f.run(["--force"])).rejects.toThrow("baseline"); expect(f.refreshes()).toBe(0);
  });
  it("validates intervals and measures elapsed days, not calendar day-of-month", () => {
    expect(() => isDue("2026-09-01", -1, currentTime)).toThrow();
    expect(isDue("2026-09-16T16:00:00Z", 20, currentTime)).toBe(true);
    expect(isDue("2026-09-16T16:00:01Z", 20, currentTime)).toBe(false);
  });
  it("updates duplicate definitions without losing unrelated content", () => {
    expect(updateEnv("A=first\nB=x=y\nA=second\n", { A: "safe" })).toBe("A=safe\nB=x=y\nA=safe\n");
  });
});

describe("private persistent rotation state", () => {
  it("writes atomically with restrictive permissions and fails closed on corrupt state", async () => {
    const root = await mkdtemp(join(tmpdir(), "precompro-state-test-"));
    try {
      const store = createFileStateStore(root, { requireMount: false });
      expect(await store.read()).toBeNull(); await store.prepare();
      const value = { id: randomUUID(), phase: "key_received", newApiKey: "private-test-key" };
      await store.write(value); await store.archive(value); expect(await store.read()).toEqual(value);
      for (const dir of [root, join(root, "history")]) expect((await stat(dir)).mode & 0o777).toBe(0o700);
      for (const file of [join(root, "rotation.json"), join(root, "history", value.id + ".json")]) expect((await stat(file)).mode & 0o777).toBe(0o600);
      expect(JSON.parse(await readFile(join(root, "rotation.json"), "utf8"))).toEqual(value);
      await writeFile(join(root, "rotation.json"), "broken"); await expect(store.read()).rejects.toThrow("do not rotate");
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  it("refuses production rotation without a mounted volume", async () => {
    const store = createFileStateStore(join(tmpdir(), "not-a-precompro-volume"));
    await expect(store.prepare()).rejects.toThrow(/persistent Linux volume|mounted persistent volume/);
  });
});
