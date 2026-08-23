# CardPulse Football judge runbook

Concise demo path: search Erling Haaland → choose season → generate → inspect
front/back card → prove reliability. Every claim stays within the evidence
boundaries in [the searchable card guide](searchable-card-demo.md).

## Before judges arrive

Three terminals:

```bash
pnpm dev:chaos-source   # http://127.0.0.1:4311/players
pnpm start:api          # http://127.0.0.1:4321
pnpm dev:web            # http://127.0.0.1:4173
```

Verify expected states:

```bash
curl -s http://127.0.0.1:4321/api/runtime | jq '.mode, .sourceId'
# expect: "mock" (no credentials) — no external request or billable mutation

curl -s "http://127.0.0.1:4321/api/search/players?q=haaland" | jq '.data'
# live mode: automatically prepares 2026/27 once, then returns cached matches

curl -s http://127.0.0.1:4321/api/seasons | jq '[.data[].compId]'
# expect: 745, 596, 776, 791 only

curl -s "http://127.0.0.1:4321/api/seasons" | jq '.data[] | select(.season == "2022")'
# unknown season probe: no such entry; generation for it fails closed
```

Full gate before recording anything:

```bash
pnpm check              # lint + typecheck + tests + builds + collector demo
```

Do not claim test results until the orchestrator has run this on the merged
branch.

## Two-minute story

Open `http://127.0.0.1:4173`.

The browser has no offline player catalog and never asks the judge for a token.
Open it before the timed path so the automatic current-season Bright Data
preparation is warm. Provider and admin credentials stay on the server.

| Time      | Action                                                      | What to say                                                                                                                                             |
| --------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0:00–0:15 | Type “Haaland” or “Arsenal” into search                     | “Search works by player or club. A cold session prepares one live directory; later keystrokes read its validated cache.”                                |
| 0:15–0:30 | Pick a verified season, press generate                      | “Only registry seasons are offered. Generate either serves a validated snapshot from cache or starts one real Bright Data collection — and says which.” |
| 0:30–0:45 | Watch run status → card                                     | “Stages are reported truthfully end to end; if any stage failed you would see exactly that stage, not a fake success.”                                  |
| 0:45–1:05 | Flip the card, generate a second season                     | “The back is validated match and goal history. Explicit flip works by keyboard and touch; each season keeps separate provenance.”                       |
| 1:05–1:25 | Switch chaos source to `drift-cards`, regenerate against it | “Layout drift is quarantined. The last verified card stays on screen; failed output never replaces verified data.”                                      |
| 1:25–1:50 | Fetch repair preview → validate → approve                   | “Same collector ID refactored, preview gated on schema and counts, human approval required, then rerun to recovery evidence.”                           |
| 1:50–2:00 | Open the provenance drawer                                  | “Every live card records its source, observed time, snapshot hash, and scrape run.”                                                                     |

Failure messaging to show deliberately (optional, 30 s):

- `unavailable` chaos mode → UI keeps the verified card and reports the source
  as unavailable;
- unknown season query → closed rejection, no collection attempted;
- blank server credentials → runtime says `mock`; public live scraping fails
  closed without exposing or requesting secrets in the browser.

## Evidence boundaries (say it before a judge asks)

- Proven real externally: the earlier 10-row StatBunker same-collector repair
  trail (failure → invalid preview rejected → corrected preview → approval →
  rerun → 10/10 mapping). Nothing more.
- The single narrow paid Erling Haaland smoke test is **gated on explicit
  approval and has not run**.
- No browser/on-demand live capture of the searchable flow exists yet.

Keep API and admin tokens out of recordings, screenshots, and shell history.
