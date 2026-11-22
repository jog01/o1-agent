#!/usr/bin/env node
/**
 * MCP server for the o1 agent. Lets Claude, Cursor or any MCP client read o1 Launchpad data,
 * screen tokens and propose trades. There is deliberately no "approve" tool: following o1's
 * safe agent workflow, a human approves every signature in the dashboard.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const AGENT = process.env.AGENT_URL ?? "http://127.0.0.1:8787";

async function call(path: string, init?: RequestInit) {
  const r = await fetch(`${AGENT}${path}`, { headers: { "content-type": "application/json" }, ...init });
  return r.json();
}
const text = (v: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(v, null, 2) }] });

const server = new McpServer({ name: "o1-agent", version: "0.1.0" });

server.registerTool(
  "list_launches",
  { description: "Recent o1 Launchpad tokens on Base with on-chain stats and safety-screen results, newest first.", inputSchema: { limit: z.number().int().min(1).max(100).default(20), passingOnly: z.boolean().default(false) } },
  async ({ limit, passingOnly }) => {
    const s = await call("/api/state");
    const rows = (s.tokens as any[])
      .filter((t) => !passingOnly || t.screen.pass)
      .slice(0, limit)
      .map((t) => ({ symbol: t.symbol, name: t.name, token: t.token, suite: t.suite, launchedAt: new Date(t.launched_ts * 1000).toISOString(), trades: t.trades, uniqueTraders: t.unique_traders, firstMinuteTraders: t.first_minute_traders, passes: t.screen.pass, failed: t.screen.checks.filter((c: any) => !c.pass).map((c: any) => `${c.label} ${c.value} (${c.limit})`) }));
    return text(rows);
  },
);

server.registerTool(
  "get_policy",
  { description: "The agent's hard limits (spend caps, slippage, allowed contracts, kill switch), safety rules, mode and today's spend." },
  async () => {
    const s = await call("/api/state");
    return text({ mode: s.mode, signer: s.signer, policy: s.policy, rules: s.rules, spentTodayUsd: s.spentTodayUsd });
  },
);

server.registerTool(
  "propose_buy",
  { description: "Ask o1's Trading API to prepare a buy. The agent checks it against policy and queues it for human approval in the dashboard. Nothing is signed by this tool.", inputSchema: { token: z.string().regex(/^0x[0-9a-fA-F]{40}$/), amountUsd: z.number().positive() } },
  async ({ token, amountUsd }) => text(await call("/api/proposals", { method: "POST", body: JSON.stringify({ token, amountUsd, source: "mcp" }) })),
);

server.registerTool(
  "list_proposals",
  { description: "Trade proposals and their status (awaiting_approval, blocked, filled, ...), with any policy violations.", inputSchema: { limit: z.number().int().min(1).max(50).default(10) } },
  async ({ limit }) => {
    const s = await call("/api/state");
    return text((s.proposals as any[]).slice(0, limit).map(({ prepared, screen, ...p }) => ({ ...p, preparedTo: prepared?.to, preparedValueWei: prepared?.valueWei })));
  },
);

server.registerTool(
  "kill_switch",
  { description: "Turn the kill switch on (cancel pending orders, refuse all signing) or off.", inputSchema: { on: z.boolean() } },
  async ({ on }) => text(await call("/api/kill", { method: "POST", body: JSON.stringify({ on }) })),
);

await server.connect(new StdioServerTransport());
