import type { Address, Hex } from "viem";

export type Mode = "demo" | "fork" | "live";

const env = process.env;

export const config = {
  mode: (env.AGENT_MODE ?? "demo") as Mode,
  port: Number(env.PORT ?? 8787),
  o1ApiUrl: env.O1_API_URL ?? "https://api.o1.exchange",
  o1ApiToken: env.O1_API_TOKEN ?? "",
  indexerUrl: env.INDEXER_URL ?? "http://127.0.0.1:7070",
  baseRpcUrl: env.BASE_RPC_URL ?? "https://mainnet.base.org",
  forkRpcUrl: env.FORK_RPC_URL ?? "http://127.0.0.1:8545",
  /** demo: a mainnet-funded address the fork impersonates, so no key is needed. */
  demoSigner: (env.DEMO_SIGNER ?? "") as Address,
  /** fork/live: the agent's own wallet key. Never logged, never sent anywhere. */
  walletKey: (env.WALLET_PRIVATE_KEY ?? "") as Hex,
  /** live mode also requires this explicit second switch. */
  liveTradingEnabled: env.LIVE_TRADING === "I_UNDERSTAND_THIS_SPENDS_REAL_MONEY",
  webDist: env.WEB_DIST ?? new URL("../../web/dist", import.meta.url).pathname,
  statePath: env.STATE_PATH ?? new URL("../../data/agent-state.json", import.meta.url).pathname,
};
