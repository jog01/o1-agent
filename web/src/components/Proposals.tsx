import { useEffect, useRef, useState } from "react";
import { Check, ChevronRight, ExternalLink, ShieldCheck, X } from "lucide-react";
import type { AgentState, Proposal, Token } from "../types";
import { age, tokenLabel, usd, weiToEth } from "../lib/utils";
import { Button } from "./ui/button";
import { Dialog, useCompactDetails } from "./ui/dialog";
import TokenAvatar from "./TokenAvatar";

const labels: Record<Proposal["status"], string> = { preparing: "Preparing", awaiting_approval: "Awaiting approval", blocked: "Blocked", rejected: "Rejected", executing: "Executing", filled: "Filled", failed: "Failed" };
interface Actions {
  mode: AgentState["mode"]; killed: boolean; connected: boolean; authorized?: boolean;
  pending: Set<string>; onDecision: (proposal: Proposal, decision: "approve" | "reject") => void;
}
interface Props extends Actions { proposals: Proposal[]; tokens?: Token[]; onViewFeed?: () => void; active?: boolean }
type Identity = Pick<Token, "token" | "symbol" | "name" | "imageUrl">;

export default function Proposals({ proposals, tokens = [], onViewFeed, active = true, ...actions }: Props) {
  const [filter, setFilter] = useState<"all" | "pending">("all");
  const [limit, setLimit] = useState(10);
  const [selectedId, setSelectedId] = useState<string>();
  const trigger = useRef<HTMLButtonElement | null>(null);
  const compact = useCompactDetails();
  const selected = proposals.find(p => p.id === selectedId);
  useEffect(() => {
    if (selectedId && active && !compact) document.getElementById("proposal-detail-heading")?.focus();
  }, [selectedId, active, compact]);
  const metadata = new Map(tokens.map(token => [token.token.toLowerCase(), token]));
  const identity = (p: Proposal): Identity => {
    const token = metadata.get(p.token.toLowerCase());
    return { token: p.token, symbol: p.symbol?.trim() || token?.symbol || "", name: p.name?.trim() || token?.name || "", imageUrl: p.imageUrl?.trim() || token?.imageUrl };
  };
  const sorted = [...proposals].sort((a, b) => Number(b.status === "awaiting_approval") - Number(a.status === "awaiting_approval") || b.createdAt - a.createdAt);
  const waiting = proposals.filter(p => p.status === "awaiting_approval").length;
  const visible = sorted.filter(p => filter === "all" || ["awaiting_approval", "executing", "preparing"].includes(p.status));
  const closeDetails = () => { setSelectedId(undefined); trigger.current?.focus(); };
  const detail = selected && <ProposalDetails {...actions} proposal={selected} identity={identity(selected)} onClose={closeDetails} />;
  return <section className="proposals-panel" aria-labelledby="proposals-heading">
    <div className={`proposal-workspace${selected && !compact ? " has-selection" : ""}`}>
      <div className="proposal-list-pane">
        <header className="panel-header"><div className="panel-title"><h2 id="proposals-heading" className="sr-only">Proposal queue</h2><span className="count-badge">{waiting} pending</span></div><div className="segmented-control" aria-label="Proposal filter">{(["all", "pending"] as const).map(value => <button key={value} aria-pressed={filter === value} onClick={() => { setFilter(value); setLimit(10); setSelectedId(undefined); }}>{value === "all" ? "All" : "Active"}</button>)}</div></header>
        {!visible.length && <div className="empty-state"><ShieldCheck size={24} /><h3>{filter === "all" ? "No proposals yet" : "No active proposals"}</h3><p>Choose a token from the feed. Review the transaction here before approving.</p>{onViewFeed && <Button variant="outline" size="sm" onClick={onViewFeed}>Explore feed<ChevronRight size={14} /></Button>}</div>}
        <div className="proposal-list" role="list" aria-label="Buy proposals">
          {visible.slice(0, limit).map(p => <div role="listitem" key={p.id}><button
            className="proposal-row" aria-label={`Review ${tokenLabel(identity(p))} buy for ${usd(p.amountUsd)} · ${labels[p.status]}`}
            aria-expanded={selectedId === p.id} aria-controls={selectedId === p.id ? "proposal-detail" : undefined}
            onClick={event => { trigger.current = event.currentTarget; setSelectedId(p.id); }}
          >
            <span className="proposal-row-token"><TokenAvatar {...identity(p)} /><span className="proposal-row-copy"><strong>{tokenLabel(identity(p))}</strong><span className="proposal-row-meta">Buy · {age(p.createdAt / 1000)} ago</span></span></span>
            <span className="proposal-row-amount"><strong>{usd(p.amountUsd)}</strong><small>{p.amountEth} ETH</small></span>
            <span className="proposal-row-status"><span className={`status-pill status-${p.status}`}>{labels[p.status]}</span></span>
            <time className="proposal-row-time" dateTime={new Date(p.createdAt).toISOString()} title={new Date(p.createdAt).toLocaleString()}>{age(p.createdAt / 1000)} ago</time>
            <ChevronRight className="proposal-row-chevron" size={15} />
          </button></div>)}
        </div>
        {visible.length > limit && <div className="panel-footer"><Button variant="ghost" onClick={() => setLimit(l => l + 10)}>Show more proposals ({visible.length - limit})</Button></div>}
      </div>
      {selected && !compact && <aside className="proposal-detail" id="proposal-detail" aria-labelledby="proposal-detail-heading" onKeyDown={event => { if (event.key === "Escape") closeDetails(); }}>{detail}</aside>}
      {compact && <Dialog id="proposal-detail" open={Boolean(selected) && active} onClose={closeDetails} className="proposal-detail is-modal" labelledBy="proposal-detail-heading">{detail}</Dialog>}
    </div>
  </section>;
}

function ProposalDetails({ proposal: p, identity, mode, killed, connected, authorized = true, pending, onDecision, onClose }: Actions & { proposal: Proposal; identity: Identity; onClose: () => void }) {
  const busy = pending.has(`decision:${p.id}`);
  const passedFirewall = p.prepared && !p.violations.length && ["awaiting_approval", "executing", "filled"].includes(p.status);
  return <>
    <header className="proposal-detail-header"><h2 id="proposal-detail-heading" tabIndex={-1}>Review proposal</h2><Button variant="ghost" size="icon" aria-label="Close proposal details" onClick={onClose}><X size={16} /></Button></header>
    <div className="proposal-detail-body"><article className={`proposal-card proposal-${p.status}`}>
      <div className="proposal-heading"><div><TokenAvatar {...identity} /><strong>{tokenLabel(identity)}</strong></div><span className={`status-pill status-${p.status}`}>{labels[p.status]}</span></div>
      <div className="proposal-amount"><strong>{usd(p.amountUsd)}</strong><span>{p.amountEth} ETH</span></div>
      <p className="proposal-created muted"><time dateTime={new Date(p.createdAt).toISOString()}>{new Date(p.createdAt).toLocaleString()}</time> · {p.source}</p>
      {passedFirewall && <p className="firewall-line positive"><ShieldCheck size={13} />Firewall: passed<span className="muted">Chain · contract · value · nonce</span></p>}
      {!!p.violations.length && <ul className="violations" aria-label="Policy violations">{p.violations.map((v, i) => <li key={i}>{v}</li>)}</ul>}
      {p.error && <p className="proposal-error negative">{p.error}</p>}
      {p.prepared && <details className="transaction-details" open={p.status === "awaiting_approval"}><summary>Unsigned transaction</summary><dl className="transaction-grid">
        <div className="wide"><dt>Token</dt><dd className="mono break-address">{p.token}</dd></div>
        <div className="wide"><dt>Signer</dt><dd className="mono break-address">{p.signer}</dd></div>
        <div className="wide"><dt>Contract · to</dt><dd className="mono break-address">{p.prepared.to}</dd></div>
        <div><dt>Value</dt><dd>{weiToEth(p.prepared.valueWei)} ETH</dd></div><div><dt>Gas limit</dt><dd>{p.prepared.gas}</dd></div>
        <div><dt>Nonce</dt><dd>{p.prepared.nonce}</dd></div><div><dt>Chain</dt><dd>{p.prepared.chainId}</dd></div>
        <div><dt>Calldata</dt><dd>{p.prepared.dataBytes} bytes</dd></div><div><dt>Slippage cap</dt><dd>{p.slippageBps / 100}%</dd></div>
      </dl></details>}
      {p.status === "filled" && <div className="fill-details"><dl className="transaction-grid"><div><dt>Tokens received</dt><dd>{p.tokensReceived ?? "—"}</dd></div><div><dt>Gas used</dt><dd>{p.gasUsed ?? "—"}</dd></div>{p.forkBlock !== undefined && <div><dt>Fork block</dt><dd>{p.forkBlock.toLocaleString()}</dd></div>}</dl>{p.txHash && <div className="transaction-hash"><span>{mode === "live" ? "Base transaction" : "Fork tx · not on BaseScan"}</span>{mode === "live" ? <a href={`https://basescan.org/tx/${p.txHash}`} target="_blank" rel="noreferrer" className="mono break-address">{p.txHash}<ExternalLink size={11} /></a> : <code className="break-address">{p.txHash}</code>}</div>}</div>}
      {p.status === "preparing" && <p className="muted text-xs">Preparing an unsigned transaction through the o1 API…</p>}
      {p.status === "executing" && <p className="muted text-xs">{mode === "live" ? "Submitting to Base mainnet…" : "Executing on the local Base fork…"}</p>}
    </article></div>
    {p.status === "awaiting_approval" && <div className="proposal-detail-actions"><Button disabled={!connected || !authorized || killed || busy || !passedFirewall} onClick={() => onDecision(p, "approve")}><Check size={14} />{busy ? "Submitting…" : mode === "live" ? "Approve live buy" : "Approve buy"}</Button><Button variant="outline" disabled={!connected || !authorized || busy} onClick={() => onDecision(p, "reject")}><X size={14} />Reject</Button></div>}
  </>;
}
