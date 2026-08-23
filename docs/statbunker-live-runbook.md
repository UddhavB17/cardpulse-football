# StatBunker live runbook (terminal-first)

Operator procedure for creating, running, healing, and evidencing the
CardPulse Football StatBunker collector with Bright Data Scraper Studio.
Every step is a terminal command; nothing here is automated in CI.

**Ground rules**

- Secrets go only into the uncommitted `.env`. Never commit, echo, screenshot,
  or paste them. `.env` is already gitignored; verify in step 4.
- Trigger and heal calls are billable Bright Data actions you run on your own
  account. This repository ships no credentials and performs none of these
  calls itself.
- StatBunker is public HTML, but crawlability is not a license: keep one
  collector, run it manually at a low rate, and **stop immediately on any 403
  or 429** (or an equivalent block page). Re-check terms before resuming.
- Do not fabricate evidence. If a step cannot be completed, leave the
  corresponding evidence file absent and keep the README wording honest.

## Step 0 — Prerequisites

```bash
node --version          # v22+
git rev-parse --is-inside-work-tree   # inside the cardpulse-football repo
alias bdata="npx -p @brightdata/cli bdata"
bdata --version
```

A Bright Data account is required for anything past step 3.

## Step 1 — Log in

```bash
bdata login             # opens a browser; stores the key locally, not in the repo
```

Headless alternative (still never committed): `export BRIGHTDATA_API_KEY=…`
in the shell that runs the CLI only.

## Step 2 — Choose one seed URL

Pick one competition/season "Player standing - Overall" list page and freeze
it for the entire trail:

```bash
SEED_URL="https://www.statbunker.com/competitions/PlayerStandings?comp_id=<your_comp_id>"
open "$SEED_URL"        # eyeball it: a table whose rows are players
```

Known public patterns: `/competitions/PlayerStandings?comp_id=…` for the list,
`/players/getPlayerStats?player_id=…` for detail pages.

## Step 3 — Create the collector (billable AI generation, 5–25 min)

```bash
bdata scraper create "$SEED_URL" "$(cat scrapers/statbunker/create-prompt.txt)"
```

Wait for the pipeline stages to finish. The final line prints the real
collector ID:

```text
Template created: c_xxxxxxxxxxxxxxxx
...
Done in N poll attempts.
```

## Step 4 — Capture the real c_* ID into uncommitted .env

```bash
COLLECTOR_ID="c_…"      # paste the value from step 3

# Prove .env is ignored BEFORE writing secrets:
git check-ignore -v .env || { echo ".env is NOT gitignored — stop"; exit 1; }
git status --porcelain  # must stay clean of .env afterwards too
```

Open `.env` in an editor (not `echo`, so tokens stay out of shell history)
and set:

```dotenv
BRIGHT_DATA_API_TOKEN=<token from Account Settings → API Tokens>
BRIGHT_DATA_COLLECTOR_ID=c_the_real_value_from_step_3
BRIGHT_DATA_TARGET_URL=https://www.statbunker.com/competitions/PlayerStandings?comp_id=<your_comp_id>
CARDPULSE_SOURCE_ID=statbunker-epl-2025-26
CARDPULSE_SOURCE_PROFILE=statbunker
CARDPULSE_ENABLE_LIVE_MUTATIONS=false
CARDPULSE_OPERATOR_TOKEN=
```

`127.0.0.1` targets are unreachable from Bright Data's cloud; the StatBunker
URL above is already public, so no tunnel is needed for this source.

## Step 5 — First run (billable) and shape check

```bash
set -a; source .env; set +a    # load without printing values

OUT="$TMPDIR/cardpulse-statbunker-baseline.json"
bdata scraper run "$BRIGHT_DATA_COLLECTOR_ID" "$BRIGHT_DATA_TARGET_URL" --pretty > "$OUT"

jq 'length' "$OUT"                                   # expect 10
jq '.[0] | keys' "$OUT"                              # stable provider shape
jq '[.[] | has("input")] | all' "$OUT"              # provider provenance
jq '[.[].red_cards == 0] | all' "$OUT"               # zeros preserved as numbers
jq '[.[] | (.minutes_played? // null) == null and (.nationality? // null) == null] | all' "$OUT"
jq -e '.[0] | .player_name == "Jarrod Bowen" and .appearances == 38 and .goals == 9 and .assists == 11' "$OUT"
```

The completed dataset can omit requested keys whose value is null and add an
`input` object. CardPulse normalizes that documented provider shape. If any
published-field or sentinel check fails, fix the prompt via heal (step 7)
before continuing.

### Raw-HTTP equivalent (what CardPulse itself does)

```bash
TRIGGER=$(curl -sS -X POST \
  "https://api.brightdata.com/dca/trigger?collector=$BRIGHT_DATA_COLLECTOR_ID&queue_next=1" \
  -H "Authorization: Bearer $BRIGHT_DATA_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d "[{\"url\": \"$BRIGHT_DATA_TARGET_URL\"}]")
echo "$TRIGGER" | jq '{collection_id}'        # j_* snapshot id
SNAPSHOT=$(echo "$TRIGGER" | jq -r '.collection_id')

while :; do
  response=$(curl -sS "https://api.brightdata.com/dca/dataset?id=$SNAPSHOT" \
    -H "Authorization: Bearer $BRIGHT_DATA_API_TOKEN")
  if [[ "${response:0:1}" == "[" ]]; then break; fi
  sleep 5
done
printf '%s' "$response" > "$TMPDIR/cardpulse-statbunker-baseline-http.json"
```

Stop conditions apply to both paths: any `401`/`404`/`422` means
configuration trouble (token, ID, input schema); any `403`/`429` from the
target or provider means stop and reassess — do not retry through blocks.

## Step 6 — Connect CardPulse live mode

Generate the operator token, then add both lines to `.env` in your editor
(still uncommitted), pasting the generated value as a literal string — never
as part of a shell command:

```bash
openssl rand -hex 32     # copy the output into .env below
```

```dotenv
CARDPULSE_ENABLE_LIVE_MUTATIONS=true
CARDPULSE_OPERATOR_TOKEN=<paste the openssl output here>
```

```bash
pnpm install
pnpm dev:chaos-source     # terminal 1 (local demo target; optional here)
pnpm start:api            # terminal 2
pnpm dev:web              # terminal 3

curl -s http://127.0.0.1:4321/api/runtime | jq   # expect mode: "live", valid c_* id
pnpm collect               # one CardPulse cycle: trigger → poll → map → validate → snapshot
```

The UI badge and `/api/runtime` now say `live`. Every billable mutation stays
denied unless `CARDPULSE_ENABLE_LIVE_MUTATIONS=true` **and** requests carry
`X-CardPulse-Operator-Token: <value>`.

## Step 7 — Same-ID heal / approval / rerun flow

Run this when extraction drifts (nulls, missing keys, wrong counts) — from a
real StatBunker layout change or a controlled equivalent you serve yourself.
Do not use `--auto-approve`; human review is part of the product story.

```bash
# 1) Heal the SAME collector (prompt ≤ 1000 chars by design).
#    The envelope returns status "awaiting_approval" plus a preview_result:
bdata scraper heal "$BRIGHT_DATA_COLLECTOR_ID" \
  "$(cat scrapers/statbunker/heal-prompt.txt)" \
  --url "$BRIGHT_DATA_TARGET_URL" | tee "$TMPDIR/cardpulse-statbunker-heal.json"

# 2) Validate the preview BEFORE approving. Scraper Studio currently samples
#    two rows in previews; the post-approval run remains the 10-row count gate:
PREVIEW="$TMPDIR/cardpulse-statbunker-heal-preview.json"
jq '.preview_result' "$TMPDIR/cardpulse-statbunker-heal.json" > "$PREVIEW"

jq -e 'length > 0' "$PREVIEW"                         # non-empty sample
jq -e 'all(.[]; (keys | length) == 14)' "$PREVIEW"    # stable key set
jq -e 'all(.[]; .minutes_played == null or (.minutes_played | type) == "number")' "$PREVIEW"
jq -e 'all(.[]; .red_cards == null or (.red_cards | type) == "number")' "$PREVIEW"
jq -e '.[0] | .player_name == "Jarrod Bowen" and .appearances == 38 and .goals == 9 and .assists == 11 and .yellow_cards == 4 and .second_yellow_cards == 0 and .red_cards == 0' "$PREVIEW"
# reject the fix if these fail: bdata scraper approve "$BRIGHT_DATA_COLLECTOR_ID" --reject

# 3) Explicit human approval (same c_* ID, no new collector):
bdata scraper approve "$BRIGHT_DATA_COLLECTOR_ID" --auto-save --url "$BRIGHT_DATA_TARGET_URL"
# status advances to done; --reject leaves the collector unchanged instead

# 4) Rerun the SAME collector and confirm recovery:
bdata scraper run "$BRIGHT_DATA_COLLECTOR_ID" "$BRIGHT_DATA_TARGET_URL" --pretty \
  > "$TMPDIR/cardpulse-statbunker-postheal.json"
jq 'length' "$TMPDIR/cardpulse-statbunker-postheal.json"   # 10 healthy rows again
jq '[.[] | select(has("error") or has("error_code"))] | length' "$TMPDIR/cardpulse-statbunker-postheal.json" # 0
```

Through CardPulse instead of raw CLI, the same flow maps to the dev/operator
routes (all require the operator token header):

| Action              | Call                                               |
| ------------------- | -------------------------------------------------- |
| poll refactor       | `POST /api/dev/heal-progress`                      |
| schema/count canary | `POST /api/dev/validate-preview`                   |
| explicit approval   | `POST /api/dev/approve` with `{ "approve": true }` |

Watch the healing state advance
`quarantined → healing_requested → awaiting_approval → preview_valid →
approved → recovered` at `GET /api/healing/statbunker-epl-2025-26`, and
record the recovery hashes/counts it exposes.

Assert identity preservation across every artifact:

```bash
grep -rhoE 'c_[A-Za-z0-9_-]+' "$TMPDIR"/cardpulse-statbunker-*.json | sort -u
# after redaction this must show exactly ONE partially masked ID everywhere
```

### Step 7a — Searchable-card same-ID refactor

Before recording the searchable player-card flow, refactor the same collector
with the current dual-mode prompt (this is a separate billable/mutating action
and still requires explicit approval):

```bash
bdata scraper heal "$BRIGHT_DATA_COLLECTOR_ID" \
  "$(cat scrapers/statbunker/searchable-card-refactor-prompt.txt)" \
  --url "https://www.statbunker.com/competitions/PlayerStandings?comp_id=776" \
  > "$TMPDIR/cardpulse-searchable-refactor.json"
```

Review a non-empty `PlayerStandings` preview whose rows carry the input
`comp_id`'s mapped season, then explicitly approve the same `c_*` collector.
After approval, the cold Erling Haaland path needs two deliberately authorized
collections: one full season-index refresh, then one Generate run whose input
is the exact-name `/usual/search` URL and whose output rows all repeat the same
numeric player ID and canonical `SeasonMatches` source URL. A warm/stale later
Generate uses that cached numeric ID directly. Do not claim that the refactor
preview proves both branches; the narrow post-approval resolver run is the
observable check for the second branch.

## Step 8 — Redact and file evidence

```bash
mkdir -p evidence/live
redact() {
  sed -E 's/(c_[A-Za-z0-9_-]{6})[A-Za-z0-9_-]+([A-Za-z0-9_-]{4})/\1****\2/g' "$1" \
    | grep -v -i 'authorization\|bearer\|api[_-]key\|operator[_-]token' > "$2"
}
redact "$TMPDIR/cardpulse-statbunker-baseline.json"        evidence/live/statbunker-baseline.redacted.json
redact "$TMPDIR/cardpulse-statbunker-heal-preview.json"    evidence/live/statbunker-heal-preview.redacted.json
redact "$TMPDIR/cardpulse-statbunker-postheal.json"        evidence/live/statbunker-postheal.redacted.json
```

Before committing any of it:

```bash
grep -rF "$BRIGHT_DATA_API_TOKEN" . && echo "LEAK — remove" || true
grep -rF "$CARDPULSE_OPERATOR_TOKEN" . && echo "LEAK — remove" || true
grep -rn 'Bearer' evidence/ || true
```

Then tick the matching boxes in [evidence/README.md](../evidence/README.md).
Keep only redacted JSON, terminal excerpts where IDs are already masked, and
short screenshots that show no token. If a capture does not exist, its file
and checkbox stay absent — absence is honest; placeholders are not.

## Step 9 — Update demo video and submission links

1. Record the screen running steps 5–7 end to end (~60 s). Before recording:
   `set +x`, close any editor showing `.env`, and re-run the leak greps.
2. Upload the video and add the real URL to the **Hackathon submission
   artifacts** section of the root `README.md`.
3. Replace the "intentionally not represented as complete" note there only
   once both artifacts (video + redacted `c_*` trail) actually exist, and
   flip the "Still required before a live claim" bullet in **Evidence
   status** accordingly.
4. Final sanity before filing:

```bash
pnpm format:check
pnpm check
```

## Cleanup / rollback

- Return to safe mock mode by blanking `BRIGHT_DATA_API_TOKEN`,
  `BRIGHT_DATA_COLLECTOR_ID`, and setting
  `CARDPULSE_ENABLE_LIVE_MUTATIONS=false` in `.env`.
- Pause or delete the collector in Scraper Studio if you no longer need it;
  leaving scheduled runs enabled keeps consuming credits.
