#!/bin/sh
# LOCAL STAND ONLY. Forgets the sign-in counters in the stand's Redis, so that one run of auth-flow.mjs does not leave
# the next one locked out: the check signs in and guesses passwords more often than one address is allowed to.
set -eu
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
URL=$(sed -n 's/^REDIS_URL=//p' "$ROOT/secrets/local_stand.env" | tr -d '"')
[ -n "$URL" ] || { echo "No REDIS_URL in secrets/local_stand.env" >&2; exit 1; }
for scope in login-ip login-email register-ip register-email forgot-ip forgot-email verify-email-ip reset-ip; do
  redis-cli -u "$URL" --scan --pattern "an30:rate:$scope:*" | while IFS= read -r key; do redis-cli -u "$URL" del "$key" > /dev/null; done
done
echo "sign-in counters of the local stand cleared"
