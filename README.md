# CardPulse Football

[![CI](https://github.com/UddhavB17/cardpulse-football/actions/workflows/ci.yml/badge.svg)](https://github.com/UddhavB17/cardpulse-football/actions/workflows/ci.yml)

CardPulse turns scraped football statistics into animated, game-style player
cards — and keeps the data trustworthy when the source page changes shape.

The demo intentionally combines a high-impact visual reveal with a reliability
story that is central to scraping: collect public football rows, validate every
record, preserve the last verified card during layout drift, repair the **same**
Bright Data Scraper Studio collector, require a valid preview and human
approval, rerun it, and show evidence of recovery.

The default local experience is a deterministic, clearly labelled mock. The
Bright Data provider path now has a redacted credentialed trail: real failure,
rejected invalid preview, corrected same-ID repair, approval, 10-row rerun, and
10/10 CardPulse mapping. A deployed browser/API live-mode recording remains
outstanding.

## Why this is not just another stats dashboard

Sports pages change continuously. CSS classes move, tables become cards, and
A/B tests quietly break selectors. A conventional dashboard either crashes or
serves stale numbers. CardPulse makes that failure visible and recoverable:

- strict Zod contracts for player, team, and standing records;
- SHA-256 payload evidence and immutable versioned snapshots;
- quarantine instead of letting malformed rows corrupt the card;
- batch-level drift confirmation, so one bad row cannot trigger a repair;
- last-known-good preservation while the scraper is broken;
- same-`c_*` collector refactor, preview validation, approval, terminal polling,
  rerun, and recovery ledger;
- deterministic semantic events for goals, assists, appearances, discipline,
  profiles, and league-table changes.

Remove scraping and the collection, drift, healing, provenance, and recovery
story disappears. The animated card is the payoff; reliable scraping is the
product.

## Judge-facing experience

The web app uses an original comic-print visual system: halftone texture,
chromatic separation, angular wipes, card tilt, and a controlled glitch while
the source is compromised. It does not bundle player photos, club crests,
league marks, or Spider-Verse assets. Reduced-motion and keyboard-friendly
paths are included.

The main flow is:

1. **Generate card** — collect a verified football batch and materialize the
   player card, team summaries, and standings.
2. **Inject layout drift** — simulate table-to-cards DOM drift; bad output is
   quarantined and the verified card remains on screen.
3. **Fetch the repair preview** — the confirmed drift has already triggered
   refactoring for the same collector ID; now retrieve its approval preview.
4. **Validate preview** — reject approval unless every preview row passes the
   frozen contract and count gate.
5. **Approve repair** — resume, poll to `done`, rerun the same collector, and
   archive hashes/counts as recovery evidence.
6. **Show a real stat amendment** — prove that DOM drift and business-data
   change are treated differently.

## Architecture

| Workspace                   | Responsibility                                                                      |
| --------------------------- | ----------------------------------------------------------------------------------- |
| `apps/web`                  | Card generator, reliability timeline, team views, standings, operator actions       |
| `apps/chaos-source`         | Stable `/players` HTML target with table, cards, amendment, and unavailable modes   |
| `services/collector-worker` | API, validation pipeline, snapshots, diffing, quarantine, healing orchestration     |
| `packages/contracts`        | Canonical Zod schemas and deterministic football fixtures                           |
| `packages/validation`       | Stable serialization, hashing, and extraction validation                            |
| `packages/brightdata`       | Scraper Studio trigger/poll adapter, row mapper, and same-collector healing adapter |

Workspace package names still use the historical `@bidsentinel` scope to keep
the migration reviewable; all product-facing names and runtime contracts are
CardPulse Football.

## Hackathon submission artifacts

- [Example StatBunker-shaped collector output](examples/structured-output.json)
  (illustrative shape; not captured from a live run)
- [StatBunker collector spec and Scraper Studio prompts](scrapers/statbunker/README.md)
- [Terminal-first StatBunker live runbook](docs/statbunker-live-runbook.md)
- [One-minute demo runbook](docs/demo-runbook.md)
- [Live Scraper Studio evidence checklist](evidence/README.md)
- [Redacted real first-run failure evidence](evidence/live/statbunker-first-run-failure.redacted.json)
- [Redacted successful same-ID recovery evidence](evidence/live/statbunker-same-id-recovery.redacted.json)
- Public repository: <https://github.com/UddhavB17/cardpulse-football>

The repository now contains redacted successful same-`c_*` provider and mapper
evidence. A deployed live API/browser recording and final demo video URL must
still be added before the submission form is filed.

## Run locally

Requirements: Node 22+ and pnpm 11.

```bash
pnpm install
```

Start these in separate terminals:

```bash
pnpm dev:chaos-source
pnpm start:api
pnpm dev:web
```

Open `http://127.0.0.1:4173`. With no credentials, the dashboard and API both
say `mock`; no external request or billable mutation is made.

Useful endpoints:

- chaos source: `http://127.0.0.1:4311/players`
- chaos controls: `http://127.0.0.1:4311/__control`
- API: `http://127.0.0.1:4321`
- web: `http://127.0.0.1:4173`

See [the demo runbook](docs/demo-runbook.md) for the one-minute presentation
and [local development](docs/local-development.md) for live-mode setup.

## Bright Data integration

The collection adapter follows the Scraper Studio flow:

1. `POST /dca/trigger?collector=c_*&queue_next=1` with `[{ "url": "…" }]`;
2. capture the returned `collection_id`;
3. poll `GET /dca/dataset?id=…` until a row array is returned;
4. map rows into football contracts and validate them independently.

The healing adapter sends `{ prompt, custom_input: [] }` to
`refactor_template`, preserves structured `preview_result`, resumes through
`resume_automation_job` only after a valid preview plus human approval, polls
to terminal `done`, and reruns the same first-class `c_*` ID.

Live mode requires all three `BRIGHT_DATA_*` variables. Billable/mutating API
routes additionally require `CARDPULSE_ENABLE_LIVE_MUTATIONS=true` and a
private 32+ character `CARDPULSE_OPERATOR_TOKEN` supplied as
`X-CardPulse-Operator-Token`. These routes are local operator controls, not a
production authentication design.

## Deterministic chaos source

`/players` is the stable scraper target. `/__control` changes only its current
mode:

- `baseline-table` — verified player statistics and standings in tables;
- `drift-cards` — identical business data in a different DOM structure;
- `amended-stats` — structurally valid data with a real statistical change;
- `unavailable` — a 503 source failure.

The JSON fixture route exists for tests; the judge story is the HTML page
changing under one stable URL.

## Data and attribution

The local demo contains fictional players and clubs plus original SVG/CSS art.
Its football record model is inspired by
[OpenLigaDB](https://www.openligadb.de/), whose published database is offered
under the [Open Database License (ODbL)](https://www.openligadb.de/lizenz).
CardPulse does not redistribute third-party player photos, club crests, league
marks, or an OpenLigaDB data dump.

[StatBunker](https://www.statbunker.com/) is a public HTML statistics site
targeted by the collector spec in
[`scrapers/statbunker/`](scrapers/statbunker/README.md). Public reachability
is a technical fact, not a license: its terms must be checked before any live
run, robots-friendly pages still deserve a low request rate (one manual
collector run at a time, no schedules), and any 403 or 429 means stop. The
spec collects only public statistical fields — never images, crests, player
photos, or account/login pages. No StatBunker data is redistributed through
this repository; the local fixtures remain fictional,
OpenLigaDB-inspired demo data only.

Before adding another real source, verify its terms, robots policy, rate limits,
and redistribution rights. Keep source adapters isolated so one site's layout
or policy does not contaminate the canonical football model.

## AI assistance disclosure

Codex and OpenCode coding agents were used during implementation, testing, and
review. The team selected the product direction and architecture, inspected the
generated changes, exercised the complete browser workflow, and verified the
repository with the automated checks below. Team members are responsible for
understanding and explaining the submitted code and technical decisions.

## Verification

```bash
pnpm check
```

This runs lint, typecheck, all tests, every workspace build, and the deterministic
collector demo. The focused contracts and provider tests are:

```bash
pnpm --filter @bidsentinel/contracts test
pnpm --filter @bidsentinel/brightdata test
```

## Evidence status

- **Implemented and automatically verified:** football contracts, mapping,
  strict validation, baseline preservation, minority-row safety, initial-empty
  safety, batch drift detection, quarantine, valid-preview-only approval,
  same-ID resume/poll/rerun evidence, API contracts, and UI state logic.
- **Externally verified:** one credentialed Bright Data failure → invalid
  preview rejection → corrected refactor preview → approval → 10-row same-ID
  rerun, followed by 10/10 canonical mapper acceptance.
- **Still required before the final deployed claim:** one browser/API
  live-mode capture and the submission demo video.

That distinction is deliberate: mock mode proves deterministic product
behavior; only external evidence can prove the provider account path.
