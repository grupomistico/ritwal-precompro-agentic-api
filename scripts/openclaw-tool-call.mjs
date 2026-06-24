#!/usr/bin/env node
import "dotenv/config";
import { toolSpecs } from "../src/tool-specs.js";

const baseUrl = (process.env.PUBLIC_MIDDLEWARE_URL || "https://ritwal-precompro-api.grupomistico.cloud").replace(/\/$/, "");
const toolSecret = process.env.TOOL_SECRET || "";
const toolName = process.argv[2];
const rawInput = process.argv.slice(3).join(" ").trim();

const specialTools = new Map([
  ["health", { name: "health", method: "GET", path: "/health", auth: false }],
  ["schema", { name: "schema", method: "GET", path: "/tools/schema", auth: true }],
  ["diagnostics", { name: "diagnostics", method: "GET", path: "/tools/diagnostics/precompro", auth: true }],
]);

const writeTools = new Set([
  "create_reservation",
  "update_reservation",
  "cancel_reservation",
  "confirm_reservation",
]);

const zoneTools = new Set(["check_availability", "create_reservation", "update_reservation"]);

const zoneAliases = [
  { id: 1442, name: "Salón", aliases: ["salon"] },
  { id: 1443, name: "Templos", aliases: ["templo", "templos"] },
  { id: 2190, name: "WINE GARDEN", aliases: ["wine", "wine garden", "garden", "jardin"] },
];

const tools = new Map([
  ...specialTools,
  ...toolSpecs.map((tool) => [tool.name, { ...tool, auth: true }]),
]);

try {
  await main();
} catch (error) {
  console.error(error.message);
  if (error.details) {
    console.error(JSON.stringify(error.details, null, 2));
  }
  process.exit(1);
}

async function main() {
  if (!toolName || toolName === "help" || toolName === "--help") {
    printHelp();
    return;
  }

  const tool = tools.get(toolName);
  if (!tool) {
    throw new Error(`Unknown Precompro tool "${toolName}". Run: npm run precompro:tool -- help`);
  }

  if (tool.auth && !toolSecret) {
    throw new Error("TOOL_SECRET is required in .env to call authenticated Precompro tools.");
  }

  if (writeTools.has(tool.name) && process.env.ALLOW_PRECOMPRO_WRITE !== "true") {
    throw new Error(
      `Write tool "${tool.name}" blocked. Set ALLOW_PRECOMPRO_WRITE=true only with explicit Valentin/admin authorization.`,
    );
  }

  const body = await parseBody(tool);
  const response = await fetch(`${baseUrl}${tool.path}`, {
    method: tool.method,
    headers: {
      accept: "application/json",
      ...(tool.auth ? { "x-tool-secret": toolSecret } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  const data = await readJson(response);
  const output = {
    ok: response.ok && data?.ok !== false,
    status: response.status,
    tool: tool.name,
    method: tool.method,
    path: tool.path,
    data,
  };

  console.log(JSON.stringify(output, null, 2));

  if (!response.ok || data?.ok === false) {
    process.exitCode = 1;
  }
}

async function parseBody(tool) {
  if (tool.method === "GET") return undefined;

  let input = rawInput;
  if (input === "-") {
    input = await readStdin();
  }

  if (!input) {
    return normalizeBody(tool, {});
  }

  try {
    return normalizeBody(tool, JSON.parse(input));
  } catch (error) {
    error.details = { inputPreview: input.slice(0, 200) };
    throw new Error(`Invalid JSON input for ${tool.name}.`);
  }
}

function normalizeBody(tool, body) {
  if (!zoneTools.has(tool.name) || !body || Array.isArray(body) || typeof body !== "object") {
    return body;
  }
  if (!Object.hasOwn(body, "zone")) return body;

  const zone = normalizeZone(body.zone);
  return zone === undefined ? body : { ...body, zone };
}

function normalizeZone(value) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "number") return value;
  if (typeof value === "object") {
    const zoneFromId = normalizeZone(value.id);
    if (typeof zoneFromId === "number") return { ...value, id: zoneFromId };
    if (zoneFromId && typeof zoneFromId === "object") return { ...value, ...zoneFromId };

    const zoneFromName = normalizeZone(value.name);
    if (typeof zoneFromName === "number") return { ...value, id: zoneFromName };
    if (zoneFromName && typeof zoneFromName === "object") return { ...value, ...zoneFromName };

    return value;
  }

  const text = String(value).trim();
  if (!text) return undefined;
  if (/^\d+$/.test(text)) return Number(text);

  const key = text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

  const match = zoneAliases.find((zone) => zone.aliases.some((alias) => key.includes(alias)));
  return match ? { id: match.id, name: match.name } : undefined;
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let value = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      value += chunk;
    });
    process.stdin.on("end", () => resolve(value.trim()));
    process.stdin.on("error", reject);
  });
}

async function readJson(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { text: text.slice(0, 1000) };
  }
}

function printHelp() {
  const names = [...tools.keys()].sort();
  console.log(`Usage:
	  npm run precompro:tool -- <toolName> [json]
	  npm run precompro:tool -- check_availability '{"date":"manana","time":"7pm","partySize":2,"zone":"Wine Garden"}'
	  npm run precompro:tool -- reservation_report '{"from":"2026-06-15","to":"2026-06-19","groupBy":["date","lifecycle"]}'

Writes are blocked unless ALLOW_PRECOMPRO_WRITE=true is set intentionally.
Zone shortcuts are normalized before the request: Salon=1442, Templos=1443, Wine Garden=2190.

Available tools:
${names.map((name) => `  - ${name}`).join("\n")}
`);
}
