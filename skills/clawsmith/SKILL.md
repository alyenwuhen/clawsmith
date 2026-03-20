---
name: clawsmith
version: 0.3.0
description: "The observability CLI for OpenClaw, packaged as a skill bundle and npm command."
tags: [openclaw, observability, tracing, monitoring, cli, daemon, npm]
metadata: {"openclaw":{"emoji":"🧭"}}
---

# clawsmith

`clawsmith` is an OpenClaw observability skill bundle with a built-in npm-style CLI.

The intended user experience is:

```bash
npm install -g clawsmith
clawsmith status
```

## Install behavior

On npm global install:
- npm exposes the `clawsmith` executable through the package `bin` field
- npm runs install lifecycle scripts for global installs too
- `clawsmith` uses `postinstall` to auto-start the monitoring daemon immediately after installation. citeturn120983search2turn132199search4

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

## Agent behavior

When helping the user inspect OpenClaw:
1. prefer `clawsmith status`
2. then `clawsmith context` or `clawsmith session --list`
3. use `clawsmith config --diag` for deep environment checks
4. use `clawsmith selftest` after installation problems or upgrades

## Boundary

This distribution is file-observability based. It is designed to begin monitoring immediately after installation, but exact prompt-level and per-tool runtime tracing still depends on in-process instrumentation.
