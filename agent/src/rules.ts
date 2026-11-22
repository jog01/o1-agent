import type { Check, IndexedToken, Rules, Screen } from "./types.js";

export const defaultRules: Rules = {
  minUniqueTraders: 3,
  minTrades: 5,
  maxSniperShare: 0.6,
  maxCreatorLaunches: 3,
  maxAgeHours: 72,
};

/** Safety screen for a launchpad token, using only on-chain data from the indexer. */
export function screen(t: IndexedToken, all: IndexedToken[], rules: Rules, nowSec: number): Screen {
  const creatorLaunches = all.filter((x) => x.creator.toLowerCase() === t.creator.toLowerCase()).length;
  const sniperShare = t.unique_traders ? t.first_minute_traders / t.unique_traders : 1;
  const ageH = (nowSec - t.launched_ts) / 3600;
  const checks: Check[] = [
    { id: "traders", label: "Unique traders", pass: t.unique_traders >= rules.minUniqueTraders, value: String(t.unique_traders), limit: `≥ ${rules.minUniqueTraders}` },
    { id: "activity", label: "Trades", pass: t.trades >= rules.minTrades, value: String(t.trades), limit: `≥ ${rules.minTrades}` },
    { id: "snipers", label: "Traders in first 60 s", pass: sniperShare <= rules.maxSniperShare, value: `${Math.round(sniperShare * 100)}%`, limit: `≤ ${Math.round(rules.maxSniperShare * 100)}%` },
    { id: "creator", label: "Creator's launches (7 d)", pass: creatorLaunches <= rules.maxCreatorLaunches, value: String(creatorLaunches), limit: `≤ ${rules.maxCreatorLaunches}` },
    { id: "age", label: "Age", pass: ageH <= rules.maxAgeHours, value: `${ageH.toFixed(1)} h`, limit: `≤ ${rules.maxAgeHours} h` },
  ];
  return { pass: checks.every((c) => c.pass), checks };
}

const n = (v: unknown, name: string, min: number, max: number) => {
  if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max) throw new Error(`${name} must be a number between ${min} and ${max}`);
  return v;
};

export function validateRules(r: Rules): Rules {
  return {
    minUniqueTraders: n(r.minUniqueTraders, "minUniqueTraders", 0, 1e6),
    minTrades: n(r.minTrades, "minTrades", 0, 1e7),
    maxSniperShare: n(r.maxSniperShare, "maxSniperShare", 0, 1),
    maxCreatorLaunches: n(r.maxCreatorLaunches, "maxCreatorLaunches", 1, 1e4),
    maxAgeHours: n(r.maxAgeHours, "maxAgeHours", 0, 24 * 365),
  };
}
