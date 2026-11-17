import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const windows = process.platform === "win32";
const python = resolve(windows ? ".venv/Scripts/python.exe" : ".venv/bin/python");
if (!existsSync(python)) {
  console.error("Create .venv and install requirements-dev.txt first. See README.md.");
  process.exit(1);
}
const commands = {
  backend: [python, ["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8000"]],
  frontend: [process.execPath, ["frontend/node_modules/next/dist/bin/next", "dev", "frontend", "--hostname", "127.0.0.1"]],
  test: [python, ["-m", "unittest", "discover", "-s", "tests", "-v"]],
};
const mode = process.argv[2] || "dev";
const selected = mode === "dev" ? [commands.backend, commands.frontend] : [commands[mode]];
if (!selected.every(Boolean)) throw new Error("Unknown command");
const children = selected.map(([command, args]) => spawn(command, args, { stdio: "inherit", detached: !windows }));
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (!child.pid || child.exitCode !== null) continue;
    if (windows) spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"]);
    else { try { process.kill(-child.pid, "SIGTERM"); } catch { /* Child already exited. */ } }
  }
  process.exitCode = code;
}
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
for (const child of children) {
  child.on("error", (error) => { console.error(error.message); stop(1); });
  child.on("exit", (code) => stop(code || 0));
}
