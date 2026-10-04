#!/usr/bin/env bash
# Drives the view's app-to-app intent handlers (docs/adr/0022-app-intents.md) through the mock
# bridge, the way Basecamp delivers them, and checks every answer. Exit status 0 = all as expected.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
LOG="$(mktemp)"
SCALA_HARNESS_INTENTS=1 "$HERE/render.sh" >"$LOG" 2>&1
status=$?
grep -E "INTENT-FAIL|want|got|intents\]|RESPOND|js-err|load-err|qml:[123]" "$LOG"
rm -f "$LOG"
exit $status
