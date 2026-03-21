#!/usr/bin/env -S node --disable-warning=ExperimentalWarning
import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import fs, { readFileSync } from "fs";
import { Command } from "commander";
import { resolveConfig, assertOpenClawExists, initConfigTemplate } from "./core/config.ts";
import { dropAndResetDb } from "./core/db.ts";
import { startDaemon } from "./daemon.ts";
import { runStatus } from "./cli/commands/status.ts";
import { runCost } from "./cli/commands/cost.ts";
import { runSession } from "./cli/commands/session.ts";
import { runCompacts } from "./cli/commands/compacts.ts";
import { runSchema } from "./cli/commands/schema.ts";
import { runTop } from "./cli/commands/top.ts";
import { runContext } from "./cli/commands/context.ts";
import { runSuggest } from "./cli/commands/suggest.ts";

const VERSION: string = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf-8")).version as string;
const program = new Command();
program.name("clawsmith").description("Know exactly what your OpenClaw agent is doing — token usage, cost, context health, and smart alerts in one place.").version(VERSION);
program.command("start").description("Start the background daemon (watches OpenClaw files)").option("--foreground", "Run daemon in foreground (don't detach)").action(async (opts: { foreground?: boolean }) => {
  const cfg = resolveConfig();
  assertOpenClawExists(cfg);
  if (process.env.CLAWSMITH_DAEMON === "1") { await startDaemon(cfg); return; }
  if (opts.foreground) { await startDaemon(cfg); return; }
  fs.mkdirSync(cfg.probeDir, { recursive: true });
  if (initConfigTemplate(cfg.probeDir)) console.log(`✓ Config template created: ${cfg.probeDir}/config.json`);
  const entryPath = fileURLToPath(import.meta.url);
  const daemonLogPath = path.join(cfg.probeDir, "daemon.log");
  const child = spawn(process.execPath, ["--import", "tsx", entryPath, "start"], { detached: true, stdio: "ignore", env: { ...process.env, CLAWSMITH_DAEMON: "1" }, cwd: process.cwd() });
  child.unref();
  console.log("✓ clawsmith daemon started (detached)");
  console.log(`✓ Watching: ${cfg.openclawDir}`);
  console.log(`✓ Logs: ${daemonLogPath}`);
  process.exit(0);
});
program.command("reset-db").description("Delete and recreate probe.db").option("--yes", "Skip confirmation prompt").action(async (opts: { yes?: boolean }) => {
  const cfg = resolveConfig();
  const dbPath = `${cfg.probeDir}/probe.db`;
  if (!opts.yes) {
    const readline = await import("readline");
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    await new Promise<void>((resolve) => {
      rl.question(`This will delete ${dbPath} and re-index from .jsonl transcripts on next start.\nContinue? [y/N] `, (answer) => { rl.close(); if (answer.toLowerCase() !== "y") { console.log("Aborted."); process.exit(0); } resolve(); });
    });
  }
  dropAndResetDb(cfg.probeDir);
  console.log(`✓ probe.db deleted. Run \`clawsmith start\` to rebuild from .jsonl transcripts.`);
});
program.command("stop").description("Stop the running daemon").action(() => {
  const cfg = resolveConfig();
  const pidFile = `${cfg.probeDir}/daemon.pid`;
  const { existsSync, readFileSync, unlinkSync } = fs;
  if (!existsSync(pidFile)) { console.log("No daemon PID file found — daemon may not be running."); return; }
  const pid = parseInt(readFileSync(pidFile, "utf-8").trim(), 10);
  if (isNaN(pid)) { console.log("Invalid PID file. Delete it manually: " + pidFile); return; }
  try { process.kill(pid, "SIGTERM"); unlinkSync(pidFile); console.log(`✓ Daemon stopped (PID ${pid})`); } catch (e: any) { if (e.code === "ESRCH") { console.log(`Daemon (PID ${pid}) was not running. Cleaning up PID file.`); try { unlinkSync(pidFile); } catch {} } else { console.error(`Failed to stop daemon: ${e.message}`); } }
});
program.command("status").description("Current session status (tokens, model, compactions)").option("--agent <name>").option("--session <key>").option("--json").action(async (opts) => { const cfg = resolveConfig(); assertOpenClawExists(cfg); await runStatus(cfg, opts); });
program.command("cost").description("API cost summary").option("--day").option("--week").option("--month").option("--all").option("--agent <name>").option("--json").action(async (opts) => { const cfg = resolveConfig(); assertOpenClawExists(cfg); await runCost(cfg, opts); });
program.command("session [session-key]").description("Per-session cost and turn breakdown").option("--list").option("--full").option("--no-turns").option("--agent <name>").option("--json").action(async (sessionKey, opts) => { const cfg = resolveConfig(); assertOpenClawExists(cfg); await runSession(cfg, sessionKey as string | undefined, opts); });
program.command("compacts").description("Recent compaction events").option("--last <n>", "Number of events to show", "5").option("--agent <name>").option("--session <key>").option("--show-messages").option("--save <id>").option("--json").action(async (opts) => { const cfg = resolveConfig(); assertOpenClawExists(cfg); await runCompacts(cfg, { ...opts, last: parseInt(opts.last ?? "5", 10) }); });
program.command("context").description("Context window composition analysis").option("--agent <name>").option("--json").action(async (opts) => { const cfg = resolveConfig(); assertOpenClawExists(cfg); await runContext(cfg, opts); });
program.command("suggest").description("Optimization suggestions").option("--agent <name>").option("--severity <level>").option("--dismiss <rule-id>").option("--reset-dismissed").option("--json").action(async (opts) => { const cfg = resolveConfig(); assertOpenClawExists(cfg); await runSuggest(cfg, { agent: opts.agent, severityFilter: opts.severity, dismiss: opts.dismiss, resetDismissed: opts.resetDismissed, json: opts.json }); });
program.command("config").description("Show detected OpenClaw configuration").option("--json").option("--diag").action(async (opts) => {
  const cfg = resolveConfig();
  if (opts.json) { console.log(JSON.stringify({ openclawDir: cfg.openclawDir, workspaceDir: cfg.workspaceDir, sessionsDir: cfg.sessionsDir, bootstrapMaxChars: cfg.bootstrapMaxChars, probeDir: cfg.probeDir, openclaw: cfg.openclaw }, null, 2)); return; }
  console.log(`OpenClaw dir:      ${cfg.openclawDir}`); console.log(`Workspace:         ${cfg.workspaceDir}`); console.log(`Sessions:          ${cfg.sessionsDir}`); console.log(`Bootstrap max:     ${cfg.bootstrapMaxChars.toLocaleString()} chars`); console.log(`probe.db:          ${cfg.probeDir}/probe.db`);
});
program.command("top").description("Live dashboard").option("--agent <name>").option("--interval <seconds>", "Refresh interval in seconds (default: 2)").action(async (opts) => { const cfg = resolveConfig(); assertOpenClawExists(cfg); await runTop(cfg, opts); });
program.command("schema [command]").description("Show the --json output schema for a command").action((commandName?: string) => { runSchema(commandName); });
program.parse(process.argv);
