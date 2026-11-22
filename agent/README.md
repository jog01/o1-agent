# agent

TypeScript service that turns o1 Launchpad data into guarded trades.

```
indexer /tokens ──▶ safety screen ──▶ policy check ──▶ o1 Trading API (prepare, unsigned)
                                                     │
                     transaction firewall ◀──────────┘   (chain, target contract, value, nonce)
                              │
                     human approval (dashboard)          (or auto inside limits)
                              │
                     execute: demo | fork | live
```

## Modes

| `AGENT_MODE` | Signer | Where the trade runs | Money |
|---|---|---|---|
| `demo` (default) | `DEMO_SIGNER`, a mainnet-funded address the fork impersonates | local Base fork (anvil) | none |
| `fork` | the agent's own wallet (`WALLET_PRIVATE_KEY`) | local Base fork, raw signed tx | none (the wallet needs a little real ETH so o1 will quote it) |
| `live` | the agent's own wallet | Base mainnet via o1 `/api/v2/order/complete` | real; also needs `LIVE_TRADING=I_UNDERSTAND_THIS_SPENDS_REAL_MONEY` |

Before each fork execution the fork is reset to the latest Base block, so it matches the state o1 quoted against.

## Safety

- **Safety screen** (`src/rules.ts`): unique traders, trade count, share of traders in the first 60 s (snipers), creator's launch count, age.
- **Policy** (`src/policy.ts`): $1 per trade, $5 per day, 500 bps max slippage, Base only, token allow/deny lists, kill switch.
- **Transaction firewall**: the unsigned tx o1 returns is decoded and checked again before signing: chain id, the contract it calls (allowlist), value not above what was approved, nonce. The API routes; it doesn't decide what the wallet signs.
- **No approve tool in MCP**: an AI client can propose, never sign. That follows o1's [safe agent workflow](https://docs.o1.exchange/launchpad/integration/data-ai).

## Run

```bash
npm ci
O1_API_TOKEN=... DEMO_SIGNER=0x... npm start   # http://localhost:8787
npm test
```

| Env | Default |
|---|---|
| `O1_API_TOKEN` | — (o1 Terminal → API Trading) |
| `INDEXER_URL` | `http://127.0.0.1:7070` |
| `FORK_RPC_URL` | `http://127.0.0.1:8545` (`anvil --fork-url https://mainnet.base.org --chain-id 8453`) |
| `BASE_RPC_URL` | `https://mainnet.base.org` |

## HTTP API

| | |
|---|---|
| `GET /api/state` | everything the dashboard shows (see [`docs/sample-state.json`](../docs/sample-state.json)) |
| `GET /api/events` | SSE, `state` event with the same payload on every change |
| `POST /api/scan` | screen all tokens, propose the strongest that passes |
| `POST /api/proposals` `{token, amountUsd}` | prepare a buy |
| `POST /api/proposals/:id/approve` · `/reject` | |
| `POST /api/kill` `{on}` | kill switch |
| `PATCH /api/policy` · `PATCH /api/rules` | edit limits and screen thresholds |

## MCP

```json
{ "mcpServers": { "o1-agent": { "command": "npx", "args": ["tsx", "agent/src/mcp.ts"], "env": { "AGENT_URL": "http://localhost:8787" } } } }
```

Tools: `list_launches`, `get_policy`, `propose_buy`, `list_proposals`, `kill_switch`.
