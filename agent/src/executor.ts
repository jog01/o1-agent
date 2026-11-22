import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  erc20Abi,
  http,
  parseTransaction,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { config } from "./config.js";
import { completeOrder } from "./o1.js";
import type { PreparedTx } from "./types.js";

const fork = http(config.forkRpcUrl, { timeout: 120_000 });
const forkPublic = createPublicClient({ chain: base, transport: fork });
const forkTest = createTestClient({ chain: base, mode: "anvil", transport: fork });
const forkWallet = createWalletClient({ chain: base, transport: fork });
const mainnet = createPublicClient({ chain: base, transport: http(config.baseRpcUrl) });

export interface ExecResult {
  txHash: Hex;
  status: "success" | "reverted";
  gasUsed: string;
  forkBlock?: number;
  tokensReceived?: string;
}

export function signerAddress(): Address {
  if (config.mode === "demo") return config.demoSigner;
  if (!config.walletKey) throw new Error("WALLET_PRIVATE_KEY is not set");
  return privateKeyToAccount(config.walletKey).address;
}

export async function walletNonce(addr: Address): Promise<number> {
  return mainnet.getTransactionCount({ address: addr });
}

/** Re-forks Base at the latest block so the fork matches the state o1 quoted against. */
async function freshFork(): Promise<number> {
  await forkTest.reset({ jsonRpcUrl: config.baseRpcUrl });
  return Number(await forkPublic.getBlockNumber());
}

async function balanceOf(client: typeof forkPublic, token: Address, owner: Address): Promise<bigint | undefined> {
  return client.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [owner] }).catch(() => undefined);
}

const delta = (before?: bigint, after?: bigint) => (before === undefined || after === undefined ? undefined : (after - before).toString());

/**
 * demo: replays the prepared transaction on a local Base fork from an impersonated funded address. No key, no money.
 * fork: signs the prepared transaction with the agent's own key and broadcasts the raw tx to the fork. No money.
 * live: signs and hands it to o1's /order/complete. Real money; needs LIVE_TRADING set.
 */
export async function execute(tx: PreparedTx, token: Address, onSent: (hash: Hex) => void = () => {}): Promise<ExecResult> {
  if (tx.permit2) throw new Error("Permit2 orders (sells) are not supported by this executor yet");
  const signer = signerAddress();
  const unsigned = parseTransaction(tx.unsigned);

  if (config.mode === "live") {
    if (!config.liveTradingEnabled) throw new Error("Live trading is disabled (set LIVE_TRADING)");
    const account = privateKeyToAccount(config.walletKey);
    const before = await balanceOf(mainnet, token, signer);
    const signed = await account.signTransaction(unsigned as any);
    const res = await completeOrder(tx.orderId, [{ id: tx.txId, signed }]);
    const hash = res.transactions?.[0]?.hash as Hex;
    if (!hash) throw new Error("o1 did not return a transaction hash");
    onSent(hash);
    const rc = await mainnet.waitForTransactionReceipt({ hash, timeout: 120_000 });
    const after = await balanceOf(mainnet, token, signer);
    return { txHash: hash, status: rc.status, gasUsed: rc.gasUsed.toString(), tokensReceived: delta(before, after) };
  }

  const forkBlock = await freshFork();
  const before = await balanceOf(forkPublic, token, signer);
  let hash: Hex;
  if (config.mode === "demo") {
    await forkTest.impersonateAccount({ address: signer });
    hash = await forkWallet.sendTransaction({
      account: signer,
      chain: base,
      to: unsigned.to!,
      value: unsigned.value,
      data: unsigned.data,
      gas: unsigned.gas,
    });
    await forkTest.stopImpersonatingAccount({ address: signer });
  } else {
    const account = privateKeyToAccount(config.walletKey);
    const signed = await account.signTransaction(unsigned as any);
    hash = await forkPublic.sendRawTransaction({ serializedTransaction: signed });
  }
  onSent(hash);
  const rc = await forkPublic.waitForTransactionReceipt({ hash, timeout: 60_000 });
  const after = await balanceOf(forkPublic, token, signer);
  return { txHash: hash, status: rc.status, gasUsed: rc.gasUsed.toString(), forkBlock, tokensReceived: delta(before, after) };
}
