#!/usr/bin/env node
import "dotenv/config";
import { spawnSync } from "node:child_process";

const applicationId = process.env.DOKPLOY_APPLICATION_ID || "RgecIhLGmG5RfsVQ-9J3q";
const dokployBaseUrl = process.env.DOKPLOY_BASE_URL || "https://grupomistico.cloud/api";
const apiKey = process.env.DOKPLOY_API_KEY;

if (!apiKey) {
  throw new Error("DOKPLOY_API_KEY is required");
}

run("npm", ["test"]);
const status = run("git", ["status", "--short"], { capture: true });
if (status.trim()) {
  console.error(status);
  throw new Error("Working tree has uncommitted changes. Commit before deploying.");
}
run("git", ["push", "origin", "main"]);

const response = await fetch(`${dokployBaseUrl}/application.deploy`, {
  method: "POST",
  headers: {
    accept: "application/json",
    "content-type": "application/json",
    "x-api-key": apiKey,
  },
  body: JSON.stringify({
    applicationId,
    title: "Deploy from local/GitHub main",
    description: "Deploy Ritwal middleware after syncing main to GitHub.",
  }),
});

const text = await response.text();
if (!response.ok) {
  throw new Error(`Dokploy deploy failed ${response.status}: ${text.slice(0, 500)}`);
}

console.log("Dokploy deploy queued from GitHub main.");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: options.capture ? "pipe" : "inherit",
    encoding: options.capture ? "utf8" : undefined,
    env: process.env,
  });
  if (result.status !== 0) {
    if (options.capture) {
      process.stderr.write(result.stderr || result.stdout || "");
    }
    throw new Error(`${command} ${args.join(" ")} failed`);
  }
  return options.capture ? result.stdout : "";
}
