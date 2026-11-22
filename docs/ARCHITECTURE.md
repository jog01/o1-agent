# Architecture

```mermaid
flowchart LR
  subgraph Base mainnet
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
  D[dashboard] <-- SSE + REST --> agent
  M[Claude / Cursor<br/>MCP] -- propose only --> agent
```

## Trade lifecycle

```mermaid
sequenceDiagram
  participant U as Human
  participant A as Agent
  participant O as o1 API
  participant F as Base fork
  A->>A: screen token (traders, snipers, creator, age)
  A->>A: checkIntent (caps, chain, slippage, lists, kill switch)
  A->>O: POST /api/v2/order (signer, token, uiAmount)
  O-->>A: unsigned EIP-1559 tx
  A->>A: checkPrepared (chainId, target allowlist, value, nonce)
  A-->>U: awaiting_approval (what will be signed)
  U->>A: approve
  A->>A: re-run both checks
  A->>F: anvil_reset to latest block, then send tx
  F-->>A: receipt + token balance delta
```

## Why these choices

- **Indexer reads the chain directly.** o1's Launchpad emits `Launched` on each factory and `Trade` on each v4 hook. Reading these with no third-party API keeps the data honest and fast: a 7-day backfill over all four Base suites takes about 3 s (100 ms per 10k-block range).
- **Sniper signal from raw trades.** The share of unique traders who bought in the first 60 s is a cheap, robust proxy for bundled or sniped launches.
- **The API routes; the wallet decides.** o1's prepared transaction is decoded and checked before signing. On the first live run the firewall blocked an unfamiliar o1 router until it was explicitly allowlisted, which is the point.
- **The fork is reset to the latest block per trade.** That way the fork state matches what o1 quoted against, so fills are realistic.
- **MCP can propose, not sign.** This matches o1's documented safe agent workflow: read, prepare unsigned, show, then a human signs.

## Not done yet

- Sells: o1 returns Permit2 typed data for sells. The executor refuses Permit2 orders until signing them is added.
- Positions and PnL tracking across fork resets.
- WebSocket head subscription instead of 1.5 s polling.
