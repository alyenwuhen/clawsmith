# clawsmith

**Know exactly what your OpenClaw agent is doing.**

Token usage. API cost. Context health. Smart alerts. All in one place — without touching a single line of OpenClaw's internals.

This project is **adapted from [seekcontext/ClawProbe](https://github.com/seekcontext/ClawProbe)** under the MIT License.

[Why clawsmith](#why-clawsmith) •
[Quick Start](#quick-start) •
[Commands](#commands) •
[Agent Integration](#agent-integration) •
[Configuration](#configuration) •
[How It Works](#how-it-works)

---

## Why clawsmith

Your OpenClaw agent lives inside a context window — burning tokens, compacting silently, spending your API budget. But you can't see any of it while it's happening.

clawsmith watches OpenClaw's files in the background and gives you a real-time window into what your agent is actually doing.

**No configuration required. Zero side effects. 100% local.**

---

## Quick Start

```bash
npm install -g git+https://github.com/alyenwuhen/clawsmith.git

clawsmith start
clawsmith status
```

clawsmith auto-detects your OpenClaw installation. No API keys, no accounts, no telemetry.

---

## Commands

```bash
# Daemon
clawsmith start               # Start background daemon
clawsmith stop                # Stop daemon

# Status & context
clawsmith status              # Current session (tokens, model, compactions)
clawsmith top                 # Live dashboard
clawsmith context             # Context window breakdown

# Sessions
clawsmith session             # Active session details + turn timeline
clawsmith session --list      # All sessions
clawsmith session --list --full  # Full session keys (not truncated)

# Cost
clawsmith cost                # This week
clawsmith cost --day          # Today
clawsmith cost --month        # This month
clawsmith cost --all          # All time

# Compact events
clawsmith compacts            # Last 5 compact events
clawsmith compacts --last 10  # Last 10

# Memory
clawsmith compacts --save <id>      # Save compacted content to MEMORY.md

# Suggestions
clawsmith suggest             # Show optimization suggestions
clawsmith suggest --dismiss <rule-id>
clawsmith suggest --reset-dismissed

# Diagnostics
clawsmith config --diag       # Full diagnostic dump
clawsmith reset-db            # Rebuild local probe.db
clawsmith schema status       # JSON output schema
```

---

## Agent Integration

Every command supports `--json` for structured output.

```bash
clawsmith status --json
clawsmith context --json
clawsmith suggest --json
clawsmith compacts --json
clawsmith cost --week --json
```

---

## Configuration

Optional config at `~/.clawsmith/config.json`.

Defaults:
- OpenClaw dir: `~/.openclaw`
- Clawsmith dir: `~/.clawsmith`

---

## How It Works

clawsmith reads OpenClaw's existing files in the background — no code changes, no plugins, no hooks required.

- Zero configuration
- Zero side effects
- Background daemon
- SQLite-backed local observability DB
- JSON transcript parsing
- Compaction tracking
- Cost estimation
- Rule-based suggestions

---

## Privacy

- 100% local
- No telemetry
- No accounts, no API keys

---

## License

MIT. Derived from ClawProbe, with original MIT attribution preserved.
