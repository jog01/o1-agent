import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { formatUnits, parseEther, type Address } from "viem";
import { config } from "./config.js";
import { execute, freshFork, signerAddress, walletNonce } from "./executor.js";
import { imageUrl, resolveImages } from "./metadata.js";
import { prepareOrder } from "./o1.js";
import { BASE_CHAIN_ID, checkIntent, checkPrepared, defaultPolicy, validatePolicy } from "./policy.js";
import { ethUsd } from "./price.js";
import { defaultRules, screen, validateRules } from "./rules.js";
import type { IndexedToken, LogLine, Policy, Proposal, Rules, Screen } from "./types.js";

export interface ScreenedToken extends IndexedToken {
  screen: Screen;
  imageUrl?: string;
}

interface Persisted {
  policy: Policy;
  rules: Rules;
  proposals: Proposal[];
}

const DAY = 86_400_000;

export class Agent extends EventEmitter {
  policy: Policy = structuredClone(defaultPolicy);
  rules: Rules = structuredClone(defaultRules);
  tokens: ScreenedToken[] = [];
  proposals: Proposal[] = [];
  log: LogLine[] = [];
  indexerOk = false;
  private seen = new Set<string>();
  private proposed = new Set<string>();
  private queue: Promise<unknown> = Promise.resolve();
  private resetting = false;
  private primed = false;

  constructor() {
    super();
    this.load();
  }

  private load() {
    if (!existsSync(config.statePath)) return;
    try {
      const s = JSON.parse(readFileSync(config.statePath, "utf8")) as Persisted;
      this.policy = { ...this.policy, ...s.policy };
      this.rules = { ...this.rules, ...s.rules };
      this.proposals = s.proposals ?? [];
      for (const p of this.proposals)
        if (p.status === "executing" || p.status === "preparing") {
          if (p.status === "executing") p.spent = true;
          p.status = "failed";
          p.error = `Interrupted by a restart while ${p.status}; check ${p.txHash ?? "the signer's history"} before retrying`;
        }
    } catch {}
  }

  private save() {
    mkdirSync(dirname(config.statePath), { recursive: true });
    const s: Persisted = { policy: this.policy, rules: this.rules, proposals: this.proposals.slice(0, 200) };
    writeFileSync(config.statePath, JSON.stringify(s, null, 2));
  }

  private changed() {
    this.save();
    this.emit("change");
  }

  say(level: LogLine["level"], msg: string) {
    this.log.unshift({ ts: Date.now(), level, msg });
    this.log.length = Math.min(this.log.length, 300);
    this.emit("change");
  }

  spentTodayUsd(): number {
    const since = Date.now() - DAY;
    return this.proposals
      .filter((p) => (p.executedAt ?? p.createdAt) > since && (p.status === "filled" || p.status === "executing" || p.spent))
      .reduce((s, p) => s + p.amountUsd, 0);
  }

  signer(): Address | "" {
    try {
      return signerAddress();
    } catch {
      return "";
    }
  }

  /** Pulls the indexer's token table, screens every token and auto-proposes new ones that pass. */
  async refresh() {
    let raw: IndexedToken[];
    try {
      const r = await fetch(`${config.indexerUrl}/tokens`, { signal: AbortSignal.timeout(5000) });
      raw = (await r.json()) as IndexedToken[];
      if (!this.indexerOk) this.say("info", `Connected to indexer: ${raw.length} o1 Launchpad tokens on Base`);
      this.indexerOk = true;
    } catch {
      if (this.indexerOk) this.say("warn", "Indexer unreachable");
      this.indexerOk = false;
      return;
    }
    const now = Math.floor(Date.now() / 1000);
    this.tokens = raw.map((t) => ({ ...t, imageUrl: imageUrl(t.token), screen: screen(t, raw, this.rules, now) }));
    void resolveImages(raw.map((t) => t.token), () => {
      for (const t of this.tokens) t.imageUrl = imageUrl(t.token);
      for (const p of this.proposals) p.imageUrl = imageUrl(p.token) ?? p.imageUrl;
      this.changed();
    });
    for (const t of this.tokens) {
      const key = t.token.toLowerCase();
      const fresh = !this.seen.has(key);
      this.seen.add(key);
      if (!this.primed) {
        if (t.screen.pass) this.proposed.add(key);
        continue;
      }
      if (fresh) this.say("info", `New launch: ${t.symbol || t.token} (${t.suite})`);
      if (!this.resetting && this.policy.autoPropose && t.screen.pass && !this.proposed.has(key) && !this.proposals.some((p) => p.token.toLowerCase() === key)) {
        this.proposed.add(key);
        this.say("action", `${t.symbol} passed the safety screen, proposing a $${this.policy.maxPerTradeUsd} buy`);
        this.propose(t.token, this.policy.maxPerTradeUsd, "agent").catch((e) => this.say("warn", `Auto-propose failed: ${(e as Error).message}`));
      }
    }
    this.primed = true;
    this.emit("change");
  }

  /** Re-screens existing tokens and proposes the best one that passes. Used by the "scan" button and MCP. */
  async scan() {
    await this.refresh();
    const pick = this.tokens
      .filter((t) => t.screen.pass && !this.proposals.some((p) => p.token.toLowerCase() === t.token.toLowerCase()))
      .sort((a, b) => b.unique_traders - a.unique_traders)[0];
    if (!pick) {
      this.say("info", "Scan: no new token to propose. Every token that passes the screen already has a proposal");
      return undefined;
    }
    this.say("action", `Scan: ${pick.symbol} is the strongest token that passes, proposing a buy`);
    return this.propose(pick.token, this.policy.maxPerTradeUsd, "agent");
  }

  async propose(token: Address, amountUsd: number, source: Proposal["source"]): Promise<Proposal> {
    if (!Number.isFinite(amountUsd) || amountUsd <= 0) throw new Error("amountUsd must be a positive number");
    const t = this.tokens.find((x) => x.token.toLowerCase() === token.toLowerCase());
    if (this.resetting) throw new Error("Demo reset in progress");
    const price = await ethUsd();
    if (this.resetting) throw new Error("Demo reset in progress");
    const amountEth = Number((amountUsd / price).toFixed(8));
    const p: Proposal = {
      id: crypto.randomUUID().slice(0, 8),
      createdAt: Date.now(),
      token,
      symbol: t?.symbol ?? "?",
      name: t?.name ?? "",
      imageUrl: imageUrl(token),
      amountUsd,
      amountEth,
      slippageBps: 300,
      signer: (this.signer() || "0x") as Address,
      source,
      status: "preparing",
      screen: t?.screen,
      violations: [],
    };
    this.proposals.unshift(p);
    p.violations = checkIntent(
      this.policy,
      { chainId: BASE_CHAIN_ID, token, amountUsd, slippageBps: p.slippageBps, screenPassed: t?.screen.pass ?? false },
      this.spentTodayUsd(),
    );
    if (p.violations.length) {
      p.status = "blocked";
      this.say("warn", `Blocked ${p.symbol} buy: ${p.violations.join("; ")}`);
      this.changed();
      return p;
    }
    this.changed();
    try {
      const [tx] = await prepareOrder({
        signer: p.signer,
        token,
        amount: amountEth.toFixed(8),
        direction: "buy",
        slippageBps: p.slippageBps,
        mevProtection: true,
      });
      p.prepared = tx;
      // In demo mode the fork impersonates the signer, so its live mainnet nonce is irrelevant.
      const nonce = config.mode === "demo" ? undefined : await walletNonce(p.signer).catch(() => undefined);
      p.violations = checkPrepared(this.policy, tx, p.signer, parseEther(amountEth.toFixed(18)), nonce);
      if (p.violations.length) {
        p.status = "blocked";
        this.say("warn", `Refused to sign ${p.symbol} order: ${p.violations.join("; ")}`);
      } else {
        p.status = "awaiting_approval";
        this.say("info", `o1 prepared ${p.symbol} buy: ${amountEth} ETH via ${tx.to.slice(0, 10)}…, gas ${tx.gas}`);
        if (!this.policy.requireApproval && source !== "mcp") void this.approve(p.id);
      }
    } catch (e: any) {
      p.status = "failed";
      p.error = String(e.message ?? e);
      this.say("warn", `o1 could not prepare ${p.symbol}: ${p.error}`);
    }
    this.changed();
    return p;
  }

  async approve(id: string): Promise<Proposal> {
    if (this.resetting) throw new Error("Demo reset in progress");
    const p = this.must(id);
    if (p.status !== "awaiting_approval" || !p.prepared) throw new Error(`Proposal is ${p.status}`);
    const current = this.tokens.find((x) => x.token.toLowerCase() === p.token.toLowerCase())?.screen;
    if (current) p.screen = current;
    const again = [
      ...checkIntent(this.policy, { chainId: BASE_CHAIN_ID, token: p.token, amountUsd: p.amountUsd, slippageBps: p.slippageBps, screenPassed: current?.pass ?? false }, this.spentTodayUsd()),
      ...checkPrepared(this.policy, p.prepared, p.signer, parseEther(p.amountEth.toFixed(18))),
    ];
    if (again.length) {
      p.status = "blocked";
      p.violations = again;
      this.say("warn", `Blocked at signing: ${again.join("; ")}`);
      this.changed();
      return p;
    }
    p.status = "executing";
    p.executedAt = Date.now();
    this.say("action", `Approved. Signing and executing ${p.symbol} buy on ${config.mode === "live" ? "Base mainnet" : "a local Base fork"}`);
    this.changed();
    try {
      // One fork, one trade at a time: each execution resets the fork.
      const run = this.queue.then(() => {
        if (this.policy.killSwitch) throw new Error("Kill switch turned on before this trade was sent");
        return execute(p.prepared!, p.token, (hash) => { p.txHash = hash; p.spent = true; this.changed(); });
      });
      this.queue = run.catch(() => {});
      const r = await run;
      p.txHash = r.txHash;
      p.gasUsed = r.gasUsed;
      p.forkBlock = r.forkBlock;
      p.tokensReceived = r.tokensReceived === undefined ? undefined : formatUnits(BigInt(r.tokensReceived), 18);
      p.status = r.status === "success" ? "filled" : "failed";
      if (r.status !== "success") {
        p.error = "Transaction reverted";
        p.spent = false;
      }
      this.say(p.status === "filled" ? "action" : "warn", p.status === "filled" ? `Filled: received ${p.tokensReceived ? Number(p.tokensReceived).toLocaleString() : "an unknown amount of"} ${p.symbol}, gas ${r.gasUsed}` : `Reverted: ${p.symbol}`);
    } catch (e: any) {
      p.status = "failed";
      p.error = String(e.shortMessage ?? e.message ?? e);
      this.say("warn", `Execution failed: ${p.error}`);
    }
    this.changed();
    return p;
  }

  reject(id: string) {
    const p = this.must(id);
    if (p.status !== "awaiting_approval") throw new Error(`Proposal is ${p.status}`);
    p.status = "rejected";
    this.say("info", `Rejected ${p.symbol} buy`);
    this.changed();
    return p;
  }

  /** Demo only: wipe proposals, spend and activity, restore default limits and re-fork Base. */
  async resetDemo() {
    if (config.mode !== "demo") throw new Error("Reset is only available in demo mode");
    if (this.resetting) throw new Error("Demo reset already in progress");
    if (this.proposals.some((p) => p.status === "executing" || p.status === "preparing"))
      throw new Error("Wait for the trade in progress to finish before resetting");
    this.resetting = true;
    try {
      const run = this.queue.then(() => freshFork());
      this.queue = run.catch(() => {});
      const forkBlock = await run;
      this.policy = structuredClone(defaultPolicy);
      this.rules = structuredClone(defaultRules);
      this.proposals = [];
      this.log = [];
      const now = Math.floor(Date.now() / 1000);
      this.tokens = this.tokens.map((t) => ({ ...t, screen: screen(t, this.tokens, this.rules, now) }));
      this.proposed = new Set(this.tokens.filter((t) => t.screen.pass).map((t) => t.token.toLowerCase()));
      this.say("info", `Demo reset: fresh Base fork at block ${forkBlock.toLocaleString()}, default limits restored`);
      this.changed();
      return { forkBlock };
    } finally {
      this.resetting = false;
    }
  }


  setKill(on: boolean) {
    this.policy.killSwitch = on;
    if (on) for (const p of this.proposals) if (p.status === "awaiting_approval") { p.status = "rejected"; p.violations = ["Kill switch"]; }
    this.say("warn", on ? "KILL SWITCH ON: all pending orders cancelled, nothing will be signed" : "Kill switch off");
    this.changed();
  }

  updatePolicy(patch: Partial<Policy>) {
    this.policy = validatePolicy({ ...this.policy, ...patch });
    this.say("info", "Policy updated");
    this.changed();
  }

  updateRules(patch: Partial<Rules>) {
    this.rules = validateRules({ ...this.rules, ...patch });
    this.say("info", "Safety rules updated");
    void this.refresh();
    this.changed();
  }

  private must(id: string) {
    const p = this.proposals.find((x) => x.id === id);
    if (!p) throw new Error("No such proposal");
    return p;
  }

  snapshot() {
    return {
      mode: config.mode,
      signer: this.signer(),
      indexerOk: this.indexerOk,
      apiConfigured: Boolean(config.o1ApiToken),
      approverTokenRequired: Boolean(config.approverToken),
      policy: this.policy,
      rules: this.rules,
      spentTodayUsd: this.spentTodayUsd(),
      tokens: this.tokens,
      proposals: this.proposals,
      log: this.log.slice(0, 100),
    };
  }
}
