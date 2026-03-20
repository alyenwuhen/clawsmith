import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home = os.homedir();
const openclawDir = process.env.OPENCLAW_HOME || path.join(home, '.openclaw');
const stateDir = path.join(home, '.clawsmith');
const stateFile = path.join(stateDir, 'daemon.state.json');
const healthFile = path.join(stateDir, 'health.json');
const eventsFile = path.join(stateDir, 'events.jsonl');
const tracesDir = path.join(stateDir, 'traces');

fs.mkdirSync(stateDir, { recursive: true });
fs.mkdirSync(tracesDir, { recursive: true });

function nowIso() { return new Date().toISOString(); }
function readJson(file, fallback = null) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } }
function writeJson(file, data) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8'); }
function appendJsonl(file, obj) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.appendFileSync(file, JSON.stringify(obj) + '\n', 'utf8'); }
function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function summarizeSessions() {
  const agentsRoot = path.join(openclawDir, 'agents');
  const allFiles = walk(agentsRoot);
  const jsonlFiles = allFiles.filter(f => f.endsWith('.jsonl'));
  const sessionsJsonFiles = allFiles.filter(f => f.endsWith('sessions.json'));
  const summary = {
    scannedAt: nowIso(),
    openclawDir,
    agentCount: 0,
    sessionFileCount: jsonlFiles.length,
    sessionsIndexCount: sessionsJsonFiles.length,
    activeSessions: [],
    tokenTotals: { input: 0, output: 0, total: 0 },
    compactionEvents: 0,
    files: []
  };

  const agents = fs.existsSync(agentsRoot) ? fs.readdirSync(agentsRoot).filter(x => fs.statSync(path.join(agentsRoot, x)).isDirectory()) : [];
  summary.agentCount = agents.length;

  for (const file of sessionsJsonFiles) {
    const data = readJson(file, null);
    if (!data) continue;
    const list = Array.isArray(data) ? data : (Array.isArray(data.sessions) ? data.sessions : []);
    for (const item of list) {
      const sessionKey = item.sessionKey || item.key || item.id || null;
      const model = item.model || item.modelId || null;
      const provider = item.provider || null;
      const usage = item.usage || {};
      const input = Number(usage.input || usage.inputTokens || 0);
      const output = Number(usage.output || usage.outputTokens || 0);
      const total = Number(usage.total || input + output);
      summary.tokenTotals.input += input;
      summary.tokenTotals.output += output;
      summary.tokenTotals.total += total;
      summary.activeSessions.push({ sessionKey, model, provider, usage: { input, output, total } });
    }
  }

  for (const file of jsonlFiles) {
    let compacts = 0;
    try {
      const raw = fs.readFileSync(file, 'utf8');
      const lines = raw.split(/\r?\n/).filter(Boolean);
      for (const line of lines) {
        const obj = readJsonFromLine(line);
        if (!obj) continue;
        const role = obj.role || obj.type || '';
        const text = JSON.stringify(obj);
        if (/compact/i.test(role) || /compaction/i.test(text)) compacts += 1;
      }
    } catch {}
    summary.compactionEvents += compacts;
    summary.files.push({ file, compactions: compacts });
  }

  return summary;
}

function readJsonFromLine(line) {
  try { return JSON.parse(line); } catch { return null; }
}

function writeTraceSnapshot(summary) {
  const traceId = `daemon_${Date.now()}`;
  const trace = {
    traceId,
    kind: 'daemon_scan',
    scannedAt: summary.scannedAt,
    openclawDir: summary.openclawDir,
    agentCount: summary.agentCount,
    sessionFileCount: summary.sessionFileCount,
    sessionsIndexCount: summary.sessionsIndexCount,
    tokenTotals: summary.tokenTotals,
    compactionEvents: summary.compactionEvents,
    activeSessions: summary.activeSessions.slice(0, 50),
    files: summary.files.slice(0, 200)
  };
  writeJson(path.join(tracesDir, `${traceId}.json`), trace);
  appendJsonl(eventsFile, { at: nowIso(), type: 'daemon_scan', traceId, tokenTotals: summary.tokenTotals, compactionEvents: summary.compactionEvents, sessionFileCount: summary.sessionFileCount });
}

let lastFingerprint = null;
function fingerprint(summary) {
  return JSON.stringify({
    sessionFileCount: summary.sessionFileCount,
    sessionsIndexCount: summary.sessionsIndexCount,
    tokenTotals: summary.tokenTotals,
    compactionEvents: summary.compactionEvents
  });
}

function loop() {
  const summary = summarizeSessions();
  const fp = fingerprint(summary);
  if (fp !== lastFingerprint) {
    writeJson(healthFile, summary);
    writeTraceSnapshot(summary);
    writeJson(stateFile, { updatedAt: nowIso(), lastFingerprint: fp });
    lastFingerprint = fp;
  } else {
    writeJson(stateFile, { updatedAt: nowIso(), lastFingerprint: fp });
  }
}

loop();
setInterval(loop, Number(process.env.CLAWSMITH_SCAN_INTERVAL_MS || 5000));
