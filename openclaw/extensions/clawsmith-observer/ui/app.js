const BASE_PATH = window.__CLAWSMITH_BASE_PATH__ || "/plugins/clawsmith";
const DEFAULT_VIEW = window.__CLAWSMITH_DEFAULT_VIEW__ === "trace" ? "trace" : "metrics";

const query = new URLSearchParams(window.location.search);
const TOKEN = query.get("token") || "";
const VIEW_FROM_PATH = window.location.pathname.endsWith("/trace")
  ? "trace"
  : window.location.pathname.endsWith("/metrics")
    ? "metrics"
    : null;
const VIEW_FROM_QUERY = query.get("view") === "trace" ? "trace" : query.get("view") === "metrics" ? "metrics" : null;

const state = {
  view: VIEW_FROM_PATH || VIEW_FROM_QUERY || DEFAULT_VIEW,
  loading: false,
  autoRefresh: true,
  error: null,
  metrics: null,
  trace: null,
  selectedSessionKey: query.get("sessionKey") || null,
  selectedTraceId: query.get("traceId") || null,
  selectedNodeId: query.get("nodeId") || null,
  traceMode: query.get("trace_view") === "detail" ? "detail" : "list",
  traceTab: ["run", "metadata", "feedback"].includes(query.get("tab")) ? query.get("tab") : "run",
  runInputFormat: "text",
  runOutputFormat: "text",
  tracePreviewCache: {},
  refreshTimer: null,
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function asNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function asString(value, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function safeSlice(text, length = 140) {
  const s = String(text || "");
  return s.length > length ? `${s.slice(0, length)}...` : s;
}

function fmtNum(value) {
  const n = asNumber(value, 0);
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return `${Math.round(n)}`;
}

function fmtUsd(value) {
  const n = asNumber(value, 0);
  if (n <= 0) return "$0.00";
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

function fmtPct(value) {
  return `${Math.round(asNumber(value, 0))}%`;
}

function fmtDate(value) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function fmtDurationMs(ms) {
  const n = asNumber(ms, 0);
  if (n <= 0) return "-";
  if (n < 1000) return `${Math.round(n)} ms`;
  if (n < 60_000) return `${(n / 1000).toFixed(2)} s`;
  return `${(n / 60_000).toFixed(2)} min`;
}

function toEventMs(event) {
  const unixMs = asNumber(event?.unixMs, NaN);
  if (Number.isFinite(unixMs) && unixMs > 0) return unixMs;
  const ts = String(event?.timestamp || "").trim();
  if (!ts) return null;
  const parsed = Date.parse(ts);
  return Number.isFinite(parsed) ? parsed : null;
}

function tryJsonText(value) {
  if (value === undefined || value === null) return "{}";
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return "{}";
    try {
      return JSON.stringify(JSON.parse(trimmed), null, 2);
    } catch {
      return JSON.stringify({ text: value }, null, 2);
    }
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return JSON.stringify({ value: String(value) }, null, 2);
  }
}

function shortId(value, head = 10) {
  const s = String(value || "");
  if (!s) return "-";
  if (s.length <= head) return s;
  return `${s.slice(0, head)}...`;
}

function buildUrl(path, params = {}) {
  const url = new URL(`${BASE_PATH}${path}`, window.location.origin);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    url.searchParams.set(key, String(value));
  }
  if (TOKEN) url.searchParams.set("token", TOKEN);
  return url;
}

async function fetchJson(path, params = {}) {
  const response = await fetch(buildUrl(path, params).toString());
  const text = await response.text();
  let payload = null;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = { ok: false, message: "parse_error", raw: text };
  }
  if (!response.ok) {
    throw new Error(payload?.message || payload?.error || `HTTP ${response.status}`);
  }
  return payload;
}

function lineChartSvg(points, color) {
  if (!Array.isArray(points) || points.length === 0) {
    return '<div class="empty">No data</div>';
  }
  const width = 700;
  const height = 190;
  const pad = 22;
  const values = points.map((row) => asNumber(row.value, 0));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const step = (width - pad * 2) / Math.max(points.length - 1, 1);
  const coords = values.map((value, index) => {
    const x = pad + index * step;
    const y = height - pad - ((value - min) / span) * (height - pad * 2);
    return { x, y };
  });

  return `
    <svg class="chart-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
      <line x1="${pad}" y1="${height - pad}" x2="${width - pad}" y2="${height - pad}" stroke="#d9e2ee" stroke-width="1" />
      <polyline points="${coords.map((point) => `${point.x},${point.y}`).join(" ")}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linecap="round" />
      ${coords.map((point) => `<circle cx="${point.x}" cy="${point.y}" r="2.2" fill="${color}" />`).join("")}
    </svg>
  `;
}

function renderMetrics() {
  const data = state.metrics;
  if (!data) {
    return '<section class="panel"><div class="empty">Loading metrics...</div></section>';
  }

  const summary = data.summary || {};
  const week = data.costs?.week || {};
  const tools = Array.isArray(data.toolStats) ? data.toolStats.slice(0, 10) : [];
  const turns = Array.isArray(data.turns) ? [...data.turns].reverse().slice(0, 12) : [];
  const costSeries = Array.isArray(data.dailyCost) ? data.dailyCost.map((row) => ({ value: asNumber(row.usd, 0) })) : [];
  const ctxSeries = Array.isArray(data.usageSeries) ? data.usageSeries.map((row) => ({ value: asNumber(row.totalTokens, 0) })) : [];

  return `
    <div class="kpi-row">
      <div class="kpi"><div class="kpi-label">Context</div><div class="kpi-value">${fmtPct(summary.contextPct)}</div><div class="kpi-meta">${fmtNum(summary.contextTokens)} / ${fmtNum(summary.contextWindow)}</div></div>
      <div class="kpi"><div class="kpi-label">Today Cost</div><div class="kpi-value">${fmtUsd(summary.todayUsd)}</div><div class="kpi-meta">Week ${fmtUsd(summary.weekUsd)}</div></div>
      <div class="kpi"><div class="kpi-label">Tool Calls</div><div class="kpi-value">${fmtNum(summary.toolCalls)}</div><div class="kpi-meta">Errors ${fmtNum(summary.toolErrors)}</div></div>
      <div class="kpi"><div class="kpi-label">Turns</div><div class="kpi-value">${fmtNum(summary.turns)}</div><div class="kpi-meta">Compacts ${fmtNum(summary.compactionCount)}</div></div>
    </div>

    <div class="panel-grid">
      <section class="panel">
        <header class="panel-hd"><h3>Weekly Cost Trend</h3></header>
        <div class="chart-wrap">${lineChartSvg(costSeries, "#2e6cff")}</div>
      </section>
      <section class="panel">
        <header class="panel-hd"><h3>Context Tokens Trend</h3></header>
        <div class="chart-wrap">${lineChartSvg(ctxSeries, "#00a08c")}</div>
      </section>
    </div>

    <div class="panel-grid">
      <section class="panel">
        <header class="panel-hd"><h3>Tool Ranking</h3></header>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Tool</th><th>Calls</th><th>Err%</th><th>Avg</th></tr></thead>
            <tbody>
              ${tools.length === 0
                ? '<tr><td colspan="4" class="empty">No tools data</td></tr>'
                : tools.map((tool) => `
                  <tr>
                    <td>${escapeHtml(tool.name)}</td>
                    <td>${fmtNum(tool.calls)}</td>
                    <td>${fmtPct(tool.errorRatePct)}</td>
                    <td>${fmtDurationMs(tool.avgLatencyMs)}</td>
                  </tr>
                `).join("")}
            </tbody>
          </table>
        </div>
      </section>
      <section class="panel">
        <header class="panel-hd"><h3>Recent Turns</h3><span class="subtle">${escapeHtml(data.activeSessionKey || "-")}</span></header>
        <div class="table-wrap">
          <table>
            <thead><tr><th>#</th><th>Time</th><th>In</th><th>Out</th><th>Cost</th></tr></thead>
            <tbody>
              ${turns.length === 0
                ? '<tr><td colspan="5" class="empty">No turns</td></tr>'
                : turns.map((turn) => `
                  <tr>
                    <td>${fmtNum(turn.turnIndex)}</td>
                    <td>${turn.timestamp ? fmtDate(turn.timestamp * 1000) : "-"}</td>
                    <td>${fmtNum(turn.inputTokensDelta)}</td>
                    <td>${fmtNum(turn.outputTokensDelta)}</td>
                    <td>${fmtUsd(turn.estimatedUsd)}</td>
                  </tr>
                `).join("")}
            </tbody>
          </table>
        </div>
      </section>
    </div>

    <section class="panel compact">
      <header class="panel-hd"><h3>Week Totals</h3></header>
      <div class="compact-row">
        <span>Input ${fmtNum(week.inputTokens)}</span>
        <span>Output ${fmtNum(week.outputTokens)}</span>
        <span>Cache ${fmtNum(week.cacheReadTokens)}</span>
      </div>
    </section>
  `;
}

function snapshotFromTrace(trace) {
  const events = Array.isArray(trace?.events) ? trace.events : [];
  const firstUser = events.find((row) => row.kind === "user")?.text || "";
  const lastAssistant = [...events].reverse().find((row) => row.kind === "assistant")?.text || "";
  return {
    input: safeSlice(firstUser, 110),
    output: safeSlice(lastAssistant, 110),
    tokens: asNumber(trace?.summary?.inputTokens, 0) + asNumber(trace?.summary?.outputTokens, 0) + asNumber(trace?.summary?.cacheReadTokens, 0) + asNumber(trace?.summary?.cacheWriteTokens, 0),
    durationMs: asNumber(trace?.summary?.durationMs, 0),
    startedAt: trace?.summary?.startedAt || null,
  };
}

function eventKindMeta(kind) {
  switch (kind) {
    case "user": return { badge: "U", label: "user_message", tone: "user" };
    case "assistant": return { badge: "A", label: "assistant", tone: "assistant" };
    case "tool_call": return { badge: "TC", label: "tool_call", tone: "tool_call" };
    case "tool_result": return { badge: "TR", label: "tool_result", tone: "tool_result" };
    default: return { badge: "M", label: "meta", tone: "meta" };
  }
}

function buildTraceRounds(trace) {
  const events = Array.isArray(trace?.events) ? trace.events : [];
  const sessionKey = trace?.selectedSessionKey || "session";
  const rounds = [];
  let current = null;

  function finishRound() {
    if (!current) return;
    const durationMs = current.startMs !== null && current.endMs !== null ? Math.max(0, current.endMs - current.startMs) : 0;
    const startTime = current.startMs !== null ? new Date(current.startMs).toISOString() : null;
    const lastAssistant = [...current.events].reverse().find((row) => row.kind === "assistant");
    rounds.push({
      ...current,
      output: current.output || (lastAssistant?.text || ""),
      eventCount: current.events.length,
      durationMs,
      startTime,
    });
    current = null;
  }

  for (const event of events) {
    if (event.kind === "user") {
      finishRound();
      const startMs = toEventMs(event);
      current = {
        traceId: asString(event.id, `${sessionKey}:trace:${rounds.length + 1}`),
        roundIndex: rounds.length + 1,
        sessionKey,
        input: event.text || "",
        output: "",
        tokens: 0,
        costUsd: 0,
        startMs,
        endMs: startMs,
        events: [event],
      };
      continue;
    }

    if (!current) {
      const startMs = toEventMs(event);
      current = {
        traceId: `${sessionKey}:trace:${rounds.length + 1}`,
        roundIndex: rounds.length + 1,
        sessionKey,
        input: "(system)",
        output: "",
        tokens: 0,
        costUsd: 0,
        startMs,
        endMs: startMs,
        events: [],
      };
    }

    current.events.push(event);
    const eventMs = toEventMs(event);
    if (eventMs !== null) {
      if (current.startMs === null) current.startMs = eventMs;
      current.endMs = eventMs;
    }
    if (event.kind === "assistant") {
      current.output = event.text || current.output;
      current.tokens += asNumber(event?.usage?.totalTokens, 0);
      current.costUsd += asNumber(event?.usage?.usd, 0);
    }
  }

  finishRound();
  return rounds;
}

function buildTraceNodes(trace, scopedEvents = null, round = null) {
  const events = Array.isArray(scopedEvents) ? scopedEvents : (Array.isArray(trace?.events) ? trace.events : []);
  const byCall = new Map();
  const byResult = new Map();
  for (const row of events) {
    if (row.kind === "tool_call" && row.toolCallId) byCall.set(row.toolCallId, row);
    if (row.kind === "tool_result" && row.toolCallId) byResult.set(row.toolCallId, row);
  }

  const rootId = "root_span";
  const rootNode = {
    id: rootId,
    parentId: null,
    level: 0,
    badge: "{}",
    kind: "root",
    kindLabel: "root_span",
    tone: "root",
    title: "openclaw_request",
    subtitle: round?.traceId || trace?.selectedSessionKey || "session",
    status: "Success",
    statusCode: "-",
    type: "entry",
    latencyMs: asNumber(round?.durationMs, asNumber(trace?.summary?.durationMs, 0)),
    startTime: round?.startTime || trace?.summary?.startedAt || null,
    spanId: round?.traceId || trace?.selectedSessionId || trace?.selectedSessionKey || "root",
    inputText: "",
    outputText: "",
    inputJson: { sessionKey: trace?.selectedSessionKey || null, traceId: round?.traceId || null },
    outputJson: round || trace?.summary || {},
    raw: round || trace?.summary || {},
  };

  const nodes = [rootNode];
  let latestUserText = "";
  let activeAssistantId = rootId;

  for (let i = 0; i < events.length; i += 1) {
    const event = events[i];
    const meta = eventKindMeta(event.kind);

    let inputText = "";
    let outputText = "";
    let inputJson = {};
    let outputJson = {};
    let title = meta.label;
    let level = 1;
    let parentId = rootId;

    if (event.kind === "user") {
      latestUserText = event.text || "";
      inputText = event.text || "";
      inputJson = { message: event.text || "" };
      title = "user_message";
    } else if (event.kind === "assistant") {
      activeAssistantId = event.id || `assistant-${i}`;
      inputText = latestUserText || "";
      outputText = event.text || "";
      inputJson = { prompt: latestUserText || "" };
      outputJson = { text: event.text || "", usage: event.usage || null };
      title = "main_agent";
    } else if (event.kind === "tool_call") {
      level = 2;
      parentId = activeAssistantId;
      inputText = event.argumentsPreview || "";
      const relatedResult = event.toolCallId ? byResult.get(event.toolCallId) : null;
      outputText = relatedResult?.text || "";
      inputJson = { tool: event.toolName || "tool", args: event.argumentsPreview || "" };
      outputJson = { text: relatedResult?.text || "", latencyMs: relatedResult?.latencyMs || null };
      title = event.toolName || "tool_call";
    } else if (event.kind === "tool_result") {
      level = 2;
      parentId = activeAssistantId;
      const relatedCall = event.toolCallId ? byCall.get(event.toolCallId) : null;
      inputText = relatedCall?.argumentsPreview || "";
      outputText = event.text || "";
      inputJson = { callArgs: relatedCall?.argumentsPreview || "" };
      outputJson = { result: event.text || "", isError: Boolean(event.isError) };
      title = event.toolName || "tool_result";
    } else {
      title = event.text || "meta";
      outputText = event.text || "";
      outputJson = event.raw || {};
    }

    nodes.push({
      id: event.id || `event-${i}`,
      parentId,
      level,
      badge: meta.badge,
      kind: event.kind || "meta",
      kindLabel: meta.label,
      tone: meta.tone,
      title,
      subtitle: event.timestamp ? fmtDate(event.timestamp) : "-",
      status: event.isError ? "Error" : "Success",
      statusCode: event.isError ? "1" : "-",
      type: event.kind || "event",
      latencyMs: asNumber(event.latencyMs, 0),
      startTime: event.timestamp || null,
      spanId: event.id || `event-${i}`,
      inputText,
      outputText,
      inputJson,
      outputJson,
      raw: event.raw || event,
    });
  }

  return nodes;
}

function traceRouteLabel() {
  if (state.traceMode === "list") return "Trace list view";
  if (state.selectedNodeId && state.selectedNodeId !== "root_span") return "Trace node detail view";
  return "Trace round detail view";
}

function renderTraceFilters() {
  return `
    <div class="trace-filter-row">
      <select disabled><option>杩囧幓 3 澶?/option></select>
      <select disabled><option>Root Span</option></select>
      <select disabled><option>SDK 涓婃姤</option></select>
      <button class="btn ghost" disabled>杩囨护鍣?/button>
      <span class="subtle">浜や簰缁撴瀯浠?Coze锛氬垪琛?-> 浼氳瘽璇︽儏 -> 鑺傜偣璇︽儏</span>
    </div>
  `;
}

function renderTraceList(trace) {
  const rounds = buildTraceRounds(trace);
  const rows = rounds.map((round) => {
    return `
      <tr>
        <td><span class="dot ok"></span></td>
        <td class="mono">${escapeHtml(shortId(round.traceId || "-", 16))}</td>
        <td title="${escapeHtml(round.input || "-")}">${escapeHtml(round.input || "-")}</td>
        <td title="${escapeHtml(round.output || "-")}">${escapeHtml(round.output || "-")}</td>
        <td>${fmtNum(round.tokens)}</td>
        <td>${fmtDurationMs(round.durationMs)}</td>
        <td>${fmtDate(round.startTime || null)}</td>
        <td><button class="btn" data-open-trace="${escapeHtml(round.traceId || "")}">进入</button></td>
      </tr>
    `;
  }).join("");

  return `
    ${renderTraceFilters()}
    <section class="panel">
      <header class="panel-hd">
        <h3>Trace</h3>
        <span class="subtle">${fmtNum(rounds.length)} traces · session ${escapeHtml(shortId(trace?.selectedSessionKey || "-", 20))}</span>
      </header>
      <div class="table-wrap">
        <table class="trace-table">
          <thead>
            <tr>
              <th></th>
              <th>TraceID</th>
              <th>Input</th>
              <th>Output</th>
              <th>Tokens</th>
              <th>Duration</th>
              <th>StartTime</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${rows || '<tr><td colspan="8" class="empty">No traces</td></tr>'}
          </tbody>
        </table>
      </div>
    </section>
  `;
}
function renderDataBlock(title, valueText, valueJson, mode, switchAttr) {
  const textActive = mode === "text" ? "active" : "";
  const jsonActive = mode === "json" ? "active" : "";
  const body = mode === "json" ? tryJsonText(valueJson) : String(valueText || "(empty)");
  return `
    <section class="data-card">
      <header class="data-hd">
        <div class="data-title">${escapeHtml(title)}</div>
        <div class="data-switch">
          <button class="tiny ${textActive}" data-switch="${switchAttr}:text">TEXT</button>
          <button class="tiny ${jsonActive}" data-switch="${switchAttr}:json">JSON</button>
        </div>
      </header>
      <pre>${escapeHtml(body)}</pre>
    </section>
  `;
}

function renderTraceDetail(trace) {
  const sessions = Array.isArray(trace?.sessions) ? trace.sessions : [];
  const currentSession = sessions.find((row) => row.sessionKey === state.selectedSessionKey) || trace?.selectedSession || null;
  const rounds = buildTraceRounds(trace);
  const activeRound = rounds.find((round) => round.traceId === state.selectedTraceId) || rounds[0] || null;
  if (!activeRound) {
    return '<section class="panel"><div class="empty">No trace rounds in current session.</div></section>';
  }

  const nodes = buildTraceNodes(trace, activeRound.events, activeRound);
  const selected = nodes.find((node) => node.id === state.selectedNodeId) || nodes[0] || null;

  const treeRows = nodes.map((node) => `
    <button class="tree-row ${node.id === selected?.id ? "active" : ""}" style="--level:${node.level}" data-node-id="${escapeHtml(node.id)}">
      <span class="tree-left">
        <span class="kind ${escapeHtml(node.tone)}">${escapeHtml(node.badge)}</span>
        <span class="tree-title">${escapeHtml(node.title)}</span>
      </span>
      <span class="tree-right">${escapeHtml(fmtDurationMs(node.latencyMs))}</span>
    </button>
  `).join("");

  const tabRun = state.traceTab === "run" ? "active" : "";
  const tabMeta = state.traceTab === "metadata" ? "active" : "";
  const tabFeedback = state.traceTab === "feedback" ? "active" : "";

  let body = "";
  if (!selected) {
    body = '<div class="empty">No node selected</div>';
  } else if (state.traceTab === "run") {
    body = `
      ${renderDataBlock("Input", selected.inputText, selected.inputJson, state.runInputFormat, "input")}
      ${renderDataBlock("Output", selected.outputText, selected.outputJson, state.runOutputFormat, "output")}
    `;
  } else if (state.traceTab === "metadata") {
    body = `
      <section class="data-card">
        <header class="data-hd"><div class="data-title">Metadata</div></header>
        <pre>${escapeHtml(tryJsonText(selected.raw || {}))}</pre>
      </section>
    `;
  } else {
    body = `
      <section class="data-card">
        <header class="data-hd"><div class="data-title">Feedback</div></header>
        <div class="empty">No feedback for this node.</div>
      </section>
    `;
  }

  return `
    <div class="trace-breadcrumb">
      <button class="btn" data-action="back-trace-list">返回列表</button>
      <span class="crumb">Trace</span>
      <span class="crumb-sep">/</span>
      <span class="crumb">${escapeHtml(shortId(activeRound.traceId || "trace", 24))}</span>
      <span class="crumb-sep">/</span>
      <span class="crumb">${escapeHtml(selected?.title || "node")}</span>
    </div>

    <div class="trace-detail-layout">
      <section class="panel trace-tree-panel">
        <header class="panel-hd">
          <h3>${escapeHtml(shortId(activeRound.traceId || "trace", 24))}</h3>
          <span class="subtle">${escapeHtml(currentSession?.model || "unknown")} · round ${fmtNum(activeRound.roundIndex)}</span>
        </header>
        <div class="trace-tree-list">${treeRows}</div>
      </section>

      <section class="panel trace-main-panel">
        <header class="panel-hd panel-hd-tight">
          <div>
            <h3>${escapeHtml(selected?.title || "-")}</h3>
            <div class="subtle">${escapeHtml(selected?.kindLabel || "-")} · ${escapeHtml(selected?.subtitle || "-")}</div>
          </div>
          <div class="tab-group">
            <button class="tab ${tabRun}" data-trace-tab="run">Run</button>
            <button class="tab ${tabMeta}" data-trace-tab="metadata">Metadata</button>
            <button class="tab ${tabFeedback}" data-trace-tab="feedback">Feedback</button>
          </div>
        </header>
        <div class="trace-main-body">${body}</div>
      </section>

      <section class="panel trace-side-panel">
        <header class="panel-hd"><h3>Status</h3></header>
        <div class="status-panel">
          <div class="status-pill ${selected?.status === "Error" ? "danger" : "ok"}">${escapeHtml(selected?.status || "-")}</div>
          <div class="kv"><span>StatusCode</span><strong>${escapeHtml(selected?.statusCode || "-")}</strong></div>
          <div class="kv"><span>SpanID</span><strong class="mono">${escapeHtml(shortId(selected?.spanId || "-", 18))}</strong></div>
          <div class="kv"><span>TraceID</span><strong class="mono">${escapeHtml(shortId(activeRound.traceId || "-", 18))}</strong></div>
          <div class="kv"><span>Type</span><strong>${escapeHtml(selected?.type || "-")}</strong></div>
          <div class="kv"><span>Latency</span><strong>${escapeHtml(fmtDurationMs(selected?.latencyMs || 0))}</strong></div>
          <div class="kv"><span>StartTime</span><strong>${escapeHtml(fmtDate(selected?.startTime || null))}</strong></div>
          <div class="kv"><span>Session</span><strong class="mono">${escapeHtml(shortId(state.selectedSessionKey || "-", 18))}</strong></div>
        </div>
      </section>
    </div>
  `;
}
function renderTrace() {
  const trace = state.trace;
  if (!trace) {
    return '<section class="panel"><div class="empty">Loading trace...</div></section>';
  }

  return state.traceMode === "detail" ? renderTraceDetail(trace) : renderTraceList(trace);
}

function pageTitle() {
  return state.view === "trace" ? "Trace" : "Metrics";
}

function pageSubTitle() {
  if (state.view === "trace") return traceRouteLabel();
  return "Context, token, tool and cost observability.";
}

function syncUrl() {
  const url = new URL(`${BASE_PATH}/${state.view}`, window.location.origin);
  if (state.view === "trace") {
    url.searchParams.set("trace_view", state.traceMode);
    if (state.selectedSessionKey) url.searchParams.set("sessionKey", state.selectedSessionKey);
    if (state.selectedTraceId) url.searchParams.set("traceId", state.selectedTraceId);
    if (state.selectedNodeId) url.searchParams.set("nodeId", state.selectedNodeId);
    if (state.traceTab !== "run") url.searchParams.set("tab", state.traceTab);
  }
  if (TOKEN) url.searchParams.set("token", TOKEN);
  window.history.replaceState({}, "", url.toString());
}

function render() {
  const app = document.getElementById("app");
  if (!app) return;

  app.innerHTML = `
    <div class="layout">
      <aside class="sidebar">
        <div class="brand">
          <div class="logo">CS</div>
          <div>
            <div class="brand-title">Clawsmith</div>
            <div class="brand-sub">Observability</div>
          </div>
        </div>
        <div class="nav-list">
          <button class="nav-item ${state.view === "metrics" ? "active" : ""}" data-nav="metrics">Metrics</button>
          <button class="nav-item ${state.view === "trace" ? "active" : ""}" data-nav="trace">Trace</button>
        </div>
      </aside>

      <main class="main">
        <div class="topbar">
          <div>
            <h1>${pageTitle()}</h1>
            <div class="subtle">${pageSubTitle()}</div>
          </div>
          <div class="top-actions">
            <label class="toggle"><input type="checkbox" id="auto-refresh" ${state.autoRefresh ? "checked" : ""} />Auto 5s</label>
            <button class="btn primary" data-action="refresh">${state.loading ? "Loading..." : "Refresh"}</button>
          </div>
        </div>

        ${state.error ? `<section class="panel"><div class="error">${escapeHtml(state.error)}</div></section>` : ""}
        ${state.view === "trace" ? renderTrace() : renderMetrics()}
      </main>
    </div>
  `;

  app.querySelectorAll("[data-nav]").forEach((button) => {
    button.addEventListener("click", () => switchView(button.getAttribute("data-nav")));
  });

  const refreshButton = app.querySelector("[data-action=refresh]");
  if (refreshButton) refreshButton.addEventListener("click", () => refreshCurrent(true));

  const auto = app.querySelector("#auto-refresh");
  if (auto) {
    auto.addEventListener("change", () => {
      state.autoRefresh = Boolean(auto.checked);
      setupAutoRefresh();
    });
  }

  app.querySelectorAll("[data-open-trace]").forEach((button) => {
    button.addEventListener("click", () => {
      const traceId = button.getAttribute("data-open-trace");
      if (!traceId) return;
      state.traceMode = "detail";
      state.selectedTraceId = traceId;
      state.selectedNodeId = "root_span";
      state.traceTab = "run";
      syncUrl();
      render();
    });
  });

  app.querySelectorAll("[data-node-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const nodeId = button.getAttribute("data-node-id");
      if (!nodeId) return;
      state.selectedNodeId = nodeId;
      state.traceTab = "run";
      syncUrl();
      render();
    });
  });

  app.querySelectorAll("[data-trace-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      const tab = button.getAttribute("data-trace-tab");
      if (!["run", "metadata", "feedback"].includes(tab || "")) return;
      state.traceTab = tab;
      syncUrl();
      render();
    });
  });

  app.querySelectorAll("[data-switch]").forEach((button) => {
    button.addEventListener("click", () => {
      const rule = button.getAttribute("data-switch") || "";
      const [kind, mode] = rule.split(":");
      if (!["text", "json"].includes(mode)) return;
      if (kind === "input") state.runInputFormat = mode;
      if (kind === "output") state.runOutputFormat = mode;
      render();
    });
  });

  const back = app.querySelector("[data-action=back-trace-list]");
  if (back) {
    back.addEventListener("click", () => {
      state.traceMode = "list";
      state.selectedNodeId = null;
      state.traceTab = "run";
      syncUrl();
      render();
    });
  }
}

function switchView(next) {
  const view = next === "trace" ? "trace" : "metrics";
  if (view === state.view) return;
  state.view = view;
  state.error = null;
  syncUrl();
  refreshCurrent(true);
}

function setupAutoRefresh() {
  if (state.refreshTimer) clearInterval(state.refreshTimer);
  if (!state.autoRefresh) return;
  state.refreshTimer = setInterval(() => {
    refreshCurrent(false);
  }, 5000);
}

async function loadMetrics() {
  state.loading = true;
  state.error = null;
  render();
  try {
    state.metrics = await fetchJson("/api/metrics", {
      sessionKey: state.selectedSessionKey || undefined,
    });
  } catch (error) {
    state.error = String(error.message || error);
  } finally {
    state.loading = false;
    render();
  }
}

async function warmSessionSnapshots(sessions, maxCount = 6) {
  const top = sessions.filter((row) => row?.sessionKey).slice(0, maxCount);
  for (const row of top) {
    if (state.tracePreviewCache[row.sessionKey]) continue;
    try {
      const detail = await fetchJson("/api/trace", { sessionKey: row.sessionKey });
      if (detail?.ok) {
        state.tracePreviewCache[row.sessionKey] = snapshotFromTrace(detail);
      }
    } catch {
      // ignore preview warm failures
    }
  }
}

async function loadTrace(forceDetail = false) {
  state.loading = true;
  state.error = null;
  render();
  try {
    const trace = await fetchJson("/api/trace", {
      sessionKey: state.selectedSessionKey || undefined,
    });
    state.trace = trace;

    if (trace?.selectedSessionKey) {
      state.selectedSessionKey = trace.selectedSessionKey;
      state.tracePreviewCache[trace.selectedSessionKey] = snapshotFromTrace(trace);
    }

    const rounds = buildTraceRounds(trace);
    if (!state.selectedTraceId || !rounds.some((round) => round.traceId === state.selectedTraceId)) {
      state.selectedTraceId = rounds[0]?.traceId || null;
    }

    if (state.traceMode === "detail" || forceDetail) {
      const activeRound = rounds.find((round) => round.traceId === state.selectedTraceId) || rounds[0] || null;
      const nodes = buildTraceNodes(trace, activeRound?.events || null, activeRound);
      if (!state.selectedNodeId || !nodes.some((node) => node.id === state.selectedNodeId)) {
        state.selectedNodeId = nodes[0]?.id || null;
      }
    } else if (rounds.length === 0) {
      state.selectedNodeId = null;
    }

    if (!state.metrics) {
      state.metrics = await fetchJson("/api/metrics", {
        sessionKey: state.selectedSessionKey || undefined,
      });
    }
  } catch (error) {
    state.error = String(error.message || error);
  } finally {
    state.loading = false;
    syncUrl();
    render();
  }
}

async function refreshCurrent(force) {
  if (!force && state.loading) return;
  if (state.view === "trace") {
    await loadTrace(false);
  } else {
    await loadMetrics();
  }
}

window.addEventListener("popstate", () => {
  state.view = window.location.pathname.endsWith("/trace") ? "trace" : "metrics";
  const nextQuery = new URLSearchParams(window.location.search);
  state.traceMode = nextQuery.get("trace_view") === "detail" ? "detail" : "list";
  state.selectedSessionKey = nextQuery.get("sessionKey") || state.selectedSessionKey;
  state.selectedTraceId = nextQuery.get("traceId") || state.selectedTraceId;
  state.selectedNodeId = nextQuery.get("nodeId") || state.selectedNodeId;
  state.traceTab = ["run", "metadata", "feedback"].includes(nextQuery.get("tab")) ? nextQuery.get("tab") : "run";
  refreshCurrent(true);
});

setupAutoRefresh();
syncUrl();
refreshCurrent(true);


