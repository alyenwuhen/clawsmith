#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const home = os.homedir();
const stateDir = path.join(home, '.clawsmith');
const pidFile = path.join(stateDir, 'daemon.pid');
const logFile = path.join(stateDir, 'daemon.log');
const healthFile = path.join(stateDir, 'health.json');
const tracesDir = path.join(stateDir, 'traces');
const eventsFile = path.join(stateDir, 'events.jsonl');
const openclawDir = process.env.OPENCLAW_HOME || path.join(home, '.openclaw');
const workspaceDir = path.join(openclawDir, 'workspace');
const memoryFile = path.join(workspaceDir, 'MEMORY.md');
const daemonScript = path.join(repoRoot, 'scripts', 'clawsmith-daemon.mjs');
const onceScript = path.join(repoRoot, 'scripts', 'once.sh');
const selftestScript = path.join(repoRoot, 'scripts', 'selftest.sh');

function ensureStateDir() { fs.mkdirSync(stateDir, { recursive: true }); }
function readJson(file, fallback = null) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } }
function writeText(s) { process.stdout.write(String(s) + '\n'); }
function isRunning(pid) { try { process.kill(pid, 0); return true; } catch { return false; } }
function getPid() { try { return Number(fs.readFileSync(pidFile, 'utf8').trim()); } catch { return null; } }
function listTraceFiles() { try { return fs.readdirSync(tracesDir).filter(f => f.endsWith('.json')).sort((a,b) => fs.statSync(path.join(tracesDir,b)).mtimeMs - fs.statSync(path.join(tracesDir,a)).mtimeMs); } catch { return []; } }
function latestTrace() { const f = listTraceFiles()[0]; return f ? readJson(path.join(tracesDir, f), null) : null; }
function truncate(s, n = 48) { if (!s) return '-'; return s.length <= n ? s : s.slice(0, n - 1) + '…'; }
function runShell(file) { return spawnSync('bash', [file], { stdio: 'inherit' }); }

function cmdStart() { ensureStateDir(); const pid = getPid(); if (pid && isRunning(pid)) { writeText(`clawsmith already running (pid=${pid})`); return; } const out = fs.openSync(logFile, 'a'); const child = spawn(process.execPath, [daemonScript], { detached: true, stdio: ['ignore', out, out] }); child.unref(); fs.writeFileSync(pidFile, String(child.pid), 'utf8'); writeText(`clawsmith started (pid=${child.pid})`); }
function cmdStop() { const pid = getPid(); if (!pid) { writeText('clawsmith is not running'); return; } if (isRunning(pid)) { try { process.kill(pid, 'SIGTERM'); } catch {} } try { fs.rmSync(pidFile, { force: true }); } catch {} writeText('clawsmith stopped'); }
function cmdStatus() { const pid = getPid(); if (pid && isRunning(pid)) writeText(`clawsmith daemon: running (pid=${pid})`); else writeText('clawsmith daemon: stopped'); const health = readJson(healthFile, null); if (!health) { writeText('health: missing'); return; } writeText(`openclawDir: ${health.openclawDir || openclawDir}`); writeText(`agentCount: ${health.agentCount || 0}`); writeText(`sessionFiles: ${health.sessionFileCount || 0}`); writeText(`sessionsIndex: ${health.sessionsIndexCount || 0}`); writeText(`tokens.in: ${health.tokenTotals?.input || 0}`); writeText(`tokens.out: ${health.tokenTotals?.output || 0}`); writeText(`tokens.total: ${health.tokenTotals?.total || 0}`); writeText(`compactions: ${health.compactionEvents || 0}`); writeText(`scannedAt: ${health.scannedAt || '-'}`); }
function cmdContext() { const health = readJson(healthFile, null); if (!health) { writeText('no health data. run: clawsmith once'); return; } const total = health.tokenTotals?.total || 0; writeText('Context Analysis'); writeText(`- total tokens observed: ${total}`); writeText(`- session files: ${health.sessionFileCount || 0}`); writeText(`- sessions indexes: ${health.sessionsIndexCount || 0}`); writeText(`- compactions observed: ${health.compactionEvents || 0}`); const top = (health.activeSessions || []).slice(0, 10); if (top.length) { writeText('Active sessions:'); top.forEach((s, i) => writeText(`  ${i + 1}. ${truncate(s.sessionKey, 80)} | ${s.provider || '-'} | ${s.model || '-'} | in=${s.usage?.input || 0} out=${s.usage?.output || 0}`)); } }
function cmdSession(args) { const health = readJson(healthFile, null); if (!health) { writeText('no health data. run: clawsmith once'); return; } const full = args.includes('--full'); const list = args.includes('--list'); const sessions = health.activeSessions || []; if (list) { sessions.forEach((s, i) => writeText(`${i + 1}. ${full ? (s.sessionKey || '-') : truncate(s.sessionKey)} | ${s.provider || '-'} | ${s.model || '-'} | total=${s.usage?.total || 0}`)); return; } const s = sessions[0]; if (!s) { writeText('no active sessions'); return; } writeText(`session: ${full ? (s.sessionKey || '-') : truncate(s.sessionKey)}`); writeText(`provider: ${s.provider || '-'}`); writeText(`model: ${s.model || '-'}`); writeText(`usage.in: ${s.usage?.input || 0}`); writeText(`usage.out: ${s.usage?.output || 0}`); writeText(`usage.total: ${s.usage?.total || 0}`); const trace = latestTrace(); if (trace) writeText(`latestTrace: ${trace.traceId || '-'}`); }
function sumTracesByRange(range) { const files = listTraceFiles(); const now = Date.now(); const ms = range === 'day' ? 86400000 : range === 'month' ? 30 * 86400000 : 7 * 86400000; const out = { traces: 0, tokens: { input: 0, output: 0, total: 0 } }; for (const f of files) { const full = path.join(tracesDir, f); const st = fs.statSync(full); if (now - st.mtimeMs > ms) continue; const j = readJson(full, null); if (!j) continue; out.traces += 1; out.tokens.input += Number(j.tokenTotals?.input || j.usage?.input || 0); out.tokens.output += Number(j.tokenTotals?.output || j.usage?.output || 0); out.tokens.total += Number(j.tokenTotals?.total || j.usage?.total || 0); } return out; }
function cmdCost(args) { const range = args.includes('--day') ? 'day' : args.includes('--month') ? 'month' : 'week'; const agg = sumTracesByRange(range); writeText(`Cost Window: ${range}`); writeText(`traces: ${agg.traces}`); writeText(`tokens.in: ${agg.tokens.input}`); writeText(`tokens.out: ${agg.tokens.output}`); writeText(`tokens.total: ${agg.tokens.total}`); writeText('usd: unavailable (no pricing model configured)'); }
function cmdCompacts(args) { const nIdx = args.indexOf('--last'); const limit = nIdx >= 0 ? Number(args[nIdx + 1] || '5') : 5; const files = listTraceFiles().slice(0, limit); let count = 0; for (const f of files) { const j = readJson(path.join(tracesDir, f), null); if (!j) continue; const c = Number(j.compactionEvents || j.compactions?.length || 0); if (c > 0) { count += 1; writeText(`${count}. ${j.traceId || f} | compactions=${c} | scannedAt=${j.scannedAt || j.endedAt || '-'}`); } } if (count === 0) writeText('no compaction events found'); }
function loadMemoryLines() { try { return fs.readFileSync(memoryFile, 'utf8').split(/\r?\n/); } catch { return []; } }
function saveMemoryLines(lines) { fs.mkdirSync(path.dirname(memoryFile), { recursive: true }); fs.writeFileSync(memoryFile, lines.join('\n'), 'utf8'); }
function cmdMemory(args) { const sub = args[0]; const rest = args.slice(1).join(' ').trim(); if (sub === 'list') { const lines = loadMemoryLines(); lines.forEach((l, i) => writeText(`${i + 1}: ${l}`)); return; } if (sub === 'search') { const q = rest.toLowerCase(); loadMemoryLines().forEach((l, i) => { if (l.toLowerCase().includes(q)) writeText(`${i + 1}: ${l}`); }); return; } if (sub === 'add') { const lines = loadMemoryLines(); lines.push(`- ${rest}`); saveMemoryLines(lines); writeText('memory entry added'); return; } if (sub === 'save-compact') { const id = rest || 'unknown'; const lines = loadMemoryLines(); lines.push(`- saved compact note from event ${id}`); saveMemoryLines(lines); writeText(`saved compact ${id} to MEMORY.md`); return; } writeText('usage: clawsmith memory list | search <q> | add <text> | save-compact <id>'); }
function cmdSuggest() { const health = readJson(healthFile, null); if (!health) { writeText('suggestion: run clawsmith once first'); return; } const out = []; if ((health.compactionEvents || 0) > 0) out.push('- compactions detected; inspect session growth and consider pruning context files'); if ((health.tokenTotals?.total || 0) > 200000) out.push('- high token volume detected; review active sessions and prompts'); if ((health.sessionFileCount || 0) > 50) out.push('- many transcript files detected; consider archiving old sessions'); if (out.length === 0) out.push('- no obvious issues detected'); out.forEach(writeText); }
function cmdConfig(args) { if (!args.includes('--diag')) { writeText('usage: clawsmith config --diag'); return; } const pid = getPid(); const diag = { openclawDir, workspaceDir, stateDir, daemonScript, pid: pid || null, daemonRunning: pid ? isRunning(pid) : false, healthFileExists: fs.existsSync(healthFile), tracesDirExists: fs.existsSync(tracesDir), eventsFileExists: fs.existsSync(eventsFile), memoryFileExists: fs.existsSync(memoryFile) }; writeText(JSON.stringify(diag, null, 2)); }
function cmdOnce() { runShell(onceScript); }
function cmdSelftest() { runShell(selftestScript); }
const [, , cmd, ...args] = process.argv;
switch (cmd) {
  case 'start': cmdStart(); break;
  case 'stop': cmdStop(); break;
  case 'status': cmdStatus(); break;
  case 'context': cmdContext(); break;
  case 'session': cmdSession(args); break;
  case 'cost': cmdCost(args); break;
  case 'compacts': cmdCompacts(args); break;
  case 'memory': cmdMemory(args); break;
  case 'suggest': cmdSuggest(); break;
  case 'config': cmdConfig(args); break;
  case 'once': cmdOnce(); break;
  case 'selftest': cmdSelftest(); break;
  default:
    writeText('clawsmith commands:');
    writeText('  clawsmith start');
    writeText('  clawsmith stop');
    writeText('  clawsmith status');
    writeText('  clawsmith context');
    writeText('  clawsmith session');
    writeText('  clawsmith session --list');
    writeText('  clawsmith session --list --full');
    writeText('  clawsmith cost');
    writeText('  clawsmith cost --day');
    writeText('  clawsmith cost --month');
    writeText('  clawsmith compacts');
    writeText('  clawsmith compacts --last 10');
    writeText('  clawsmith memory list');
    writeText('  clawsmith memory search "postgres"');
    writeText('  clawsmith memory add "prefer snake_case"');
    writeText('  clawsmith memory save-compact <id>');
    writeText('  clawsmith suggest');
    writeText('  clawsmith config --diag');
    writeText('  clawsmith once');
    writeText('  clawsmith selftest');
}
