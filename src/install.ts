import fs from "fs";
import path from "path";
import os from "os";
import { spawn } from "child_process";

const probeDir = path.join(os.homedir(), ".clawsmith");
const pidFile = path.join(probeDir, "daemon.pid");
const logFile = path.join(probeDir, "daemon.log");
const entry = new URL("./index.ts", import.meta.url);

function isRunning(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

fs.mkdirSync(probeDir, { recursive: true });
let existingPid: number | null = null;
try { existingPid = Number(fs.readFileSync(pidFile, "utf-8").trim()); } catch {}
if (existingPid && isRunning(existingPid)) {
  console.log(`clawsmith postinstall: daemon already running (pid=${existingPid})`);
  process.exit(0);
}

const out = fs.openSync(logFile, "a");
const child = spawn(process.execPath, ["--import", "tsx", entry.pathname, "start"], {
  detached: true,
  stdio: ["ignore", out, out],
  env: { ...process.env },
});
child.unref();
console.log(`clawsmith postinstall: daemon bootstrap launched (pid=${child.pid})`);
