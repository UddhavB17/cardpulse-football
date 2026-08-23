# Scraper Studio prompts for StatBunker

Three paste-ready prompts live in this folder. The `.txt` files are the
canonical byte source; the blocks below are copies kept in sync by review.

- `create-prompt.txt` — used once, at creation time. It is deliberately at or
  below the Bright Data CLI's 500-character description limit.
- `heal-prompt.txt` — the same contract compressed to 834 characters because
  CardPulse's healing adapter sends the repair prompt to
  `POST /dca/collectors/{c_*}/refactor_template`, which must be 1–1000
  characters (enforced in `packages/brightdata`). Use it for same-ID heals so
  a repaired collector keeps emitting the verified list-page shape.
- `searchable-card-refactor-prompt.txt` — the current same-ID dual-mode
  refactor: a complete verified-season player index or an exact-name resolver
  followed by that player's canonical completed-match table. It remains under
  the refactor endpoint's 1000-character limit.

## Create prompt

```text
On StatBunker PlayerStandings, never wait for #show or click More. Extract the first 10 table.table tbody rows. Map direct td positions 1–9 to player_name, team_name, position, appearances, goals, assists, yellow_cards, second_yellow_cards, red_cards. Preserve numeric 0. Set player_url, minutes_played, nationality to null; season to "2025"; source_url to the input URL. Return only those 14 keys. No images or pagination.
```

## Heal prompt (≤ 1000 chars)

```text
Repair StatBunker without #show or More. Use table.table > tbody > tr and the first 10 rows. Use 1-based direct child cells: player_name=td[1], team_name=td[2], position=td[3], appearances=td[4], goals=td[5], assists=td[6], yellow_cards=td[7], second_yellow_cards=td[8], red_cards=td[9]. Do not select later cells by generic class. For comp_id=776 the first-row sentinel is Jarrod Bowen: 38 appearances, 9 goals, 11 assists, 4 yellow, 0 second-yellow, 0 red; fail if shifted. Output only the 14 documented keys. player_url=null, minutes_played=null, nationality=null; season="2025"; source_url=input URL. Preserve numeric zero. Preview may sample fewer rows; the actual run must return exactly 10.
```

## Why the rules look like this

- **First 10 rows only** — bounds cost and request volume to one list page.
- **No detail/More interaction** — the live page uses More only to reveal
  hidden columns and exposes no player link in these rows. The unavailable
  minutes, nationality, and player URL stay null instead of being invented.
- **Preserve numeric zero** — `0` cards or `0` goals is real data; collapsing
  it to `null` would corrupt discipline statistics downstream.
- **Null only for truly unavailable optional fields** — the strict contracts
  quarantine invented values; honest nulls survive validation.
- **No images / personal data / login pages** — keeps the collector inside
  public statistics and away from accounts, ads, and photos.
- **Provider-aware shape** — previews include requested null keys, while
  completed datasets can omit them and add `input`; CardPulse normalizes both
  without weakening checks on the published fields.

An illustrative example of this row shape (hand-written, not captured from a
live run) is [examples/structured-output.json](../../examples/structured-output.json).

## Searchable-card same-ID refactor (≤ 1000 chars)

```text
On PlayerStandings read comp_id: 745=2023,596=2024,776=2025,791=2026; otherwise fail. Extract every table.table tbody row, direct td1..9 as player_name,team_name,position,appearances,goals,assists,yellow_cards,second_yellow_cards,red_cards. Set player_url,minutes_played,nationality=null; season=mapped year; source_url=input. On /usual/search read search,comps_id; require exactly one player link with normalized visible text equal to search, else fail. Parse numeric player_id; open /players/SeasonMatches?comps_id={id}&comps_type=EPL&player_id={player}. Extract every table.table tbody row: td1 competition,2 home_team,3 score,4 away_team,5 started,6 substitute,7 minutes_played,9 goals,12 assists,13 yellow_cards,14 second_yellow_cards,15 red_cards,16 played_on. Repeat resolved_player_name,resolved_player_id,resolved_player_url and canonical source_url on every row. Preserve numeric 0. No pagination, images, login, guesses, or partial name matches.
```

The two branches are deliberate. The list page has no per-player link, so its
stable local identity is name + club. A paid Generate for such a row targets
the public exact-name search URL, accepts only one exact result, and performs
the canonical `SeasonMatches` extraction in that same provider run. Once
verified, CardPulse caches the numeric player ID for direct later refreshes.
