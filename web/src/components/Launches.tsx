import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, ExternalLink, Radio, Search } from "lucide-react";
import type { Token } from "../types";
import { age, shortAddress, tokenLabel } from "../lib/utils";
import { Button } from "./ui/button";
import TokenAvatar from "./TokenAvatar";

export default function Launches({ tokens, disabled, pending, onPropose, buyControls }: {
  tokens: Token[]; disabled: boolean; pending: Set<string>; onPropose: (token: Token) => void; buyControls?: ReactNode;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [onlyPassing, setOnlyPassing] = useState(false);
  const filtered = tokens.filter(t => (!onlyPassing || t.screen.pass) && `${t.symbol} ${t.name} ${t.token}`.toLowerCase().includes(query.toLowerCase()));
  return <section className="panel launches-panel" aria-labelledby="launches-heading">
    <header className="panel-header launch-header">
      <div className="panel-title"><Radio size={15} /><h2 id="launches-heading">Launchpad feed</h2><span className="count-badge">{tokens.length}</span></div>
      {buyControls}
    </header>
    <div className="table-toolbar">
      <label className="search-field"><Search size={14} /><span className="sr-only">Search launches</span><input placeholder="Search launches" value={query} onChange={e => setQuery(e.target.value)} /></label>
      <label className="check-control"><input type="checkbox" checked={onlyPassing} onChange={e => setOnlyPassing(e.target.checked)} />Passing only</label>
    </div>
    <div className="table-scroll" tabIndex={0} role="region" aria-label="Launches table, scroll horizontally on small screens" onFocusCapture={event => {
      // Native focus can leave a partially visible control clipped in this scrollport.
      if (event.target !== event.currentTarget) event.target.scrollIntoView({ block: "nearest", inline: "nearest" });
    }}>
      <table className="launches-table">
        <thead><tr><th scope="col">Token / suite</th><th scope="col">Age</th><th scope="col" className="numeric">Trades</th><th scope="col" className="numeric">Traders</th><th scope="col" className="numeric">First 60s</th><th scope="col">Screen</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
        <tbody>{filtered.map(token => <LaunchRow key={token.token} token={token} expanded={expanded.has(token.token)} disabled={disabled || pending.has(`propose:${token.token}`)} onExpand={() => setExpanded(prev => {
          const next = new Set(prev); if (next.has(token.token)) next.delete(token.token); else next.add(token.token); return next;
        })} onPropose={() => onPropose(token)} />)}</tbody>
      </table>
    </div>
    {!filtered.length && <div className="empty-state"><Radio size={22} /><h3>{tokens.length ? "No matching launches" : "Waiting for launches"}</h3><p>{tokens.length ? "Try another search or turn off the passing filter." : "The feed will appear when the indexer delivers launch data."}</p></div>}
    <footer className="panel-footer"><span>{filtered.length} launches</span><span>{tokens.filter(t => t.screen.pass).length} pass safety screening</span></footer>
  </section>;
}

function LaunchRow({ token: t, expanded, disabled, onExpand, onPropose }: { token: Token; expanded: boolean; disabled: boolean; onExpand: () => void; onPropose: () => void }) {
  const detailId = `screen-${t.token}`;
  const label = tokenLabel(t);
  const symbol = t.symbol?.trim();
  const name = t.name?.trim();
  return <><tr className={expanded ? "is-expanded" : undefined}>
    <td><div className="token-cell"><button className="expand-button" onClick={onExpand} aria-expanded={expanded} aria-controls={detailId} aria-label={`${expanded ? "Hide" : "Show"} ${label} safety checks`}>{expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button>
      <TokenAvatar {...t} /><div><a className="token-symbol" href={`https://basescan.org/token/${t.token}`} target="_blank" rel="noreferrer">{label}<ExternalLink size={10} /></a><div className="token-name" title={name || t.token}>{symbol && name ? name : shortAddress(t.token)} <span className="suite-label">{t.suite}</span></div></div></div></td>
    <td className="muted">{age(t.launched_ts)}</td><td className="numeric">{t.trades.toLocaleString()}</td><td className="numeric">{t.unique_traders.toLocaleString()}</td>
    <td className="numeric">{t.unique_traders ? `${Math.round(t.first_minute_traders / t.unique_traders * 100)}%` : "—"}</td>
    <td><button className={`status-pill ${t.screen.pass ? "status-positive" : "status-negative"}`} onClick={onExpand} aria-expanded={expanded} aria-controls={detailId}>{t.screen.pass ? "Pass" : "Fail"} · {t.screen.checks.filter(c => c.pass).length}/5</button></td>
    <td className="launch-actions">{t.screen.pass && <Button variant="outline" size="sm" disabled={disabled} onClick={onPropose}>Propose buy</Button>}</td>
  </tr><tr hidden={!expanded} id={detailId} className="screen-row"><td colSpan={7}><div className="screen-checks">{t.screen.checks.map(check => <div key={check.id} className="screen-check"><span className={check.pass ? "positive" : "negative"}>{check.pass ? "PASS" : "FAIL"}</span><span>{check.label}</span><strong>{check.value}</strong><span className="muted">limit {check.limit}</span></div>)}</div></td></tr></>;
}
