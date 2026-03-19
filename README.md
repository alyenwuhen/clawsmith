# clawsmith

`clawsmith` is an OpenClaw observability plugin plus skill bundle.

It captures:
- full agent runs
- session and channel activity
- prompt and message snapshots
- token usage
- context ratio estimates
- tool spans
- compaction events
- subagent events

It intentionally focuses on **monitoring and tracing**, not evaluation.

## Structure

- `src/index.js` — OpenClaw plugin
- `skills/clawsmith/SKILL.md` — companion skill
- `dashboard/viewer.html` — lightweight local trace browser
- `test/selftest.mjs` — local self-test

## HTTP routes

- `/plugins/clawsmith/health`
- `/plugins/clawsmith/traces?limit=100`
- `/plugins/clawsmith/trace/<traceId>`
- `/plugins/clawsmith/session/<sessionId>`
- `/plugins/clawsmith/viewer`

## Local storage

By default traces are written under:

```text
<workspace>/.clawsmith/
```

## Self-test

```bash
npm run selftest
```
