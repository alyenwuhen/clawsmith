#!/usr/bin/env bash
set -euo pipefail
STATE_DIR="${HOME}/.clawsmith"
PID_FILE="${STATE_DIR}/daemon.pid"
HEALTH_FILE="${STATE_DIR}/health.json"
if [[ -f "${PID_FILE}" ]]; then PID="$(cat "${PID_FILE}")"; if kill -0 "${PID}" >/dev/null 2>&1; then echo "clawsmith daemon: running (pid=${PID})"; else echo "clawsmith daemon: stale pid file"; fi; else echo "clawsmith daemon: stopped"; fi
if [[ -f "${HEALTH_FILE}" ]]; then echo "health file: ${HEALTH_FILE}"; cat "${HEALTH_FILE}"; else echo "health file: missing"; fi
