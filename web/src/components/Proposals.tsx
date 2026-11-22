import { useState } from "react";
import { Check, ClipboardList, ExternalLink, ShieldCheck, X } from "lucide-react";
import type { AgentState, Proposal } from "../types";
import { shortAddress, usd, weiToEth } from "../lib/utils";
import { Button } from "./ui/button";

const labels: Record<Proposal["status"], string> = { preparing: "Preparing", awaiting_approval: "Awaiting approval", blocked: "Blocked", rejected: "Rejected", executing: "Executing", filled: "Filled", failed: "Failed" };
export default function Proposals({ proposals, mode, killed, connected, authorized = true, pending, onDecision }: {
  proposals: Proposal[]; mode: AgentState["mode"]; killed: boolean; connected: boolean;
  authorized?: boolean; pending: Set<string>; onDecision: (proposal: Proposal, decision: "approve" | "reject") => void;
}) {
  const [filter, setFilter] = useState<"all" | "pending">("all");
  const [limit, setLimit] = useState(10);
  const sorted = [...proposals].sort((a, b) => b.createdAt - a.createdAt);
  const waiting = proposals.filter(p => p.status === "awaiting_approval").length;
  const visible = sorted.filter(p => filter === "all" || ["awaiting_approval", "executing", "preparing"].includes(p.status));
  return <section className="panel proposals-panel" aria-labelledby="proposals-heading">
    <header className="panel-header"><div className="panel-title"><ClipboardList size={15} /><h2 id="proposals-heading">Proposals</h2><span className="count-badge">{waiting} pending</span></div><div className="segmented-control" aria-label="Proposal filter"><button aria-pressed={filter === "all"} onClick={() => setFilter("all")}>All</button><button aria-pressed={filter === "pending"} onClick={() => setFilter("pending")}>Active</button></div></header>
    {!visible.length && <div className="empty-state"><ShieldCheck size={24} /><h3>{filter === "all" ? "Nothing to sign. Yet." : "No active proposals"}</h3><p>Propose a buy from the feed. Every transaction is checked before signing.</p></div>}
    <div className="proposal-list">{visible.slice(0, limit).map(p => {
      const busy = pending.has(`decision:${p.id}`);
      const passedFirewall = p.prepared && !p.violations.length && ["awaiting_approval", "executing", "filled"].includes(p.status);
      return <article className={`proposal-card proposal-${p.status}`} key={p.id}>
        <div className="proposal-heading"><div><span className="eyebrow">BUY</span><strong>{p.symbol || shortAddress(p.token)}</strong><span className="muted text-xs">{p.source}</span></div><span className={`status-pill status-${p.status}`}>{labels[p.status]}</span></div>
        <div className="proposal-amount"><strong>{usd(p.amountUsd)}</strong><span>{p.amountEth} ETH</span><time className="muted" dateTime={new Date(p.createdAt).toISOString()}>{new Date(p.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time></div>
        {p.prepared && <details className="transaction-details" open={p.status === "awaiting_approval"}><summary>Unsigned transaction <span className="muted">· inspect before approving</span></summary><dl className="transaction-grid"><div className="wide"><dt>Contract · to</dt><dd className="mono break-address">{p.prepared.to}</dd></div><div><dt>Value</dt><dd>{weiToEth(p.prepared.valueWei)} ETH</dd></div><div><dt>Gas limit</dt><dd>{p.prepared.gas}</dd></div><div><dt>Nonce</dt><dd>{p.prepared.nonce}</dd></div><div><dt>Chain</dt><dd>{p.prepared.chainId}</dd></div></dl></details>}
        {passedFirewall && <p className="firewall-line positive"><ShieldCheck size={13} />Firewall: passed<span className="muted">Chain · contract · value · nonce</span></p>}
        {!!p.violations.length && <ul className="violations" aria-label="Policy violations">{p.violations.map((v, i) => <li key={i}>{v}</li>)}</ul>}
        {p.error && <p className="proposal-error negative">{p.error}</p>}
        {p.status === "filled" && <div className="fill-details"><dl className="transaction-grid"><div><dt>Tokens received</dt><dd>{p.tokensReceived ?? "—"}</dd></div><div><dt>Gas used</dt><dd>{p.gasUsed ?? "—"}</dd></div>{p.forkBlock !== undefined && <div><dt>Fork block</dt><dd>{p.forkBlock.toLocaleString()}</dd></div>}</dl>{p.txHash && <div className="transaction-hash"><span>{mode === "live" ? "Base transaction" : "Fork tx · not on BaseScan"}</span>{mode === "live" ? <a href={`https://basescan.org/tx/${p.txHash}`} target="_blank" rel="noreferrer" className="mono break-address">{p.txHash}<ExternalLink size={11} /></a> : <code className="break-address">{p.txHash}</code>}</div>}</div>}
        {p.status === "awaiting_approval" && <div className="proposal-actions"><Button disabled={!connected || !authorized || killed || busy || !passedFirewall} onClick={() => onDecision(p, "approve")}><Check size={14} />{busy ? "Submitting…" : mode === "live" ? "Approve live buy" : "Approve buy"}</Button><Button variant="outline" disabled={!connected || !authorized || busy} onClick={() => onDecision(p, "reject")}><X size={14} />Reject</Button></div>}
        {p.status === "preparing" && <p className="muted text-xs">Preparing an unsigned transaction through the o1 API…</p>}
        {p.status === "executing" && <p className="muted text-xs">{mode === "live" ? "Submitting to Base mainnet…" : "Executing on the local Base fork…"}</p>}
      </article>;
    })}</div>
    {visible.length > limit && <div className="panel-footer"><Button variant="ghost" onClick={() => setLimit(l => l + 10)}>Show more proposals ({visible.length - limit})</Button></div>}
  </section>;
}
