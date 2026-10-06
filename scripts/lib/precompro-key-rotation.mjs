import { randomUUID, createHash } from "node:crypto";

const DAY_MS = 86400000;
const GRACE_MS = 20 * 60000;

export function parseEnv(text = "") {
  return Object.fromEntries(text.split(/\r?\n/).filter(line => line.includes("=") && !line.trim().startsWith("#")).map(line => {
    const index = line.indexOf("=");
    return [line.slice(0, index).trim(), line.slice(index + 1)];
  }));
}

export function updateEnv(text, values) {
  for (const [name, value] of Object.entries(values)) {
    if (/[\r\n]/.test(value)) throw new Error("Invalid environment value");
    const pattern = new RegExp(`^${name}=.*$`, "gm");
    text = pattern.test(text) ? text.replace(pattern, () => `${name}=${value}`) : text.replace(/\s*$/, "") + `\n${name}=${value}\n`;
  }
  return text;
}

export function isDue(value, days, now) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(days) || days <= 0) throw new Error("Refresh interval must be positive");
  if (!Number.isFinite(timestamp) || timestamp > now) throw new Error("A valid renewal baseline is required; do not rotate with unknown age");
  return now - timestamp >= days * DAY_MS;
}

// /refresh is not idempotent. Never retry it automatically, including after a timeout.
export async function runRotation({ env, args = new Set(), store, fetchImpl = fetch, now = Date.now, log = () => {}, wait = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  const required = name => {
    if (!env[name]) throw new Error(`${name} is required`);
    return env[name];
  };
  const id = required("DOKPLOY_APPLICATION_ID");
  const dokployKey = required("DOKPLOY_API_KEY");
  const runtimeKey = required("PRECOMPRO_API_KEY");
  const base = (env.DOKPLOY_BASE_URL || "https://grupomistico.cloud/api").replace(/\/$/, "");
  const timeout = Number(env.PRECOMPRO_REFRESH_TIMEOUT_MS || 20000);
  if (!Number.isFinite(timeout) || timeout < 1000 || timeout > 60000) throw new Error("Invalid request timeout");
  async function request(url, options = {}) {
    let response;
    try { response = await fetchImpl(url, { ...options, signal: AbortSignal.timeout(timeout) }); }
    catch { throw new Error("Network failure or timeout; response outcome may be unknown"); }
    if (!response.ok) {
      const error = new Error(`HTTP ${response.status}`);
      error.httpStatus = response.status;
      throw error;
    }
    const text = await response.text();
    if (!text) return null; // Dokploy mutation endpoints can return an empty successful body.
    try { return JSON.parse(text); } catch { throw new Error("Invalid JSON response; outcome may be unknown"); }
  }
  const dokploy = (path, body) => request(base + path, {
    method: body ? "POST" : "GET",
    headers: { accept: "application/json", "x-api-key": dokployKey, ...(body ? { "content-type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const getApp = () => dokploy(`/application.one?applicationId=${encodeURIComponent(id)}`);
  const saveEnv = (app, text) => dokploy("/application.saveEnvironment", {
    applicationId: id, env: text, buildArgs: app.buildArgs ?? null,
    buildSecrets: app.buildSecrets ?? null, createEnvFile: app.createEnvFile ?? true,
  });
  const diagnose = async () => {
    const url = required("PUBLIC_MIDDLEWARE_URL").replace(/\/$/, "");
    const diagnostics = await request(url + "/tools/diagnostics/precompro", { headers: { accept: "application/json", "x-tool-secret": required("TOOL_SECRET") } });
    if (!diagnostics?.ok || !diagnostics.checks?.vendor?.ok || !diagnostics.checks?.availability?.ok) throw new Error("Precompro vendor/availability verification failed");
    const expectedFingerprint = createHash("sha256").update(runtimeKey).digest("hex").slice(0, 12);
    if (diagnostics.precompro?.apiKeyFingerprint !== expectedFingerprint) throw new Error("Public application is not using the expected key; wait for the correct deployment");
    log({ event: "precompro_integration_verified", vendorOk: true, availabilityOk: true });
  };

  // Validate Dokploy authentication on EVERY run, even when rotation is not due.
  let app = await getApp();
  let appEnv = parseEnv(app.env);
  if (!appEnv.PRECOMPRO_API_KEY) throw new Error("Dokploy application is missing its Precompro key");
  const days = Number(appEnv.PRECOMPRO_REFRESH_INTERVAL_DAYS || 20);
  const scheduledDue = isDue(appEnv.PRECOMPRO_API_KEY_REFRESHED_AT, days, now());
  const due = args.has("--force") || scheduledDue;
  let state = await store.read();
  if (state && (!/^[a-f0-9-]{36}$/.test(state.id || "") || !["refresh_requested", "key_received", "env_saved", "redeploy_requested", "verified", "rejected"].includes(state.phase))) throw new Error("Invalid renewal journal; reconcile it manually before rotating");
  if (state && ["key_received", "env_saved", "redeploy_requested", "verified"].includes(state.phase) && (typeof state.newApiKey !== "string" || !state.newApiKey || !Number.isFinite(Date.parse(state.refreshedAt)))) throw new Error("Incomplete renewal journal; recover it before rotating");
  log({ event: "precompro_refresh_check", due, intervalDays: days, refreshedAt: appEnv.PRECOMPRO_API_KEY_REFRESHED_AT, pendingPhase: state?.phase || null });
  if (args.has("--dry-run")) return { due, phase: state?.phase || null };
  await store.prepare();

  if (args.has("--adopt-current")) {
    if (runtimeKey !== appEnv.PRECOMPRO_API_KEY) throw new Error("Apply the saved key before adopting it");
    await diagnose();
    if (state) await store.archive(state);
    state = { id: randomUUID(), phase: "verified", source: "manual-confirmed", newApiKey: runtimeKey, refreshedAt: appEnv.PRECOMPRO_API_KEY_REFRESHED_AT, verifiedAt: new Date(now()).toISOString() };
    await store.write(state); await store.archive(state);
    return { due, phase: "verified" };
  }

  if (state?.phase === "refresh_requested") throw new Error("Previous refresh has an unknown outcome. Do not renew again; recover the provider key first");
  if (state?.newApiKey && !["verified", "rejected"].includes(state.phase)) {
    if (![state.previousApiKey, state.newApiKey].includes(appEnv.PRECOMPRO_API_KEY)) throw new Error("Key changed outside this rotation; manual reconciliation required");
    if (appEnv.PRECOMPRO_API_KEY !== state.newApiKey) {
      if (args.has("--verify-only")) {
        // Recover a received key first. Never generate another key during recovery.
        log({ event: "precompro_recovering_received_key" });
      }
      await persistReceivedKey();
    }
    return finishPending();
  }

  if (runtimeKey !== appEnv.PRECOMPRO_API_KEY) throw new Error("Runtime key differs from Dokploy; apply saved environment before renewing");
  if (args.has("--verify-only") || !due) {
    await diagnose();
    if (!state || state.newApiKey !== appEnv.PRECOMPRO_API_KEY || state.refreshedAt !== appEnv.PRECOMPRO_API_KEY_REFRESHED_AT) {
      if (state) await store.archive(state);
      state = { id: randomUUID(), phase: "verified", source: appEnv.PRECOMPRO_API_KEY_REFRESH_SOURCE || "adopted", newApiKey: appEnv.PRECOMPRO_API_KEY, refreshedAt: appEnv.PRECOMPRO_API_KEY_REFRESHED_AT, verifiedAt: new Date(now()).toISOString() };
      await store.write(state);
      await store.archive(state);
    }
    return { due, phase: "verified" };
  }

  // Check read AND write access before invalidating the working provider credential.
  await diagnose();
  await saveEnv(app, app.env);
  const preflight = await getApp();
  if (preflight.env !== app.env) throw new Error("Environment changed during preflight; refusing renewal");
  if (state) await store.archive(state);
  state = { id: randomUUID(), phase: "refresh_requested", source: "automatic", previousApiKey: appEnv.PRECOMPRO_API_KEY, startedAt: new Date(now()).toISOString() };
  await store.write(state); // fsynced persistent marker BEFORE the non-idempotent request.
  let data;
  try {
    data = await request(required("PRECOMPRO_WEBSERVICE_BASE").replace(/\/$/, "") + "/refresh", { headers: { apiKey: state.previousApiKey, accept: "application/json" } });
  } catch (error) {
    // Only definitive authentication/validation rejection is safe to retry on a future run.
    if ([400, 401, 403].includes(error.httpStatus)) {
      state = { ...state, phase: "rejected", httpStatus: error.httpStatus };
      await store.write(state);
      await store.archive(state);
    }
    throw error;
  }
  const newApiKey = data?.apiKey || data?.apikey || data?.api_key || data?.key;
  if (typeof newApiKey !== "string" || !newApiKey || /[\r\n]/.test(newApiKey)) throw new Error("Refresh returned no usable key; outcome is unknown, do not retry");
  state = { ...state, phase: "key_received", newApiKey, refreshedAt: new Date(now()).toISOString() };
  await store.write(state); // The actual key is durable BEFORE any Dokploy call.
  await store.archive(state);
  log({ event: "precompro_received_key_backed_up", rotationId: state.id });
  await persistReceivedKey();
  return finishPending();

  async function persistReceivedKey() {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        app = await getApp(); appEnv = parseEnv(app.env);
        if (![state.previousApiKey, state.newApiKey].includes(appEnv.PRECOMPRO_API_KEY)) throw new Error("Key changed outside this rotation");
        const text = updateEnv(app.env, { PRECOMPRO_API_KEY: state.newApiKey, PRECOMPRO_API_KEY_REFRESHED_AT: state.refreshedAt, PRECOMPRO_API_KEY_REFRESH_SOURCE: "automatic", PRECOMPRO_REFRESH_INTERVAL_DAYS: String(days) });
        await saveEnv(app, text);
        app = await getApp(); appEnv = parseEnv(app.env);
        if (appEnv.PRECOMPRO_API_KEY !== state.newApiKey || appEnv.PRECOMPRO_API_KEY_REFRESHED_AT !== state.refreshedAt) throw new Error("Saved environment verification failed");
        state = { ...state, phase: "env_saved" };
        await store.write(state);
        log({ event: "precompro_key_saved", rotationId: state.id });
        return;
      } catch (error) {
        if (error.message.includes("outside this rotation")) throw error;
        log({ event: "dokploy_save_failed", attempt, keyBackupAvailable: true });
        if (attempt === 3) throw new Error("Could not save received key; persistent backup is available for the next recovery run");
        await wait(1000 * attempt);
      }
    }
  }

  async function finishPending() {
    if (runtimeKey === state.newApiKey) {
      await diagnose();
      state = { ...state, phase: "verified", verifiedAt: new Date(now()).toISOString() };
      await store.write(state); await store.archive(state);
      return { due, phase: "verified" };
    }
    if (state.phase === "redeploy_requested") {
      if (now() - Date.parse(state.redeployRequestedAt) > GRACE_MS) throw new Error("Saved key not active after 20 minutes; investigate redeploy. No new rotation will be attempted");
      log({ event: "precompro_waiting_for_redeploy", rotationId: state.id });
      return { due, phase: state.phase };
    }
    if (args.has("--skip-redeploy")) return { due, phase: state.phase };
    state = { ...state, phase: "redeploy_requested", redeployRequestedAt: new Date(now()).toISOString() };
    await store.write(state); // Persist before self-redeploy can terminate this process.
    await dokploy("/application.redeploy", { applicationId: id, title: "Scheduled Precompro apiKey refresh", description: `Apply backed-up rotation ${state.id}; verification runs separately.` });
    log({ event: "dokploy_redeploy_queued", rotationId: state.id });
    return { due, phase: state.phase };
  }
}
