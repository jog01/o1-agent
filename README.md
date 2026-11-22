# o1 agent

A guarded trading agent for [o1.exchange](https://o1.exchange) on Base.

It watches the o1 Launchpad on-chain, screens every new token against safety rules, prepares trades through the [o1 Trading API](https://docs.o1.exchange/api/trading), and only signs inside hard limits a human sets. It follows o1's own [safe agent workflow](https://docs.o1.exchange/launchpad/integration/data-ai): read, prepare unsigned, show, then sign.

## What's here

| | |
|---|---|
| [`indexer/`](indexer) | Rust. Reads every o1 Launchpad suite on Base from the chain, keeps per-token stats, streams events. |
| [`agent/`](agent) | TypeScript. Safety screen, policy, o1 Trading API, transaction firewall, approval queue, fork/live executor, MCP server. |
| `web/` | Dashboard (React + Vite + Tailwind + shadcn). |
| [`docs/`](docs) | [Architecture](docs/ARCHITECTURE.md) · [Going live](docs/GO-LIVE.md) |

## Run the whole thing

Needs Rust, Node 22 and [Foundry](https://getfoundry.sh) (`anvil`).

```bash
(cd indexer && cargo build --release)
(cd agent && npm ci)
(cd web && npm ci && npm run build)
O1_API_TOKEN=... DEMO_SIGNER=0x... ./scripts/start.sh   # http://localhost:8787
```

Demo mode (default) trades on a local Base fork: real o1 data, real o1 routes, no money.
