#!/usr/bin/env bash
# Unit test for src/scala_links.hpp (ADR 0022): join/invite link build + parse, identity-link validation.
set -euo pipefail
cd "$(dirname "$0")"
NLOHMANN=$(find /nix/store -maxdepth 5 -name json.hpp -path '*nlohmann*' 2>/dev/null | head -1)
NLOHMANN_INC=$(dirname "$(dirname "$NLOHMANN")")
SSL=$(find /nix/store -maxdepth 4 -name libcrypto.so -path '*openssl-3*' 2>/dev/null | head -1 | xargs -r dirname | xargs -r dirname)
g++ -std=c++17 -I../src -I"$NLOHMANN_INC" ${SSL:+-I"$SSL/include" -L"$SSL/lib" -Wl,-rpath,"$SSL/lib"} -Wno-deprecated-declarations \
    links_test.cpp -o /tmp/scala_links_test -lcrypto
/tmp/scala_links_test
