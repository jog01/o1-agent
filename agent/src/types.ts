import type { Address, Hex } from "viem";

/** Shape served by the Rust indexer at GET /tokens. */
export interface IndexedToken {
  suite: string;
  token: Address;
  pool_id: Hex;
  creator: Address;
  quote_token: Address;
  name: string;
  symbol: string;
  launched_block: number;
  launched_ts: number;
  trades: number;
  unique_traders: number;
  first_minute_traders: number;
  quote_fees: Hex;
  last_trade_ts: number;
}

export interface Check {
  id: string;
  label: string;
  pass: boolean;
  value: string;
  limit: string;
}

export interface Screen {
  pass: boolean;
  checks: Check[];
}

export interface Policy {
  maxPerTradeUsd: number;
  maxPerDayUsd: number;
  maxSlippageBps: number;
  allowedChainIds: number[];
  /** Contracts a prepared transaction may call. Anything else is refused before signing. */
  allowedTargets: Address[];
  /** Empty means "any token that passes screening". */
  tokenAllowlist: Address[];
  tokenDenylist: Address[];
  requireApproval: boolean;
  autoPropose: boolean;
  killSwitch: boolean;
}

export interface Rules {
  minUniqueTraders: number;
  minTrades: number;
  maxSniperShare: number;
  maxCreatorLaunches: number;
  maxAgeHours: number;
}

export type ProposalStatus =
  | "preparing"
  | "awaiting_approval"
  | "blocked"
  | "rejected"
  | "executing"
  | "filled"
  | "failed";

export interface PreparedTx {
  orderId: string;
  txId: string;
  chainId: number;
  to: Address;
  valueWei: string;
  gas: string;
  nonce: number;
  dataBytes: number;
  permit2: boolean;
  exchange?: string;
  pool?: string;
  unsigned: Hex;
}

export interface Proposal {
  id: string;
  createdAt: number;
  token: Address;
  symbol: string;
  name: string;
  amountUsd: number;
  amountEth: number;
  slippageBps: number;
  signer: Address;
  source: "agent" | "user" | "mcp";
  status: ProposalStatus;
  screen?: Screen;
  violations: string[];
  prepared?: PreparedTx;
  txHash?: Hex;
  forkBlock?: number;
  gasUsed?: string;
  tokensReceived?: string;
  error?: string;
}

export interface LogLine {
  ts: number;
  level: "info" | "warn" | "action";
  msg: string;
}
