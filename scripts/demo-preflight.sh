#!/usr/bin/env bash
# demo-preflight.sh — run this the morning of a scala demo. It verifies the whole path guests
# depend on: the always-on hub (delivery + Storage), the public/LAN install repos serving the
# current versions, and the Waku fleet. Exit 0 = green light; non-zero = something to fix.
#
# Env overrides: HUB_SSH (default root@198.19.139.213), HUB_PUBLIC (128.140.55.128),
# LAN_BASECAMP (https://jimmy-crib.office.mesh:8444/basecamp/index.json),
# FDROID_INDEX (http://jimmy-crib.office.mesh:8099/loam-fdroid/repo/index-v1.json).
set -uo pipefail
HUB_SSH="${HUB_SSH:-root@198.19.139.213}"
HUB_PUBLIC="${HUB_PUBLIC:-128.140.55.128}"
HUB_PORT="${HUB_PORT:-8199}"
LAN_BASECAMP="${LAN_BASECAMP:-https://127.0.0.1:8444/basecamp/index.json}"
FDROID_INDEX="${FDROID_INDEX:-http://127.0.0.1:8099/loam-fdroid/repo/index-v1.json}"
LOGOSCORE_REMOTE="${LOGOSCORE_REMOTE:-/root/scala-hub/logoscore/bin/logoscore}"

ok=0; warn=0; fail=0
pass(){ printf '  \033[32m✓\033[0m %s\n' "$1"; ok=$((ok+1)); }
soft(){ printf '  \033[33m!\033[0m %s\n' "$1"; warn=$((warn+1)); }
bad(){  printf '  \033[31m✗\033[0m %s\n' "$1"; fail=$((fail+1)); }
hdr(){ printf '\n\033[1m%s\033[0m\n' "$1"; }

hdr "1. Hub service + Storage node"
if timeout 20 ssh "$HUB_SSH" 'systemctl is-active scala-hub.service' 2>/dev/null | grep -q '^active'; then
  pass "scala-hub.service is active"
else bad "scala-hub.service NOT active — ssh $HUB_SSH 'systemctl restart scala-hub.service'"; fi

DBG=$(timeout 30 ssh "$HUB_SSH" "cd /root/scala-hub; LOGOSCORE=$LOGOSCORE_REMOTE python3 ./logos-hub call scala-vps storage_module debug 2>/dev/null" 2>/dev/null)
HUBID=$(printf '%s' "$DBG" | python3 -c "import json,sys,re;m=re.search(r'\{.*\}',sys.stdin.read(),re.S);print((json.loads(m.group(0)).get('result') or {}).get('value',{}).get('id','') if m else '')" 2>/dev/null)
HUBADDR=$(printf '%s' "$DBG" | python3 -c "import json,sys,re;m=re.search(r'\{.*\}',sys.stdin.read(),re.S);print(((json.loads(m.group(0)).get('result') or {}).get('value',{}).get('addrs') or ['?'])[0] if m else '?')" 2>/dev/null)
[ -n "$HUBID" ] && pass "Storage node up: ${HUBID:0:16}… @ $HUBADDR" || bad "Storage node not responding (debug empty)"

hdr "2. Hub reachable from THIS machine (what guests need)"
if timeout 8 bash -c "(exec 3<>/dev/tcp/$HUB_PUBLIC/$HUB_PORT) 2>/dev/null"; then pass "TCP $HUB_PUBLIC:$HUB_PORT reachable"; else bad "TCP $HUB_PUBLIC:$HUB_PORT NOT reachable — check the VPS firewall / network"; fi

hdr "3. Hub delivery meshed (fleet up)"
NR=$(timeout 30 ssh "$HUB_SSH" "cd /root/scala-hub; LOGOSCORE=$LOGOSCORE_REMOTE python3 ./logos-hub call scala-vps scala diagnostics 2>/dev/null" 2>/dev/null | python3 -c "import json,sys,re;m=re.search(r'\{.*\}',sys.stdin.read(),re.S);d=json.loads(m.group(0)).get('result') if m else None;d=json.loads(d) if isinstance(d,str) else d;print('%s|%s'%(d.get('nodeReady'),d.get('deliveryStatus')) if d else '?')" 2>/dev/null)
case "$NR" in
  True\|Connected) pass "delivery Connected + node ready (fleet reachable)";;
  *) soft "delivery status: $NR — give the hub a minute, or the logos.test fleet may be flaky";;
esac

hdr "4. Install repos serving the current build"
BC=$(timeout 12 curl -sk "$LAN_BASECAMP" 2>/dev/null)
for m in scala scala_ui; do
  V=$(printf '%s' "$BC" | python3 -c "import json,sys;d=json.load(sys.stdin);
items=d.get('packages',[])
print(next((max((x.get('publisherRef') or x.get('version') or '' for x in it.get('versions',[])), default='?') for it in items if it.get('name')=='$m'), 'MISSING'))" 2>/dev/null)
  [ -n "$V" ] && [ "$V" != "MISSING" ] && pass "Basecamp repo serves $m ($V)" || bad "Basecamp repo missing $m"
done
FV=$(timeout 12 curl -s "$FDROID_INDEX" 2>/dev/null | python3 -c "import json,sys;d=json.load(sys.stdin);p=d['packages'].get('xyz.vpavlin.scala',[]);print(max((str(x.get('versionName')) for x in p),default='MISSING'))" 2>/dev/null)
[ -n "$FV" ] && [ "$FV" != "MISSING" ] && pass "F-Droid repo serves scala ($FV)" || bad "F-Droid repo missing scala (is vpavlin-repo.service up?)"

hdr "Summary"
printf '  %d ok · %d warn · %d fail\n' "$ok" "$warn" "$fail"
if [ "$fail" -gt 0 ]; then printf '\033[31mNOT READY — fix the ✗ items above.\033[0m\n'; exit 1
elif [ "$warn" -gt 0 ]; then printf '\033[33mMostly ready — check the ! items.\033[0m\n'; exit 0
else printf '\033[32mGREEN LIGHT — demo away.\033[0m\n'; exit 0; fi
