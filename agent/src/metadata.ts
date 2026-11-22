import { createPublicClient, http, parseAbi, type Address } from "viem";
import { base } from "viem/chains";
import { config } from "./config.js";

const GATEWAY = (process.env.IPFS_GATEWAY ?? "https://gateway.pinata.cloud/ipfs").replace(/\/*$/, "/");
const client = createPublicClient({ chain: base, transport: http(config.baseRpcUrl, { timeout: 10_000 }) });
const abi = parseAbi(["function contractURI() view returns (string)"]);

const MAX_IMAGE_BYTES = 2_000_000;
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

export interface CachedImage {
  type: string;
  body: ArrayBuffer;
}

/** Image bytes per token, fetched once from IPFS and served by the agent; null once a lookup failed or there is no image. */
const images = new Map<string, CachedImage | null>();
const inflight = new Set<string>();

export function toGateway(uri: string): string | undefined {
  if (uri.startsWith("ipfs://")) return GATEWAY + uri.slice(7).replace(/^ipfs\//, "");
  if (uri.startsWith("https://")) return uri;
  return undefined;
}

// Creators control both URIs, so the server only ever fetches through the IPFS gateway, never an arbitrary host.
async function fromIpfs(uri: unknown): Promise<Response | null> {
  if (typeof uri !== "string" || !uri.startsWith("ipfs://")) return null;
  const r = await fetch(toGateway(uri)!, { signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new Error(`ipfs ${r.status}`);
  return r;
}

/** Reads at most `max` bytes, giving up (and cancelling the download) as soon as the body is larger. */
export async function readCapped(r: Response, max: number): Promise<ArrayBuffer | null> {
  if (Number(r.headers.get("content-length") ?? 0) > max || !r.body) {
    await r.body?.cancel();
    return null;
  }
  const reader = r.body.getReader();
  const out = new Uint8Array(max);
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return out.slice(0, n).buffer;
    if (n + value.byteLength > max) {
      await reader.cancel();
      return null;
    }
    out.set(value, n);
    n += value.byteLength;
  }
}

async function lookup(token: Address): Promise<CachedImage | null> {
  const uri = await client.readContract({ address: token, abi, functionName: "contractURI" });
  const meta = await fromIpfs(uri);
  if (!meta) return null;
  const img = await fromIpfs(((await meta.json()) as { image?: unknown }).image);
  if (!img) return null;
  const type = (img.headers.get("content-type") ?? "").split(";")[0].trim();
  if (!IMAGE_TYPES.has(type)) return null;
  const body = await readCapped(img, MAX_IMAGE_BYTES);
  return body ? { type, body } : null;
}

export function cachedImage(token: string): CachedImage | undefined {
  return images.get(token.toLowerCase()) ?? undefined;
}

/** Same-origin URL for a token's cached image, once it has been fetched. */
export function imageUrl(token: Address): string | undefined {
  return cachedImage(token) ? `/api/token-image/${token.toLowerCase()}` : undefined;
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
