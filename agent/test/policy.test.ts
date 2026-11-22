import { describe, expect, it } from "vitest";
import { checkIntent, checkPrepared, defaultPolicy } from "../src/policy.js";
import type { PreparedTx } from "../src/types.js";

const token = "0xb200000000000000000000531df9adf3d948f601" as const;
const ok = { chainId: 8453, token, amountUsd: 1, slippageBps: 300, screenPassed: true };
const tx: PreparedTx = { orderId: "o", txId: "t", chainId: 8453, to: defaultPolicy.allowedTargets[0], valueWei: "300000000000000", gas: "600000", nonce: 7, dataBytes: 100, permit2: false, unsigned: "0x" };

describe("checkIntent", () => {
  it("allows a trade inside every limit", () => expect(checkIntent(defaultPolicy, ok, 0)).toEqual([]));
  it("enforces the per-trade cap", () => expect(checkIntent(defaultPolicy, { ...ok, amountUsd: 2 }, 0)[0]).toMatch(/per-trade/));
  it("enforces the daily cap", () => expect(checkIntent(defaultPolicy, ok, 4.5).join()).toMatch(/daily cap/));
  it("enforces slippage", () => expect(checkIntent(defaultPolicy, { ...ok, slippageBps: 900 }, 0).join()).toMatch(/Slippage/));
  it("blocks other chains", () => expect(checkIntent(defaultPolicy, { ...ok, chainId: 56 }, 0).join()).toMatch(/Chain 56/));
  it("blocks tokens that fail screening", () => expect(checkIntent(defaultPolicy, { ...ok, screenPassed: false }, 0).join()).toMatch(/safety screen/));
  it("allowlist overrides screening", () => {
    const p = { ...defaultPolicy, tokenAllowlist: [token] };
    expect(checkIntent(p, { ...ok, screenPassed: false }, 0)).toEqual([]);
    expect(checkIntent(p, { ...ok, token: "0x0000000000000000000000000000000000000001" }, 0).join()).toMatch(/allowlist/);
  });
  it("kill switch blocks everything", () => expect(checkIntent({ ...defaultPolicy, killSwitch: true }, ok, 0).join()).toMatch(/Kill switch/));
});

describe("checkPrepared", () => {
  const signer = "0x0000000000000000000000000000000000000002" as const;
  it("accepts the expected transaction", () => expect(checkPrepared(defaultPolicy, tx, signer, 300000000000000n, 7)).toEqual([]));
  it("refuses unknown contracts", () => expect(checkPrepared(defaultPolicy, { ...tx, to: "0x000000000000000000000000000000000000dEaD" }, signer, 300000000000000n).join()).toMatch(/not an allowed contract/));
  it("refuses more value than approved", () => expect(checkPrepared(defaultPolicy, tx, signer, 1n).join()).toMatch(/more than the approved/));
  it("refuses the wrong chain", () => expect(checkPrepared(defaultPolicy, { ...tx, chainId: 1 }, signer, 300000000000000n).join()).toMatch(/chain 1/));
  it("refuses a nonce mismatch", () => expect(checkPrepared(defaultPolicy, tx, signer, 300000000000000n, 8).join()).toMatch(/nonce/));
});
