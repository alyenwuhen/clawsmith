#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
node "${SCRIPT_DIR}/clawsmith-daemon.mjs" &
PID=$!
sleep 2
kill "${PID}" >/dev/null 2>&1 || true
wait "${PID}" 2>/dev/null || true
echo "clawsmith one-shot scan completed"
