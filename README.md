# clawsmith

**Know exactly what your OpenClaw agent is doing.**

Token usage. API cost. Context health. Smart alerts. All in one place — without touching a single line of OpenClaw's internals.

[![npm](https://img.shields.io/npm/v/clawsmith)](https://www.npmjs.com/package/clawsmith)
[![npm downloads](https://img.shields.io/npm/dm/clawsmith)](https://www.npmjs.com/package/clawsmith)
[![GitHub Stars](https://img.shields.io/github/stars/seekcontext/Clawsmith)](https://github.com/seekcontext/Clawsmith)
[![License](https://img.shields.io/github/license/seekcontext/Clawsmith)](./LICENSE)

[English](./README.md) · [简体中文](./README.zh-CN.md) · [日本語](./README.ja.md)

[Why clawsmith](#why-clawsmith) •
[Quick Start](#quick-start) •
[Commands](#commands) •
[Agent Integration](#agent-integration) •
[Configuration](#configuration) •
[How It Works](#how-it-works)

---

## Why clawsmith

Your OpenClaw agent lives inside a context window — burning tokens, compacting silently, spending your API budget. But you can't see any of it while it's happening.

clawsmith fixes that. It watches OpenClaw's files in the background and gives you a real-time window into what your agent is actually doing:

| Problem | clawsmith |
|---------|-----------|
| "Is my agent healthy right now?" | `clawsmith status` — instant snapshot |
| "I want to keep watching it live" | `clawsmith top` — live dashboard, auto-refreshing |
| "Why is context compacting so often?" | `clawsmith context` + `clawsmith suggest` |
| "What did the agent forget after compaction?" | `clawsmith compacts` |
| "What is this costing me?" | `clawsmith cost --week` with per-model pricing |
| "Is my TOOLS.md actually reaching the model?" | Truncation detection built-in |

**No configuration required. Zero side effects. 100% local.**

---

## Quick Start

```bash
npm install -g clawsmith

clawsmith start    # Launch background daemon (auto-detects OpenClaw)
clawsmith status   # Instant snapshot
```

clawsmith auto-detects your OpenClaw installation. No API keys, no accounts, no telemetry.

### Install as an OpenClaw skill (one command)

If you use OpenClaw, install clawsmith as a skill so your agent can monitor itself:

```bash
clawhub install clawsmith
```

Or tell your agent directly:

> Read https://github.com/alyenwuhen/Opensmith/tree/master/skills/clawsmith/SKILL.md and follow the instructions to set up clawsmith self-monitoring.

Start a new OpenClaw session and the agent will automatically have access to `clawsmith` commands for self-monitoring. See [`skills/clawsmith/SKILL.md`](./skills/clawsmith/SKILL.md) for the full skill definition.

---

## Commands

### `clawsmith status` — Instant Snapshot

Everything at a glance: session, model, context utilization, today's cost, and active alerts.

```
$ clawsmith status

📊  Agent Status  (active session)
──────────────────────────────────────────────────
  Agent:     main
  Session:   agent:main:workspace:direct:xxx ●
  Model:     moonshot/kimi-k2.5
  Active:    Today 16:41   Compacts: 2

  Context:   87.3K / 200.0K tokens  ███████░░░  44%
  Tokens:    72.4K in / 5.2K out

  Today:     $0.12  → clawsmith cost for full breakdown

  🟡  Context window at 44% capacity
       → Consider starting a fresh session or manually compacting now
```

---

### `clawsmith top` — Live Dashboard

Open it in a side terminal while your agent runs a long task. Stays on screen and updates every 2 seconds — context bar, cost counters, and a live turn-by-turn feed.

```
clawsmith top  refreshing every 2s  (q / Ctrl+C to quit)     03/18/2026 17:42:35
────────────────────────────────────────────────────────────────────────────────
  Agent: main   ● daemon running
  Session: agent:main:workspace:direct:xxx  ● active
  Model:   moonshot/kimi-k2.5
  Active:  Today 17:42   Compacts: 2
────────────────────────────────────────────────────────────────────────────────
  Context   ████████░░░░░░░░░░░░░░░░  44%   87.3K / 200.0K tokens
  Headroom  112.7K tokens remaining (56%)
────────────────────────────────────────────────────────────────────────────────
  Session cost  $0.52        Input   859.2K tok      Output   29.8K tok
  Today total   $0.67        Cache read   712.0K tok
────────────────────────────────────────────────────────────────────────────────
  Recent turns
  Turn  Time      ΔInput   ΔOutput  Cost          Note
  27    17:42     22.0K    908      $0.0094        ← latest
  26    17:19     990      630      $0.0026
  25    17:19     20.4K    661      $0.0094
  24    15:57     564      39       $0.0014
  23    15:56     18.8K    231      $0.0076        ◆ compact
────────────────────────────────────────────────────────────────────────────────
  🟡  Context window at 44% capacity
  Costs are estimates based on public pricing.
```

`q` or `Ctrl+C` to quit. Exits cleanly without leaving a mess in your terminal.

```bash
clawsmith top                  # default 2s refresh
clawsmith top --interval 5     # slower refresh
clawsmith top --agent coder    # target a specific agent
```

---

### `clawsmith cost` — API Cost Tracking

Per-model pricing for 30+ models built-in. Tracks input, output, and cache tokens separately. Day, week, month, or all-time views.

```
$ clawsmith cost --week

💰  Weekly Cost  2026-03-12 – 2026-03-18
──────────────────────────────────────────────────
  Total:     $0.67
  Daily avg: $0.096
  Month est: $2.87

  2026-03-12  ██████████████░░  $0.15
  2026-03-16  ████████████████  $0.16
  2026-03-17  █░░░░░░░░░░░░░░░  $0.0088
  2026-03-18  ███░░░░░░░░░░░░░  $0.03

  Input:   1.0M tokens  $0.65  (97%)
  Output:  47.8K tokens  $0.03  (3%)

  Costs are estimates. Verify with your provider's billing dashboard.
```

Built-in prices for: OpenAI (GPT-4o, o1, o3, o4-mini), Anthropic (Claude 3/3.5/3.7 Sonnet/Opus/Haiku), Google (Gemini 2.0/2.5 Flash/Pro), Moonshot (kimi-k2.5), DeepSeek (v3, r1), and more. Add any unlisted model via `~/.clawsmith/config.json`.

---

### `clawsmith session` — Session Breakdown

Drill into any session: total cost, token timeline, and exactly what each turn consumed.

```
$ clawsmith session

💬  Session  agent:main:workspace:…
──────────────────────────────────────────────────
  Model:      moonshot/kimi-k2.5
  Duration:   2h 14m
  Tokens:     In 859.2K  Out 29.8K  Context 87.3K
  Est. cost:  $0.52
  Compacts:   2

  Turn timeline:
  Turn  Time   ΔInput   ΔOutput  Cost
  1     14:02   4.2K     312     $0.003
  2     14:18  12.7K     891     $0.009  ◆ compact
  3     14:41  38.1K    2.4K     $0.028
  …
```

---

### `clawsmith context` — Context Window Analysis

Find out what's filling your context window, and catch silent truncation before it causes problems.

```
$ clawsmith context

🔍  Context Window  agent: main
──────────────────────────────────────────────────
  Used:    87.3K / 200.0K tokens  ███████░░░  44%

  Workspace overhead:  ~4.2K tokens  (7 injected files)
  Conversation est:    ~83.1K tokens  (messages + system prompt + tools)

  ⚠ TOOLS.md: 31% truncated — model never sees this content
    Increase bootstrapMaxChars in openclaw.json to fix this

  Remaining:  112.7K tokens (56%)
```

---

### `clawsmith compacts` — Compaction Events

Every compaction is captured. See exactly what was discarded — and save it before it's gone forever.

```
$ clawsmith compacts

📦  Compact Events  last 5
──────────────────────────────────────────────────

  #3  Today 16:22  [agent:main…]  3 messages

    👤  "Can you add retry logic to the upload handler?"
    🤖  "Done — added exponential backoff with 3 retries. The key change is in…"

    → Archive: clawsmith compacts --save 3
```

---

### `clawsmith suggest` — Optimization Alerts

Automatic detection of common issues. Only fires when something actually needs your attention.

| Rule | What It Detects |
|------|----------------|
| `tools-truncation` | TOOLS.md cut off — tool descriptions the model can't see |
| `high-compact-freq` | Context fills too fast, compacting every < 30 minutes |
| `context-headroom` | Context window > 90% full — compaction is imminent |
| `cost-spike` | Today's spend > 2× your weekly average |
| `memory-bloat` | MEMORY.md too large — wasting tokens on every turn |

Dismiss noisy rules: `clawsmith suggest --dismiss <rule-id>`

---

## Agent Integration

clawsmith is designed to be called **by agents**, not just humans. Every command supports `--json` for clean, parseable output. Errors are always structured JSON — never coloured text that breaks parsing.

### Health check in one call

```bash
clawsmith status --json
```

```json
{
  "agent": "main",
  "daemonRunning": true,
  "sessionKey": "agent:main:workspace:direct:xxx",
  "model": "moonshot/kimi-k2.5",
  "sessionTokens": 87340,
  "windowSize": 200000,
  "utilizationPct": 44,
  "todayUsd": 0.12,
  "suggestions": [
    {
      "severity": "warning",
      "ruleId": "context-headroom",
      "title": "Context window at 44% capacity",
      "detail": "...",
      "action": "Consider starting a fresh session or manually compacting now"
    }
  ]
}
```

### Discover the output schema

```bash
clawsmith schema           # list all commands
clawsmith schema status    # full field spec for status --json
clawsmith schema cost      # full field spec for cost --json
```

### Dismiss a suggestion programmatically

```bash
clawsmith suggest --dismiss context-headroom --json
# → { "ok": true, "dismissed": "context-headroom" }
```

### Errors are always parseable

```bash
clawsmith session --json   # no active session
# → { "ok": false, "error": "no_active_session", "message": "..." }
# exit code 1
```

---

## Configuration

Optional config at `~/.clawsmith/config.json` — auto-created on first `clawsmith start`:

```json
{
  "timezone": "Asia/Shanghai",
  "openclaw": {
    "dir": "~/.openclaw",
    "agent": "main"
  },
  "cost": {
    "customPrices": {
      "my-provider/my-model": { "input": 1.00, "output": 3.00 }
    }
  },
  "alerts": {
    "dailyBudgetUsd": 5.00
  },
  "rules": {
    "disabled": ["memory-bloat"]
  }
}
```

Most users need zero configuration. clawsmith auto-detects everything from your existing OpenClaw setup.

---

## How It Works

clawsmith reads OpenClaw's existing files in the background — no code changes, no plugins, no hooks required.

- **Zero configuration** — auto-detects OpenClaw at `~/.openclaw`
- **Zero side effects** — never touches OpenClaw's files; writes only to `~/.clawsmith/`
- **Background daemon** — `clawsmith start` watches for changes and keeps the local database current
- **Minimal footprint** — 4 production dependencies, no cloud services, no telemetry

---

## Privacy

- **100% local** — no data ever leaves your machine
- **No telemetry** — clawsmith collects nothing
- **No accounts, no API keys** — install and run

---

## Compatibility

Works with any OpenClaw version. Requires Node.js ≥ 22 · macOS or Linux (Windows via WSL2).

---

## Contributing

MIT licensed. Contributions welcome.

```bash
git clone https://github.com/seekcontext/Clawsmith
cd Clawsmith && npm install && npm run dev
```

---

[MIT License](./LICENSE)
