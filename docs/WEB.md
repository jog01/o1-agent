# Dashboard

`web/` is a React + Vite + Tailwind app, built to `web/dist` and served by the agent on the same port. It has four tabs under one navbar.

| Tab | Shows |
|---|---|
| Proposals | Pending and past buys, the unsigned transaction, approve / reject |
| Feed | Every o1 Launchpad token with its safety screen and a buy button |
| Policy | Trading limits, allowed contracts, token lists, safety-screen rules |
| Activity | The agent's log |

![Feed](img/feed.png)

![Proposals](img/proposals.png)

![Policy](img/policy.png)

## Data flow

```mermaid
sequenceDiagram
  participant B as Browser
  participant A as Agent
  B->>A: GET /api/events (SSE)
  A-->>B: state snapshot
  loop on every agent change (debounced 150 ms)
    A-->>B: state snapshot
  end
  Note over B,A: if the stream drops, the app polls /api/state and reconnects
  B->>A: POST /api/proposals/:id/approve<br/>x-approver-token
  A-->>B: updated proposal
```

- `api.ts`: `request()` adds the approver token to every write, and `useAgent()` keeps one state object fed by SSE with a polling fallback. The connection badge shows live, polling or disconnected.
- `App.tsx`: shell, navbar, kill switch, demo reset, approver-token entry, notices.
- `components/`: `Launches` (Feed), `Proposals`, `Settings` (Policy), `Navigation` (tabs synced to the URL hash), `TokenAvatar` (token image with a letter fallback).
- The approver token is kept in `localStorage` and cleared on a 401.

## Look

o1's visual language: Poppins, pale blue `#9CD6FF` accents, dark panels, 1px dividers, tabular figures. Green and red are only for status.
