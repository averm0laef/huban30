#!/bin/sh
# The API of the local stand (port 4000), reachable from a phone and from the 1С computer on the same network.
#
#   corepack pnpm --filter @an30/api build
#   sh scripts/dev/run-api-preview.sh
#
# Settings of the stand (database, Redis, the session and encryption keys) are read from secrets/local_stand.env,
# keys of the parts finder from secrets/parts_finder.env, Rossko keys from secrets/rossko_key1.txt and
# rossko_key2.txt. The folder secrets/ is not in Git: without secrets/local_stand.env see docs/LOCAL_DEVELOPMENT.md.
# Keep that file — the stand's data is encrypted with the key in it.
set -eu
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
STAND="$ROOT/secrets/local_stand.env"
[ -f "$STAND" ] || { echo "No $STAND: see docs/LOCAL_DEVELOPMENT.md" >&2; exit 1; }
set -a
. "$STAND"
set +a
export API_BIND_HOST=0.0.0.0
# Only the names the API reads.
PF="$ROOT/secrets/parts_finder.env"
if [ -f "$PF" ]; then
  for name in FAPI_KEY FAPI_DAILY_CREDIT_LIMIT FAPI_FITMENT_ENABLED API_NINJAS_KEY API_NINJAS_MODE TECDOC_API_KEY TECDOC_MONTHLY_LIMIT TECDOC_PERIOD_START TECDOC_DAILY_LIMIT; do
    value=$(sed -n "s/^${name}=//p" "$PF" | tail -n 1 | tr -d '\r')
    [ -n "$value" ] && export "$name=$value"
  done
fi
if [ -s "$ROOT/secrets/rossko_key1.txt" ] && [ -s "$ROOT/secrets/rossko_key2.txt" ]; then
  export ROSSKO_ENABLED=true ROSSKO_KEY1_FILE="$ROOT/secrets/rossko_key1.txt" ROSSKO_KEY2_FILE="$ROOT/secrets/rossko_key2.txt"
fi
cd "$ROOT" && exec node apps/api/dist/main.js
