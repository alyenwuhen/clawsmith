# clawsmith (skill-first)

This document supersedes the plugin-first README when you deploy `clawsmith` through the OpenClaw `skills` path.

## Deployment model

`clawsmith` is designed to work as:

- a skill under the OpenClaw `skills` directory
- a set of helper scripts under `scripts/`
- a local daemon that scans OpenClaw data under `~/.openclaw`

This avoids requiring runtime hook installation just to get basic observability.

## Primary scripts

```bash
bash scripts/start.sh
bash scripts/status.sh
bash scripts/once.sh
bash scripts/selftest.sh
bash scripts/stop.sh
```

## Output directory

```text
~/.clawsmith/
├── daemon.pid
├── daemon.log
├── daemon.state.json
├── health.json
├── events.jsonl
└── traces/
```

## What is collected

- OpenClaw session index summaries
- transcript-file scan snapshots
- compaction-like event counts inferred from transcripts
- token totals when they are present in local session metadata
- daemon-generated trace snapshots

## Boundary

This skill-first deployment is file-observability based.

It is easier to deploy than a runtime plugin, but it is also less exact than true in-process tracing. Exact per-tool spans and exact prompt capture require runtime hook instrumentation.
