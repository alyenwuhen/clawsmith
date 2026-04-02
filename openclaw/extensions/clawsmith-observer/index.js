import fs from "fs";
import os from "os";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { URL, fileURLToPath } from "url";
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";

const execFileAsync = promisify(execFile);
const ROOT_DIR = path.dirname(fileURLToPath(import.meta.url));
const UI_DIR = path.join(ROOT_DIR, "ui");

const DEFAULTS = {
  enabled: true,
  clawsmithBin: "clawsmith",
  execTimeoutMs: 3000,
  autoStartDaemon: true,
  autoAppendMonitorCard: true,
  appendIntervalSec: 0,
  channelAllowlist: [],
  dashboardEnabled: true,
  dashboardBasePath: "/plugins/clawsmith",
  dashboardToken: "",
  openclawStateDir: "",
  traceMaxEvents: 2400,
  metricsTurnLimit: 120,
};

function asString(value, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function asBoolean(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}

function asNumber(value, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeBasePath(raw) {
  const value = asString(raw, DEFAULTS.dashboardBasePath).trim();
  if (!value) return DEFAULTS.dashboardBasePath;
  const withLeading = value.startsWith("/") ? value : `/${value}`;
  if (withLeading.length > 1 && withLeading.endsWith("/")) return withLeading.slice(0, -1);
  return withLeading;
}

function normalizeConfig(input) {
  const cfg = input && typeof input === "object" ? input : {};
  return {
    enabled: asBoolean(cfg.enabled, DEFAULTS.enabled),
    clawsmithBin: asString(cfg.clawsmithBin, DEFAULTS.clawsmithBin).trim() || DEFAULTS.clawsmithBin,
    execTimeoutMs: clamp(asNumber(cfg.execTimeoutMs, DEFAULTS.execTimeoutMs), 500, 60000),
    autoStartDaemon: asBoolean(cfg.autoStartDaemon, DEFAULTS.autoStartDaemon),
    autoAppendMonitorCard: asBoolean(cfg.autoAppendMonitorCard, DEFAULTS.autoAppendMonitorCard),
    appendIntervalSec: clamp(asNumber(cfg.appendIntervalSec, DEFAULTS.appendIntervalSec), 0, 3600),
    channelAllowlist: Array.isArray(cfg.channelAllowlist) ? cfg.channelAllowlist.filter((v) => typeof v === "string") : [],
    dashboardEnabled: asBoolean(cfg.dashboardEnabled, DEFAULTS.dashboardEnabled),
    dashboardBasePath: normalizeBasePath(cfg.dashboardBasePath),
    dashboardToken: asString(cfg.dashboardToken, DEFAULTS.dashboardToken).trim(),
    openclawStateDir: asString(cfg.openclawStateDir, DEFAULTS.openclawStateDir).trim(),
    traceMaxEvents: clamp(asNumber(cfg.traceMaxEvents, DEFAULTS.traceMaxEvents), 200, 20000),
    metricsTurnLimit: clamp(asNumber(cfg.metricsTurnLimit, DEFAULTS.metricsTurnLimit), 20, 500),
  };
}

function fmtTokens(value) {
  const n = asNumber(value, 0);
  if (n <= 0) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return `${Math.round(n)}`;
}

function fmtUsd(value) {
  const n = asNumber(value, 0);
  if (n <= 0) return "$0.00";
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

function readJSON(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}

function toMs(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value > 1e12) return value;
    if (value > 1e9) return value * 1000;
    return null;
  }
  if (typeof value !== "string" || !value.trim()) return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return toMs(numeric);
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function snippet(text, max = 1200) {
  const value = asString(text, "");
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function textFromContent(content, max = 1400) {
  if (typeof content === "string") return snippet(content, max);
  if (!Array.isArray(content)) return "";
  const parts = [];
  for (const item of content) {
    if (!item || typeof item !== "object") continue;
    if (item.type === "text" && typeof item.text === "string") parts.push(item.text);
    if (item.type === "toolCall") parts.push(`[tool_call] ${asString(item.name, "tool")}`);
  }
  return snippet(parts.join("\n"), max);
}

function usageFrom(message) {
  const usage = message && typeof message === "object" ? message.usage : null;
  const input = asNumber(usage?.input, asNumber(usage?.inputTokens, 0));
  const output = asNumber(usage?.output, asNumber(usage?.outputTokens, 0));
  const cacheRead = asNumber(usage?.cacheRead, asNumber(usage?.cache_read, 0));
  const cacheWrite = asNumber(usage?.cacheWrite, asNumber(usage?.cache_write, 0));
  const totalTokens = asNumber(usage?.totalTokens, input + output + cacheRead + cacheWrite);
  const usd = asNumber(usage?.cost?.total, 0);
  return { input, output, cacheRead, cacheWrite, totalTokens, usd };
}

async function runClawsmithText(state, args) {
  const { stdout = "", stderr = "" } = await execFileAsync(state.cfg.clawsmithBin, args, {
    timeout: state.cfg.execTimeoutMs,
    maxBuffer: 4 * 1024 * 1024,
    windowsHide: true,
  });
  const text = String(stdout).trim();
  if (!text && stderr) return String(stderr).trim();
  return text;
}

async function runClawsmithJson(state, args) {
  const text = await runClawsmithText(state, args);
  if (!text) throw new Error(`clawsmith ${args.join(" ")} returned empty output`);
  const parsed = (() => {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  })();
  if (parsed === null) throw new Error(`clawsmith ${args.join(" ")} returned non-json: ${text.slice(0, 220)}`);
  return parsed;
}

async function tryCommand(state, args) {
  try {
    return await runClawsmithJson(state, args);
  } catch (error) {
    state.api.logger.warn?.(`[clawsmith-observer] command failed ${args.join(" ")} :: ${String(error)}`);
    return null;
  }
}

async function readStatus(state) {
  return tryCommand(state, ["status", "--json"]);
}

function openclawStateDir(cfg) {
  if (cfg.openclawStateDir) return cfg.openclawStateDir;
  const fromEnv = asString(process.env.OPENCLAW_STATE_DIR, "").trim();
  if (fromEnv) return fromEnv;
  return path.join(os.homedir(), ".openclaw");
}

function sessionIndex(state, agent) {
  const sessionsDir = path.join(openclawStateDir(state.cfg), "agents", agent, "sessions");
  const raw = readJSON(path.join(sessionsDir, "sessions.json")) || {};
  const rows = [];
  for (const [sessionKey, item] of Object.entries(raw)) {
    const sessionId = asString(item?.sessionId, "").trim();
    let jsonlPath = asString(item?.sessionFile, "").trim();
    if (!jsonlPath && sessionId) jsonlPath = path.join(sessionsDir, `${sessionId}.jsonl`);
    if (jsonlPath && !path.isAbsolute(jsonlPath)) jsonlPath = path.join(sessionsDir, jsonlPath);
    rows.push({
      sessionKey,
      sessionId: sessionId || null,
      updatedAtMs: toMs(item?.updatedAt) || 0,
      model: asString(item?.model, asString(item?.modelOverride, "")) || null,
      provider: asString(item?.modelProvider, "") || null,
      compactionCount: asNumber(item?.compactionCount, 0),
      chatType: asString(item?.chatType, "") || null,
      channel: asString(item?.lastChannel, asString(item?.deliveryContext?.channel, "")) || null,
      target: asString(item?.lastTo, asString(item?.deliveryContext?.to, "")) || null,
      jsonlPath: jsonlPath || null,
    });
  }
  rows.sort((a, b) => b.updatedAtMs - a.updatedAtMs);
  return {
    sessionsDir,
    rows,
    byKey: new Map(rows.map((row) => [row.sessionKey, row])),
    byId: new Map(rows.filter((row) => row.sessionId).map((row) => [row.sessionId, row])),
  };
}

function mergeSessions(indexRows, costRows) {
  const map = new Map();
  for (const row of Array.isArray(costRows) ? costRows : []) {
    const key = asString(row?.sessionKey, "").trim();
    if (!key) continue;
    map.set(key, {
      sessionKey: key,
      sessionId: null,
      model: asString(row?.model, "") || null,
      provider: asString(row?.provider, "") || null,
      estimatedUsd: asNumber(row?.estimatedUsd, 0),
      inputTokens: asNumber(row?.inputTokens, 0),
      outputTokens: asNumber(row?.outputTokens, 0),
      contextTokens: asNumber(row?.contextTokens, 0),
      totalTokens: asNumber(row?.totalTokens, 0),
      turnCount: Array.isArray(row?.turns) ? row.turns.length : asNumber(row?.turnCount, 0),
      lastActiveAtMs: toMs(row?.lastActiveAt) || 0,
      compactionCount: asNumber(row?.compactionCount, 0),
      jsonlPath: null,
      chatType: null,
      channel: null,
      target: null,
    });
  }
  for (const row of indexRows) {
    const existing = map.get(row.sessionKey) || {};
    map.set(row.sessionKey, {
      ...existing,
      sessionKey: row.sessionKey,
      sessionId: row.sessionId,
      model: existing.model || row.model,
      provider: existing.provider || row.provider,
      compactionCount: existing.compactionCount || row.compactionCount,
      lastActiveAtMs: existing.lastActiveAtMs || row.updatedAtMs,
      jsonlPath: row.jsonlPath,
      chatType: row.chatType,
      channel: row.channel,
      target: row.target,
    });
  }
  return Array.from(map.values()).sort((a, b) => b.lastActiveAtMs - a.lastActiveAtMs);
}

function parseTrace(jsonlPath, maxEvents) {
  const lines = fs.readFileSync(jsonlPath, "utf-8").split(/\r?\n/).filter(Boolean);
  const dropped = Math.max(0, lines.length - maxEvents);
  const windowLines = dropped > 0 ? lines.slice(-maxEvents) : lines;

  const events = [];
  const tools = new Map();
  const pending = new Map();
  const usageSeries = [];
  const totals = { userMessages: 0, assistantMessages: 0, toolCalls: 0, toolResults: 0, toolErrors: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalUsd: 0 };
  let turnIndex = 0;
  let startMs = null;
  let endMs = null;

  for (let i = 0; i < windowLines.length; i += 1) {
    const row = (() => { try { return JSON.parse(windowLines[i]); } catch { return null; } })();
    if (!row || typeof row !== "object") continue;
    const msg = row.message && typeof row.message === "object" ? row.message : {};
    const ts = asString(row.timestamp, asString(msg.timestamp, ""));
    const unixMs = toMs(ts);
    if (unixMs !== null) {
      if (startMs === null || unixMs < startMs) startMs = unixMs;
      if (endMs === null || unixMs > endMs) endMs = unixMs;
    }
    const lineNo = dropped + i + 1;

    if (row.type === "message") {
      const role = asString(msg.role, "");
      if (role === "user") {
        totals.userMessages += 1;
        events.push({ id: asString(row.id, `u-${lineNo}`), parentId: asString(row.parentId, ""), lineNo, kind: "user", timestamp: ts || null, unixMs, text: textFromContent(msg.content, 1400), raw: { role, timestamp: ts || null } });
        continue;
      }
      if (role === "assistant") {
        totals.assistantMessages += 1;
        turnIndex += 1;
        const usage = usageFrom(msg);
        totals.inputTokens += usage.input;
        totals.outputTokens += usage.output;
        totals.cacheReadTokens += usage.cacheRead;
        totals.cacheWriteTokens += usage.cacheWrite;
        totals.totalUsd += usage.usd;
        usageSeries.push({ turnIndex, timestamp: ts || null, unixMs, ...usage });

        events.push({ id: asString(row.id, `a-${lineNo}`), parentId: asString(row.parentId, ""), lineNo, kind: "assistant", turnIndex, timestamp: ts || null, unixMs, text: textFromContent(msg.content, 1700), usage, stopReason: asString(msg.stopReason, "") || null, raw: { role, timestamp: ts || null, usage, stopReason: asString(msg.stopReason, "") || null } });

        for (const item of Array.isArray(msg.content) ? msg.content : []) {
          if (!item || typeof item !== "object" || item.type !== "toolCall") continue;
          const toolName = asString(item.name, "tool");
          const callId = asString(item.id, "");
          totals.toolCalls += 1;
          const bucket = tools.get(toolName) || { name: toolName, calls: 0, results: 0, errors: 0, totalLatencyMs: 0, maxLatencyMs: 0 };
          bucket.calls += 1;
          tools.set(toolName, bucket);
          if (callId) pending.set(callId, { toolName, unixMs });
          events.push({ id: `${asString(row.id, `a-${lineNo}`)}:${callId || toolName}`, parentId: asString(row.id, ""), lineNo, kind: "tool_call", timestamp: ts || null, unixMs, toolCallId: callId || null, toolName, argumentsPreview: snippet(JSON.stringify(item.arguments ?? {}, null, 2), 900), raw: { role: "toolCall", toolName, toolCallId: callId || null } });
        }
        continue;
      }
      if (role === "toolResult") {
        totals.toolResults += 1;
        const callId = asString(msg.toolCallId, "");
        const pendingCall = callId ? pending.get(callId) : null;
        const toolName = asString(msg.toolName, pendingCall?.toolName || "tool");
        const latencyMs = pendingCall?.unixMs && unixMs !== null ? Math.max(0, unixMs - pendingCall.unixMs) : asNumber(msg?.details?.durationMs, asNumber(msg?.details?.tookMs, 0)) || null;
        const isError = Boolean(msg.isError);
        if (isError) totals.toolErrors += 1;
        const bucket = tools.get(toolName) || { name: toolName, calls: 0, results: 0, errors: 0, totalLatencyMs: 0, maxLatencyMs: 0 };
        bucket.results += 1;
        if (isError) bucket.errors += 1;
        if (latencyMs !== null) {
          bucket.totalLatencyMs += latencyMs;
          bucket.maxLatencyMs = Math.max(bucket.maxLatencyMs, latencyMs);
        }
        tools.set(toolName, bucket);
        if (callId) pending.delete(callId);
        events.push({ id: asString(row.id, `tr-${lineNo}`), parentId: asString(row.parentId, ""), lineNo, kind: "tool_result", timestamp: ts || null, unixMs, toolCallId: callId || null, toolName, latencyMs, isError, text: textFromContent(msg.content, 1200), raw: { role, toolName, toolCallId: callId || null, latencyMs, isError } });
        continue;
      }
    }

    if (["session", "model_change", "thinking_level_change", "custom"].includes(asString(row.type, ""))) {
      events.push({ id: asString(row.id, `m-${lineNo}`), parentId: asString(row.parentId, ""), lineNo, kind: "meta", timestamp: ts || null, unixMs, text: asString(row.type, "meta"), raw: { type: asString(row.type, "meta"), timestamp: ts || null } });
    }
  }

  const toolStats = Array.from(tools.values()).map((tool) => ({
    ...tool,
    avgLatencyMs: tool.results > 0 ? Math.round(tool.totalLatencyMs / tool.results) : 0,
    errorRatePct: tool.results > 0 ? Math.round((tool.errors / tool.results) * 100) : 0,
  })).sort((a, b) => b.calls - a.calls);

  return {
    events,
    usageSeries,
    toolStats,
    summary: {
      lineCount: lines.length,
      droppedEvents: dropped,
      eventCount: events.length,
      durationMs: startMs !== null && endMs !== null ? Math.max(0, endMs - startMs) : 0,
      startedAt: startMs ? new Date(startMs).toISOString() : null,
      endedAt: endMs ? new Date(endMs).toISOString() : null,
      assistantTurns: turnIndex,
      uniqueTools: toolStats.length,
      topTools: toolStats.slice(0, 12),
      ...totals,
    },
  };
}

async function collectTop(state) {
  const [status, context, cost] = await Promise.all([
    tryCommand(state, ["status", "--json"]),
    tryCommand(state, ["context", "--json"]),
    tryCommand(state, ["cost", "--day", "--json"]),
  ]);
  if (!status) return null;
  return { generatedAt: new Date().toISOString(), status, context, cost };
}

async function collectTurnTop(state) {
  const status = await tryCommand(state, ["status", "--json"]);
  if (!status) return null;
  const sessionKey = asString(status?.sessionKey, "").trim();
  let latestTurn = null;
  if (!latestTurn && sessionKey) {
    const session = await tryCommand(state, ["session", sessionKey, "--json"]);
    const turns = Array.isArray(session?.turns) ? session.turns : [];
    latestTurn = turns.length > 0 ? turns[turns.length - 1] : null;
  }

  return {
    generatedAt: new Date().toISOString(),
    status,
    sessionKey: sessionKey || null,
    latestTurn,
  };
}

function monitorCard(top, cfg) {
  const status = top?.status || {};
  const context = top?.context || {};
  const cost = top?.cost || {};
  const daemon = status.daemonRunning ? "running" : "stopped";
  const model = asString(status.model, "unknown");
  const sessionTokens = asNumber(context.sessionTokens, asNumber(status.sessionTokens, 0));
  const windowSize = asNumber(context.windowSize, asNumber(status.windowSize, 0));
  const pct = asNumber(context.utilizationPct, asNumber(status.utilizationPct, 0));
  const usd = asNumber(status.todayUsd, asNumber(cost.totalUsd, 0));
  return [
    `[Clawsmith Monitor] daemon=${daemon} agent=${asString(status.agent, "main")} model=${model}`,
    `context=${Math.round(pct)}% (${fmtTokens(sessionTokens)}/${fmtTokens(windowSize)}) today=${fmtUsd(usd)} compacts=${Math.round(asNumber(status.compactionCount, 0))}`,
    `dashboard=${cfg.dashboardBasePath}/metrics`,
  ].join("\n");
}

function monitorTurnCard(snapshot, cfg) {
  const status = snapshot?.status || {};
  const turn = snapshot?.latestTurn || {};
  const daemon = status.daemonRunning ? "running" : "stopped";
  const model = asString(status.model, "unknown");
  const sessionKey = asString(snapshot?.sessionKey, "");
  const turnIndex = asNumber(turn?.turnIndex, 0);
  const turnTs = asNumber(turn?.timestamp, 0);
  const turnTime = turnTs > 0 ? new Date(turnTs * 1000).toISOString() : asString(snapshot?.generatedAt, "");
  const inTokens = asNumber(turn?.inputTokensDelta, 0);
  const outTokens = asNumber(turn?.outputTokensDelta, 0);
  const usd = asNumber(turn?.estimatedUsd, 0);
  const compact = Boolean(turn?.compactOccurred);
  const traceUrl = `${cfg.dashboardBasePath}/trace${sessionKey ? `?trace_view=detail&sessionKey=${encodeURIComponent(sessionKey)}` : ""}`;
  return [
    "[Clawsmith Turn]",
    `daemon=${daemon} model=${model} session=${sessionKey || "-"}`,
    `turn=${turnIndex || "-"} at=${turnTime || "-"}`,
    `input=${fmtTokens(inTokens)} output=${fmtTokens(outTokens)} cost=${fmtUsd(usd)} compact=${compact ? "yes" : "no"}`,
    `trace=${traceUrl}`,
  ].join("\n");
}

function conversationKey(event, ctx) {
  return `${asString(ctx?.channelId, "unknown")}:${asString(ctx?.accountId, "default")}:${asString(ctx?.conversationId, asString(event?.to, "unknown"))}`;
}

function shouldAppend(state, event, ctx) {
  if (!state.cfg.autoAppendMonitorCard) return false;
  if (state.cfg.channelAllowlist.length > 0 && !state.cfg.channelAllowlist.includes(asString(ctx?.channelId))) return false;
  if (typeof event?.content !== "string") return false;
  if (event.content.includes("[Clawsmith Monitor]") || event.content.includes("[Clawsmith Turn]")) return false;
  return true;
}

async function ensureDaemon(state, reason) {
  if (!state.cfg.autoStartDaemon) return;
  if (state.startingPromise) return state.startingPromise;
  state.startingPromise = (async () => {
    const before = await readStatus(state);
    if (before?.daemonRunning === true) return;
    state.api.logger.info?.(`[clawsmith-observer] starting clawsmith daemon (${reason})`);
    try {
      await runClawsmithText(state, ["start"]);
    } catch (error) {
      state.api.logger.error?.(`[clawsmith-observer] failed to start daemon: ${String(error)}`);
      return;
    }
    const after = await readStatus(state);
    if (after?.daemonRunning === true) state.api.logger.info?.("[clawsmith-observer] clawsmith daemon is running");
  })().finally(() => {
    state.startingPromise = null;
  });
  return state.startingPromise;
}

function requestUrl(req) {
  return new URL(req.url || "/", "http://localhost");
}

function authorized(req, url, cfg) {
  if (!cfg.dashboardToken) return true;
  const tokenFromQuery = url.searchParams.get("token");
  const tokenFromHeader = asString(req.headers["x-clawsmith-token"]);
  return tokenFromQuery === cfg.dashboardToken || tokenFromHeader === cfg.dashboardToken;
}

function sendJson(res, code, payload) {
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload, null, 2));
}

function sendText(res, code, type, text) {
  res.statusCode = code;
  res.setHeader("Content-Type", `${type}; charset=utf-8`);
  res.end(text);
}

function uiFile(state, name) {
  if (state.uiCache.has(name)) return state.uiCache.get(name);
  const filePath = path.join(UI_DIR, name);
  if (!filePath.startsWith(UI_DIR) || !fs.existsSync(filePath)) return null;
  const text = fs.readFileSync(filePath, "utf-8");
  state.uiCache.set(name, text);
  return text;
}

async function apiTrace(state, url) {
  const status = await readStatus(state);
  const agent = asString(url.searchParams.get("agent"), asString(status?.agent, "main"));
  const index = sessionIndex(state, agent);
  const costs = await tryCommand(state, ["session", "--list", "--json", "--no-turns"]);
  const sessions = mergeSessions(index.rows, costs);

  const byKey = index.byKey.get(asString(url.searchParams.get("sessionKey"), "").trim());
  const byId = index.byId.get(asString(url.searchParams.get("sessionId"), "").trim());
  const active = index.byKey.get(asString(status?.sessionKey, "").trim()) || index.byId.get(asString(status?.sessionId, "").trim());
  const selected = byKey || byId || active || index.rows[0] || null;

  if (!selected || !selected.jsonlPath || !fs.existsSync(selected.jsonlPath)) {
    return {
      ok: false,
      generatedAt: new Date().toISOString(),
      agent,
      activeSessionKey: asString(status?.sessionKey, null),
      sessions,
      error: "trace_unavailable",
    };
  }

  const parsed = parseTrace(selected.jsonlPath, state.cfg.traceMaxEvents);
  const sessionCost = await tryCommand(state, ["session", selected.sessionKey, "--json"]);
  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    agent,
    activeSessionKey: asString(status?.sessionKey, null),
    selectedSessionKey: selected.sessionKey,
    selectedSessionId: selected.sessionId,
    selectedSession: selected,
    sessions,
    sessionCost,
    ...parsed,
  };
}

async function apiMetrics(state, url) {
  const [status, context, day, week, trace] = await Promise.all([
    tryCommand(state, ["status", "--json"]),
    tryCommand(state, ["context", "--json"]),
    tryCommand(state, ["cost", "--day", "--json"]),
    tryCommand(state, ["cost", "--week", "--json"]),
    apiTrace(state, url),
  ]);

  const key = asString(trace?.selectedSessionKey, asString(status?.sessionKey, ""));
  const session = key ? await tryCommand(state, ["session", key, "--json"]) : null;
  const turns = Array.isArray(session?.turns) ? session.turns.map((turn) => ({
    turnIndex: asNumber(turn.turnIndex, 0),
    timestamp: asNumber(turn.timestamp, 0),
    inputTokensDelta: asNumber(turn.inputTokensDelta, 0),
    outputTokensDelta: asNumber(turn.outputTokensDelta, 0),
    estimatedUsd: asNumber(turn.estimatedUsd, 0),
    compactOccurred: Boolean(turn.compactOccurred),
  })).sort((a, b) => a.turnIndex - b.turnIndex).slice(-state.cfg.metricsTurnLimit) : [];

  const toolStats = Array.isArray(trace?.toolStats) ? trace.toolStats : [];
  const avgLatency = toolStats.length
    ? Math.round(toolStats.reduce((sum, item) => sum + asNumber(item.avgLatencyMs, 0), 0) / toolStats.length)
    : 0;

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    activeSessionKey: key || null,
    status,
    context,
    costs: { day, week },
    sessions: {
      total: Array.isArray(trace?.sessions) ? trace.sessions.length : 0,
      items: Array.isArray(trace?.sessions) ? trace.sessions.slice(0, 24) : [],
    },
    summary: {
      daemonRunning: Boolean(status?.daemonRunning),
      model: asString(status?.model, "unknown"),
      provider: asString(status?.provider, "unknown"),
      contextPct: asNumber(context?.utilizationPct, asNumber(status?.utilizationPct, 0)),
      contextTokens: asNumber(context?.sessionTokens, asNumber(status?.sessionTokens, 0)),
      contextWindow: asNumber(context?.windowSize, asNumber(status?.windowSize, 0)),
      todayUsd: asNumber(day?.totalUsd, asNumber(status?.todayUsd, 0)),
      weekUsd: asNumber(week?.totalUsd, 0),
      toolCalls: asNumber(trace?.summary?.toolCalls, 0),
      toolErrors: asNumber(trace?.summary?.toolErrors, 0),
      uniqueTools: toolStats.length,
      avgToolLatencyMs: avgLatency,
      turns: asNumber(trace?.summary?.assistantTurns, turns.length),
      compactionCount: asNumber(status?.compactionCount, 0),
    },
    dailyCost: Array.isArray(week?.daily) ? week.daily : [],
    usageSeries: Array.isArray(trace?.usageSeries) ? trace.usageSeries : [],
    toolStats,
    turns,
    traceHealth: {
      eventCount: asNumber(trace?.summary?.eventCount, 0),
      droppedEvents: asNumber(trace?.summary?.droppedEvents, 0),
      durationMs: asNumber(trace?.summary?.durationMs, 0),
    },
  };
}

function registerDashboard(state) {
  if (!state.cfg.dashboardEnabled) return;
  state.api.registerHttpRoute({
    path: state.cfg.dashboardBasePath,
    auth: "plugin",
    match: "prefix",
    handler: async (req, res) => {
      const url = requestUrl(req);
      if (!url.pathname.startsWith(state.cfg.dashboardBasePath)) return false;
      if (!authorized(req, url, state.cfg)) {
        sendJson(res, 401, { ok: false, error: "unauthorized" });
        return true;
      }

      const suffix = url.pathname.slice(state.cfg.dashboardBasePath.length) || "/";
      if (suffix === "/" || suffix === "" || suffix === "/trace" || suffix === "/metrics") {
        const html = uiFile(state, "index.html");
        if (!html) return sendText(res, 404, "text/plain", "index.html not found"), true;
        const rendered = html
          .replaceAll("__BASE_PATH__", state.cfg.dashboardBasePath)
          .replaceAll("__DEFAULT_VIEW__", suffix === "/trace" ? "trace" : suffix === "/metrics" ? "metrics" : "metrics");
        sendText(res, 200, "text/html", rendered);
        return true;
      }

      if (suffix === "/app.js") {
        const js = uiFile(state, "app.js");
        if (!js) return sendText(res, 404, "text/plain", "app.js not found"), true;
        sendText(res, 200, "application/javascript", js);
        return true;
      }

      if (suffix === "/styles.css") {
        const css = uiFile(state, "styles.css");
        if (!css) return sendText(res, 404, "text/plain", "styles.css not found"), true;
        sendText(res, 200, "text/css", css);
        return true;
      }

      if (suffix === "/api/top") {
        const top = await collectTop(state);
        if (!top) return sendJson(res, 503, { ok: false, error: "clawsmith_unavailable" }), true;
        const trace = await apiTrace(state, url);
        sendJson(res, 200, { ...top, traceSummary: trace.ok ? trace.summary : null });
        return true;
      }

      if (suffix === "/api/status" || suffix === "/api/context" || suffix === "/api/cost" || suffix === "/api/session") {
        const map = {
          "/api/status": ["status", "--json"],
          "/api/context": ["context", "--json"],
          "/api/cost": ["cost", "--day", "--json"],
          "/api/session": ["session", "--json", "--no-turns"],
        };
        const result = await tryCommand(state, map[suffix]);
        if (!result) return sendJson(res, 503, { ok: false, error: "command_failed" }), true;
        sendJson(res, 200, result);
        return true;
      }

      if (suffix === "/api/trace/sessions") {
        const trace = await apiTrace(state, url);
        sendJson(res, 200, {
          ok: true,
          generatedAt: new Date().toISOString(),
          agent: trace.agent,
          activeSessionKey: trace.activeSessionKey,
          items: trace.sessions || [],
        });
        return true;
      }

      if (suffix === "/api/trace") {
        const trace = await apiTrace(state, url);
        sendJson(res, trace.ok ? 200 : 404, trace);
        return true;
      }

      if (suffix === "/api/metrics") {
        const metrics = await apiMetrics(state, url);
        sendJson(res, 200, metrics);
        return true;
      }

      sendJson(res, 404, { ok: false, error: "not_found" });
      return true;
    },
  });
}

export default definePluginEntry({
  id: "clawsmith-observer",
  name: "Clawsmith Observer",
  description: "Auto-start clawsmith and provide web observability dashboards for non-CLI users.",
  register(api) {
    const cfg = normalizeConfig(api.pluginConfig);
    if (!cfg.enabled) {
      api.logger.info?.("[clawsmith-observer] disabled by config");
      return;
    }

    const state = {
      api,
      cfg,
      lastAppendAt: new Map(),
      lastTurnAppend: new Map(),
      startingPromise: null,
      uiCache: new Map(),
    };

    registerDashboard(state);

    api.on("gateway_start", async () => {
      await ensureDaemon(state, "gateway_start");
      api.logger.info?.(`[clawsmith-observer] dashboard route ready at ${cfg.dashboardBasePath}`);
    });

    api.on("session_start", async () => {
      await ensureDaemon(state, "session_start");
    });

    api.on("message_sending", async (event, ctx) => {
      if (!shouldAppend(state, event, ctx)) return;
      const snapshot = await collectTurnTop(state);
      if (!snapshot) return;
      const convKey = conversationKey(event, ctx);
      const turnIndex = asNumber(snapshot?.latestTurn?.turnIndex, 0);
      const turnTs = asNumber(snapshot?.latestTurn?.timestamp, 0);
      const sessionKey = asString(snapshot?.sessionKey, "");
      const turnKey = sessionKey && turnIndex > 0 ? `${sessionKey}:${turnIndex}:${turnTs}` : "";
      if (turnKey) {
        const lastTurnKey = state.lastTurnAppend.get(convKey) || "";
        if (lastTurnKey === turnKey) return;
        state.lastTurnAppend.set(convKey, turnKey);
      } else if (state.cfg.appendIntervalSec > 0) {
        const now = Date.now();
        const minGapMs = state.cfg.appendIntervalSec * 1000;
        const last = state.lastAppendAt.get(convKey) ?? 0;
        if (now - last < minGapMs) return;
        state.lastAppendAt.set(convKey, now);
      }
      const card = monitorTurnCard(snapshot, cfg);
      const content = event.content.trim() ? `${event.content}\n\n${card}` : card;
      return { content };
    });
  },
});
