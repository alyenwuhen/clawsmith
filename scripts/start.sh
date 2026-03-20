#!/usr/bin/env bash
set -euo pipefail
STATE_DIR="${HOME}/.clawsmith"
PID_FILE="${STATE_DIR}/daemon.pid"
LOG_FILE="${STATE_DIR}/daemon.log"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DAEMON="${SCRIPT_DIR}/clawsmith-daemon.mjs"
mkdir -p "${STATE_DIR}"
if [[ -f "${PID_FILE}" ]]; then
  PID="$(cat "${PID_FILE}")"
  if kill -0 "${PID}" >/dev/null 2>&1; then echo "clawsmith already running (pid=${PID})"; exit 0; fi
fi
nohup node "${DAEMON}" >>"${LOG_FILE}" 2>&1 &
echo $! > "${PID_FILE}"
echo "clawsmith started (pid=$(cat "${PID_FILE}"))"
