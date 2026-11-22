import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import sample from "../../docs/sample-state.json";
import App from "./App";
import { request, saveApproverToken, useAgent } from "./api";
import Settings from "./components/Settings";
import Proposals from "./components/Proposals";
import TokenAvatar from "./components/TokenAvatar";
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
const response = (body: unknown, ok = true, status = ok ? 200 : 400) => ({ ok, status, json: async () => body }) as Response;

beforeEach(() => {
  vi.stubGlobal("EventSource", Stream); saveApproverToken("");
  window.history.replaceState(null, "", "/");
  // jsdom does not implement the browser's native top-layer dialog behavior.
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: { configurable: true, value(this: HTMLDialogElement) { this.open = true; } },
    close: { configurable: true, value(this: HTMLDialogElement) { this.open = false; } },
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

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

  it("accepts a six-second snapshot instead of invalidating it every five seconds", async () => {
    vi.useFakeTimers(); vi.stubGlobal("EventSource", undefined);
    const fetcher = vi.fn(() => new Promise<Response>(resolve => setTimeout(() => resolve(response(fixture())), 6_000)));
    vi.stubGlobal("fetch", fetcher);
    const { result } = renderHook(() => useAgent());
    await act(async () => { await vi.advanceTimersByTimeAsync(6_000); });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result.current.connection).toBe("polling");
    expect(result.current.state?.tokens.length).toBeGreaterThan(0);
  });
});

describe("guarded actions", () => {
  it.each([401, 503])("keeps a %s decision error visible inside the mobile dialog", async status => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    const state = fixture(); state.approverTokenRequired = true; state.proposals = [proposal()];
    saveApproverToken("test-only-expired-token");
    vi.stubGlobal("fetch", vi.fn(async (url: string) => url === "/api/state" ? response(state) : response({ error: status === 401 ? "approver token required" : "Execution service unavailable" }, false, status)));
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /Review TEST buy/ }));
    const dialog = screen.getByRole("dialog", { name: "Review proposal" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Approve buy" }));
    const error = await within(dialog).findByRole("alert");
    expect(error.textContent).toContain(status === 401 ? "approver token required" : "Execution service unavailable");
    if (status === 401) {
      expect((within(dialog).getByRole("button", { name: "Approve buy" }) as HTMLButtonElement).disabled).toBe(true);
      fireEvent.click(within(dialog).getByRole("button", { name: "Manage approver access" }));
      expect(screen.queryByRole("dialog")).toBeNull();
      await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Approver token")));
    } else {
      await waitFor(() => expect((within(dialog).getByRole("button", { name: "Approve buy" }) as HTMLButtonElement).disabled).toBe(false));
    }
  });

  it("keeps kill-switch state truthful after another client releases it", async () => {
    let state = fixture(); state.policy.killSwitch = false;
    const fetcher = vi.fn(async (url: string) => {
      if (url === "/api/kill") state = { ...state, policy: { ...state.policy, killSwitch: true } };
      return response(state);
    });
    vi.stubGlobal("fetch", fetcher);
    render(<App />);
    await waitFor(() => expect((screen.getByRole("button", { name: "Activate kill switch" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Activate kill switch" }));
    await screen.findByText(/Trading halted\. Pending approvals cancelled\./);
    await waitFor(() => expect((screen.getByRole("button", { name: "Release kill switch" }) as HTMLButtonElement).disabled).toBe(false));
    state = { ...state, policy: { ...state.policy, killSwitch: false } };
    act(() => Stream.current.state(state));
    expect(screen.getByRole("button", { name: "Activate kill switch" }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.queryByText(/Trading halted\.|Kill switch on\./)).toBeNull();
  });

  it("counts passing launches within the current feed filters", async () => {
    window.history.replaceState(null, "", "/#feed");
    const state = fixture();
    state.tokens = [
      { ...state.tokens[0], symbol: "PASS", name: "Passing launch", screen: { pass: true, checks: [] } },
      { ...state.tokens[0], token: "0x0000000000000000000000000000000000000099", symbol: "FAIL", name: "Failing launch", screen: { pass: false, checks: [] } },
    ];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(state)));
    render(<App />);
    await screen.findByText("2 launches");
    fireEvent.change(screen.getByPlaceholderText("Search launches"), { target: { value: "FAIL" } });
    expect(screen.getByText("1 launches")).toBeTruthy();
    expect(screen.getByText("0 pass safety screening")).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: "Passing only" }));
    expect(screen.getByText("0 launches")).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText("Search launches"), { target: { value: "" } });
    expect(screen.getByText("1 launches")).toBeTruthy();
    expect(screen.getByText("1 pass safety screening")).toBeTruthy();
  });

  it("unlocks protected actions with a saved token and re-locks after a 401", async () => {
    const state = fixture(); state.approverTokenRequired = true; state.proposals = [proposal()];
    const fetcher = vi.fn(async (url: string, _options?: RequestInit) => url === "/api/state" ? response(state) : response({ error: "approver token required" }, false, 401));
    vi.stubGlobal("fetch", fetcher);
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /Review TEST buy/ }));
    const approve = await screen.findByRole("button", { name: "Approve buy" });
    expect((approve as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Approver token"), { target: { value: "test-only-approver" } });
    fireEvent.click(screen.getByRole("button", { name: "Save token" }));
    expect((approve as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(approve);
    await within(screen.getByRole("complementary", { name: "Review proposal" })).findByText("approver token required");
    expect((approve as HTMLButtonElement).disabled).toBe(true);
    const headers = fetcher.mock.calls.find(([url]) => url.endsWith("/approve"))?.[1]?.headers as Record<string, string>;
    expect(headers["x-approver-token"]).toBe("test-only-approver");
    expect(localStorage.getItem("o1-agent.approverToken")).toBeNull();
  });

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
    fireEvent.click(screen.getByRole("button", { name: /Review TEST buy/ }));
    expect((screen.getByRole("button", { name: "Approve buy" }) as HTMLButtonElement).disabled).toBe(true);
    rerender(<Proposals {...props} proposals={[proposal()]} killed />);
    expect((screen.getByRole("button", { name: "Approve buy" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Reject" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("labels fork fills without linking their hashes to mainnet", () => {
    const p = { ...proposal(), status: "filled" as const, txHash: "0xabcdef", tokensReceived: "2.73", gasUsed: "12345", forkBlock: 123 };
    render(<Proposals proposals={[p]} mode="demo" killed={false} connected pending={new Set()} onDecision={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Review TEST buy/ }));
    expect(screen.getByText("Fork tx · not on BaseScan")).toBeTruthy();
    expect(screen.getByText("2.73")).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("posts a manual amount and exposes API errors instead of pretending success", async () => {
    const state = fixture(); state.proposals = [];
    const fetcher = vi.fn(async (url: string) => url === "/api/state" ? response(state) : response({ error: "O1_API_TOKEN is not set" }, false));
    vi.stubGlobal("fetch", fetcher);
    render(<App />);
    fireEvent.click(screen.getByRole("tab", { name: "Feed" }));
    await screen.findByRole("heading", { name: "Launchpad feed" });
    fireEvent.change(screen.getByLabelText("Buy amount in USD"), { target: { value: "2" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Propose buy" })[0]);
    await screen.findByText("O1_API_TOKEN is not set");
    const call = fetcher.mock.calls.find(([url]) => url === "/api/proposals") as unknown as [string, RequestInit];
    expect(JSON.parse(String(call[1].body))).toEqual({ token: state.tokens[0].token, amountUsd: 2 });
    await act(async () => { Stream.current.onerror?.(); });
  });

  it("refuses sub-cent buys before sending a proposal", async () => {
    const state = fixture(); state.proposals = [];
    const fetcher = vi.fn().mockResolvedValue(response(state)); vi.stubGlobal("fetch", fetcher);
    render(<App />);
    fireEvent.click(screen.getByRole("tab", { name: "Feed" }));
    await screen.findByRole("heading", { name: "Launchpad feed" });
    fireEvent.change(screen.getByLabelText("Buy amount in USD"), { target: { value: "0.001" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Propose buy" })[0]);
    expect(screen.getByText("Enter a buy amount of at least $0.01, in whole cents.")).toBeTruthy();
    expect(fetcher.mock.calls.some(([url]) => url === "/api/proposals")).toBe(false);
  });

  it("surfaces server error messages and formats wei without precision loss", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ error: "Kill switch is on" }, false)));
    await expect(request("/scan", "POST")).rejects.toThrow("Kill switch is on");
    expect(weiToEth("1000000000000000001")).toBe("1.000000000000000001");
  });
});

describe("tabbed workspace", () => {
  it("restores hash navigation, browser history and unsaved policy drafts", async () => {
    window.history.replaceState(null, "", "#policy");
    const state = fixture(); state.proposals = [proposal()];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(state)));
    render(<App />);
    const cap = await screen.findByLabelText("Per-trade cap · USD");
    expect(screen.getByRole("tabpanel").getAttribute("id")).toBe("panel-policy");
    fireEvent.change(cap, { target: { value: "0.5" } });
    fireEvent.click(screen.getByRole("tab", { name: "Feed" }));
    expect(window.location.hash).toBe("#feed");
    expect(screen.getAllByRole("tabpanel")).toHaveLength(1);
    expect(screen.queryByRole("heading", { name: "Trading policy" })).toBeNull();
    act(() => Stream.current.state({ ...state, policy: { ...state.policy, maxPerTradeUsd: 2 } }));
    act(() => window.history.back());
    await waitFor(() => expect(screen.getByRole("tab", { name: "Policy" }).getAttribute("aria-selected")).toBe("true"));
    expect((cap as HTMLInputElement).value).toBe("0.5");
    fireEvent.keyDown(screen.getByRole("tab", { name: "Policy" }), { key: "ArrowRight" });
    expect(window.location.hash).toBe("#activity");
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Activity" }));
    fireEvent.keyDown(document.activeElement!, { key: "Home" });
    expect(screen.getByRole("tab", { name: /^Proposals/ }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByLabelText("1 pending")).toBeTruthy();
  });

  it("keeps proposals compact until selected and preserves selection across updates", () => {
    const p = proposal(); const onDecision = vi.fn();
    const props = { proposals: [p], mode: "demo" as const, killed: false, connected: true, pending: new Set<string>(), onDecision };
    const { rerender } = render(<Proposals {...props} />);
    expect(screen.queryByText("Unsigned transaction")).toBeNull();
    const row = screen.getByRole("button", { name: /Review TEST buy/ });
    fireEvent.click(row);
    expect(screen.getByText("Unsigned transaction")).toBeTruthy();
    expect(screen.getByText("Firewall: passed")).toBeTruthy();
    expect(screen.getByText("100 bytes")).toBeTruthy();
    const newer = { ...p, id: "newer", symbol: "NEW", createdAt: p.createdAt + 1 };
    rerender(<Proposals {...props} proposals={[newer, p]} />);
    expect(row.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Approve buy" }));
    expect(onDecision).toHaveBeenCalledWith(p, "approve");
    fireEvent.click(screen.getByRole("button", { name: "Close proposal details" }));
    expect(screen.queryByText("Unsigned transaction")).toBeNull();
    expect(document.activeElement).toBe(row);
  });

  it("uses a dismissible native modal on compact screens and restores focus", () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    render(<Proposals proposals={[proposal()]} mode="demo" killed={false} connected pending={new Set()} onDecision={vi.fn()} />);
    const row = screen.getByRole("button", { name: /Review TEST buy/ }); row.focus(); fireEvent.click(row);
    const detail = screen.getByRole("dialog", { name: "Review proposal" });
    expect((detail as HTMLDialogElement).open).toBe(true);
    fireEvent(detail, new Event("cancel", { bubbles: false, cancelable: true }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(row);
  });

  it("keeps disconnected, unauthorized and unprepared proposals unapprovable", () => {
    const props = { proposals: [proposal()], mode: "demo" as const, killed: false, connected: false, pending: new Set<string>(), onDecision: vi.fn() };
    const { rerender } = render(<Proposals {...props} />);
    fireEvent.click(screen.getByRole("button", { name: /Review TEST buy/ }));
    const disabled = (name: string) => (screen.getByRole("button", { name }) as HTMLButtonElement).disabled;
    expect(disabled("Approve buy")).toBe(true); expect(disabled("Reject")).toBe(true);
    rerender(<Proposals {...props} connected authorized={false} />);
    expect(disabled("Approve buy")).toBe(true); expect(disabled("Reject")).toBe(true);
    rerender(<Proposals {...props} connected proposals={[{ ...proposal(), prepared: undefined }]} />);
    expect(disabled("Approve buy")).toBe(true); expect(disabled("Reject")).toBe(false);
    rerender(<Proposals {...props} connected pending={new Set(["decision:test-proposal"])} />);
    expect(disabled("Submitting…")).toBe(true); expect(disabled("Reject")).toBe(true);
  });

  it("renders genuine token images, falls back on errors and rejects unsafe URLs", () => {
    const props = { token: proposal().token, symbol: " TEST ", name: "Test token" };
    const { container, rerender } = render(<TokenAvatar {...props} imageUrl="https://example.com/token.png" />);
    const image = container.querySelector("img")!;
    expect(image.getAttribute("src")).toBe("https://example.com/token.png");
    fireEvent.error(image);
    expect(container.querySelector("img")).toBeNull(); expect(container.textContent).toBe("TE");
    rerender(<TokenAvatar {...props} imageUrl="https://example.com/replacement.png" />);
    expect(container.querySelector("img")).not.toBeNull();
    rerender(<TokenAvatar {...props} symbol=" " imageUrl="javascript:alert(1)" />);
    expect(container.querySelector("img")).toBeNull(); expect(container.textContent).toBe("TE");
    rerender(<TokenAvatar {...props} symbol=" " name=" " imageUrl=" " />);
    expect(container.textContent).toBe(props.token.slice(2, 4).toUpperCase());
  });

  it("shares API token logos between the feed and older proposals", async () => {
    const state = fixture(); state.proposals = [proposal()];
    state.tokens[0].imageUrl = "https://example.com/logo.png";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(state)));
    const { container } = render(<App />);
    const row = await screen.findByRole("button", { name: /Review TEST buy/ });
    expect(row.querySelector("img")?.getAttribute("src")).toBe(state.tokens[0].imageUrl);
    fireEvent.click(screen.getByRole("tab", { name: "Feed" }));
    expect(container.querySelector(".launches-table .token-image")?.getAttribute("src")).toBe(state.tokens[0].imageUrl);
  });
});

describe("demo reset", () => {
  async function openReset() {
    fireEvent.click(screen.getByLabelText("Account menu"));
    fireEvent.click(await screen.findByRole("button", { name: "Reset demo" }));
    return screen.getByRole("dialog", { name: "Reset demo account?" });
  }

  it("requires confirmation, excludes concurrent actions and keeps the selected tab on success", async () => {
    window.history.replaceState(null, "", "#policy");
    let state = fixture(); state.mode = "demo"; state.proposals = [proposal()];
    let finish!: (value: Response) => void;
    const fetcher = vi.fn((url: string) => url === "/api/demo/reset" ? new Promise<Response>(resolve => { finish = resolve; }) : Promise.resolve(response(state)));
    vi.stubGlobal("fetch", fetcher); render(<App />);
    await screen.findByRole("heading", { name: "Trading policy" });
    fireEvent.change(screen.getByLabelText("Per-trade cap · USD"), { target: { value: "0.5" } });
    const cancelled = await openReset();
    fireEvent.click(within(cancelled).getByRole("button", { name: "Cancel" }));
    expect(fetcher.mock.calls.some(([url]) => url === "/api/demo/reset")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Reset demo" }));
    const dialog = screen.getByRole("dialog", { name: "Reset demo account?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Reset demo" }));
    expect((within(dialog).getByRole("button", { name: "Resetting…" }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(dialog).getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Activate kill switch" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent(dialog, new Event("cancel", { cancelable: true }));
    expect(screen.getByRole("dialog")).toBe(dialog);
    state = fixture(); state.mode = "demo"; state.proposals = []; state.spentTodayUsd = 0; state.log = [];
    await act(async () => { finish(response({ forkBlock: 12345678 })); });
    await screen.findByText("Demo reset.");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(window.location.hash).toBe("#policy");
    expect((screen.getByLabelText("Per-trade cap · USD") as HTMLInputElement).value).toBe(String(state.policy.maxPerTradeUsd));
    expect(fetcher.mock.calls.filter(([url]) => url === "/api/demo/reset")).toHaveLength(1);
  });

  it("keeps failed reset context visible and displays the actual server error", async () => {
    const state = fixture(); state.mode = "demo";
    vi.stubGlobal("fetch", vi.fn(async (url: string) => url === "/api/state" ? response(state) : response({ error: "Fork reset unavailable" }, false, 503)));
    render(<App />); await screen.findByRole("heading", { name: "Proposal queue" });
    const dialog = await openReset();
    fireEvent.click(within(dialog).getByRole("button", { name: "Reset demo" }));
    expect(await within(dialog).findByRole("alert")).toHaveProperty("textContent", "Fork reset unavailable");
    expect((within(dialog).getByRole("button", { name: "Reset demo" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it.each(["live", "fork"] as const)("does not expose reset for %s mode", async mode => {
    const state = fixture(); state.mode = mode;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(state)));
    render(<App />); await screen.findByRole("heading", { name: "Proposal queue" });
    fireEvent.click(screen.getByLabelText("Account menu"));
    expect(screen.queryByRole("button", { name: "Reset demo" })).toBeNull();
  });

  it("requires approver access and a live connection before resetting", async () => {
    const state = fixture(); state.mode = "demo"; state.approverTokenRequired = true;
    const fetcher = vi.fn().mockResolvedValue(response(state)); vi.stubGlobal("fetch", fetcher);
    render(<App />); await screen.findByRole("heading", { name: "Proposal queue" });
    fireEvent.click(screen.getByLabelText("Account menu"));
    const reset = screen.getByRole("button", { name: "Reset demo" }) as HTMLButtonElement;
    expect(reset.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Approver token"), { target: { value: "test-only-token" } });
    fireEvent.click(screen.getByRole("button", { name: "Save token" }));
    expect(reset.disabled).toBe(false);
    fetcher.mockRejectedValue(new Error("offline"));
    await act(async () => { Stream.current.onerror?.(); });
    expect(reset.disabled).toBe(true);
  });
});
