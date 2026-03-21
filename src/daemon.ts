import fs from "fs";
import path from "path";
import { ResolvedConfig } from "./core/config.ts";
import { openDb, insertSessionSnapshot, upsertCompactEvent } from "./core/db.ts";
import { FileWatcher, buildWatchGlobs, FileChange } from "./core/watcher.ts";
import { readSessionsStore, listJsonlFiles, findJsonlPath, clearJsonlCache } from "./core/session-store.ts";
import { parseIncremental, parseAll, parseSessionStats } from "./core/jsonl-parser.ts";
import { analyzeCompaction } from "./engines/compact-diff.ts";
import { snapshotWorkspaceFiles } from "./engines/file-analyzer.ts";
import { runRules, persistSuggestions, ProbeState } from "./engines/rule-engine.ts";
import { recordSessionTurns } from "./engines/cost.ts";
let watcher: FileWatcher | null = null;
function redirectStdioToLogFile(probeDir: string): void { const logPath = path.join(probeDir, "daemon.log"); const stream = fs.createWriteStream(logPath, { flags: "a" }); const write = (chunk: unknown, encoding?: unknown, callback?: unknown): boolean => { const cb = typeof encoding === "function" ? encoding : typeof callback === "function" ? callback : undefined; const enc = (typeof encoding === "string" ? encoding : "utf8") as BufferEncoding; if (cb !== undefined) { stream.write(String(chunk), enc, cb as any); } else { stream.write(String(chunk), enc); } return true; }; (process.stdout as any).write = write; (process.stderr as any).write = write; }
export async function startDaemon(cfg: ResolvedConfig): Promise<void> {
  if (process.env.CLAWSMITH_DAEMON === "1") redirectStdioToLogFile(cfg.probeDir);
  const pidFile = path.join(cfg.probeDir, "daemon.pid"); fs.writeFileSync(pidFile, String(process.pid), "utf-8");
  const db = openDb(cfg.probeDir); const agent = cfg.probe.openclaw.agent;
  console.log(`✓ clawsmith daemon started  [${new Date().toISOString()}]`); console.log(`  openclawDir: ${cfg.openclawDir}`); console.log(`  sessionsDir: ${cfg.sessionsDir}`); console.log(`  probeDir:    ${cfg.probeDir}`); console.log(`  agent:       ${agent}`);
  if (!fs.existsSync(cfg.sessionsDir)) { console.error(`[daemon] WARNING: sessionsDir does not exist: ${cfg.sessionsDir}`); }
  const jsonlFiles = listJsonlFiles(cfg.sessionsDir); console.log(`[daemon] Found ${jsonlFiles.length} .jsonl transcript(s) to scan`);
  for (const jsonlPath of jsonlFiles) { try { await processJsonlFile(cfg, agent, jsonlPath, true); } catch (err) { console.error(`[daemon] Error scanning ${jsonlPath}:`, err); } }
  clearJsonlCache();
  try { const sessionCount = await processSessionsJson(cfg, agent); console.log(`[daemon] Snapshotted ${sessionCount} session(s) from sessions.json`); } catch (err) { console.error(`[daemon] Error reading sessions.json:`, err); }
  snapshotWorkspaceFiles(db, agent, cfg.workspaceDir, cfg.bootstrapMaxChars); runAndPersistRules(cfg, agent);
  const globs = buildWatchGlobs(cfg.openclawDir, cfg.workspaceDir, cfg.sessionsDir); watcher = new FileWatcher(300).watch(globs);
  watcher.on(async (change: FileChange) => { try { switch (change.category) { case "sessions_json": await processSessionsJson(cfg, agent); runAndPersistRules(cfg, agent); break; case "jsonl": await processJsonlFile(cfg, agent, change.filePath, false); runAndPersistRules(cfg, agent); break; case "workspace_md": snapshotWorkspaceFiles(db, agent, cfg.workspaceDir, cfg.bootstrapMaxChars); runAndPersistRules(cfg, agent); break; case "openclaw_config": break; } } catch (err) { console.error("[daemon] Error processing change:", err); } });
  const ruleTimer = setInterval(() => { runAndPersistRules(cfg, agent); }, 5 * 60 * 1000);
  const shutdown = async () => { clearInterval(ruleTimer); if (watcher) await watcher.close(); try { fs.unlinkSync(pidFile); } catch {} process.exit(0); };
  process.on("SIGTERM", shutdown); process.on("SIGINT", shutdown);
}
async function processSessionsJson(cfg: ResolvedConfig, agent: string): Promise<number> { const db = openDb(cfg.probeDir); const sessions = readSessionsStore(cfg.sessionsDir); const now = Math.floor(Date.now() / 1000); for (const session of sessions) { insertSessionSnapshot(db, { agent, session_key: session.sessionKey, session_id: session.sessionId, model: session.modelOverride ?? null, provider: session.providerOverride ?? null, input_tokens: session.inputTokens, output_tokens: session.outputTokens, total_tokens: session.totalTokens, context_tokens: session.contextTokens, compaction_count: session.compactionCount, sampled_at: now }); } return sessions.length; }
async function processJsonlFile(cfg: ResolvedConfig, agent: string, filePath: string, fullScan: boolean): Promise<void> { const db = openDb(cfg.probeDir); const sessions = readSessionsStore(cfg.sessionsDir); const matchedSession = sessions.find((s) => { const p = findJsonlPath(cfg.sessionsDir, s); return p === filePath || (p && path.resolve(p) === path.resolve(filePath)); }); const sessionKey = matchedSession?.sessionKey ?? path.basename(filePath, ".jsonl"); try { const stats = parseSessionStats(filePath); if (stats && stats.turns.length > 0) { recordSessionTurns(db, agent, sessionKey, stats, cfg.probe.cost.customPrices); } } catch (err) { console.error(`[daemon] turn record error for ${sessionKey}:`, err); }
  const { entries, compactEvents } = fullScan ? parseAll(filePath) : parseIncremental(filePath); if (compactEvents.length === 0) return; const { getCompactedMessages } = await import("./core/jsonl-parser.ts"); let prevFirstKeptId: string | undefined; for (const event of compactEvents) { const compactedMessages = getCompactedMessages(entries, event, prevFirstKeptId); analyzeCompaction(event, entries, prevFirstKeptId); upsertCompactEvent(db, { agent, session_key: sessionKey, compaction_entry_id: event.entryId, first_kept_entry_id: event.firstKeptEntryId, tokens_before: event.tokensBefore ?? null, summary_text: event.summaryText, compacted_at: event.timestamp ?? null, compacted_message_count: compactedMessages.length, compacted_messages: JSON.stringify(compactedMessages.map((m) => ({ id: (m as any).id, role: (m as any).role, content: (m as any).content.slice(0, 2000) }))) }); prevFirstKeptId = event.firstKeptEntryId; } }
function runAndPersistRules(cfg: ResolvedConfig, agent: string): void { const db = openDb(cfg.probeDir); const state: ProbeState = { db, agent, workspaceDir: cfg.workspaceDir, sessionsDir: cfg.sessionsDir, bootstrapMaxChars: cfg.bootstrapMaxChars, config: cfg.probe }; try { const suggestions = runRules(state); persistSuggestions(db, agent, suggestions); } catch {} }
