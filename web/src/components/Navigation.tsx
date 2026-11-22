import { useEffect, useLayoutEffect, useState, type KeyboardEvent } from "react";
import { Activity, ClipboardList, Radio, ShieldCheck } from "lucide-react";

const tabs = [
  { id: "proposals", label: "Proposals", icon: ClipboardList },
  { id: "feed", label: "Feed", icon: Radio },
  { id: "policy", label: "Policy", icon: ShieldCheck },
  { id: "activity", label: "Activity", icon: Activity },
] as const;
export type Tab = typeof tabs[number]["id"];

function tabFromHash(): Tab {
  return tabs.find(tab => `#${tab.id}` === window.location.hash)?.id ?? "proposals";
}

export function useNavigation() {
  const [tab, setTab] = useState<Tab>(tabFromHash);
  useLayoutEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, [tab]);
  useEffect(() => {
    const navigate = () => {
      // The skip link must focus the current page, not change tabs.
      if (window.location.hash !== "#main") setTab(tabFromHash());
    };
    window.addEventListener("hashchange", navigate);
    return () => window.removeEventListener("hashchange", navigate);
  }, []);
  const navigate = (next: Tab) => {
    setTab(next);
    if (window.location.hash !== `#${next}`) window.location.hash = next;
  };
  return [tab, navigate] as const;
}

export default function Navigation({ tab, pending, onNavigate }: {
  tab: Tab; pending: number; onNavigate: (tab: Tab) => void;
}) {
  const onKeyDown = (event: KeyboardEvent<HTMLAnchorElement>, index: number) => {
    let next: number;
    if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
    else if (event.key === "ArrowLeft") next = (index + tabs.length - 1) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    else return;
    event.preventDefault();
    onNavigate(tabs[next].id);
    document.getElementById(`tab-${tabs[next].id}`)?.focus();
  };
  return <nav className="primary-nav" aria-label="Dashboard sections">
    <div className="nav-tabs terminal-tabs" role="tablist" aria-label="Dashboard sections">
      {tabs.map(({ id, label, icon: Icon }, index) => <a
        key={id} id={`tab-${id}`} href={`#${id}`} role="tab" aria-selected={tab === id}
        aria-controls={`panel-${id}`} tabIndex={tab === id ? 0 : -1}
        aria-current={tab === id ? "page" : undefined}
        className={`nav-tab terminal-tab${tab === id ? " is-active" : ""}`}
        onClick={event => { event.preventDefault(); onNavigate(id); }}
        onKeyDown={event => onKeyDown(event, index)}
      ><Icon size={17} /><span>{label}</span>{id === "proposals" && pending > 0 && <span className="nav-count terminal-tab-count" aria-label={`${pending} pending`}>{pending}</span>}</a>)}
    </div>
  </nav>;
}
