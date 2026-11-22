import { useState, type FormEvent } from "react";
import { LockKeyhole, Settings2, SlidersHorizontal } from "lucide-react";
import type { Policy, Rules } from "../types";
import { shortAddress } from "../lib/utils";
import { Button } from "./ui/button";

type Field = { key: string; label: string; min: number; max?: number; step?: number; hint?: string };
const policyFields: Field[] = [
  { key: "maxPerTradeUsd", label: "Per-trade cap · USD", min: 0.01, step: 0.01 },
  { key: "maxPerDayUsd", label: "Daily cap · USD", min: 0.01, step: 0.01 },
  { key: "maxSlippageBps", label: "Max slippage · bps", min: 0, max: 10000, hint: "100 bps = 1%" },
];
const ruleFields: Field[] = [
  { key: "minUniqueTraders", label: "Min unique traders", min: 0 },
  { key: "minTrades", label: "Min trades", min: 0 },
  { key: "maxSniperShare", label: "Max first-60s share · %", min: 0, max: 100, step: 1 },
  { key: "maxCreatorLaunches", label: "Max creator launches · 7d", min: 0 },
  { key: "maxAgeHours", label: "Max token age · hours", min: 0.01, step: 0.01 },
];

export default function Settings({ policy, rules, disabled, pending, onSave }: {
  policy: Policy; rules: Rules; disabled: boolean; pending: Set<string>;
  onSave: (path: "policy" | "rules", patch: Record<string, unknown>) => Promise<boolean>;
}) {
  return <div className="policy-page-grid" aria-label="Agent settings">
    <SettingsForm kind="policy" value={policy} disabled={disabled} busy={pending.has("policy")} onSave={patch => onSave("policy", patch)} />
    <SettingsForm kind="rules" value={rules} disabled={disabled} busy={pending.has("rules")} onSave={patch => onSave("rules", patch)} />
    <div className="rail-note policy-page-wide"><LockKeyhole size={14} /><p>Limits are enforced by the agent, then checked again against the unsigned transaction. The API routes. It never decides what gets signed.</p></div>
  </div>;
}

function SettingsForm({ kind, value, disabled, busy, onSave }: {
  kind: "policy" | "rules"; value: Policy | Rules; disabled: boolean; busy: boolean;
  onSave: (patch: Record<string, unknown>) => Promise<boolean>;
}) {
  // Keep only changed fields. Streaming snapshots cannot overwrite edits, and saving
  // one field cannot overwrite a setting changed by another client in the meantime.
  const [edits, setEdits] = useState<Record<string, string | boolean>>({});
  const [error, setError] = useState("");
  const fields = kind === "policy" ? policyFields : ruleFields;
  const values = value as unknown as Record<string, number | string[] | boolean>;
  const fieldValue = (key: string): string | boolean => edits[key] ?? (key === "maxSniperShare" ? Number(values[key]) * 100 : Array.isArray(values[key]) ? (values[key] as string[]).join("\n") : values[key]) as string | boolean;
  const contracts = kind === "policy" ? [...new Set(String(fieldValue("allowedTargets")).split(/[\s,]+/).filter(Boolean))] : [];
  const edit = (key: string, next: string | boolean) => setEdits(prev => ({ ...prev, [key]: next }));
  const dirty = Object.keys(edits).length > 0;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const sent = { ...edits };
    const patch: Record<string, unknown> = {};
    for (const [key, raw] of Object.entries(sent)) {
      if (typeof raw === "boolean") { patch[key] = raw; continue; }
      const field = fields.find(f => f.key === key);
      if (field) {
        const number = Number(raw);
        if (!raw.trim() || !Number.isFinite(number) || number < field.min || (field.max !== undefined && number > field.max) || (!field.step && !Number.isInteger(number))) {
          setError(`Enter a valid value for ${field.label.toLowerCase()}.`); return;
        }
        patch[key] = key === "maxSniperShare" ? number / 100 : number;
      } else {
        const addresses = raw.split(/[\s,]+/).filter(Boolean);
        if (addresses.some(a => !/^0x[a-fA-F0-9]{40}$/.test(a))) { setError("Use full 0x addresses, separated by commas or new lines."); return; }
        patch[key] = [...new Set(addresses)];
      }
    }
    if (patch.requireApproval === false && !window.confirm("Disable human approval? Future proposals may execute automatically within the policy limits.")) return;
    setError("");
    if (await onSave(patch)) setEdits(current => Object.fromEntries(Object.entries(current).filter(([key, val]) => sent[key] !== val)));
  };
  return <section className={`panel ${kind}-panel`} aria-labelledby={`${kind}-heading`}>
    <header className="panel-header"><div className="panel-title">{kind === "policy" ? <Settings2 size={15} /> : <SlidersHorizontal size={15} />}<h2 id={`${kind}-heading`}>{kind === "policy" ? "Trading policy" : "Safety screen"}</h2></div>{dirty && <span className="unsaved-badge">Unsaved</span>}</header>
    <form onSubmit={submit} className="settings-form">
      {fields.map(field => <label className="form-field" key={field.key}><span>{field.label}</span><input type="number" name={field.key} min={field.min} max={field.max} step={field.step ?? 1} required value={String(fieldValue(field.key))} onChange={e => edit(field.key, e.target.value)} disabled={disabled || busy} />{field.hint && <small className="muted">{field.hint}</small>}</label>)}
      {kind === "policy" && <>
        <div className="fixed-chain"><span className="muted">Allowed chain</span><span>Base <span className="mono muted">8453</span></span></div>
        <details className="contract-details"><summary><span>Allowed contracts</span><span className="contract-count">{contracts.length} {contracts.length === 1 ? "contract" : "contracts"}</span>{contracts[0] && <span className="contract-preview mono muted">{shortAddress(contracts[0])}{contracts.length > 1 ? ` +${contracts.length - 1}` : ""}</span>}</summary><label className="form-field"><span className="sr-only">Allowed contracts</span><textarea rows={3} spellCheck={false} value={String(fieldValue("allowedTargets"))} onChange={e => edit("allowedTargets", e.target.value)} disabled={disabled || busy} /><small className="muted">One address per line. Empty blocks every contract.</small></label></details>
        <details className="token-lists"><summary>Token allow / deny lists</summary>{[["tokenAllowlist", "Token allowlist"], ["tokenDenylist", "Token denylist"]].map(([key, label]) => <label className="form-field" key={key}><span>{label}</span><textarea rows={2} spellCheck={false} value={String(fieldValue(key))} onChange={e => edit(key, e.target.value)} disabled={disabled || busy} /></label>)}<p className="muted text-xs">An empty allowlist allows tokens that pass screening.</p></details>
        <label className="toggle-field"><span><strong>Require approval</strong><small>You review before signing</small></span><input type="checkbox" role="switch" checked={Boolean(fieldValue("requireApproval"))} onChange={e => edit("requireApproval", e.target.checked)} disabled={disabled || busy} /></label>
        <label className="toggle-field"><span><strong>Auto-propose</strong><small>Queue new launches that pass</small></span><input type="checkbox" role="switch" checked={Boolean(fieldValue("autoPropose"))} onChange={e => edit("autoPropose", e.target.checked)} disabled={disabled || busy} /></label>
      </>}
      {error && <p className="negative text-xs" role="alert">{error}</p>}
      <div className="settings-actions"><Button type="submit" variant="outline" disabled={disabled || busy || !dirty}>{busy ? "Saving…" : kind === "policy" ? "Save policy" : "Save rules"}</Button>{dirty && <Button variant="ghost" disabled={busy} onClick={() => { setEdits({}); setError(""); }}>Discard</Button>}</div>
    </form>
  </section>;
}
