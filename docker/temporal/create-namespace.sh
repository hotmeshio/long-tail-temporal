#!/bin/sh
# Waits for the Temporal server, then creates the namespace when missing.
set -eu
NAMESPACE="${DEFAULT_NAMESPACE:-default}"
ADDRESS="${TEMPORAL_ADDRESS:-temporal:7233}"
ATTEMPTS=60

i=1
until temporal operator cluster health --address "$ADDRESS" >/dev/null 2>&1; do
  [ "$i" -ge "$ATTEMPTS" ] && { echo "Temporal at $ADDRESS is not healthy"; exit 1; }
  i=$((i + 1)); sleep 3
done

if temporal operator namespace describe -n "$NAMESPACE" --address "$ADDRESS" >/dev/null 2>&1; then
  echo "namespace $NAMESPACE exists"
else
  temporal operator namespace create -n "$NAMESPACE" --address "$ADDRESS"
fi
