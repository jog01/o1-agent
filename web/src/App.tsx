import { useRef, useState } from "react";
import { Activity, ArrowRight, CheckCircle2, Circle, ExternalLink, LoaderCircle, Power, RefreshCw, ShieldCheck, WifiOff, X } from "lucide-react";
import { request, useAgent } from "./api";
import type { AgentState, Proposal, Token } from "./types";
import { cn, shortAddress, usd } from "./lib/utils";
import { Button } from "./components/ui/button";
import Launches from "./components/Launches";
import Proposals from "./components/Proposals";
import Settings from "./components/Settings";

export default function App() {
  const { state, connection, lastUpdate, refresh } = useAgent();
  const [pending, setPending] = useState<Set<string>>(new Set());
  const inflight = useRef(new Set<string>());
  const [notice, setNotice] = useState<{ text: string; error: boolean }>();
  const [amount, setAmount] = useState("1");
  const connected = connection === "live" || connection === "polling";
  const act = async (key: string, path: string, method: string, body?: unknown, success?: string): Promise<boolean> => {
    if (inflight.current.has(key)) return false;
    inflight.current.add(key); setPending(new Set(inflight.current)); setNotice(undefined);
    try {
      const result = await request<Proposal | null>(path, method, body);
      const failed = result && (result.status === "blocked" || result.status === "failed");
      setNotice({ text: failed ? `${result.symbol || "Proposal"}: ${result.status}. ${result.error ?? result.violations.join("; ")}` : success ?? "Request submitted. Review the proposals queue.", error: Boolean(failed) });
      await refresh();
      return true;
    } catch (error) {
      setNotice({ text: error instanceof Error ? error.message : "Something went wrong. Please retry.", error: true }); return false;
    } finally { inflight.current.delete(key); setPending(new Set(inflight.current)); }
  };
  const propose = (token: Token) => {
    const amountUsd = Number(amount);
    if (!amount.trim() || !Number.isFinite(amountUsd) || amountUsd <= 0) { setNotice({ text: "Enter a buy amount greater than $0.", error: true }); return; }
    if (state?.mode === "live" && !state.policy.requireApproval && !window.confirm(`Propose ${usd(amountUsd)} of ${token.symbol}? Approval is disabled: this can spend real money immediately.`)) return;
    void act(`propose:${token.token}`, "/proposals", "POST", { token: token.token, amountUsd });
  };
  const decide = (proposal: Proposal, decision: "approve" | "reject") => {
    if (decision === "approve" && state?.mode === "live" && !window.confirm(`Approve a real ${usd(proposal.amountUsd)} buy of ${proposal.symbol} on Base mainnet?`)) return;
    void act(`decision:${proposal.id}`, `/proposals/${encodeURIComponent(proposal.id)}/${decision}`, "POST", undefined, decision === "approve" ? "Approval submitted. Check the execution result below." : "Proposal rejected.");
  };
  const scan = () => {
    if (state?.mode === "live" && !state.policy.requireApproval && !window.confirm("Scan may propose and execute a live buy automatically. Continue?")) return;
    void act("scan", "/scan", "POST", undefined, "Scan complete. Check the feed and proposals queue.");
  };
  return <div className="app-shell">
    <a className="skip-link" href="#main">Skip to dashboard</a>
    <header className="topbar">
      <a className="brand" href="/" aria-label="o1 agent dashboard"><img className="brand-logo" src="/brand/o1-wordmark-white.svg" width="55" height="28" alt="o1" /><span className="brand-divider" /><span>agent<span className="brand-subtitle">GUARDED TERMINAL</span></span></a>
      <div className="topbar-status"><span className={cn("mode-badge", state?.mode === "live" && "mode-live")}>{state?.mode.toUpperCase() ?? "CONNECTING"}</span><span className="mode-description">{state?.mode === "live" ? "Base mainnet · real money" : state?.mode === "fork" ? "Signed execution · local fork" : "Local Base fork · no real money"}</span></div>
      <div className="topbar-controls"><span className={cn("connection-label", !connected && "negative")} title={lastUpdate ? `Last snapshot: ${new Date(lastUpdate).toLocaleTimeString()}` : "Waiting for first snapshot"}>{connected ? <Circle size={7} fill="currentColor" /> : <WifiOff size={13} />}{connection === "live" ? "Live feed" : connection === "polling" ? "Polling · 5s" : connection === "connecting" ? "Connecting" : "Disconnected"}</span><Button variant="destructive" className={cn("kill-switch", state?.policy.killSwitch && "is-killed")} disabled={!state || !connected || pending.has("kill")} aria-pressed={state?.policy.killSwitch ?? false} onClick={() => {
        if (!state) return;
        void act("kill", "/kill", "POST", { on: !state.policy.killSwitch }, state.policy.killSwitch ? "Kill switch released. Trading follows your policy." : "Kill switch on. Pending approvals cancelled; new buys blocked.");
      }}><Power size={15} />{pending.has("kill") ? "Updating…" : state?.policy.killSwitch ? "KILL SWITCH ON" : "KILL SWITCH"}</Button></div>
    </header>
    {state?.mode === "live" && <div className="live-banner" role="alert">LIVE MODE — Approved trades spend real money on Base mainnet.</div>}
    {state?.policy.killSwitch && <div className="kill-banner" role="status"><Power size={14} />Trading halted. Pending approvals cancelled. Release the kill switch to resume.</div>}
    {!connected && state && <div className="connection-banner" role="alert">Agent connection lost. Displaying the last snapshot; trading controls are disabled until reconnect.</div>}
    {state && !state.policy.requireApproval && <div className="approval-banner" role="status">Human approval is disabled. Proposals can execute automatically within your policy limits.</div>}
    <main id="main" className="dashboard">
      <div className="page-heading"><div><div className="eyebrow">O1 LAUNCHPAD / BASE</div><h1>Watch the launch. Guard the trade.</h1><p>A live on-chain feed. A hard policy. You stay in control.</p></div><Button disabled={!state || !connected || state.policy.killSwitch || pending.has("scan")} onClick={scan}><RefreshCw size={14} className={pending.has("scan") ? "animate-spin" : undefined} />{pending.has("scan") ? "Scanning…" : "Scan now"}</Button></div>
      {notice && <div className={cn("notice", notice.error && "notice-error")} role={notice.error ? "alert" : "status"}><span>{notice.text}</span><Button variant="ghost" size="icon" onClick={() => setNotice(undefined)} aria-label="Dismiss message"><X size={14} /></Button></div>}
      {!state ? <section className="panel loading-panel" aria-live="polite">{connection === "disconnected" ? <WifiOff size={26} /> : <LoaderCircle size={26} className="animate-spin" />}<h2>{connection === "disconnected" ? "Agent is unreachable" : "Connecting to your agent"}</h2><p>{connection === "disconnected" ? "Check that the agent is running on port 8787. Retrying automatically." : "Loading launches, proposals and policy…"}</p><Button variant="outline" onClick={() => void refresh()}>Retry connection</Button></section> : <>
        <Metrics state={state} />
        {!state.apiConfigured && <div className="config-banner"><ShieldCheck size={15} /><span>o1 API is not configured. You can browse and screen launches; preparing a buy will show a configuration error.</span></div>}
        <div className="workspace"><div className="main-column">
          <div className="feed-controls"><span className="muted">Manual proposals</span><label>Buy amount <span className="amount-input"><span>$</span><input type="number" min="0.01" step="0.01" required aria-label="Buy amount in USD" value={amount} onChange={e => setAmount(e.target.value)} disabled={!connected} /></span></label><span className="muted">Policy cap {usd(state.policy.maxPerTradeUsd)}</span></div>
          <Launches tokens={state.tokens} disabled={!connected || state.policy.killSwitch} pending={pending} onPropose={propose} />
          <Proposals proposals={state.proposals} mode={state.mode} killed={state.policy.killSwitch} connected={connected} pending={pending} onDecision={decide} />
          <ActivityLog lines={state.log} />
        </div><Settings policy={state.policy} rules={state.rules} disabled={!connected} pending={pending} onSave={(path, patch) => act(path, `/${path}`, "PATCH", patch, `${path === "policy" ? "Trading policy" : "Safety rules"} saved.`)} /></div>
      </>}
      <section className="how-it-works" aria-label="How it works"><span className="eyebrow">HOW IT WORKS</span><ol>{["Read", "Screen", "Prepare · o1 API", "Firewall", "You approve", "Execute"].map((step, i) => <li key={step}><span className="step-number">0{i + 1}</span>{step}{i < 5 && <ArrowRight size={12} />}</li>)}</ol><span className="muted">{state?.mode === "live" ? "Base mainnet execution" : "Execution stays on a local Base fork"}</span></section>
      <footer className="app-footer"><span>Built on o1 · Guardrails before signatures</span><a href="https://docs.o1.exchange/launchpad/integration/data-ai" target="_blank" rel="noreferrer">Safe agent workflow <ExternalLink size={11} /></a></footer>
    </main>
  </div>;
}

function Metrics({ state }: { state: AgentState }) {
  const percent = state.policy.maxPerDayUsd > 0 ? Math.min(100, state.spentTodayUsd / state.policy.maxPerDayUsd * 100) : 0;
  return <section className="metrics-strip" aria-label="Agent status">
    <div className="metric"><span className="metric-label">Signer</span><span className="metric-value mono" title={state.signer || "Not configured"}>{shortAddress(state.signer)}</span><span className="metric-note">{state.mode === "demo" ? "Impersonated on fork" : state.mode === "fork" ? "Signs on local fork" : "Signs on Base mainnet"}</span></div>
    <div className="metric"><span className="metric-label">Indexer</span><span className={cn("metric-value", state.indexerOk ? "positive" : "negative")}><Circle size={7} fill="currentColor" />{state.indexerOk ? "Connected" : "Offline"}</span><span className="metric-note">{state.tokens.length} indexed launches</span></div>
    <div className="metric spend-metric"><span className="metric-label">Today’s spend <span className="muted">/ daily cap</span></span><span className="metric-value">{usd(state.spentTodayUsd)}<span className="muted">/ {usd(state.policy.maxPerDayUsd)}</span></span><div className="spend-track" role="progressbar" aria-label="Daily cap used" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${percent}%` }} /></div></div>
    <div className="metric"><span className="metric-label">Human approval</span><span className="metric-value">{state.policy.requireApproval ? <><ShieldCheck size={15} />Required</> : "Automatic"}</span><span className="metric-note">{state.policy.autoPropose ? "Auto-propose enabled" : "Manual proposals only"}</span></div>
  </section>;
}

function ActivityLog({ lines }: { lines: AgentState["log"] }) {
  const [paused, setPaused] = useState(false);
  const [snapshot, setSnapshot] = useState(lines);
  const shown = [...(paused ? snapshot : lines)].sort((a, b) => b.ts - a.ts);
  return <section className="panel activity-panel" aria-labelledby="activity-heading"><header className="panel-header"><div className="panel-title"><Activity size={15} /><h2 id="activity-heading">Activity</h2><span className="count-badge">{paused ? "Paused" : "Streaming"}</span></div><Button variant="ghost" size="sm" onClick={() => { if (!paused) setSnapshot(lines); setPaused(!paused); }}>{paused ? "Resume" : "Pause"}</Button></header><div className="activity-list" role="log" aria-live="off" aria-label="Agent activity, newest first">{!shown.length && <p className="empty-log">No activity yet. Events appear here as the agent works.</p>}{shown.slice(0, 100).map((line, i) => <div className={`log-line log-${line.level}`} key={`${line.ts}-${i}`}><time dateTime={new Date(line.ts).toISOString()}>{new Date(line.ts).toLocaleTimeString([], { hour12: false })}</time><span className="log-level">{line.level === "action" ? <CheckCircle2 size={11} /> : <Circle size={6} fill="currentColor" />}{line.level}</span><span>{line.msg}</span></div>)}</div></section>;
}
