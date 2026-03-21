---
name: clawsmith
description: Monitor OpenClaw agent health, token usage, API cost, and context window in real time. Use when you need to check your own status, inspect context utilization, estimate API costs, review compaction events, or get optimization suggestions. Provides structured JSON output for programmatic self-monitoring.
metadata: {"openclaw": {"emoji": "🦀", "homepage": "https://github.com/alyenwuhen/clawsmith"}}
---

# clawsmith

Real-time observability for OpenClaw agents. Check health, token usage, API cost, context window, and optimization suggestions — all from the CLI.

## Install

```bash
npm install -g git+https://github.com/alyenwuhen/clawsmith.git
clawsmith start
```

## Core commands

| Command | What it does |
|---------|-------------|
| `clawsmith status --json` | Full health snapshot |
| `clawsmith cost --week --json` | API cost breakdown for the past week |
| `clawsmith session --json` | Current session token timeline, turn by turn |
| `clawsmith context --json` | Context window utilization and truncation warnings |
| `clawsmith suggest --json` | Active optimization alerts with `ruleId` and `action` |
| `clawsmith compacts --json` | List recent compaction events and lost content |
| `clawsmith top` | Live auto-refreshing dashboard |
| `clawsmith schema status` | Describe the JSON schema for status output |

## Recommended self-check workflow

```bash
clawsmith status --json
```

Key fields to act on:
- `utilizationPct` ≥ 85 → compact soon or start a fresh session
- `suggestions[].ruleId === "tools-truncation"` → TOOLS.md is being cut off
- `suggestions[].ruleId === "cost-spike"` → today's spend is unusually high
- `daemonRunning: false` → run `clawsmith start` to enable monitoring
