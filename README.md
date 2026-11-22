# o1 agent

A guarded trading agent for [o1.exchange](https://o1.exchange) on Base.

It watches the o1 Launchpad on-chain, screens every new token against safety rules, prepares trades through the [o1 Trading API](https://docs.o1.exchange/api/trading), and only signs inside hard limits a human sets. It follows o1's own [safe agent workflow](https://docs.o1.exchange/launchpad/integration/data-ai): read, prepare unsigned, show, then sign.

Status: work in progress.
