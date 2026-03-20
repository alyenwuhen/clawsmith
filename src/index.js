import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function safeJsonParse(raw, fallback = null) {
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function readJson(file, fallback = null) {
  try {
    return safeJsonParse(fs.readFileSync(file, 'utf8'), fallback);
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

function appendJsonl(file, obj) {
  ensureDir(path.dirname(file));
  fs.appendFileSync(file, JSON.stringify(obj) + '\n', 'utf8');
}

function nowIso() {
  return new Date().toISOString();
}

function getStore(api) {
  const pluginCfg = api.pluginConfig || {};
  const workspaceDir = api.runtime?.workspaceDir || api.resolvePath?.('~/workspace') || process.cwd();
  const outputDirName = pluginCfg.outputDir || '.clawsmith';
  const storeDir = path.isAbsolute(outputDirName) ? outputDirName : path.join(workspaceDir, outputDirName);
  const tracesDir = path.join(storeDir, 'traces');
  const sessionsDir = path.join(storeDir, 'sessions');
  const runsDir = path.join(storeDir, 'runs');
  ensureDir(tracesDir); ensureDir(sessionsDir); ensureDir(runsDir);
  return { workspaceDir, storeDir, tracesDir, sessionsDir, runsDir };
}

function estimateContextRatio(pluginCfg, provider, model, usageInput) {
  const map = pluginCfg.contextWindows || {};
  const direct = map[`${provider}/${model}`] || map[model] || map[provider];
  if (!direct || !usageInput || usageInput <= 0) return null;
  return Math.max(0, Math.min(1, usageInput / direct));
}

function loadTrace(file) {
  return readJson(file, null);
}

function saveTrace(file, trace) {
  writeJson(file, trace);
}

function findLatestTrace(store) {
  const files = fs.existsSync(store.tracesDir) ? fs.readdirSync(store.tracesDir).filter(f => f.endsWith('.json')) : [];
  files.sort((a,b) => fs.statSync(path.join(store.tracesDir, b)).mtimeMs - fs.statSync(path.join(store.tracesDir, a)).mtimeMs);
  return files[0] ? readJson(path.join(store.tracesDir, files[0]), null) : null;
}

function listTraces(store, limit = 100) {
  const files = fs.existsSync(store.tracesDir) ? fs.readdirSync(store.tracesDir).filter(f => f.endsWith('.json')) : [];
  files.sort((a,b) => fs.statSync(path.join(store.tracesDir, b)).mtimeMs - fs.statSync(path.join(store.tracesDir, a)).mtimeMs);
  return files.slice(0, limit).map(name => readJson(path.join(store.tracesDir, name), null)).filter(Boolean);
}

function listSessionTraces(store, sessionId) {
  return listTraces(store, 1000).filter(t => t.sessionId === sessionId);
}

function upsertSessionIndex(store, sessionId, patch) {
  if (!sessionId) return;
  const file = path.join(store.sessionsDir, `${sessionId}.json`);
  const data = readJson(file, { sessionId, updatedAt: nowIso(), traces: [], channels: [], runIds: [] });
  Object.assign(data, patch, { updatedAt: nowIso() });
  if (patch.traceId && !data.traces.includes(patch.traceId)) data.traces.push(patch.traceId);
  if (patch.channelId && !data.channels.includes(patch.channelId)) data.channels.push(patch.channelId);
  if (patch.runId && !data.runIds.includes(patch.runId)) data.runIds.push(patch.runId);
  writeJson(file, data);
}

function createTraceSkeleton({ runId, sessionId, agentId, channelId, trigger }) {
  return {
    traceId: runId || `trace_${Date.now()}`,
    runId: runId || null,
    sessionId: sessionId || null,
    agentId: agentId || null,
    channelId: channelId || null,
    trigger: trigger || null,
    startedAt: nowIso(),
    endedAt: null,
    success: null,
    error: null,
    provider: null,
    model: null,
    prompt: null,
    systemPrompt: null,
    historyMessageCount: 0,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    contextRatio: null,
    assistantTexts: [],
    inputMessages: [],
    outputMessages: [],
    toolSpans: [],
    compactions: [],
    subagents: [],
    events: []
  };
}

function persistEvent(store, trace, event) {
  trace.events.push({ at: nowIso(), ...event });
  appendJsonl(path.join(store.runsDir, `${trace.traceId}.jsonl`), { at: nowIso(), ...event });
}

const plugin = {
  id: 'clawsmith',
  name: 'clawsmith',
  version: '0.1.0',
  description: 'LangSmith-style tracing and monitoring for OpenClaw',
  register(api) {
    const store = getStore(api);
    const pluginCfg = api.pluginConfig || {};
    const liveToolCalls = new Map();

    function traceFile(traceId) {
      return path.join(store.tracesDir, `${traceId}.json`);
    }

    function getOrCreateTrace(ctx) {
      const traceId = ctx?.runId || `trace_${Date.now()}`;
      const file = traceFile(traceId);
      let trace = loadTrace(file);
      if (!trace) {
        trace = createTraceSkeleton({
          runId: ctx?.runId,
          sessionId: ctx?.sessionId,
          agentId: ctx?.agentId,
          channelId: ctx?.channelId,
          trigger: ctx?.trigger
        });
        saveTrace(file, trace);
        upsertSessionIndex(store, trace.sessionId, { traceId: trace.traceId, runId: trace.runId, channelId: trace.channelId });
      }
      return { trace, file };
    }

    api.registerCommand({
      name: 'probe',
      description: 'Inspect latest clawsmith trace information',
      acceptsArgs: true,
      requireAuth: false,
      handler: async (ctx) => {
        const store = getStore(api);
        const args = (ctx.args || '').trim();
        const latest = findLatestTrace(store);
        if (!args || args === 'latest' || args === 'status') {
          if (!latest) return { text: 'clawsmith: no traces captured yet.' };
          return {
            text:
`clawsmith latest\ntraceId=${latest.traceId}\nsessionId=${latest.sessionId || '-'}\nprovider=${latest.provider || '-'}\nmodel=${latest.model || '-'}\nusage.in=${latest.usage?.input || 0}\nusage.out=${latest.usage?.output || 0}\ncontextRatio=${latest.contextRatio == null ? '-' : (latest.contextRatio * 100).toFixed(2) + '%'}`
          };
        }
        const [sub, val] = args.split(/\s+/, 2);
        if (sub === 'trace' && val) {
          const trace = readJson(path.join(store.tracesDir, `${val}.json`), null);
          return { text: trace ? JSON.stringify(trace, null, 2) : `clawsmith: trace not found: ${val}` };
        }
        if (sub === 'session' && val) {
          const sess = readJson(path.join(store.sessionsDir, `${val}.json`), null);
          return { text: sess ? JSON.stringify(sess, null, 2) : `clawsmith: session not found: ${val}` };
        }
        return { text: 'clawsmith: supported commands: probe status | probe latest | probe trace <id> | probe session <id>' };
      }
    });

    api.registerHttpRoute({
      path: '/plugins/clawsmith/health',
      auth: 'gateway',
      handler: async (_req, res) => {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ ok: true, plugin: 'clawsmith', version: plugin.version }));
        return true;
      }
    });

    api.registerHttpRoute({
      path: '/plugins/clawsmith/traces',
      auth: 'gateway',
      match: 'exact',
      handler: async (req, res) => {
        const url = new URL(req.url, 'http://localhost');
        const limit = Number(url.searchParams.get('limit') || '100');
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ items: listTraces(store, limit) }));
        return true;
      }
    });

    api.registerHttpRoute({
      path: '/plugins/clawsmith/trace/',
      auth: 'gateway',
      match: 'prefix',
      handler: async (req, res) => {
        const id = decodeURIComponent((req.url.split('/plugins/clawsmith/trace/')[1] || '').split('?')[0]);
        const trace = readJson(path.join(store.tracesDir, `${id}.json`), null);
        res.statusCode = trace ? 200 : 404;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(trace || { error: 'trace_not_found', traceId: id }));
        return true;
      }
    });

    api.registerHttpRoute({
      path: '/plugins/clawsmith/session/',
      auth: 'gateway',
      match: 'prefix',
      handler: async (req, res) => {
        const id = decodeURIComponent((req.url.split('/plugins/clawsmith/session/')[1] || '').split('?')[0]);
        const session = readJson(path.join(store.sessionsDir, `${id}.json`), null);
        const traces = listSessionTraces(store, id);
        res.statusCode = session ? 200 : 404;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(session ? { session, traces } : { error: 'session_not_found', sessionId: id }));
        return true;
      }
    });

    api.registerHttpRoute({
      path: '/plugins/clawsmith/viewer',
      auth: 'gateway',
      match: 'exact',
      handler: async (_req, res) => {
        const html = fs.readFileSync(path.join(__dirname, '..', 'dashboard', 'viewer.html'), 'utf8');
        res.setHeader('content-type', 'text/html; charset=utf-8');
        res.end(html);
        return true;
      }
    });

    api.on('session_start', (event, ctx) => {
      upsertSessionIndex(store, event.sessionId || ctx.sessionId, {
        sessionId: event.sessionId || ctx.sessionId,
        sessionKey: event.sessionKey || ctx.sessionKey,
        startedAt: nowIso()
      });
    });

    api.on('message_received', (event, ctx) => {
      appendJsonl(path.join(store.storeDir, 'messages.received.jsonl'), { at: nowIso(), ctx, event });
    });

    api.on('message_sent', (event, ctx) => {
      appendJsonl(path.join(store.storeDir, 'messages.sent.jsonl'), { at: nowIso(), ctx, event });
    });

    api.on('llm_input', (event, ctx) => {
      const { trace, file } = getOrCreateTrace(ctx);
      trace.provider = event.provider;
      trace.model = event.model;
      trace.prompt = pluginCfg.persistPromptBodies === false ? '[disabled]' : event.prompt;
      trace.systemPrompt = pluginCfg.persistPromptBodies === false ? '[disabled]' : (event.systemPrompt || null);
      trace.historyMessageCount = Array.isArray(event.historyMessages) ? event.historyMessages.length : 0;
      if (pluginCfg.persistMessageBodies) trace.inputMessages = event.historyMessages || [];
      persistEvent(store, trace, { type: 'llm_input', provider: event.provider, model: event.model, imagesCount: event.imagesCount || 0 });
      saveTrace(file, trace);
      upsertSessionIndex(store, trace.sessionId, { traceId: trace.traceId, runId: trace.runId, channelId: trace.channelId });
    });

    api.on('before_tool_call', (event, ctx) => {
      const { trace, file } = getOrCreateTrace(ctx);
      const span = {
        key: `${ctx.runId || trace.traceId}:${event.toolCallId || event.toolName}:${Date.now()}`,
        toolCallId: event.toolCallId || null,
        toolName: event.toolName,
        startedAt: nowIso(),
        endedAt: null,
        durationMs: null,
        params: event.params,
        result: null,
        error: null
      };
      liveToolCalls.set(`${ctx.runId || trace.traceId}:${event.toolName}:${event.toolCallId || 'default'}`, span);
      trace.toolSpans.push(span);
      persistEvent(store, trace, { type: 'before_tool_call', toolName: event.toolName, toolCallId: event.toolCallId || null });
      saveTrace(file, trace);
    });

    api.on('after_tool_call', (event, ctx) => {
      const { trace, file } = getOrCreateTrace(ctx);
      const mapKey = `${ctx.runId || trace.traceId}:${event.toolName}:${event.toolCallId || 'default'}`;
      const span = liveToolCalls.get(mapKey) || trace.toolSpans.find(s => s.toolName === event.toolName && s.toolCallId === (event.toolCallId || null) && !s.endedAt);
      if (span) {
        span.endedAt = nowIso();
        span.durationMs = event.durationMs || null;
        span.result = pluginCfg.persistMessageBodies ? (event.result ?? null) : '[omitted]';
        span.error = event.error || null;
      }
      liveToolCalls.delete(mapKey);
      persistEvent(store, trace, { type: 'after_tool_call', toolName: event.toolName, toolCallId: event.toolCallId || null, durationMs: event.durationMs || null, error: event.error || null });
      saveTrace(file, trace);
    });

    api.on('before_compaction', (event, ctx) => {
      const { trace, file } = getOrCreateTrace(ctx);
      trace.compactions.push({ phase: 'before', at: nowIso(), messageCount: event.messageCount, compactingCount: event.compactingCount || null, tokenCount: event.tokenCount || null });
      persistEvent(store, trace, { type: 'before_compaction', messageCount: event.messageCount, compactingCount: event.compactingCount || null, tokenCount: event.tokenCount || null });
      saveTrace(file, trace);
    });

    api.on('after_compaction', (event, ctx) => {
      const { trace, file } = getOrCreateTrace(ctx);
      trace.compactions.push({ phase: 'after', at: nowIso(), messageCount: event.messageCount, compactedCount: event.compactedCount || null, tokenCount: event.tokenCount || null });
      persistEvent(store, trace, { type: 'after_compaction', messageCount: event.messageCount, compactedCount: event.compactedCount || null, tokenCount: event.tokenCount || null });
      saveTrace(file, trace);
    });

    api.on('subagent_spawned', (event, ctx) => {
      const { trace, file } = getOrCreateTrace(ctx);
      trace.subagents.push({ type: 'spawned', at: nowIso(), ...event });
      persistEvent(store, trace, { type: 'subagent_spawned', childSessionKey: event.childSessionKey, agentId: event.agentId, runId: event.runId });
      saveTrace(file, trace);
    });

    api.on('subagent_ended', (event, ctx) => {
      const { trace, file } = getOrCreateTrace(ctx);
      trace.subagents.push({ type: 'ended', at: nowIso(), ...event });
      persistEvent(store, trace, { type: 'subagent_ended', targetSessionKey: event.targetSessionKey, outcome: event.outcome || null, reason: event.reason });
      saveTrace(file, trace);
    });

    api.on('llm_output', (event, ctx) => {
      const { trace, file } = getOrCreateTrace(ctx);
      trace.provider = event.provider;
      trace.model = event.model;
      trace.assistantTexts = event.assistantTexts || [];
      trace.usage = {
        input: event.usage?.input || 0,
        output: event.usage?.output || 0,
        cacheRead: event.usage?.cacheRead || 0,
        cacheWrite: event.usage?.cacheWrite || 0,
        total: event.usage?.total || ((event.usage?.input || 0) + (event.usage?.output || 0))
      };
      trace.contextRatio = estimateContextRatio(pluginCfg, event.provider, event.model, trace.usage.input);
      if (pluginCfg.persistMessageBodies && event.lastAssistant) trace.outputMessages.push(event.lastAssistant);
      persistEvent(store, trace, { type: 'llm_output', usage: trace.usage, assistantCount: trace.assistantTexts.length });
      saveTrace(file, trace);
    });

    api.on('agent_end', (event, ctx) => {
      const { trace, file } = getOrCreateTrace(ctx);
      trace.endedAt = nowIso();
      trace.success = !!event.success;
      trace.error = event.error || null;
      trace.durationMs = event.durationMs || null;
      persistEvent(store, trace, { type: 'agent_end', success: !!event.success, durationMs: event.durationMs || null, error: event.error || null });
      saveTrace(file, trace);
      upsertSessionIndex(store, trace.sessionId, { traceId: trace.traceId, runId: trace.runId, channelId: trace.channelId, lastSuccess: trace.success, lastEndedAt: trace.endedAt });
    });

    api.on('session_end', (event, ctx) => {
      upsertSessionIndex(store, event.sessionId || ctx.sessionId, { messageCount: event.messageCount, durationMs: event.durationMs || null, endedAt: nowIso() });
    });
  }
};

export default plugin;
