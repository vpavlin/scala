#!/usr/bin/env bash
# ROLES / PERMISSION fold test. A single authorization scenario (roles.src.json) is folded by
# BOTH engines — the C++ desktop core (src/scala_engine.hpp) and the JS mobile engine
# (src/lib/engine.ts) — and checked TWO ways:
#   (a) PARITY  — the two engines produce byte-identical folded state (they must never diverge
#                 on who is allowed to do what, or a phone and a desktop disagree on the calendar);
#   (b) OUTCOME — the folded state matches the EXPECTED authorization result (parity alone only
#                 proves the engines agree, not that the authorization is correct).
# Covers: owner = first cal.meta author; editor-can-grant; non-member self-promotion rejected;
# viewer self-promotion rejected; viewer read-only (can't add); participant-add-when-open;
# edit-your-own; participant-can't-edit-others; editor-can-edit-any; open=false blocks participants
# but not editors; unsigned dropped; tampered dropped; tombstone terminal (no resurrect).
set -euo pipefail
cd "$(dirname "$0")"

NLOHMANN=$(find /nix/store -maxdepth 5 -name json.hpp -path '*nlohmann*' 2>/dev/null | head -1)
NLOHMANN_INC=$(dirname "$(dirname "$NLOHMANN")")
SSL=$(find /nix/store -maxdepth 4 -name libcrypto.so -path '*openssl-3*' 2>/dev/null | head -1 | xargs -r dirname | xargs -r dirname)

echo "== signing role fixtures (fold always requires a signature) =="
# stdout of the signer = the resolved test addresses (A..F); stderr = the human log.
export ROLE_ADDRS=$(node --experimental-strip-types --import ./register.mjs sign_roles.mjs roles.src.json roles.json)

echo "== compiling C++ engine harness =="
g++ -std=c++17 -I"$NLOHMANN_INC" ${SSL:+-I"$SSL/include" -L"$SSL/lib" -Wl,-rpath,"$SSL/lib"} \
  -Wno-deprecated-declarations fold_cpp.cpp -o fold_cpp -lcrypto

echo "== folding role fixtures (both engines) =="
export ROLE_CPP=$(./fold_cpp < roles.json)
export ROLE_JS=$(node --experimental-strip-types --import ./register.mjs fold_ts.mjs roles.json)

python3 - <<'PY'
import json, os, sys

def norm(o):
    if isinstance(o, dict):  return {k: norm(o[k]) for k in sorted(o)}
    if isinstance(o, list):  return [norm(x) for x in o]
    return o

cpp = json.loads(os.environ["ROLE_CPP"])
js  = json.loads(os.environ["ROLE_JS"])
addr = json.loads(os.environ["ROLE_ADDRS"])
ok = True

# (a) cross-platform parity
if norm(cpp) != norm(js):
    print("PARITY MISMATCH — desktop and mobile fold the authorization differently:")
    print("  C++:", json.dumps(norm(cpp)))
    print("  JS :", json.dumps(norm(js)))
    ok = False
else:
    print("engines agree (C++ == JS)")

def check(cond, msg):
    global ok
    print(("  ok  " if cond else "  FAIL") + "  " + msg)
    if not cond: ok = False

# (b) expected authorization outcome — assert on the shared (identical) C++ result.
st = cpp
A, B, C, D, E, F = (addr[k] for k in "ABCDEF")

check(st["owner"] == A, "owner = first cal.meta author (A)")
check(st["rolesConfigured"] is True, "rolesConfigured flips true after a member.set")
check(st["open"] is False, "owner closed the calendar (open=false, LWW)")

roles = st["roles"]
check(roles.get(B) == "editor", "owner granted B editor")
check(roles.get(E) == "viewer", "owner granted E viewer")
check(roles.get(C) == "viewer", "editor B granted C viewer (editor-can-grant)")
check(D not in roles, "non-member D's self-promotion to editor was REJECTED")
check(roles.get(C) != "editor", "viewer C's self-promotion to editor was REJECTED")
check(len(roles) == 3, "exactly {B:editor, E:viewer, C:viewer} — no stray grants")

evs = {e["id"]: e for e in st["events"]}
check(set(evs) == {"evP"}, "only evP survives (evV,evD,evU,evT,evEd all dropped)")
if "evP" in evs:
    check(evs["evP"]["title"] == "Picnic (editor fix)", "editor B's edit of a participant's event won (editor-can-edit-any)")
    check(evs["evP"]["creatorId"] == F, "evP creatorId pinned to ORIGINAL author F, not the last editor")
check("evV" not in evs, "viewer E could NOT add an event (read-only)")
check("evD" not in evs, "participant D blocked once calendar closed (open=false)")
check("evU" not in evs, "unsigned event dropped (signatures always required)")
check("evT" not in evs, "tampered event dropped (signature verify fails)")
check("evEd" not in evs, "tombstone terminal — deleted editor event not resurrected")

print("\nROLES FOLD OK — authorization correct AND identical across desktop/mobile"
      if ok else "\nROLES FOLD TEST FAILED")
sys.exit(0 if ok else 1)
PY

echo "== convergence: authorization is arrival-order-independent (300 shuffled+dup orders) =="
node --experimental-strip-types --import ./register.mjs roles_converge.mjs
