#!/usr/bin/env bash
# INVITE TICKETS fold test (ADR 0022). The invite fixture is folded by BOTH engines — C++ desktop
# (src/scala_engine.hpp) and JS mobile (src/lib/engine.ts) — and checked for (a) PARITY and
# (b) the EXPECTED outcome, then (c) convergence under 300 shuffled + duplicated arrival orders.
set -euo pipefail
cd "$(dirname "$0")"
NLOHMANN=$(find /nix/store -maxdepth 5 -name json.hpp -path '*nlohmann*' 2>/dev/null | head -1)
NLOHMANN_INC=$(dirname "$(dirname "$NLOHMANN")")
SSL=$(find /nix/store -maxdepth 4 -name libcrypto.so -path '*openssl-3*' 2>/dev/null | head -1 | xargs -r dirname | xargs -r dirname)
export INV_ADDRS=$(node --experimental-strip-types --import ./register.mjs sign_invites.mjs invites.src.json invites.json 2>/dev/null)
g++ -std=c++17 -I"$NLOHMANN_INC" ${SSL:+-I"$SSL/include" -L"$SSL/lib" -Wl,-rpath,"$SSL/lib"} -Wno-deprecated-declarations fold_cpp.cpp -o fold_cpp -lcrypto
export INV_CPP=$(./fold_cpp < invites.json)
export INV_JS=$(node --experimental-strip-types --import ./register.mjs fold_ts.mjs invites.json 2>/dev/null)
python3 - <<'PY'
import json, os, sys
def norm(o):
    if isinstance(o, dict): return {k: norm(o[k]) for k in sorted(o)}
    if isinstance(o, list): return [norm(x) for x in o]
    return o
cpp, js, a = json.loads(os.environ["INV_CPP"]), json.loads(os.environ["INV_JS"]), json.loads(os.environ["INV_ADDRS"])
ok = True
def check(c, m):
    global ok
    print(("  ok  " if c else "  FAIL") + "  " + m)
    if not c: ok = False
check(norm(cpp) == norm(js), "engines agree (C++ == JS)")
if norm(cpp) != norm(js):
    print("  C++:", json.dumps(norm(cpp))); print("  JS :", json.dumps(norm(js)))
r, inv, evs = cpp["roles"], cpp["invites"], {e["id"]: e for e in cpp["events"]}
check(r.get(a["B"]) == "editor", "owner-granted editor B (member.set unchanged)")
check(r.get(a["F"]) == "editor", "F redeemed T1 → editor")
check(a["G"] not in r, "G's second claim of the redeemed T1 ignored; G's high-S claim of T5 rejected")
check(r.get(a["E"]) == "viewer", "E redeemed T2 → viewer (after a wrong-key attempt was rejected)")
check(a["C"] not in r, "C claiming FOR someone else rejected; C's claim of revoked T4 rejected")
check(a["D"] not in r, "D's claim before the invite existed did not count")
check(a["T3"] not in inv, "outsider D could not offer a ticket (T3)")
check(a["T4"] not in inv, "revoked T4 is gone")
check(inv.get(a["T5"]) == "editor", "T5 still pending (the high-S claim did not redeem it)")
check(inv.get(a["T6"]) == "editor", "T6 pending (claim came before the invite)")
check(inv.get(a["T7"]) == "viewer", "an editor who joined via a ticket (F) can invite (T7)")
check(a["T1"] not in inv and a["T2"] not in inv, "redeemed tickets are no longer pending (T1 revoke had no effect)")
check(set(inv) == {a["T5"], a["T6"], a["T7"]}, "exactly T5, T6, T7 pending")
check(len(r) == 3, "exactly B, F, E hold roles")
check("evF" in evs and "evE" not in evs, "F (editor via ticket) can add; E (viewer via ticket) cannot")
check(cpp["open"] is False and cpp["rolesConfigured"] is True, "calendar closed, roles configured")
print("\nINVITES FOLD OK — correct AND identical across desktop/mobile" if ok else "\nINVITES FOLD TEST FAILED")
sys.exit(0 if ok else 1)
PY
sed -e 's/roles\.json/invites.json/' -e 's/roles convergence:/invites convergence:/' roles_converge.mjs > invites_converge.mjs
node --experimental-strip-types --import ./register.mjs invites_converge.mjs 2>&1 | grep -v "MODULE_TYPELESS\|Reparsing\|To eliminate\|trace-warnings"
