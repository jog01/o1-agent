# Architecture

Sequa is three services in one repo: a Rust indexer, a TypeScript agent and a React dashboard, with a local Base fork for demo trades.

| Doc | Covers |
|---|---|
| [Indexer](INDEXER.md) | How Launchpad events are read, decoded and aggregated |
| [Agent](AGENT.md) | Screen, policy, firewall, proposal states, executor modes, API, MCP |
| [Dashboard](WEB.md) | Tabs, live updates, screenshots |
| [Timeline](TIMELINE.md) | Startup order and one trade from launch to fill, file by file |
| [Going live](GO-LIVE.md) | Wallet, fork mode and live mode |

## System

```mermaid
flowchart LR
  subgraph base [Base mainnet]
    F[o1 Launchpad factories<br/>Launched]
    H[Uniswap v4 hooks<br/>Trade]
  end
  subgraph indexer [indexer · Rust]
    I[backfill + head poll<br/>alloy] --> S[(token stats)]
  end
  subgraph agent [agent · TypeScript]
    R[safety screen] --> P[policy check]
    P --> O[o1 Trading API<br/>prepare, unsigned]
    O --> W[tx firewall]
    W --> Q[approval queue]
    Q --> X[executor<br/>demo · fork · live]
  end
  F & H --> I
  S -- /tokens --> R
  X -- impersonate / raw tx --> K[(anvil Base fork)]
  X -. live only .-> C[o1 /order/complete]
  D[dashboard · React] <-- SSE + REST --> agent
  M[Claude / Cursor<br/>MCP] -- propose only --> agent
```

## Ports

| Service | Port | Talks to |
|---|---|---|
| Anvil fork | 8545 | Base RPC |
| Indexer | 7070 | Base RPC |
| Agent + dashboard | 8787 | indexer, fork, o1 API, Coinbase price |

## Why these choices

- **Indexer reads the chain directly.** o1's Launchpad emits `Launched` on each factory and `Trade` on each v4 hook. Reading these with no third-party API keeps the data honest and fast: a 7-day backfill over all four Base suites takes about 3 s.
- **Rust for the hot path, TypeScript for the rest.** The indexer decodes every log on Base's Launchpad; the agent is I/O-bound glue around o1's API, viem and the UI.
- **Sniper signal from raw trades.** The share of unique traders who bought in the first 60 s is a cheap, robust proxy for bundled or sniped launches.
- **The API routes; the wallet decides.** o1's prepared transaction is decoded and checked before signing. On the first live run the firewall blocked an unfamiliar o1 router until it was explicitly allowlisted, which is the point.
- **The fork is reset to the latest block per trade.** That way the fork state matches what o1 quoted against, so fills are realistic.
- **MCP can propose, not sign.** This matches o1's documented safe agent workflow: read, prepare unsigned, show, then a human signs.

## Not done yet

- Sells: o1 returns Permit2 typed data for sells. The executor refuses Permit2 orders until signing them is added.
- Positions and PnL tracking across fork resets.
- WebSocket head subscription instead of 1.5 s polling.
