#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const packageRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const daemonScript = path.join(packageRoot, 'scripts', 'clawsmith-daemon.mjs');
const stateDir = path.join(os.homedir(), '.clawsmith');
const pidFile = path.join(stateDir, 'daemon.pid');
const logFile = path.join(stateDir, 'daemon.log');

function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); }
function isRunning(pid) { try { process.kill(pid, 0); return true; } catch { return false; } }
function getPid() { try { return Number(fs.readFileSync(pidFile, 'utf8').trim()); } catch { return null; } }

ensureDir(stateDir);
const existingPid = getPid();
if (existingPid && isRunning(existingPid)) {
  console.log(`clawsmith postinstall: daemon already running (pid=${existingPid})`);
  process.exit(0);
}

const out = fs.openSync(logFile, 'a');
const child = spawn(process.execPath, [daemonScript], {
  detached: true,
  stdio: ['ignore', out, out],
  env: process.env,
});
child.unref();
fs.writeFileSync(pidFile, String(child.pid), 'utf8');
console.log(`clawsmith postinstall: daemon started (pid=${child.pid})`);
