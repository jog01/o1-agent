import { useEffect, useRef, useState, type ReactNode } from "react";

/** Native modal gives us focus containment, Escape handling and an inert background. */
export function Dialog({ open, onClose, busy = false, className, labelledBy, children, id }: {
  open: boolean; onClose: () => void; busy?: boolean; className: string; labelledBy: string; children: ReactNode; id?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog || !open) return;
    const previousFocus = document.activeElement;
    dialog.showModal();
    return () => {
      dialog.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, [open]);
  return <dialog ref={ref} id={id} className={className} aria-labelledby={labelledBy} aria-busy={busy || undefined}
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}
  >{children}</dialog>;
}

export function useCompactDetails() {
  const [compact, setCompact] = useState(() => window.matchMedia?.("(max-width: 1099px)").matches ?? false);
  useEffect(() => {
    const query = window.matchMedia?.("(max-width: 1099px)");
    if (!query) return;
    const update = () => setCompact(query.matches);
    update(); query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return compact;
}
