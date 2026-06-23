#!/usr/bin/env node
import "dotenv/config";
import { createHash } from "node:crypto";

const DAY_MS = 24 * 60 * 60 * 1000;
const args = new Set(process.argv.slice(2));

const force = args.has("--force");
const dryRun = args.has("--dry-run");
const skipRedeploy = args.has("--skip-redeploy");
const skipDiagnostics = args.has("--skip-diagnostics");

const intervalDays = Number(process.env.PRECOMPRO_REFRESH_INTERVAL_DAYS || 20);
const refreshedAt = process.env.PRECOMPRO_API_KEY_REFRESHED_AT || "";
const applicationId = required("DOKPLOY_APPLICATION_ID");
const dokployBaseUrl = process.env.DOKPLOY_BASE_URL || "https://grupomistico.cloud/api";
const dokployApiKey = required("DOKPLOY_API_KEY");
const currentApiKey = required("PRECOMPRO_API_KEY");
const webserviceBase = required("PRECOMPRO_WEBSERVICE_BASE");
const publicMiddlewareUrl = process.env.PUBLIC_MIDDLEWARE_URL || "";
const toolSecret = process.env.TOOL_SECRET || "";

const due = force || isDue(refreshedAt, intervalDays);

log({
  event: "precompro_refresh_check",
  due,
  force,
  dryRun,
  intervalDays,
  refreshedAt: refreshedAt || null,
  currentFingerprint: fingerprint(currentApiKey),
});

if (!due) {
  process.exit(0);
}

if (dryRun) {
  log({ event: "precompro_refresh_dry_run", message: "Refresh is due but dry-run is enabled." });
  process.exit(0);
}

const refresh = await refreshPrecomproKey();
const newApiKey = extractApiKey(refresh.data);

if (!newApiKey || newApiKey === currentApiKey) {
  throw new Error("Precompro refresh did not return a new apiKey.");
}

const application = await getApplication();
const envMap = parseEnv(application.env || "");
envMap.PRECOMPRO_API_KEY = newApiKey;
envMap.PRECOMPRO_API_KEY_REFRESHED_AT = new Date().toISOString();
envMap.PRECOMPRO_REFRESH_INTERVAL_DAYS = String(intervalDays);

await saveApplicationEnv(stringifyEnv(envMap));

log({
  event: "precompro_key_refreshed",
  previousFingerprint: fingerprint(currentApiKey),
  newFingerprint: fingerprint(newApiKey),
  refreshedAt: envMap.PRECOMPRO_API_KEY_REFRESHED_AT,
});

if (!skipRedeploy) {
  await redeployApplication();
  log({ event: "dokploy_redeploy_queued", applicationId });
}

if (!skipDiagnostics && !skipRedeploy && publicMiddlewareUrl && toolSecret) {
  await waitForApplicationDone();
  await wait(8000);
  const diagnostics = await callDiagnostics();
  log({
    event: "post_refresh_diagnostics",
    ok: diagnostics.ok,
    egressIp: diagnostics.egressIp || null,
    vendorOk: diagnostics.checks?.vendor?.ok || false,
    availabilityOk: diagnostics.checks?.availability?.ok || false,
  });
  if (!diagnostics.ok) {
    throw new Error("Post-refresh diagnostics failed.");
  }
}

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function isDue(value, days) {
  if (!value) return true;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return true;
  return Date.now() - date.getTime() >= days * DAY_MS;
}

async function refreshPrecomproKey() {
  const response = await fetch(`${webserviceBase}/refresh`, {
    method: "GET",
    headers: {
      apiKey: currentApiKey,
      accept: "application/json",
    },
  });
  const data = await readJson(response);
  if (!response.ok) {
    throw new Error(`Precompro refresh failed ${response.status}: ${JSON.stringify(safeData(data))}`);
  }
  return { status: response.status, data };
}

function extractApiKey(data) {
  if (!data || typeof data !== "object") return "";
  return data.apiKey || data.apikey || data.api_key || data.key || "";
}

async function getApplication() {
  const response = await fetch(
    `${dokployBaseUrl}/application.one?applicationId=${encodeURIComponent(applicationId)}`,
    {
      headers: {
        accept: "application/json",
        "x-api-key": dokployApiKey,
      },
    },
  );
  const data = await readJson(response);
  if (!response.ok) {
    throw new Error(`Dokploy application.one failed ${response.status}: ${JSON.stringify(safeData(data))}`);
  }
  return data;
}

async function saveApplicationEnv(env) {
  await postDokploy("/application.saveEnvironment", {
    applicationId,
    env,
    buildArgs: null,
    buildSecrets: null,
    createEnvFile: true,
  });
}

async function redeployApplication() {
  await postDokploy("/application.redeploy", {
    applicationId,
    title: "Scheduled Precompro apiKey refresh",
    description: "Refresh Precompro apiKey and restart Ritwal middleware.",
  });
}

async function postDokploy(path, body) {
  const response = await fetch(`${dokployBaseUrl}${path}`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "x-api-key": dokployApiKey,
    },
    body: JSON.stringify(body),
  });
  const data = await readJson(response);
  if (!response.ok) {
    throw new Error(`Dokploy ${path} failed ${response.status}: ${JSON.stringify(safeData(data))}`);
  }
  return data;
}

async function waitForApplicationDone() {
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    const application = await getApplication();
    log({
      event: "dokploy_status_poll",
      attempt,
      status: application.applicationStatus,
    });
    if (application.applicationStatus === "done") return;
    await wait(10000);
  }
  throw new Error("Timed out waiting for Dokploy application to finish redeploy.");
}

async function callDiagnostics() {
  const response = await fetch(`${publicMiddlewareUrl.replace(/\/$/, "")}/tools/diagnostics/precompro`, {
    headers: {
      accept: "application/json",
      "x-tool-secret": toolSecret,
    },
  });
  const data = await readJson(response);
  if (!response.ok) {
    throw new Error(`Diagnostics failed ${response.status}: ${JSON.stringify(safeData(data))}`);
  }
  return data;
}

async function readJson(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { text: text.slice(0, 500) };
  }
}

function parseEnv(value) {
  const result = {};
  for (const line of value.split(/\r?\n/)) {
    if (!line || line.trim().startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index === -1) continue;
    result[line.slice(0, index)] = line.slice(index + 1);
  }
  return result;
}

function stringifyEnv(value) {
  return `${Object.entries(value)
    .map(([key, entry]) => `${key}=${entry}`)
    .join("\n")}\n`;
}

function fingerprint(value) {
  return createHash("sha256").update(value || "").digest("hex").slice(0, 12);
}

function safeData(data) {
  if (!data || typeof data !== "object") return data;
  const clone = { ...data };
  for (const key of ["apiKey", "apikey", "api_key", "key", "PRECOMPRO_API_KEY", "DOKPLOY_API_KEY"]) {
    if (Object.prototype.hasOwnProperty.call(clone, key)) {
      clone[key] = "[redacted]";
    }
  }
  return clone;
}

function log(payload) {
  console.log(JSON.stringify(payload));
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
