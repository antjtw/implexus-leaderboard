#!/usr/bin/env bash
# Pings Supabase projects so free ones aren't paused for inactivity.
# Usage: supabase-keepalive.sh [NAME ...]
#   Always pings the leaderboard project (URL + key from config.js).
#   For each NAME, pings the project in $NAME_SUPABASE_URL / $NAME_SUPABASE_KEY
#   via the keep_alive() function from supabase/keep-alive.sql.
set -uo pipefail
cd "$(dirname "$0")/.."
failed=0

# ping LABEL URL KEY METHOD PATH
ping() {
  local label=$1 url=${2%/} key=$3 method=$4 path=$5 code
  code=$(curl -sS -o /tmp/keepalive.out -w '%{http_code}' --max-time 30 \
    -X "$method" -H "apikey: $key" -H "Content-Type: application/json" \
    $([ "$method" = POST ] && printf '%s' "--data {}") \
    "$url/rest/v1/$path") || code=000
  if [ "$code" -ge 200 ] && [ "$code" -lt 300 ]; then
    echo "✓ $label is awake ($code)"
  else
    echo "::error::$label ping failed (HTTP $code): $(head -c 300 /tmp/keepalive.out 2>/dev/null)"
    failed=1
  fi
}

# The leaderboard: read a single row of the roster
lb_url=$(node -e 'const f=require("fs").readFileSync("config.js","utf8");console.log(new Function(f+";return SUPABASE_CONFIG")().url||"")')
lb_key=$(node -e 'const f=require("fs").readFileSync("config.js","utf8");console.log(new Function(f+";return SUPABASE_CONFIG")().key||"")')
if [ -n "$lb_url" ] && [ -n "$lb_key" ]; then
  ping "Leaderboard" "$lb_url" "$lb_key" GET "lifters?select=id&limit=1"
else
  echo "Leaderboard: Supabase not configured in config.js, skipping"
fi

# Other projects, by name
for name in "$@"; do
  url_var="${name}_SUPABASE_URL"; key_var="${name}_SUPABASE_KEY"
  url=${!url_var:-}; key=${!key_var:-}
  if [ -z "$url" ] || [ -z "$key" ]; then
    echo "::warning::$name: secrets ${url_var} / ${key_var} not set, skipping"
    continue
  fi
  ping "$name" "$url" "$key" POST "rpc/keep_alive"
done

exit $failed
