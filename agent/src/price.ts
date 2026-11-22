let cache: { usd: number; at: number } | undefined;

/** ETH/USD spot from Coinbase's public price endpoint, cached for a minute. */
export async function ethUsd(): Promise<number> {
  if (cache && Date.now() - cache.at < 60_000) return cache.usd;
  try {
    const r = await fetch("https://api.coinbase.com/v2/prices/ETH-USD/spot", { signal: AbortSignal.timeout(5000) });
    const j = (await r.json()) as any;
    const usd = Number(j.data.amount);
    if (usd > 0) cache = { usd, at: Date.now() };
  } catch {}
  return cache?.usd ?? 3000;
}
