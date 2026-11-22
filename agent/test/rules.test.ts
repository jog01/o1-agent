import { describe, expect, it } from "vitest";
import { defaultRules, screen } from "../src/rules.js";
import type { IndexedToken } from "../src/types.js";

const now = 1_800_000_000;
const t = (over: Partial<IndexedToken> = {}): IndexedToken => ({ suite: "standard", token: "0x1111111111111111111111111111111111111111", pool_id: "0x", creator: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", quote_token: "0x0000000000000000000000000000000000000000", name: "T", symbol: "T", launched_block: 1, launched_ts: now - 3600, trades: 20, unique_traders: 10, first_minute_traders: 2, quote_fees: "0x0", last_trade_ts: now, ...over });

describe("screen", () => {
  it("passes a healthy token", () => expect(screen(t(), [t()], defaultRules, now).pass).toBe(true));
  it("flags sniper-heavy launches", () => {
    const s = screen(t({ first_minute_traders: 9 }), [], defaultRules, now);
    expect(s.pass).toBe(false);
    expect(s.checks.find((c) => c.id === "snipers")!.pass).toBe(false);
  });
  it("flags serial creators", () => {
    const many = Array.from({ length: 5 }, (_, i) => t({ token: `0x${String(i).repeat(40)}` as any }));
    expect(screen(t(), many, defaultRules, now).checks.find((c) => c.id === "creator")!.pass).toBe(false);
  });
  it("flags thin activity", () => expect(screen(t({ unique_traders: 1, trades: 2 }), [], defaultRules, now).pass).toBe(false));
  it("flags stale tokens", () => expect(screen(t({ launched_ts: now - 100 * 3600 }), [], defaultRules, now).pass).toBe(false));
});
