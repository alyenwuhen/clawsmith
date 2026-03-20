#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATE_DIR="${HOME}/.clawsmith"
HEALTH_FILE="${STATE_DIR}/health.json"
TRACE_DIR="${STATE_DIR}/traces"
bash "${SCRIPT_DIR}/once.sh"
if [[ ! -f "${HEALTH_FILE}" ]]; then echo "selftest failed: missing health file ${HEALTH_FILE}" >&2; exit 1; fi
if [[ ! -d "${TRACE_DIR}" ]]; then echo "selftest failed: missing trace dir ${TRACE_DIR}" >&2; exit 1; fi
TRACE_COUNT=$(find "${TRACE_DIR}" -type f -name '*.json' | wc -l | tr -d ' ')
echo "clawsmith selftest: ok"
echo "health file: ${HEALTH_FILE}"
echo "trace count: ${TRACE_COUNT}"
cat "${HEALTH_FILE}"
