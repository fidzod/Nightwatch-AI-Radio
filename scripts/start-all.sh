#!/usr/bin/env bash
# Starts the whole station — Icecast, LiquidSoap, and the engine run in the
# background (each logged to its own file under data/logs/); the web console
# runs in the foreground last, so Ctrl+C there stops everything together.
#
# Run via: nix develop -c scripts/start-all.sh
set -euo pipefail
cd "$(dirname "$0")/.."

for cmd in icecast liquidsoap node pnpm; do
  command -v "$cmd" >/dev/null || {
    echo "$cmd not on PATH — run this inside 'nix develop'." >&2
    exit 1
  }
done

if [ ! -f .env ]; then
  echo "No .env found — cp .env.example .env and fill in your API keys first." >&2
  exit 1
fi

log_dir="data/logs"
mkdir -p "$log_dir"

icecast_port="${ICECAST_PORT:-8000}"

pids=()
cleanup() {
  echo
  echo "Stopping station..."
  for pid in "${pids[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null || true
  echo "Stopped."
}
trap cleanup EXIT

# Bash-builtin TCP check (no curl dependency) — polls until something is
# listening on the given port, or gives up after ~15s.
wait_for_port() {
  local port="$1" tries=30
  while ! (exec 3<>"/dev/tcp/127.0.0.1/${port}") 2>/dev/null; do
    tries=$((tries - 1))
    if [ "$tries" -le 0 ]; then
      echo "  (gave up waiting on port ${port} — continuing anyway, check $log_dir/)" >&2
      return 1
    fi
    sleep 0.5
  done
  exec 3>&- 3<&- 2>/dev/null || true
  return 0
}

echo "-> icecast"
scripts/start-icecast.sh > "$log_dir/icecast.log" 2>&1 &
pids+=("$!")
wait_for_port "$icecast_port"

echo "-> liquidsoap"
liquidsoap liquidsoap/radio.liq > "$log_dir/liquidsoap.log" 2>&1 &
pids+=("$!")

echo "-> engine"
# Direct node invocation (not `pnpm --filter`) so the backgrounded PID is the
# real process, not a wrapper that could survive the cleanup trap's kill.
node --env-file-if-exists=.env apps/engine/src/server.ts > "$log_dir/engine.log" 2>&1 &
pids+=("$!")

echo
echo "Station running. Logs: $log_dir/{icecast,liquidsoap,engine}.log"
echo "Stream:  http://localhost:${icecast_port}/nightwatch.mp3"
echo "Console: starting now — Ctrl+C here stops everything"
echo

pnpm --filter @airadio/web dev
