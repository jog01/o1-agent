import { parseTransaction, type Address, type Hex } from "viem";
import { config } from "./config.js";
import type { PreparedTx } from "./types.js";

export const PERMIT2_SIGNATURE_PLACEHOLDER =
  "42f68902113a2a579bcc207c91254c8516d921250e748c18a082d91d74908f8e9a05f27b72a030c6a42d77d0e0aab6fb09219b01a01e7b5b24e4f322ee1762ff1b";

export interface OrderRequest {
  signer: Address;
  token: Address;
  amount: string;
  direction: "buy" | "sell";
  slippageBps: number;
  mevProtection: boolean;
}

async function post(path: string, body: unknown) {
  if (!config.o1ApiToken) throw new Error("O1_API_TOKEN is not set");
  const res = await fetch(`${config.o1ApiUrl}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.o1ApiToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const json = (await res.json().catch(() => ({}))) as any;
  if (!res.ok || json.success === false) throw new Error(`o1 API ${path}: ${json.message ?? res.status}`);
  return json;
}

/** POST /api/v2/order: o1 builds an unsigned transaction for the signer. Nothing is signed or sent. */
export async function prepareOrder(o: OrderRequest): Promise<PreparedTx[]> {
  const json = await post("/api/v2/order", {
    networkId: 8453,
    signerAddress: o.signer,
    tokenAddress: o.token,
    uiAmount: o.amount,
    direction: o.direction,
    slippageBps: o.slippageBps,
    mevProtection: o.mevProtection,
  });
  return (json.transactions as any[]).map((t) => decodePrepared(json.id, t));
}

export function decodePrepared(orderId: string, t: any): PreparedTx {
  const tx = parseTransaction(t.unsigned as Hex);
  return {
    orderId,
    txId: t.id,
    chainId: tx.chainId ?? 0,
    to: tx.to as Address,
    valueWei: (tx.value ?? 0n).toString(),
    gas: (tx.gas ?? 0n).toString(),
    nonce: tx.nonce ?? 0,
    dataBytes: tx.data ? (tx.data.length - 2) / 2 : 0,
    permit2: Boolean(t.permit2?.eip712),
    exchange: t.exchange,
    pool: t.pool,
    unsigned: t.unsigned,
  };
}

/** POST /api/v2/order/complete: hands signed transactions to o1 for broadcast. Live mode only. */
export async function completeOrder(orderId: string, txs: { id: string; signed: Hex }[]) {
  return post("/api/v2/order/complete", { id: orderId, transactions: txs });
}
