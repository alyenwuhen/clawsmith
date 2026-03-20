#!/usr/bin/env bash
set -euo pipefail
STATE_DIR="${HOME}/.clawsmith"
PID_FILE="${STATE_DIR}/daemon.pid"
if [[ ! -f "${PID_FILE}" ]]; then echo "clawsmith is not running"; exit 0; fi
PID="$(cat "${PID_FILE}")"
if kill -0 "${PID}" >/dev/null 2>&1; then kill "${PID}" >/dev/null 2>&1 || true; sleep 1; fi
rm -f "${PID_FILE}"
echo "clawsmith stopped"
