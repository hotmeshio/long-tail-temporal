#!/bin/sh
# Starts one review on the compose stack, resolves it through Long Tail's API and checks the result.
# Needs the stack running: docker compose up -d --build
set -eu
LT_URL="${LT_URL:-http://localhost:3200}"
ID="smoke-$(date +%s)"
OUT="$(mktemp)"

docker compose exec -T worker npx tsx examples/review-order/start-workflow.ts "$ID" >"$OUT" 2>&1 &
STARTER=$!

TOKEN=$(curl -sf -X POST "$LT_URL/api/auth/login" -H 'content-type: application/json' \
  -d "{\"username\":\"${LT_ADMIN_USER:-superadmin}\",\"password\":\"${LT_ADMIN_PASSWORD:-l0ngt@1l}\"}" \
  | node -e 'process.stdin.on("data", (d) => console.log(JSON.parse(d).token))')

ESC=""
for i in $(seq 1 60); do
  ESC=$(curl -sf "$LT_URL/api/escalations/by-workflow/$ID" -H "authorization: Bearer $TOKEN" \
    | node -e 'process.stdin.on("data", (d) => { const r = JSON.parse(d).escalations.find((e) => e.status === "pending"); console.log(r ? r.id : ""); })' || true)
  [ -n "$ESC" ] && break
  sleep 1
done
[ -n "$ESC" ] || { echo "no escalation opened for $ID"; cat "$OUT"; exit 1; }

curl -sf -X POST "$LT_URL/api/escalations/$ESC/resolve" -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"resolverPayload":{"approved":true,"notes":"smoke"}}' >/dev/null

wait "$STARTER"
cat "$OUT"
grep -q "shipped $ID" "$OUT" || { echo "workflow $ID did not ship"; exit 1; }
echo "smoke passed: $ID"
