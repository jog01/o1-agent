import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentState } from "./types";

export async function request<T>(path: string, method = "GET", body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method, signal: signal ?? AbortSignal.timeout(30_000), cache: "no-store",
    ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new Error(result?.error ?? `Request failed (${response.status})`);
  return result as T;
}

export type Connection = "connecting" | "live" | "polling" | "disconnected";

export function useAgent() {
  const [state, setState] = useState<AgentState>();
  const [connection, setConnection] = useState<Connection>("connecting");
  const [lastUpdate, setLastUpdate] = useState<number>();
  const refreshRef = useRef<() => Promise<void>>(async () => {});
  const refresh = useCallback(() => refreshRef.current(), []);

  useEffect(() => {
    let disposed = false;
    let source: EventSource | undefined;
    let streaming = false;
    let heartbeat = 0;
    let revision = 0;
    let requestId = 0;
    const controller = new AbortController();
    const accept = (next: AgentState) => {
      if (disposed) return;
      setState(next);
      setLastUpdate(Date.now());
    };
    const poll = async () => {
      const startedRevision = revision;
      const id = ++requestId;
      try {
        const next = await request<AgentState>("/state", "GET", undefined, AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]));
        if (disposed || id !== requestId || startedRevision !== revision) return;
        accept(next);
        setConnection(streaming ? "live" : "polling");
      } catch {
        if (!disposed && id === requestId && !streaming) setConnection("disconnected");
      }
    };
    refreshRef.current = poll;
    void poll();
    if (typeof EventSource !== "undefined") {
      source = new EventSource("/api/events");
      source.addEventListener("state", (event) => {
        try {
          const next = JSON.parse((event as MessageEvent).data) as AgentState;
          if (!next.policy || !Array.isArray(next.tokens)) throw new Error("Invalid state");
          revision++;
          streaming = true;
          heartbeat = Date.now();
          accept(next);
          setConnection("live");
        } catch { streaming = false; void poll(); }
      });
      source.addEventListener("ping", () => { heartbeat = Date.now(); });
      source.onerror = () => { streaming = false; void poll(); };
    }
    const interval = window.setInterval(() => {
      if (streaming && Date.now() - heartbeat > 35_000) streaming = false;
      if (!streaming) void poll();
    }, 5_000);
    return () => { disposed = true; controller.abort(); source?.close(); window.clearInterval(interval); };
  }, []);
  return { state, connection, lastUpdate, refresh };
}
