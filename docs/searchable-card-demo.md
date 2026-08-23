# Searchable Premier League card demo

The one-player demo became a searchable card generator: type a player name,
pick a verified season, generate once, inspect the front/back card. This page
is the truthful walkthrough — what is real, what is cached, what is gated.

## The judge path

1. **Search “Erling Haaland” or “Arsenal”.** No token or setup step is shown.
   The app automatically prepares the current verified season through Bright
   Data, then the ARIA combobox searches the validated cache by player or club.
   Concurrent preparation is deduplicated; keystrokes do not each trigger a
   provider run.
2. **Choose a season.** Only registry seasons are offered. Unknown seasons
   fail closed: no URL is guessed and no collection starts.
3. **Generate.** One explicit public action per card:
   - **Cache hit** — serves the last validated snapshot for that player and
     season; provenance shows the original collection time, source URL shape,
     snapshot version, and SHA-256 hash.
   - **Real collection** — one billable Bright Data run (trigger → poll →
     map → validate → snapshot) through the same frozen contracts as always.

     If the local standings row has no numeric player link, that one run starts
     at StatBunker's public exact-name search page. It must find exactly one
     matching player, prove the numeric ID and canonical season-match URL on
     every returned row, and otherwise fails closed without replacing a card.

   The response records which path produced the card; run status is polled
   asynchronously so the UI shows the true stage at all times.

4. **Inspect.** Front: identity, club, position, season headline stats. Back:
   validated match rows, goal history, and provenance. Flip is explicit (button, keyboard,
   touch). Generate a second season of the same player to compare cards side
   by side; each keeps its own provenance.
5. **Break it on purpose.** Chaos modes (`drift-cards`, `unavailable`) show
   quarantine, preservation of the last verified card, same-collector healing,
   preview gating, approval, rerun, and recovery evidence.

## Truthful generation stages

Run status reports exactly where a run is; there are no synthetic success
stages:

| Stage                   | Meaning                                                       |
| ----------------------- | ------------------------------------------------------------- |
| `finding_player`        | selected identity resolved from the free local index          |
| `starting_collector`    | protected Bright Data request is genuinely pending            |
| `extracting_statistics` | provider dataset resolved and the returned batch is processed |
| `validating_data`       | strict contracts, quarantine, and drift gates are evaluated   |
| `printing_card`         | verified snapshot and card bundle are being stored            |
| `succeeded` / `failed`  | terminal outcome; glitch stops immediately                    |

A failure surfaces as the exact failing stage with a safe message. Failed or
quarantined collections never backfill the search index silently and never
replace the last verified card.

## Verified season registry

| Season  | `comp_id` | Official source URL                                                 | Status             |
| ------- | --------: | ------------------------------------------------------------------- | ------------------ |
| 2023/24 |       745 | https://www.statbunker.com/competitions/PlayerStandings?comp_id=745 | complete           |
| 2024/25 |       596 | https://www.statbunker.com/competitions/PlayerStandings?comp_id=596 | complete           |
| 2025/26 |       776 | https://www.statbunker.com/competitions/PlayerStandings?comp_id=776 | complete           |
| 2026/27 |       791 | https://www.statbunker.com/competitions/PlayerStandings?comp_id=791 | current/incomplete |

Anything outside this table fails closed. 2026/27 is deliberately marked
incomplete: available completed-match rows render normally, while a genuine
source gap is marked unavailable instead of zero-filled or invented.

StatBunker states that statistics update after a match completes. CardPulse
therefore does not promise an in-match live score: after the upstream page
changes, the next explicit Generate action recollects when the cached card is
missing or older than 15 minutes. There is no automatic background polling.

## Live-only guardrails

- The browser has no offline/demo-data action or fictional player catalog.
- Judges never enter a token. Bright Data credentials and the admin token stay
  server-side; public paid work is cached, deduplicated, and rate-limited.
- The current 2026/27 directory is prepared automatically, while another
  verified season is loaded on demand when the judge generates it.
- Search results and generated cards carry provenance, so cache hits and fresh
  collections remain distinguishable.

## Accessibility contract

- ARIA combobox pattern: proper roles and states (`combobox`, `listbox`,
  `option`, expanded state), arrow-key navigation, Enter selects, Escape
  closes, focus returns to the input.
- Explicit flip control usable by mouse, touch, and keyboard; never
  hover-only.
- Touch targets sized for fingers; all actions reachable by keyboard alone.
- `prefers-reduced-motion` disables non-essential animation including flip
  transitions and glitch effects.
- No player photos, club crests, league logos, or shot coordinates anywhere
  in the card — text, numbers, and original art only.

## API surface

Route shapes and rules live in [the API contract](api-contract.md): player
search, seasons, card generation plus async scrape/run status, generated card,
match availability, and scrape health — alongside the unchanged reliability
and operator endpoints (`players`, `teams`, `standings`, `changes`,
`sources`, `quarantines`, `healing/{sourceId}`, `/api/dev/*`).

## Evidence boundaries

- **Proven externally:** the earlier 10-row StatBunker same-collector repair
  trail only (real failure → invalid preview rejected → corrected preview →
  approval → rerun → 10/10 mapper acceptance).
- **Release evidence:** record the public player/club search, one generated
  card, its source URL, observed time, and snapshot hash before making a live
  freshness claim in the submission.
- **Submission evidence:** keep the final browser/API recording and demo video
  alongside the redacted recovery trail.

## Test matrix

The release gate covers Prettier, ESLint, all six TypeScript projects, the full
unit/HTTP suite, all six production builds, deterministic collector recovery,
and desktop/mobile browser checks. Record exact counts and public live evidence
from the release commit rather than copying stale numbers into a submission.

| #   | Requirement                          | Verification                                                                                           |
| --- | ------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| 1   | Search finds players and clubs       | `/api/search/players?q=haaland` returns Haaland; a club query such as `manchester` returns its players |
| 2   | No token or per-keystroke billing    | first search auto-prepares one deduplicated cache; later queries read it without browser credentials   |
| 3   | Registry seasons only                | `/api/seasons` lists exactly 745/596/776/791; other seasons rejected                                   |
| 4   | Unknown season fails closed          | generation request for an unlisted season returns an error; no URL guessed, no collection started      |
| 5   | Cached generation serves provenance  | cache hit returns snapshot version/hash and marks itself as cached                                     |
| 6   | Real generation runs truthful stages | run status advances through the exact five operations above, then succeeds or names the failing stage  |
| 7   | Failures preserve verified data      | forced provider failure leaves the last verified card untouched                                        |
| 8   | Browser remains live-only            | no fictional player catalog or demo-data action is present; demo-marked card payloads are refused      |
| 9   | Combobox keyboard behavior           | arrows move options, Enter selects, Escape closes, focus restores; screen-reader roles present         |
| 10  | Explicit flip works everywhere       | flip via button click, Enter/Space key, and touch tap; never hover-only                                |
| 11  | Reduced motion honored               | with `prefers-reduced-motion`, flips/glitches render without non-essential animation                   |
| 12  | No photos/logos/shot coordinates     | card payload and artwork contain none                                                                  |
| 13  | Season comparison keeps provenance   | two generated seasons display side by side with separate hashes                                        |
| 14  | Current-season history is honest     | 2026/27 completed rows update cards; missing/partial source data is labelled rather than zero-filled   |
| 15  | Reliability story preserved          | existing drift/quarantine/heal tests and endpoints still pass unchanged                                |
