---
name: clawsmith-skill-first-guide
version: 0.2.0
description: "Skill-first operating guide for clawsmith scripts and daemon."
tags: [openclaw, observability, skill, daemon, scripts]
metadata: {"openclaw":{"emoji":"🧭"}}
---

# clawsmith skill-first guide

Use this guide when clawsmith is installed in the OpenClaw `skills` path and operated through shell scripts.

## Default execution order

1. `bash scripts/status.sh`
2. `bash scripts/start.sh` if daemon is not running
3. `bash scripts/once.sh` for immediate refresh
4. `bash scripts/selftest.sh` for validation
5. summarize `~/.clawsmith/health.json`

## Script meanings

- `start.sh` — start the background daemon
- `stop.sh` — stop the daemon
- `status.sh` — inspect runtime health
- `once.sh` — perform a single scan
- `selftest.sh` — validate clawsmith output chain

## What the daemon scans

- `~/.openclaw/agents/**/sessions.json`
- `~/.openclaw/agents/**/*.jsonl`

## What the daemon writes

- `~/.clawsmith/health.json`
- `~/.clawsmith/events.jsonl`
- `~/.clawsmith/traces/*.json`

## Important note

This mode does not require OpenClaw runtime hook installation. It is therefore simpler to deploy, but any metric not persisted by OpenClaw into local files can only be inferred or omitted.
