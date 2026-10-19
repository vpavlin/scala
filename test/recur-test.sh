#!/usr/bin/env bash
# Unit test for src/scala_recur.hpp (dueOccurrences, shrooms ADR-064): windows, rules, time zones, DST.
set -euo pipefail
cd "$(dirname "$0")"
NLOHMANN=$(find /nix/store -maxdepth 5 -name json.hpp -path '*nlohmann*' 2>/dev/null | head -1)
NLOHMANN_INC=$(dirname "$(dirname "$NLOHMANN")")
g++ -std=c++17 -Wall -I../src -I"$NLOHMANN_INC" recur_test.cpp -o /tmp/scala_recur_test
TZ=UTC /tmp/scala_recur_test
