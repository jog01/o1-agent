import type { Address } from "viem";
import type { Policy, PreparedTx } from "./types.js";

export const BASE_CHAIN_ID = 8453;

export const defaultPolicy: Policy = {
  maxPerTradeUsd: 1,
  maxPerDayUsd: 5,
  maxSlippageBps: 500,
  allowedChainIds: [BASE_CHAIN_ID],
  allowedTargets: [
    // Contracts the o1 Trading API routes Base swaps through (observed in prepared orders).
    "0x7293d41c28e5fc2292e62d26fec60e22a145d1a5",
    "0x0000000000001ff3684f28c67538d4d072c22734",
  ],
  tokenAllowlist: [],
  tokenDenylist: [],
  requireApproval: true,
  autoPropose: true,
  killSwitch: false,
};

const eq = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export interface Intent {
  chainId: number;
  token: Address;
  amountUsd: number;
  slippageBps: number;
  screenPassed: boolean;
}

/** Checks a trade intent before anything is prepared. */
export function checkIntent(p: Policy, i: Intent, spentTodayUsd: number): string[] {
  const v: string[] = [];
  if (p.killSwitch) v.push("Kill switch is on");
  if (!p.allowedChainIds.includes(i.chainId)) v.push(`Chain ${i.chainId} is not allowed`);
  if (i.amountUsd > p.maxPerTradeUsd) v.push(`$${i.amountUsd} is over the $${p.maxPerTradeUsd} per-trade cap`);
  if (spentTodayUsd + i.amountUsd > p.maxPerDayUsd) v.push(`Would bring today's spend to $${(spentTodayUsd + i.amountUsd).toFixed(2)}, over the $${p.maxPerDayUsd} daily cap`);
  if (i.slippageBps > p.maxSlippageBps) v.push(`Slippage ${i.slippageBps} bps is over the ${p.maxSlippageBps} bps cap`);
  if (p.tokenDenylist.some((t) => eq(t, i.token))) v.push("Token is on the denylist");
  if (p.tokenAllowlist.length && !p.tokenAllowlist.some((t) => eq(t, i.token))) v.push("Token is not on the allowlist");
  if (!p.tokenAllowlist.length && !i.screenPassed) v.push("Token failed the safety screen");
  return v;
}

/**
 * Checks the transaction the API actually returned, right before signing.
 * The API is trusted to route, not to decide what the wallet signs.
 */
export function checkPrepared(p: Policy, tx: PreparedTx, signer: Address, maxValueWei: bigint, expectedNonce?: number): string[] {
  const v: string[] = [];
  if (p.killSwitch) v.push("Kill switch is on");
  if (!p.allowedChainIds.includes(tx.chainId)) v.push(`Prepared tx is for chain ${tx.chainId}`);
  if (!p.allowedTargets.some((a) => eq(a, tx.to))) v.push(`Prepared tx calls ${tx.to}, which is not an allowed contract`);
  if (BigInt(tx.valueWei) > maxValueWei) v.push(`Prepared tx sends ${tx.valueWei} wei, more than the approved ${maxValueWei}`);
  if (expectedNonce !== undefined && tx.nonce !== expectedNonce) v.push(`Prepared tx nonce ${tx.nonce} does not match wallet nonce ${expectedNonce}`);
  void signer;
  return v;
}

const num = (v: unknown, name: string, min: number, max = Infinity) => {
  if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max) throw new Error(`${name} must be a number between ${min} and ${max}`);
  return v;
};
const addrs = (v: unknown, name: string) => {
  if (!Array.isArray(v) || !v.every((a) => typeof a === "string" && /^0x[0-9a-fA-F]{40}$/.test(a))) throw new Error(`${name} must be a list of addresses`);
  return v as Address[];
};
const bool = (v: unknown, name: string) => {
  if (typeof v !== "boolean") throw new Error(`${name} must be true or false`);
  return v;
};

/** Rejects malformed or unsafe policy values instead of silently weakening a limit. */
export function validatePolicy(p: Policy): Policy {
  return {
    maxPerTradeUsd: num(p.maxPerTradeUsd, "maxPerTradeUsd", 0, 1000),
    maxPerDayUsd: num(p.maxPerDayUsd, "maxPerDayUsd", 0, 10_000),
    maxSlippageBps: num(p.maxSlippageBps, "maxSlippageBps", 0, 5000),
    allowedChainIds: [BASE_CHAIN_ID],
    allowedTargets: addrs(p.allowedTargets, "allowedTargets"),
    tokenAllowlist: addrs(p.tokenAllowlist, "tokenAllowlist"),
    tokenDenylist: addrs(p.tokenDenylist, "tokenDenylist"),
    requireApproval: bool(p.requireApproval, "requireApproval"),
    autoPropose: bool(p.autoPropose, "autoPropose"),
    killSwitch: bool(p.killSwitch, "killSwitch"),
  };
}
