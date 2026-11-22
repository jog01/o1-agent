export interface Check { id: string; label: string; pass: boolean; value: string; limit: string }
export interface Screen { pass: boolean; checks: Check[] }
export interface Token {
  token: string; symbol: string; name: string; suite: string; launched_ts: number;
  trades: number; unique_traders: number; first_minute_traders: number; screen: Screen;
}
export interface Policy {
  maxPerTradeUsd: number; maxPerDayUsd: number; maxSlippageBps: number;
  allowedChainIds: number[]; allowedTargets: string[]; tokenAllowlist: string[]; tokenDenylist: string[];
  requireApproval: boolean; autoPropose: boolean; killSwitch: boolean;
}
export interface Rules {
  minUniqueTraders: number; minTrades: number; maxSniperShare: number; maxCreatorLaunches: number; maxAgeHours: number;
}
export interface Proposal {
  id: string; createdAt: number; token: string; symbol: string; name: string;
  amountUsd: number; amountEth: number; slippageBps: number; signer: string; source: string;
  status: "preparing" | "awaiting_approval" | "blocked" | "rejected" | "executing" | "filled" | "failed";
  violations: string[]; error?: string;
  prepared?: { to: string; valueWei: string; gas: string; nonce: number; chainId: number; dataBytes: number };
  tokensReceived?: string; gasUsed?: string; forkBlock?: number; txHash?: string;
}
export interface AgentState {
  approverTokenRequired?: boolean;
  mode: "demo" | "fork" | "live"; signer: string; indexerOk: boolean; apiConfigured: boolean;
  spentTodayUsd: number; policy: Policy; rules: Rules; tokens: Token[]; proposals: Proposal[];
  log: { ts: number; level: "info" | "warn" | "action"; msg: string }[];
}
