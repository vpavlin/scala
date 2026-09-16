#!/usr/bin/env bash
# CATCH-UP parity + convergence test: the desktop RBSR (src/logos_sync/catchup.hpp) and the mobile
# RBSR (src/lib/catchup.ts) must (a) emit a BYTE-IDENTICAL initial fingerprint frame — the
# cross-platform wire invariant a phone and a desktop reconcile over — and (b) both converge two
# divergent id-sets to their union. This is the sync path SDS can't heal (cold-start backfill), and
# the exact area of past cross-platform bugs, so it's worth a golden test.
set -euo pipefail
cd "$(dirname "$0")"

NLOHMANN=$(find /nix/store -maxdepth 5 -name json.hpp -path '*nlohmann*' 2>/dev/null | head -1)
NLOHMANN_INC=$(dirname "$(dirname "$NLOHMANN")")
SSL=$(find /nix/store -maxdepth 4 -name libcrypto.so -path '*openssl-3*' 2>/dev/null | head -1 | xargs -r dirname | xargs -r dirname)

echo "== compiling C++ catch-up harness =="
g++ -std=c++17 -I"$NLOHMANN_INC" ${SSL:+-I"$SSL/include" -L"$SSL/lib" -Wl,-rpath,"$SSL/lib"} \
  -Wno-deprecated-declarations catchup_cpp.cpp -o catchup_cpp -lcrypto

# Two overlapping sets, each >8 ids so buildInitial buckets (8) and the recursive fp-split path runs.
export CU_INPUT=$(python3 -c "import json;a=['id-%03d'%i for i in range(0,15)];b=['id-%03d'%i for i in range(10,25)];print(json.dumps({'a':a,'b':b}))")
export CU_UNION=$(python3 -c "print(','.join('id-%03d'%i for i in range(0,25)))")

echo "== running both engines =="
export CU_CPP=$(printf '%s' "$CU_INPUT" | ./catchup_cpp)
export CU_JS=$(printf '%s' "$CU_INPUT" | node --experimental-strip-types --import ./register.mjs catchup_ts.mjs)
echo "C++: $CU_CPP"
echo "JS : $CU_JS"

python3 - <<'PY'
import json, os, sys
c = json.loads(os.environ["CU_CPP"]); j = json.loads(os.environ["CU_JS"]); union = os.environ["CU_UNION"]
ok = True
if c["fp"] != j["fp"]:
    print(f"FP PARITY MISMATCH\n  C++ {c['fp']}\n  JS  {j['fp']}"); ok = False
for tag, o in (("C++", c), ("JS", j)):
    if o["a"] != union or o["b"] != union:
        print(f"{tag} did NOT converge (a={len(o['a'].split(','))}, b={len(o['b'].split(','))}, want {len(union.split(','))})"); ok = False
print("\nCATCHUP PARITY OK — identical fingerprint + both engines converge to the union"
      if ok else "\nCATCHUP TEST FAILED")
sys.exit(0 if ok else 1)
PY
