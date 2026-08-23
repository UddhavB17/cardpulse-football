# StatBunker collector spec

This folder defines a Bright Data Scraper Studio collector for CardPulse
Football against [StatBunker](https://www.statbunker.com/), a public football
statistics website that serves plain HTML tables.

A real collector was created during integration validation, but its full ID
and all credentials are deliberately absent from the repository. Follow the
runbook below and keep your account-specific values only in an uncommitted
`.env`.

## Files

| File                | Purpose                                                                                   |
| ------------------- | ----------------------------------------------------------------------------------------- |
| `create-prompt.txt` | Full prompt for creating the collector (`bdata scraper create`). Canonical byte source.   |
| `heal-prompt.txt`   | Compact same-ID repair prompt (`bdata scraper heal` / `refactor_template`), ≤ 1000 chars. |
| `studio-prompt.md`  | The prompts with rationale, output contract, and usage notes.                             |

The live procedure — create, run, capture the `c_*` ID, connect CardPulse,
heal/approve/rerun, redact evidence — is in
[docs/statbunker-live-runbook.md](../../docs/statbunker-live-runbook.md).

## Output contract

One JSON object per player, exactly 10 rows per run. Scraper Studio previews
show all 14 requested keys; completed Bright Data datasets currently omit
keys whose value is null and add an `input` provenance object. The mapper
accepts that provider shape while validating every published field.

| Key                   | Type            | Notes                                             |
| --------------------- | --------------- | ------------------------------------------------- |
| `player_name`         | string          |                                                   |
| `player_url`          | string \| null  | null: PlayerStandings has no player link          |
| `team_name`           | string          |                                                   |
| `position`            | string \| null  | `goalkeeper`, `defender`, `midfielder`, `forward` |
| `appearances`         | integer         | zero stays `0`                                    |
| `goals`               | integer         | zero stays `0`                                    |
| `assists`             | integer \| null | null only if truly unavailable                    |
| `yellow_cards`        | integer         | zero stays `0`                                    |
| `second_yellow_cards` | integer \| null | zero stays `0`; null only if truly unavailable    |
| `red_cards`           | integer         | zero stays `0`                                    |
| `minutes_played`      | integer \| null | null: not published by PlayerStandings            |
| `nationality`         | string \| null  | null: not published by PlayerStandings            |
| `season`              | string          | four-digit starting year, e.g. `"2025"`           |
| `source_url`          | string (URL)    | absolute list-page URL                            |

These keys match CardPulse's row mapper, which normalizes snake_case fields
into the strict football contracts. Missing nullable enrichment maps to
explicit null; malformed or missing published fields are quarantined.

## Known page patterns (publicly documented)

- List page: `/competitions/PlayerStandings?comp_id=<digits>` ("Player
  standing - Overall" view).
- This specific list page does not expose player-detail links. CardPulse does
  not invent a detail URL or minutes value when the source does not publish it.

Pick one competition/season list page as the seed URL and keep it stable for
the whole evidence trail.

## Honest use constraints

- StatBunker content is publicly reachable HTML. That does not by itself
  grant permission: verify the site's terms before any live run.
- A permissive robots posture is not a license to crawl aggressively. Use the
  lowest practical request rate (one collector run at a time, no schedules),
  and stop immediately on any HTTP 403 or 429 or equivalent block signal.
- Do not collect images, crests, player photos, or personal data beyond the
  public statistical fields above; never touch login or account pages.
- The local fixtures in this repo stay fictional and OpenLigaDB-inspired.
  They are demo-only; do not replace them with captured StatBunker data, and
  do not redistribute StatBunker data through this repository.
