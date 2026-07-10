#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

PORT=7373
INTERVAL_SECONDS=30
LOG_FILE="scripts/dev-forever.log"
DEV_PID=""

timestamp() {
  date "+%Y-%m-%d %H:%M:%S"
}

port_is_listening() {
  lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1
}

start_dev_server() {
  echo "[$(timestamp)] nothing listening on $PORT; starting bun run dev" | tee -a "$LOG_FILE"
  bun run dev >>"$LOG_FILE" 2>&1 &
  DEV_PID="$!"
  echo "[$(timestamp)] bun run dev started as pid $DEV_PID" | tee -a "$LOG_FILE"
}

stop_child() {
  if [[ -n "$DEV_PID" ]] && kill -0 "$DEV_PID" >/dev/null 2>&1; then
    echo "[$(timestamp)] stopping child pid $DEV_PID" | tee -a "$LOG_FILE"
    kill "$DEV_PID" >/dev/null 2>&1 || true
  fi
}

trap stop_child EXIT INT TERM

echo "[$(timestamp)] watching port $PORT every ${INTERVAL_SECONDS}s" | tee -a "$LOG_FILE"

while true; do
  if ! port_is_listening; then
    start_dev_server
  fi

  sleep "$INTERVAL_SECONDS"
done
