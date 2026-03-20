---
name: clawsmith
version: 0.2.0
description: "The observability CLI for OpenClaw, packaged as a skill bundle."
tags: [openclaw, observability, tracing, monitoring, cli, daemon]
metadata: {"openclaw":{"emoji":"🧭"}}
---

# clawsmith

`clawsmith` is an OpenClaw **skill bundle with a built-in CLI**.

The user should interact with a single command surface:

```bash
clawsmith start
clawsmith status
clawsmith session --list
clawsmith cost --month
clawsmith suggest
clawsmith config --diag
```

## What this skill provides

- a unified `clawsmith` CLI
- a daemon that scans local OpenClaw data
- session and token summaries when present in local files
- compaction and trace snapshots
- lightweight memory operations on `MEMORY.md`

## Core commands

```bash
# Daemon
clawsmith start
clawsmith stop

# Status & context
clawsmith status
clawsmith context

# Sessions
clawsmith session
clawsmith session --list
clawsmith session --list --full

# Cost
clawsmith cost
clawsmith cost --day
clawsmith cost --month

# Compact events
clawsmith compacts
clawsmith compacts --last 10

# Memory
clawsmith memory list
clawsmith memory search "postgres"
clawsmith memory add "prefer snake_case"
clawsmith memory save-compact <id>

# Suggestions
clawsmith suggest

# Diagnostics
clawsmith config --diag

# Verification
clawsmith once
clawsmith selftest
```

## How the agent should use this skill

1. Prefer the `clawsmith` CLI over raw script paths.
2. Run `clawsmith status` first when checking health.
3. Run `clawsmith start` if monitoring is not active.
4. Run `clawsmith selftest` after installation or migration.
5. Summarize `clawsmith status`, `clawsmith context`, or `clawsmith config --diag` for the user.

## Boundary

This bundle is **file-observability based**. It does not require runtime hook installation, but any metric not persisted by OpenClaw into local files can only be inferred or omitted.
