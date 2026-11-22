import { useEffect, useRef, useState } from "react";
import { Activity, CheckCircle2, Circle, Ellipsis, ExternalLink, LoaderCircle, Power, RefreshCw, RotateCcw, ShieldCheck, WifiOff, X } from "lucide-react";
import { ApiError, getApproverToken, request, saveApproverToken, useAgent } from "./api";
import type { AgentState, Proposal, Token } from "./types";
import { cn, shortAddress, tokenLabel, usd } from "./lib/utils";
import { Button } from "./components/ui/button";
import Launches from "./components/Launches";
import Proposals from "./components/Proposals";
import Settings from "./components/Settings";
import Navigation, { useNavigation } from "./components/Navigation";
import { Dialog } from "./components/ui/dialog";

export default function App() {
  const { state, connection, lastUpdate, refresh } = useAgent();
  const [tab, navigate] = useNavigation();
  const [resetEpoch, setResetEpoch] = useState(0);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetError, setResetError] = useState("");
  const accountMenu = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const closeMenu = (event: PointerEvent) => {
      if (!resetOpen && event.target instanceof Node && accountMenu.current && !accountMenu.current.contains(event.target)) accountMenu.current.open = false;
    };
    document.addEventListener("pointerdown", closeMenu);
    return () => document.removeEventListener("pointerdown", closeMenu);
  }, [resetOpen]);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const inflight = useRef(new Set<string>());
  const [notice, setNotice] = useState<{ text: string; error: boolean }>();
  const [amount, setAmount] = useState("1");
  const [approverToken, setApproverToken] = useState(getApproverToken);
  const [tokenDraft, setTokenDraft] = useState("");
  const [editingToken, setEditingToken] = useState(false);
  const connected = connection === "live" || connection === "polling";
  const ready = connected && !pending.has("reset");
  const authorized = !state?.approverTokenRequired || Boolean(approverToken);
  const act = async (key: string, path: string, method: string, body?: unknown, success?: string, onError?: (message: string) => void): Promise<boolean> => {
    if (inflight.current.has(key) || inflight.current.has("reset") || (key === "reset" && inflight.current.size > 0)) return false;
    inflight.current.add(key); setPending(new Set(inflight.current)); setNotice(undefined);
    try {
      const result = await request<Proposal | null>(path, method, body);
      const failed = result && (result.status === "blocked" || result.status === "failed");
      setNotice({ text: failed ? `${result.symbol || "Proposal"}: ${result.status}. ${result.error ?? result.violations.join("; ")}` : success ?? "Request submitted. Review the proposals queue.", error: Boolean(failed) });
      await refresh();
      return true;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        saveApproverToken(""); setApproverToken(""); setEditingToken(true);
      }
      const message = error instanceof Error ? error.message : "Something went wrong. Please retry.";
      setNotice({ text: message, error: true }); onError?.(message); return false;
    } finally { inflight.current.delete(key); setPending(new Set(inflight.current)); }
  };
  const propose = (token: Token) => {
    const amountUsd = Number(amount);
    if (!amount.trim() || !Number.isFinite(amountUsd) || amountUsd < 0.01 || Math.abs(amountUsd * 100 - Math.round(amountUsd * 100)) > 1e-8) { setNotice({ text: "Enter a buy amount of at least $0.01, in whole cents.", error: true }); return; }
    if (state?.mode === "live" && !state.policy.requireApproval && !window.confirm(`Propose ${usd(amountUsd)} of ${tokenLabel(token)}? Approval is disabled: this can spend real money immediately.`)) return;
    void act(`propose:${token.token}`, "/proposals", "POST", { token: token.token, amountUsd }).then(ok => { if (ok) navigate("proposals"); });
  };
  const decide = (proposal: Proposal, decision: "approve" | "reject") => {
    if (decision === "approve" && state?.mode === "live" && !window.confirm(`Approve a real ${usd(proposal.amountUsd)} buy of ${tokenLabel(proposal)} on Base mainnet?`)) return;
    void act(`decision:${proposal.id}`, `/proposals/${encodeURIComponent(proposal.id)}/${decision}`, "POST", undefined, decision === "approve" ? "Approval submitted. Check the execution result below." : "Proposal rejected.");
  };
  const scan = () => {
    if (state?.mode === "live" && !state.policy.requireApproval && !window.confirm("Scan may propose and execute a live buy automatically. Continue?")) return;
    void act("scan", "/scan", "POST", undefined, "Scan complete. Check the feed and proposals queue.");
  };
  const resetDemo = async () => {
    if (state?.mode !== "demo" || !ready || !authorized || inflight.current.size > 0) return;
    setResetError("");
    if (await act("reset", "/demo/reset", "POST", undefined, "Demo reset.", setResetError)) {
      setAmount("1"); setResetEpoch(epoch => epoch + 1); setResetOpen(false);
    }
  };
  return <div className="app-shell tabbed-shell">
    <a className="skip-link" href="#main">Skip to dashboard</a>
    <header className="topbar app-navbar">
      <a className="brand" href="#proposals" onClick={event => { event.preventDefault(); navigate("proposals"); }} aria-label="Sequa for o1"><img className="brand-logo" src="/brand/o1-wordmark-white.svg" width="55" height="28" alt="o1" /><span className="brand-divider" /><span>Sequa</span></a>
      <Navigation tab={tab} pending={state?.proposals.filter(p => p.status === "awaiting_approval").length ?? 0} onNavigate={navigate} />
      <div className="navbar-actions">
        <span className={cn("mode-badge nav-mode", state?.mode === "live" && "mode-live")}>{state?.mode ?? "Connecting"}</span>
        <span className={cn("connection-label", !connected && "negative")} title={lastUpdate ? `Last snapshot: ${new Date(lastUpdate).toLocaleTimeString()}` : "Waiting for first snapshot"} aria-label={`Agent ${connection === "live" ? "connected" : connection}`}>{connected ? <Circle size={7} fill="currentColor" /> : <WifiOff size={13} />}<span className="connection-text">{connection === "live" ? "Connected" : connection === "polling" ? "Polling" : connection === "connecting" ? "Connecting" : "Offline"}</span></span>
        <Button variant="destructive" className={cn("kill-switch", state?.policy.killSwitch && "is-killed")} disabled={!state || !ready || pending.has("kill") || (state.policy.killSwitch && !authorized)} aria-label={state?.policy.killSwitch ? "Release kill switch" : "Activate kill switch"} aria-pressed={state?.policy.killSwitch ?? false} onClick={() => {
        if (!state) return;
        void act("kill", "/kill", "POST", { on: !state.policy.killSwitch }, state.policy.killSwitch ? "Kill switch released. Trading follows your policy." : "Kill switch on. Pending approvals cancelled; new buys blocked.");
        }}><Power size={15} /><span className="kill-label">{pending.has("kill") ? "Updating…" : state?.policy.killSwitch ? "Trading halted" : "Kill switch"}</span><span className="kill-label-compact" aria-hidden="true">{pending.has("kill") ? "…" : state?.policy.killSwitch ? "Resume" : "Stop"}</span></Button>
        <details ref={accountMenu} className="account-menu terminal-menu" onKeyDown={event => { if (event.key === "Escape") { event.currentTarget.open = false; event.currentTarget.querySelector("summary")?.focus(); } }}>
          <summary aria-label="Account menu"><Ellipsis size={19} /></summary>
          <div className="account-menu-panel terminal-menu-panel">
            <div className="account-menu-heading"><strong>{state?.mode === "demo" ? "Demo account" : "Trading account"}</strong><span className="muted">{state?.mode === "live" ? "Base mainnet · real money" : "Local Base fork · no real money"}</span></div>
            {state && <dl className="account-menu-details"><div><dt>Signer</dt><dd className="mono" title={state.signer}>{shortAddress(state.signer)}</dd></div><div><dt>Spent today</dt><dd>{usd(state.spentTodayUsd)} / {usd(state.policy.maxPerDayUsd)}</dd></div><div><dt>Indexer</dt><dd>{state.indexerOk ? "Connected" : "Offline"}</dd></div></dl>}
            {state?.mode === "demo" && <><hr /><Button variant="outline" disabled={!ready || !authorized || pending.size > 0} onClick={() => { setResetError(""); setResetOpen(true); }}><RotateCcw size={14} />Reset demo</Button></>}
          </div>
        </details>
      </div>
    </header>
    {state?.mode === "demo" && <Dialog open={resetOpen} onClose={() => setResetOpen(false)} busy={pending.has("reset")} className="demo-reset-dialog" labelledBy="reset-heading">
      <h2 id="reset-heading">Reset demo account?</h2>
      <p className="demo-reset-copy">This clears demo proposals and activity, resets today's spend and the Base fork, and restores the default policy. No real funds are affected.</p>
      {resetError && <p className="proposal-error negative" role="alert">{resetError}</p>}
      <div className="demo-reset-actions"><Button variant="ghost" autoFocus disabled={pending.has("reset")} onClick={() => setResetOpen(false)}>Cancel</Button><Button disabled={!ready || !authorized || pending.size > 0} onClick={() => void resetDemo()}>{pending.has("reset") ? <LoaderCircle size={14} className="animate-spin" /> : <RotateCcw size={14} />}{pending.has("reset") ? "Resetting…" : "Reset demo"}</Button></div>
    </Dialog>}
    {state?.mode === "live" && <div className="live-banner" role="alert">LIVE MODE — Approved trades spend real money on Base mainnet.</div>}
    {state?.policy.killSwitch && <div className="kill-banner" role="status"><Power size={14} />Trading halted. Pending approvals cancelled. Release the kill switch to resume.</div>}
    {!connected && state && <div className="connection-banner" role="alert">Agent connection lost. Displaying the last snapshot; trading controls are disabled until reconnect.</div>}
    {state && !state.policy.requireApproval && <div className="approval-banner" role="status">Human approval is disabled. Proposals can execute automatically within your policy limits.</div>}
    <main id="main" className="dashboard tabbed-dashboard terminal-workspace" tabIndex={-1}>
      <div className="terminal-page-heading"><div><h1>{tab[0].toUpperCase() + tab.slice(1)}</h1><p>{({ proposals: "Review before you sign.", feed: "New launches on o1, screened against your rules.", policy: "Your limits. Enforced before every signature.", activity: "A live record of what your agent is doing." })[tab]}</p></div></div>
      {notice && <div className={cn("notice", notice.error && "notice-error")} role={notice.error ? "alert" : "status"}><span>{notice.text}</span><Button variant="ghost" size="icon" onClick={() => setNotice(undefined)} aria-label="Dismiss message"><X size={14} /></Button></div>}
      {(state?.approverTokenRequired || editingToken) && <section className="approver-panel panel" aria-label="Approver access">{!approverToken || editingToken ? <form className="approver-form" onSubmit={event => {
        event.preventDefault(); const token = tokenDraft.trim(); if (!token) return;
        saveApproverToken(token); setApproverToken(token); setTokenDraft(""); setEditingToken(false);
      }}><div><strong>Approver access</strong><p className="muted">Enter your approver token to approve, reject or edit limits. Saved in this browser only.</p></div><label className="sr-only" htmlFor="approver-token">Approver token</label><input id="approver-token" type="password" autoComplete="off" spellCheck={false} required value={tokenDraft} onChange={event => setTokenDraft(event.target.value)} placeholder="Approver token" /><Button type="submit" disabled={!tokenDraft.trim()}>Save token</Button>{editingToken && approverToken && <Button variant="ghost" onClick={() => { setEditingToken(false); setTokenDraft(""); }}>Cancel</Button>}</form> : <div className="approver-form"><span className="muted">Approver token saved on this browser.</span><Button variant="ghost" onClick={() => setEditingToken(true)}>Change token</Button><Button variant="ghost" onClick={() => { saveApproverToken(""); setApproverToken(""); }}>Forget token</Button></div>}</section>}
      {!state ? <section className="panel loading-panel" aria-live="polite">{connection === "disconnected" ? <WifiOff size={26} /> : <LoaderCircle size={26} className="animate-spin" />}<h2>{connection === "disconnected" ? "Agent is unreachable" : "Connecting to your agent"}</h2><p>{connection === "disconnected" ? "Check that the agent is running on port 8787. Retrying automatically." : "Loading launches, proposals and policy…"}</p><Button variant="outline" onClick={() => void refresh()}>Retry connection</Button></section> : <>
        {!state.apiConfigured && <div className="config-banner"><ShieldCheck size={15} /><span>o1 API is not configured. You can browse and screen launches; preparing a buy will show a configuration error.</span></div>}
        <div id="panel-proposals" role="tabpanel" aria-labelledby="tab-proposals" hidden={tab !== "proposals"} key={`proposals-${resetEpoch}`}>
          <div className="terminal-context"><span>Spent today <strong>{usd(state.spentTodayUsd)} / {usd(state.policy.maxPerDayUsd)}</strong></span><span>Per trade <strong>{usd(state.policy.maxPerTradeUsd)}</strong></span><span>Approval <strong>{state.policy.requireApproval ? "Required" : "Automatic"}</strong></span></div>
          <Proposals proposals={state.proposals} tokens={state.tokens} mode={state.mode} killed={state.policy.killSwitch} connected={ready} authorized={authorized} pending={pending} onDecision={decide} onViewFeed={() => navigate("feed")} active={tab === "proposals"} />
        </div>
        <div id="panel-feed" role="tabpanel" aria-labelledby="tab-feed" hidden={tab !== "feed"}>
          <div className="terminal-context"><span>Indexer <strong className={state.indexerOk ? "positive" : "negative"}>{state.indexerOk ? "Connected" : "Offline"}</strong></span><span><strong>{state.tokens.length}</strong> launches</span></div>
          <Launches tokens={state.tokens} disabled={!ready || !authorized || state.policy.killSwitch} pending={pending} onPropose={propose} buyControls={<div className="feed-controls"><label>Buy amount <span className="amount-input"><span>$</span><input type="number" min="0.01" step="0.01" required aria-label="Buy amount in USD" value={amount} onChange={e => setAmount(e.target.value)} disabled={!ready} /></span></label><span className="muted">Max {usd(state.policy.maxPerTradeUsd)}</span><Button variant="outline" size="sm" disabled={!ready || !authorized || state.policy.killSwitch || pending.has("scan")} onClick={scan}><RefreshCw size={14} className={pending.has("scan") ? "animate-spin" : undefined} />{pending.has("scan") ? "Scanning…" : "Scan now"}</Button></div>} />
        </div>
        <div id="panel-policy" role="tabpanel" aria-labelledby="tab-policy" hidden={tab !== "policy"} key={`policy-${resetEpoch}`}>
          <div className="terminal-context"><span>Signer <strong className="mono" title={state.signer}>{shortAddress(state.signer)}</strong></span><span>{state.mode === "demo" ? "Impersonated on local fork" : state.mode === "fork" ? "Signing on local fork" : "Signing on Base mainnet"}</span></div>
          <Settings policy={state.policy} rules={state.rules} disabled={!ready || !authorized} pending={pending} onSave={(path, patch) => act(path, `/${path}`, "PATCH", patch, `${path === "policy" ? "Trading policy" : "Safety rules"} saved.`)} />
        </div>
        <div id="panel-activity" role="tabpanel" aria-labelledby="tab-activity" hidden={tab !== "activity"} key={`activity-${resetEpoch}`}><ActivityLog lines={state.log} /></div>
      </>}
      <footer className="app-footer"><span>Built on o1 · Guardrails before signatures</span><a href="https://docs.o1.exchange/launchpad/integration/data-ai" target="_blank" rel="noreferrer">Safe agent workflow <ExternalLink size={11} /></a></footer>
    </main>
  </div>;
}

function ActivityLog({ lines }: { lines: AgentState["log"] }) {
  const [paused, setPaused] = useState(false);
  const [snapshot, setSnapshot] = useState(lines);
  const shown = [...(paused ? snapshot : lines)].sort((a, b) => b.ts - a.ts);
  return <section className="panel activity-panel" aria-labelledby="activity-heading"><header className="panel-header"><div className="panel-title"><Activity size={15} /><h2 id="activity-heading">Activity</h2><span className="count-badge">{paused ? "Paused" : "Streaming"}</span></div><Button variant="ghost" size="sm" onClick={() => { if (!paused) setSnapshot(lines); setPaused(!paused); }}>{paused ? "Resume" : "Pause"}</Button></header><div className="activity-list" role="log" aria-live="off" aria-label="Agent activity, newest first">{!shown.length && <p className="empty-log">No activity yet. Events appear here as the agent works.</p>}{shown.slice(0, 100).map((line, i) => <div className={`log-line log-${line.level}`} key={`${line.ts}-${i}`}><time dateTime={new Date(line.ts).toISOString()}>{new Date(line.ts).toLocaleTimeString([], { hour12: false })}</time><span className="log-level">{line.level === "action" ? <CheckCircle2 size={11} /> : <Circle size={6} fill="currentColor" />}{line.level}</span><span>{line.msg}</span></div>)}</div></section>;
}
