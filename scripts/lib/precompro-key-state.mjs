import { mkdir, chmod, readFile, open, rename, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

export function createFileStateStore(directory, { requireMount = true } = {}) {
  const root = resolve(directory), history = join(root, "history");
  async function syncDirectory(path) {
    const handle = await open(path, "r");
    try { await handle.sync(); } finally { await handle.close(); }
  }
  async function atomicWrite(path, value) {
    const temp = `${path}.${randomUUID()}.tmp`;
    const handle = await open(temp, "wx", 0o600);
    try { await handle.writeFile(JSON.stringify(value) + "\n", "utf8"); await handle.sync(); }
    finally { await handle.close(); }
    await rename(temp, path);
    await syncDirectory(path === join(root, "rotation.json") ? root : history);
  }
  return {
    root,
    async prepare() {
      if (requireMount) {
        if (process.platform !== "linux") throw new Error("Automatic renewal requires a persistent Linux volume");
        const mounts = await readFile("/proc/self/mountinfo", "utf8");
        if (!mounts.split("\n").some(line => line.split(" ")[4] === root)) throw new Error("State directory is not a mounted persistent volume; refusing renewal");
      }
      await mkdir(history, { recursive: true, mode: 0o700 });
      await chmod(root, 0o700); await chmod(history, 0o700);
      const probe = join(root, `.write-probe-${randomUUID()}`);
      const handle = await open(probe, "wx", 0o600);
      try { await handle.writeFile("ok"); await handle.sync(); } finally { await handle.close(); }
      await unlink(probe); await syncDirectory(root);
    },
    async read() {
      try { return JSON.parse(await readFile(join(root, "rotation.json"), "utf8")); }
      catch (error) {
        if (error.code === "ENOENT") return null;
        throw new Error("Cannot read renewal journal; do not rotate until it is recovered");
      }
    },
    write: value => atomicWrite(join(root, "rotation.json"), value),
    async archive(value) {
      if (!/^[a-f0-9-]{36}$/.test(value.id)) throw new Error("Invalid rotation journal identifier");
      await atomicWrite(join(history, `${value.id}.json`), value);
    },
  };
}
