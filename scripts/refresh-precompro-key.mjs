#!/usr/bin/env node
import "dotenv/config";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { createFileStateStore } from "./lib/precompro-key-state.mjs";
import { runRotation } from "./lib/precompro-key-rotation.mjs";

const store = createFileStateStore(process.env.PRECOMPRO_REFRESH_STATE_DIR || "/var/lib/precompro-key-refresh");
const log = payload => console.log(JSON.stringify(payload));
const args = new Set(process.argv.slice(2));
try {
  if (args.has("--dry-run") || process.env.PRECOMPRO_REFRESH_LOCK_HELD === "1") {
    await runRotation({ env: process.env, args, store, log });
  } else {
    await store.prepare();
    const child = spawn("flock", ["--nonblock", "--conflict-exit-code", "75", join(store.root, "rotation.lock"), process.execPath, fileURLToPath(import.meta.url), ...process.argv.slice(2)], {
      stdio: "inherit", env: { ...process.env, PRECOMPRO_REFRESH_LOCK_HELD: "1" },
    });
    process.exitCode = await new Promise((resolve, reject) => {
      child.once("error", () => reject(new Error("OS locking unavailable; renewal was not attempted")));
      child.once("exit", code => resolve(code ?? 1));
    });
    if (process.exitCode === 75) { log({ event: "precompro_another_check_running" }); process.exitCode = 0; }
  }
} catch (error) {
  log({ event: "precompro_renewal_failed", reason: error.message, stateDirectory: store.root });
  process.exitCode = 1;
}
