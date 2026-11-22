#!/usr/bin/env bash
# Starts the full stack: Base fork (anvil), indexer, agent (serves the dashboard).
# Env: see agent/README.md. INDEXER_REPLAY=1 replays the 7-day fixture instead of reading the chain.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PORT:-8787}"
INDEXER_PORT="${INDEXER_PORT:-7070}"
FORK_PORT="${FORK_PORT:-8545}"
mkdir -p "$ROOT/data"

if ! curl -sf -X POST "http://127.0.0.1:$FORK_PORT" -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' >/dev/null; then
  anvil --fork-url "${BASE_RPC_URL:-https://mainnet.base.org}" --chain-id 8453 --port "$FORK_PORT" --silent &
fi

if ! curl -sf "http://127.0.0.1:$INDEXER_PORT/health" >/dev/null; then
  if [[ "${INDEXER_REPLAY:-0}" == 1 ]]; then
    "$ROOT/indexer/target/release/indexer" --listen "127.0.0.1:$INDEXER_PORT" \
      --replay "$ROOT/indexer/fixtures/base-launchpad-7d.jsonl" --speed "${REPLAY_SPEED:-600}" >"$ROOT/data/indexer.log" 2>&1 &
  else
    "$ROOT/indexer/target/release/indexer" --listen "127.0.0.1:$INDEXER_PORT" --backfill "${BACKFILL_BLOCKS:-302400}" >"$ROOT/data/indexer.log" 2>&1 &
  fi
fi

cd "$ROOT/agent"
export INDEXER_URL="http://127.0.0.1:$INDEXER_PORT" FORK_RPC_URL="http://127.0.0.1:$FORK_PORT" PORT
exec npx tsx src/server.ts
