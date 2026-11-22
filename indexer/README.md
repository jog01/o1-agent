# indexer

Rust service that reads the o1 Launchpad on Base straight from the chain and streams it.

- Watches every current o1 Launchpad suite on Base (standard, tax, wstO burn, pads): `Launched` from each factory and `Trade` from each Uniswap v4 hook. Addresses come from o1's published `launch-contract-suites.json`.
- Backfills the last N blocks in chunks, then polls the head every 1.5 s.
- Keeps per-token stats: trades, unique traders, traders in the first 60 s (a sniper signal), quote fees.
- Serves `GET /health`, `GET /tokens` and a WebSocket at `/stream` with every decoded event.

```bash
cargo run --release -- --backfill 43200                       # live, last ~1 day
cargo run --release -- --replay fixtures/base-launchpad-7d.jsonl --speed 600   # demo mode, no RPC
cargo run --release -- --record data/events.jsonl            # live and record a new fixture
```

`BASE_RPC_URL` defaults to `https://base-rpc.publicnode.com` (the official `mainnet.base.org` rate-limits `eth_getLogs`).

`fixtures/base-launchpad-7d.jsonl` is a real 7-day recording of o1 Launchpad activity on Base, used by demo mode.
