# Scraper Studio prompts for StatBunker

Two paste-ready prompts live in this folder. The `.txt` files are the
canonical byte source; the blocks below are copies kept in sync by review.

- `create-prompt.txt` — used once, at creation time. It is deliberately at or
  below the Bright Data CLI's 500-character description limit.
- `heal-prompt.txt` — the same contract compressed to 834 characters because
  CardPulse's healing adapter sends the repair prompt to
  `POST /dca/collectors/{c_*}/refactor_template`, which must be 1–1000
  characters (enforced in `packages/brightdata`). Use it for same-ID heals so
  a repaired collector keeps emitting exactly the canonical shape.

## Create prompt

```text
Extract the first 10 player rows from the main standings table. Follow each player detail/More link. Return player_name, player_url, team_name, position, appearances, goals, assists, yellow_cards, second_yellow_cards, red_cards, minutes_played, nationality, season, source_url. Use absolute URLs and integers; preserve 0 and use null only if absent. Normalize position to goalkeeper/defender/midfielder/forward and season to its four-digit start year. No images or pagination.
```

## Heal prompt (≤ 1000 chars)

```text
One public StatBunker competition player-stats HTML table. Return one JSON object per row for ONLY the first 10 player rows, in table order, each with exactly these keys: player_name, player_url, team_name, position, appearances, goals, assists, yellow_cards, second_yellow_cards, red_cards, minutes_played, nationality, season, source_url. Open each player's detail link (/players/getPlayerStats?player_id=...) to fill minutes_played and nationality. position is one of goalkeeper, defender, midfielder, forward, or null. season is the four-digit starting year, e.g. "2025". Stats are integers: keep 0 as the number 0, never null. Use null only when an optional field is truly unavailable; never invent values. No images, personal data, or login/register pages. Traverse only the list page plus those 10 detail pages; no pagination.
```

## Why the rules look like this

- **First 10 rows only** — bounds cost and request volume to one list page
  plus ten detail pages per run.
- **Follow each detail/More link** — `minutes_played` and `nationality` are
  not columns on the standings-style list page; they live on the player page.
- **Preserve numeric zero** — `0` cards or `0` goals is real data; collapsing
  it to `null` would corrupt discipline statistics downstream.
- **Null only for truly unavailable optional fields** — the strict contracts
  quarantine invented values; honest nulls survive validation.
- **No images / personal data / login pages** — keeps the collector inside
  public statistics and away from accounts, ads, and photos.
- **Stable key set** — CardPulse maps snake_case fields into its Zod
  contracts; a drifting shape shows up as quarantine plus batch drift, which
  is the signal that triggers same-ID healing in the first place.

An illustrative example of this row shape (hand-written, not captured from a
live run) is [examples/structured-output.json](../../examples/structured-output.json).
