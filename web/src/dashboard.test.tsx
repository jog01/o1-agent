import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import sample from "../../docs/sample-state.json";
import App from "./App";
import { request, useAgent } from "./api";
import Settings from "./components/Settings";
import Proposals from "./components/Proposals";
import { weiToEth } from "./lib/utils";
import type { AgentState, Proposal } from "./types";

class Stream extends EventTarget {
  static current: Stream;
  onerror: (() => void) | null = null;
  close = vi.fn();
  constructor(public url: string) { super(); Stream.current = this; }
  state(value: AgentState) { this.dispatchEvent(new MessageEvent("state", { data: JSON.stringify(value) })); }
}

const fixture = () => structuredClone(sample) as AgentState;
const proposal = (): Proposal => ({
  id: "test-proposal", createdAt: Date.now(), token: fixture().tokens[0].token,
  symbol: "TEST", name: "Test token", amountUsd: 1, amountEth: 0.0003, slippageBps: 500,
  signer: "0x0000000000000000000000000000000000000001", source: "user", status: "awaiting_approval", violations: [],
  prepared: { to: "0x0000000000000000000000000000000000000002", valueWei: "300000000000000", gas: "180000", nonce: 1, chainId: 8453, dataBytes: 100 },
});
const response = (body: unknown, ok = true) => ({ ok, status: ok ? 200 : 400, json: async () => body }) as Response;

beforeEach(() => { vi.stubGlobal("EventSource", Stream); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("agent connection", () => {
  it("falls back to polling on SSE failure and recovers to streaming", async () => {
    const fetcher = vi.fn().mockResolvedValue(response(fixture())); vi.stubGlobal("fetch", fetcher);
    const { result, unmount } = renderHook(() => useAgent());
    await waitFor(() => expect(result.current.connection).toBe("polling"));
    act(() => Stream.current.state(fixture()));
    expect(result.current.connection).toBe("live");
    fetcher.mockRejectedValue(new Error("offline"));
    await act(async () => { Stream.current.onerror?.(); });
    expect(result.current.connection).toBe("disconnected");
    expect(result.current.state?.tokens.length).toBeGreaterThan(0);
    act(() => Stream.current.state(fixture()));
    expect(result.current.connection).toBe("live");
    unmount(); expect(Stream.current.close).toHaveBeenCalledOnce();
  });

  it("does not let a slow HTTP snapshot overwrite a newer SSE snapshot", async () => {
    let finish!: (value: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(resolve => { finish = resolve; })));
    const { result } = renderHook(() => useAgent());
    const next = fixture(); next.policy.killSwitch = true;
    act(() => Stream.current.state(next));
    await act(async () => { finish(response(fixture())); });
    expect(result.current.state?.policy.killSwitch).toBe(true);
  });

  it("polls every five seconds when SSE is unsupported", async () => {
    vi.useFakeTimers(); vi.stubGlobal("EventSource", undefined);
    const fetcher = vi.fn().mockResolvedValue(response(fixture())); vi.stubGlobal("fetch", fetcher);
    renderHook(() => useAgent());
    await act(async () => {});
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

describe("guarded actions", () => {
  it("keeps drafts across live updates and saves only changed policy fields", async () => {
    const state = fixture(); const onSave = vi.fn().mockResolvedValue(true);
    const props = { policy: state.policy, rules: state.rules, pending: new Set<string>(), disabled: false, onSave };
    const { rerender } = render(<Settings {...props} />);
    fireEvent.change(screen.getByLabelText("Per-trade cap · USD"), { target: { value: "0.5" } });
    rerender(<Settings {...props} policy={{ ...state.policy, maxPerTradeUsd: 2, maxPerDayUsd: 10 }} />);
    expect((screen.getByLabelText("Per-trade cap · USD") as HTMLInputElement).value).toBe("0.5");
    fireEvent.click(screen.getByRole("button", { name: "Save policy" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith("policy", { maxPerTradeUsd: 0.5 }));
  });

  it("never enables approval with firewall violations or a halted agent", () => {
    const onDecision = vi.fn(); const p = proposal(); p.violations = ["Contract not allowed"];
    const props = { proposals: [p], mode: "demo" as const, killed: false, connected: true, pending: new Set<string>(), onDecision };
    const { rerender } = render(<Proposals {...props} />);
    expect((screen.getByRole("button", { name: "Approve buy" }) as HTMLButtonElement).disabled).toBe(true);
    rerender(<Proposals {...props} proposals={[proposal()]} killed />);
    expect((screen.getByRole("button", { name: "Approve buy" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Reject" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("labels fork fills without linking their hashes to mainnet", () => {
    const p = { ...proposal(), status: "filled" as const, txHash: "0xabcdef", tokensReceived: "2.73", gasUsed: "12345", forkBlock: 123 };
    render(<Proposals proposals={[p]} mode="demo" killed={false} connected pending={new Set()} onDecision={vi.fn()} />);
    expect(screen.getByText("Fork tx · not on BaseScan")).toBeTruthy();
    expect(screen.getByText("2.73")).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("posts a manual amount and exposes API errors instead of pretending success", async () => {
    const state = fixture(); state.proposals = [];
    const fetcher = vi.fn(async (url: string) => url === "/api/state" ? response(state) : response({ error: "O1_API_TOKEN is not set" }, false));
    vi.stubGlobal("fetch", fetcher);
    render(<App />);
    await screen.findByRole("heading", { name: "Launchpad feed" });
    fireEvent.change(screen.getByLabelText("Buy amount in USD"), { target: { value: "2" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Propose buy" })[0]);
    await screen.findByText("O1_API_TOKEN is not set");
    const call = fetcher.mock.calls.find(([url]) => url === "/api/proposals") as unknown as [string, RequestInit];
    expect(JSON.parse(String(call[1].body))).toEqual({ token: state.tokens[0].token, amountUsd: 2 });
    await act(async () => { Stream.current.onerror?.(); });
  });

  it("surfaces server error messages and formats wei without precision loss", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ error: "Kill switch is on" }, false)));
    await expect(request("/scan", "POST")).rejects.toThrow("Kill switch is on");
    expect(weiToEth("1000000000000000001")).toBe("1.000000000000000001");
  });
});
