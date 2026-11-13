#!/bin/sh
# Runs two reviews on the compose stack and resolves each through Long Tail's API:
# one started by a Temporal client, one invoked from Long Tail. Checks both ship.
# Needs the stack running: docker compose up -d --build
set -eu
LT_URL="${LT_URL:-http://localhost:3200}"
ID="smoke-$(date +%s)"
INVOKED="$ID-invoked"
OUT="$(mktemp)"

json() { node -e "let d='';process.stdin.on('data',(c)=>d+=c).on('end',()=>{const j=JSON.parse(d);console.log($1)})"; }

pending_escalation() {
  for i in $(seq 1 60); do
    ESC=$(curl -sf "$LT_URL/api/escalations/by-workflow/$1" -H "authorization: Bearer $TOKEN" \
      | json '(j.escalations.find((e) => e.status === "pending") || {}).id || ""' || true)
    [ -n "$ESC" ] && { echo "$ESC"; return 0; }
    sleep 1
  done
  return 1
}

approve() {
  curl -sf -X POST "$LT_URL/api/escalations/$1/resolve" -H "authorization: Bearer $TOKEN" \
    -H 'content-type: application/json' -d '{"resolverPayload":{"approved":true,"notes":"smoke"}}' >/dev/null
}

docker compose exec -T worker npx tsx examples/review-order/start-workflow.ts "$ID" >"$OUT" 2>&1 &
STARTER=$!

TOKEN=$(curl -sf -X POST "$LT_URL/api/auth/login" -H 'content-type: application/json' \
  -d "{\"username\":\"${LT_ADMIN_USER:-superadmin}\",\"password\":\"${LT_ADMIN_PASSWORD:-l0ngt@1l}\"}" | json 'j.token')

# 1. Started by a Temporal client
ESC=$(pending_escalation "$ID") || { echo "no escalation opened for $ID"; cat "$OUT"; exit 1; }
approve "$ESC"
wait "$STARTER"
cat "$OUT"
grep -q "shipped $ID" "$OUT" || { echo "workflow $ID did not ship"; exit 1; }

# 2. Registered by LT_START_CONFIG and invoked from Long Tail
curl -sf -X POST "$LT_URL/api/workflows/reviewOrderRequest/invoke" -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d "{\"data\":{\"orderId\":\"$INVOKED\"},\"workflowId\":\"$INVOKED\"}" >/dev/null
ESC=$(pending_escalation "$INVOKED") || { echo "no escalation opened for $INVOKED"; exit 1; }
approve "$ESC"
STATUS=""
for i in $(seq 1 30); do
  STATUS=$(curl -sf "$LT_URL/api/workflows/$INVOKED/result" -H "authorization: Bearer $TOKEN" \
    | json '(j.result && j.result.data && j.result.data.status) || ""' || true)
  [ -n "$STATUS" ] && break
  sleep 1
done
[ "$STATUS" = "shipped $INVOKED" ] || { echo "invoked workflow $INVOKED did not ship: '$STATUS'"; exit 1; }

echo "smoke passed: $ID, $INVOKED"
