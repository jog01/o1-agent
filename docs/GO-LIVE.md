# Going live

Demo mode needs nothing from you. To run the agent with its own wallet:

1. **Fund the demo wallet** `0xd5C2ef73E983c07ae789944AFAdae94fD20F0567` with about $5 of ETH on Base, from a source you're fine having linked on-chain.
2. **Fork mode** (still no spend): set `AGENT_MODE=fork` and `WALLET_PRIVATE_KEY` (held as a secret on the agent's box, never in git). o1 now quotes our own wallet, and the agent signs real raw transactions that land on the fork.
3. **Live mode** (real money, only when you decide): `AGENT_MODE=live` plus `LIVE_TRADING=I_UNDERSTAND_THIS_SPENDS_REAL_MONEY`. Keep the $1 per trade / $5 per day caps and `requireApproval: true`.
4. **o1 API token:** created from a throwaway o1 account (o1 Terminal → API Trading). For a real setup, create one from your own account and swap `O1_API_TOKEN`.
