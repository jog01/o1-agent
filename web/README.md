# o1 agent dashboard

Vite + React + TypeScript + Tailwind, with a local shadcn/ui Button and the official o1 brand skin. All API and asset URLs are same-origin; no credentials belong in the frontend.

```bash
npm ci
npm run dev       # Vite :5173, /api proxied to the agent on :8787
npm run build     # web/dist, served at / by the agent
npm run typecheck
npm test
```

Run the indexer and agent as described in `../agent/README.md`. The dashboard uses `/api/events` state events and automatically polls `/api/state` every five seconds while SSE is unavailable. Trading actions are disabled when no current connection is available. An API error stays visible; stale state is never presented as a live connection.

For UI-only development, intercept `/api/state` and the `state` events at `/api/events` with `../docs/sample-state.json`. Mock responses must stay in the development/test harness, never in the production dashboard. The checked-in tests use that sample payload to exercise action wiring and streaming failures without any secrets.

Policy/rules forms retain unsaved changes during live updates and submit only edited fields. Disabling human approval asks for confirmation. Live approvals and live proposals/scans with human approval disabled ask explicitly before spending. The kill switch is a dedicated API action, not a policy-editor field.

When `approverTokenRequired` is set, enter the token in the masked approver-access field. It is stored in localStorage on that browser and sent only on same-origin API mutations using `x-approver-token`. Change/forget controls are available; a 401 clears the saved token and locks protected controls again. Emergency kill-on remains available without an approver token. No token is bundled into the app.

Fork transaction hashes are deliberately not linked to BaseScan. A filled demo/fork proposal is labelled **fork tx**, not a mainnet trade.

End-to-end preparations/fills require the configured demo agent and are verified after deployment; a UI-only mock is not evidence of a real o1 prepare or fork execution.
