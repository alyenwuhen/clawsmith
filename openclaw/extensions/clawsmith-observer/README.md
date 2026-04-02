# clawsmith-observer

OpenClaw native plugin for non-CLI users:

- Auto-starts `clawsmith` daemon when OpenClaw gateway starts.
- Appends a compact monitor card to outbound replies in `message_sending` hook.
- Exposes a web dashboard at `/plugins/clawsmith`.
- Professional views:
  - `Trace`: `/plugins/clawsmith/trace`
  - `Metrics`: `/plugins/clawsmith/metrics`

## Install (WSL)

```bash
openclaw plugins install /mnt/d/code/codex_total/clawsmith/openclaw/extensions/clawsmith-observer
openclaw plugins enable clawsmith-observer
```

Restart OpenClaw gateway afterwards.

## Optional config (`~/.openclaw/openclaw.json`)

```json
{
  "plugins": {
    "entries": {
      "clawsmith-observer": {
        "enabled": true,
        "config": {
          "autoStartDaemon": true,
          "autoAppendMonitorCard": true,
          "appendIntervalSec": 20,
          "dashboardEnabled": true,
          "dashboardBasePath": "/plugins/clawsmith",
          "dashboardToken": "",
          "traceMaxEvents": 2400,
          "metricsTurnLimit": 120
        }
      }
    }
  }
}
```

If `dashboardToken` is set, access dashboard with:

`/plugins/clawsmith?token=YOUR_TOKEN`
