import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentState } from "./types";

const TOKEN_KEY = "o1-agent.approverToken";
let memoryToken = "";
export function getApproverToken() {
  try { return localStorage.getItem(TOKEN_KEY) ?? memoryToken; } catch { return memoryToken; }
}
export function saveApproverToken(token: string) {
  memoryToken = token;
  try { if (token) localStorage.setItem(TOKEN_KEY, token); else localStorage.removeItem(TOKEN_KEY); } catch { /* Session-only if storage is unavailable. */ }
}
export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

export async function request<T>(path: string, method = "GET", body?: unknown, signal?: AbortSignal): Promise<T> {
  const token = method !== "GET" ? getApproverToken() : "";
  const response = await fetch(`/api${path}`, {
    method, signal: signal ?? AbortSignal.timeout(30_000), cache: "no-store",
    headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(token ? { "x-approver-token": token } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(result?.error ?? `Request failed (${response.status})`, response.status);
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
    let pendingPoll: Promise<void> | undefined;
    const controller = new AbortController();
    const accept = (next: AgentState) => {
      if (disposed) return;
      setState(previous => ({ ...next, approverTokenRequired: next.approverTokenRequired ?? previous?.approverTokenRequired }));
      setLastUpdate(Date.now());
    };
    const poll = (): Promise<void> => {
      if (pendingPoll) return pendingPoll;
      const run = async () => {
        const startedRevision = revision;
        try {
          const next = await request<AgentState>("/state", "GET", undefined, AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]));
          if (disposed || startedRevision !== revision) return;
          accept(next);
          setConnection(streaming ? "live" : "polling");
        } catch {
          if (!disposed && !streaming) setConnection("disconnected");
        }
      };
      pendingPoll = run().finally(() => { pendingPoll = undefined; });
      return pendingPoll;
    };
    refreshRef.current = async () => { await pendingPoll; if (!disposed) await poll(); };
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
