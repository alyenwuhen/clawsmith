---
name: clawsmith
version: 0.1.0
description: "Trace and monitor OpenClaw runs, sessions, tools, and token usage."
tags: [openclaw, observability, tracing, monitoring, tokens, sessions, tools]
metadata: {"openclaw":{"emoji":"🧭"}}
---

# clawsmith

Use this skill when the user wants to inspect OpenClaw runtime behavior.

## What clawsmith provides

- per-run trace ids
- prompt snapshots
- usage snapshots: input, output, cacheRead, cacheWrite, total
- tool span timing
- session/channel aggregation
- subagent and compaction event tracking
- lightweight HTTP browsing endpoints

## Typical commands

- `probe status`
- `probe latest`
- `probe trace <traceId>`
- `probe session <sessionId>`

## Notes

This package is a **plugin + skill** bundle. The skill explains and helps operate the trace store. The plugin does the actual data capture through OpenClaw runtime hooks.
