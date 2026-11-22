import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { isAddress, type Address } from "viem";
import { Agent } from "./agent.js";
import { config } from "./config.js";

const agent = new Agent();
const app = new Hono();

const fail = (c: any, e: any) => c.json({ error: String(e?.message ?? e) }, 400);

if (config.mode !== "demo" && config.approverToken.length < 16) {
  console.error(`APPROVER_TOKEN (16+ chars) is required in ${config.mode} mode`);
  process.exit(1);
}
/** Human-only actions. Demo mode with no token set is open, since it cannot spend anything. */
const isApprover = (c: any) => !config.approverToken || c.req.header("x-approver-token") === config.approverToken;
const denied = (c: any) => c.json({ error: "approver token required" }, 401);

app.get("/api/health", (c) => c.json({ ok: true, mode: config.mode, indexer: agent.indexerOk }));
app.get("/api/state", (c) => c.json(agent.snapshot()));

app.get("/api/events", (c) =>
  streamSSE(c, async (s) => {
    let pending = false;
    const push = () => {
      if (pending) return;
      pending = true;
      setTimeout(() => {
        pending = false;
        void s.writeSSE({ event: "state", data: JSON.stringify(agent.snapshot()) });
      }, 150);
    };
    agent.on("change", push);
    s.onAbort(() => {
      agent.off("change", push);
    });
    await s.writeSSE({ event: "state", data: JSON.stringify(agent.snapshot()) });
    while (!s.aborted) await s.sleep(15_000).then(() => s.writeSSE({ event: "ping", data: "" }));
  }),
);

app.post("/api/proposals", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  if (!isAddress(b.token)) return fail(c, "token must be an address");
  try {
    const source = isApprover(c) && b.source !== "mcp" ? "user" : "mcp";
    return c.json(await agent.propose(b.token as Address, Number(b.amountUsd ?? agent.policy.maxPerTradeUsd), source));
  } catch (e) {
    return fail(c, e);
  }
});
app.post("/api/scan", async (c) => (isApprover(c) ? c.json((await agent.scan()) ?? null) : denied(c)));
app.post("/api/proposals/:id/approve", async (c) => {
  if (!isApprover(c)) return denied(c);
  try {
    return c.json(await agent.approve(c.req.param("id")));
  } catch (e) {
    return fail(c, e);
  }
});
app.post("/api/proposals/:id/reject", (c) => {
  if (!isApprover(c)) return denied(c);
  try {
    return c.json(agent.reject(c.req.param("id")));
  } catch (e) {
    return fail(c, e);
  }
});
app.post("/api/kill", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  if (b.on !== true && !isApprover(c)) return denied(c);
  agent.setKill(b.on === true);
  return c.json(agent.policy);
});
app.post("/api/demo/reset", async (c) => {
  if (!isApprover(c)) return denied(c);
  try {
    return c.json(await agent.resetDemo());
  } catch (e) {
    return fail(c, e);
  }
});
app.patch("/api/policy", async (c) => {
  if (!isApprover(c)) return denied(c);
  const b = await c.req.json().catch(() => ({}));
  const { killSwitch: _ignored, ...patch } = b;
  try {
    agent.updatePolicy(patch);
  } catch (e) {
    return fail(c, e);
  }
  return c.json(agent.policy);
});
app.patch("/api/rules", async (c) => {
  if (!isApprover(c)) return denied(c);
  try {
    agent.updateRules(await c.req.json().catch(() => ({})));
  } catch (e) {
    return fail(c, e);
  }
  return c.json(agent.rules);
});

app.use("/*", serveStatic({ root: config.webDist.replace(process.cwd() + "/", "") }));
app.get("*", serveStatic({ path: `${config.webDist.replace(process.cwd() + "/", "")}/index.html` }));

agent.say("info", `Agent started in ${config.mode} mode`);
setInterval(() => void agent.refresh(), 3000);
void agent.refresh();

serve({ fetch: app.fetch, port: config.port, hostname: "0.0.0.0" }, (i) => console.log(`agent listening on :${i.port} (${config.mode})`));
