import { createPublicClient, http, parseAbi, type Address } from "viem";
import { base } from "viem/chains";
import { config } from "./config.js";

const GATEWAY = process.env.IPFS_GATEWAY ?? "https://gateway.pinata.cloud/ipfs/";
const client = createPublicClient({ chain: base, transport: http(config.baseRpcUrl, { timeout: 10_000 }) });
const abi = parseAbi(["function contractURI() view returns (string)"]);

/** Resolved image URL per token; null once a lookup failed or the token has no image. */
const images = new Map<string, string | null>();
const inflight = new Set<string>();

export function toGateway(uri: string): string | undefined {
  if (uri.startsWith("ipfs://")) return GATEWAY + uri.slice(7).replace(/^ipfs\//, "");
  if (uri.startsWith("https://")) return uri;
  return undefined;
}

async function lookup(token: Address): Promise<string | null> {
  const uri = await client.readContract({ address: token, abi, functionName: "contractURI" });
  const url = toGateway(uri);
  if (!url) return null;
  const r = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!r.ok) throw new Error(`metadata ${r.status}`);
  const meta = (await r.json()) as { image?: unknown };
  return typeof meta.image === "string" ? (toGateway(meta.image) ?? null) : null;
}

export function imageUrl(token: Address): string | undefined {
  return images.get(token.toLowerCase()) ?? undefined;
}

/** Resolves images for tokens not looked up yet, a few at a time, and calls onFound when any resolve. */
export async function resolveImages(tokens: Address[], onFound: () => void) {
  const todo = tokens.filter((t) => !images.has(t.toLowerCase()) && !inflight.has(t.toLowerCase()));
  for (let i = 0; i < todo.length; i += 4) {
    const batch = todo.slice(i, i + 4);
    batch.forEach((t) => inflight.add(t.toLowerCase()));
    const found = await Promise.all(
      batch.map(async (t) => {
        const url = await lookup(t).catch(() => null);
        images.set(t.toLowerCase(), url);
        inflight.delete(t.toLowerCase());
        return url;
      }),
    );
    if (found.some(Boolean)) onFound();
  }
}
