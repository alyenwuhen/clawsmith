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

### Auto-start on install

Install `clawsmith`, and it immediately starts the monitoring daemon.

```bash
npm install -g clawsmith
```

After installation, the `clawsmith` executable is available on your PATH through the package `bin` field, and npm runs the package install lifecycle for global installs as well. citeturn120983search2turn132199search4

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

### Install globally

```bash
npm install -g clawsmith
```

That does three things:
1. installs the `clawsmith` command
2. runs `postinstall`
3. auto-starts the daemon

The daemon performs an immediate scan on boot, so monitoring starts right after installation.

### First commands

```bash
clawsmith status
clawsmith session --list
clawsmith config --diag
```

---

## How It Works

`clawsmith` works in two layers:

1. **CLI layer**
   - the `clawsmith` executable dispatches all commands
   - npm exposes it via the `bin` field on global install citeturn120983search2

2. **Local observability layer**
   - the daemon scans `~/.openclaw/agents/**`
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

npm no longer supports uninstall lifecycle scripts in modern versions, so automatic teardown on `npm uninstall -g clawsmith` is not something npm provides as a package hook. citeturn132199search1

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
├── package.json             # npm-style bin + postinstall
├── skills/clawsmith/SKILL.md
├── src/cli.js               # Unified command router
├── src/install.js           # Auto-starts daemon after install
├── scripts/clawsmith-daemon.mjs
├── scripts/start.sh
├── scripts/stop.sh
├── scripts/status.sh
├── scripts/once.sh
├── scripts/selftest.sh
└── test/selftest.mjs
```
