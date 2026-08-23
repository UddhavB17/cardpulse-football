# CardPulse Football

[![CI](https://github.com/UddhavB17/cardpulse-football/actions/workflows/ci.yml/badge.svg)](https://github.com/UddhavB17/cardpulse-football/actions/workflows/ci.yml)

CardPulse turns scraped football statistics into animated, game-style player
cards — and keeps the data trustworthy when the source page changes shape.
This branch transforms the one-player demo into a **searchable Premier League
card generator**: search a real player by name, pick a verified season, and
generate the front/back card through a real or cached Bright Data collection.

The demo intentionally combines a high-impact visual reveal with a reliability
story that is central to scraping: search over a local cached index (never a
paid per-keystroke call), collect public football rows only on explicit
generate, validate every record, preserve the last verified card during layout
drift or provider failure, repair the **same** Bright Data Scraper Studio
collector, require a valid preview and human approval, rerun it, and show
evidence of recovery.

The default local experience is deterministic and clearly labelled. The Bright
Data provider path has one redacted credentialed trail proving the earlier
10-row StatBunker same-collector repair (real failure → rejected invalid
preview → corrected same-ID repair → approval → 10-row rerun → 10/10 mapping).
A browser/API live-mode recording of the new searchable flow and a narrow paid
Erling Haaland smoke test remain gated on explicit approval and have **not**
run.

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

Open the app, type **Erling Haaland** into the search box, choose a verified
season, and press generate. The card renders front (identity, club, position,
season headline stats) and back (verified match/goal history, provenance,
snapshot hash) with an explicit flip control. Multiple seasons of the same player can be
generated side by side for comparison, each carrying its source provenance.

The main flow is:

1. **Search** — an ARIA combobox queries a local cached player index; no
   provider call happens per keystroke.
2. **Choose season** — only seasons in the verified registry are offered;
   unknown seasons fail closed instead of guessing a URL.
3. **Generate** — one explicit action triggers either a real Bright Data
   collection (billable) or serves a previously collected validated snapshot
   from cache; run status is polled asynchronously and every stage shown is
   truthful (`finding_player → starting_collector → extracting_statistics →
validating_data → printing_card`, followed by `succeeded` or `failed`).
   Because the standings table publishes no player link, an uncached list-only
   identity uses StatBunker's public exact-name search URL in that same single
   provider run, accepts exactly one numeric player ID, and then extracts its
   canonical season-match table. Mixed, partial, or wrong-season identities
   fail closed.
4. **Inspect the card** — front/back flip, season comparison, and per-card
   match history plus provenance: source URL, collector shape, snapshot
   version, and hash.
5. **Inject layout drift / break the source** — bad output is quarantined and
   the last verified card stays on screen; default/live failures never become
   fixture or demo data.
6. **Heal** — same-collector refactor preview, schema/count gate, explicit
   approval, rerun, recovery evidence.

Demo data requires an explicit demo action and stays under a persistent
`DEMO DATA` label; it is never silently substituted for a failed real or live
collection.

The web app keeps its original comic-print visual system: halftone texture,
chromatic separation, angular wipes, card tilt, and a controlled glitch while
the source is compromised. It bundles no player photos, club crests, league
marks, or Spider-Verse assets.

### Verified season registry

Search and generation accept only these StatBunker Premier League seasons,
each verified at its official list page:

| Season  | `comp_id` | Official source URL                                                   | Status             |
| ------- | --------: | --------------------------------------------------------------------- | ------------------ |
| 2023/24 |       745 | <https://www.statbunker.com/competitions/PlayerStandings?comp_id=745> | complete           |
| 2024/25 |       596 | <https://www.statbunker.com/competitions/PlayerStandings?comp_id=596> | complete           |
| 2025/26 |       776 | <https://www.statbunker.com/competitions/PlayerStandings?comp_id=776> | complete           |
| 2026/27 |       791 | <https://www.statbunker.com/competitions/PlayerStandings?comp_id=791> | current/incomplete |

Any other season fails closed: no URL is guessed, no collection runs.
Current-season rows are partial by definition. StatBunker publishes updates
after each match completes; CardPulse recollects a player-specific
`SeasonMatches` page on the next explicit Generate action once the card is
older than the 15-minute freshness window. It does not claim goal-by-goal
in-match updates or run a background poller.

## Accessibility

The card experience is keyboard- and touch-complete:

- search is an ARIA combobox with full keyboard behavior (arrows, Enter,
  Escape), announced options, and touch-friendly targets;
- flipping is explicit — a button/toggle that works by keyboard and touch,
  never hover-only;
- `prefers-reduced-motion` disables non-essential animation;
- cards contain no player photos, club crests/league logos, or shot
  coordinates — only text, numbers, and original art.

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
- [Searchable card demo guide and test matrix](docs/searchable-card-demo.md)
- [One-minute judge runbook](docs/demo-runbook.md)
- [Live Scraper Studio evidence checklist](evidence/README.md)
- [Redacted real first-run failure evidence](evidence/live/statbunker-first-run-failure.redacted.json)
- [Redacted successful same-ID recovery evidence](evidence/live/statbunker-same-id-recovery.redacted.json)
- Public repository: <https://github.com/UddhavB17/cardpulse-football>

The repository now contains redacted successful same-`c_*` provider and mapper
evidence for the earlier 10-row StatBunker repair only. A deployed browser/API
recording of the searchable flow, the gated Erling Haaland paid smoke test,
and the final demo video URL must still be added before the submission form is
filed; none of these has run yet.

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
say `mock`; no external request or billable mutation is made. Choose **Use
demo data** for the zero-cost Haaland flow. A fresh live process has an empty
in-memory index until an explicit operator-gated season refresh; search itself
never bills, and stale/missing generation bills only after the protected
Generate action.

Useful endpoints:

- chaos source: `http://127.0.0.1:4311/players`
- chaos controls: `http://127.0.0.1:4311/__control`
- API: `http://127.0.0.1:4321`
- web: `http://127.0.0.1:4173`

The searchable card flow adds search, seasons, async card-generation run
status, generated-card, matches-availability, and scrape-status routes on top
of the preserved reliability/operator endpoints — see [the API
contract](docs/api-contract.md) and [the searchable card demo
guide](docs/searchable-card-demo.md).

See [the demo runbook](docs/demo-runbook.md) for the one-minute presentation
and [local development](docs/local-development.md) for live-mode setup.

## Bright Data integration

The collection adapter follows the Scraper Studio flow:

1. `POST /dca/trigger?collector=c_*&queue_next=1` with `[{ "url": "…" }]`;
2. capture the returned `collection_id`;
3. poll `GET /dca/dataset?id=…` until a row array is returned;
4. use `PlayerStandings?comp_id=…` for an explicit index refresh; generation
   targets the verified player-specific
   `SeasonMatches?comps_id=…&comps_type=EPL&player_id=…` URL when a numeric ID
   is cached, otherwise one exact-name `/usual/search` input resolves and
   collects that canonical match table in the same provider run;
5. map every match row into frozen contracts, validate/quarantine the batch,
   derive season totals, then store the versioned card and match history.

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

The local demo contains a clearly stamped Haaland identity with synthetic demo
totals, additional fictional players/clubs, and original SVG/CSS art. Demo
numbers are never presented as live observations.
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
  rerun, followed by 10/10 canonical mapper acceptance. This proves the
  earlier 10-row StatBunker same-collector repair only.
- **Gated, not run:** the single narrow paid Erling Haaland smoke test waits
  on explicit approval; no browser/on-demand live capture of the searchable
  flow exists yet.
- **Still required before the final deployed claim:** that gated smoke test,
  one browser/API live-mode capture of search → season → generate, and the
  submission demo video.

That distinction is deliberate: mock mode proves deterministic product
behavior; only external evidence can prove the provider account path.
