# clawsmith

**The Observability CLI for OpenClaw**

See what your agent runs. Track what your sessions consume. Know when context starts leaking.

[Why clawsmith](#why-clawsmith) •
[Features](#features) •
[Quick Start](#quick-start) •
[How It Works](#how-it-works) •
[CLI Reference](#cli-reference) •
[Configuration](#configuration)

---

## Why clawsmith

OpenClaw sessions generate local state, transcripts, token usage, compaction signals, and memory artifacts — but these are not easy to inspect from one consistent interface.

`clawsmith` gives you a single CLI surface for that observability layer.

It focuses on **monitoring and tracing**, not evaluation.

---

## Features

### Daemon control

```bash
clawsmith start
clawsmith stop
```

### Status & context

```bash
clawsmith status
clawsmith context
```

### Sessions

```bash
clawsmith session
clawsmith session --list
clawsmith session --list --full
```

### Cost

```bash
clawsmith cost
clawsmith cost --day
clawsmith cost --month
```

### Compact events

```bash
clawsmith compacts
clawsmith compacts --last 10
```

### Memory

```bash
clawsmith memory list
clawsmith memory search "postgres"
clawsmith memory add "prefer snake_case"
clawsmith memory save-compact 1
```

### Suggestions & diagnostics

```bash
clawsmith suggest
clawsmith config --diag
```

### Verification

```bash
clawsmith once
clawsmith selftest
```

---

## Quick Start

### Install as a skill bundle

Put the `clawsmith` folder into your OpenClaw `skills` directory. This package is designed as a **skill bundle with a built-in CLI**.

After installation, the user should only need a single command surface:

```bash
clawsmith start
clawsmith status
```

### First run

```bash
clawsmith selftest
clawsmith start
clawsmith status
```

---

## How It Works

`clawsmith` works in two layers:

1. **Skill bundle layer**
   - `SKILL.md` tells the agent how to operate `clawsmith`
   - the bundle ships its own CLI and helper scripts

2. **Local observability layer**
   - scans `~/.openclaw/agents/**`
   - reads `sessions.json` and transcript `.jsonl` files
   - writes health and trace snapshots into `~/.clawsmith/`

### Output directory

```text
~/.clawsmith/
├── daemon.pid
├── daemon.log
├── daemon.state.json
├── health.json
├── events.jsonl
└── traces/
```

### What gets tracked

- session index summaries
- transcript-file scan snapshots
- compaction-like events inferred from local transcripts
- token totals when they are present in local session metadata
- daemon-generated trace snapshots

### Boundary

This build is **file-observability based**. It is easier to deploy than a runtime-hook plugin, but exact per-tool spans and exact prompt capture require in-process instrumentation.

---

## CLI Reference

```bash
# Daemon
clawsmith start               # Start background daemon
clawsmith stop                # Stop daemon

# Status & context
clawsmith status              # Current session and scan summary
clawsmith context             # Context and session breakdown

# Sessions
clawsmith session             # Active session details
clawsmith session --list      # All sessions
clawsmith session --list --full  # Full session keys (not truncated)

# Cost
clawsmith cost                # This week
clawsmith cost --day          # Today
clawsmith cost --month        # This month

# Compact events
clawsmith compacts            # Last 5 compact events
clawsmith compacts --last 10  # Last 10

# Memory
clawsmith memory list                      # List memory entries
clawsmith memory search "postgres"         # Search memory
clawsmith memory add "prefer snake_case"   # Add to memory
clawsmith memory save-compact <id>         # Save from compact event

# Suggestions
clawsmith suggest             # Show optimization suggestions

# Diagnostics
clawsmith config --diag       # Full diagnostic dump

# Verification
clawsmith once                # Run a single scan
clawsmith selftest            # Validate clawsmith output chain
```

---

## Configuration

Environment variables:

```bash
OPENCLAW_HOME=~/.openclaw
CLAWSMITH_SCAN_INTERVAL_MS=5000
```

Defaults:
- OpenClaw directory: `~/.openclaw`
- Clawsmith state directory: `~/.clawsmith`

---

## Structure

```text
clawsmith/
├── clawsmith                # CLI entrypoint
├── package.json             # npm-style package metadata + bin
├── skills/clawsmith/SKILL.md
├── src/cli.js               # Unified command router
├── scripts/clawsmith-daemon.mjs
├── scripts/start.sh
├── scripts/stop.sh
├── scripts/status.sh
├── scripts/once.sh
├── scripts/selftest.sh
└── test/selftest.mjs
```
