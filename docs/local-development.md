# Local development

## Setup

```bash
corepack enable
pnpm install
cp .env.example .env
```

`.env` is gitignored. Node loads the root file through
`--env-file-if-exists=../../.env` in the collector-worker scripts; there is no
dotenv dependency. Blank Bright Data credentials select safe mock mode.

## Run the full local product

Use three terminals:

```bash
pnpm dev:chaos-source
pnpm start:api
pnpm dev:web
```

Open:

- web: `http://127.0.0.1:4173`
- API runtime truth: `http://127.0.0.1:4321/api/runtime`
- scraper target: `http://127.0.0.1:4311/players`
- local chaos controls: `http://127.0.0.1:4311/__control`

Chaos modes are `baseline-table`, `drift-cards`, `amended-stats`, and
`unavailable`.

## Searchable card flow

The browser has no credential step. A configured live process automatically
prepares the current 2026/27 index on page load or first search:

```bash
curl -s "http://127.0.0.1:4321/api/search/players?q=haaland" | jq '.data' # prepares once when cold
curl -s http://127.0.0.1:4321/api/seasons | jq '[.data[].compId]'   # 745, 596, 776, 791
```

Search reads a validated local cache after one deduplicated Bright Data
preparation. Player and club queries share it; no provider call occurs per
keystroke. A stale/missing generation is another explicit billable mutation,
cached and rate-limited by the API.
Generation collects the selected player's verified `SeasonMatches` page. If
the standings index has no numeric player link, the same one-run collector
starts at the public exact-name search URL, proves one numeric ID, and then
extracts the canonical match table;
after StatBunker publishes a completed match, the next explicit Generate after
the 15-minute TTL recalculates the card. There is no background polling.
Unknown seasons fail closed. See
[the searchable card demo guide](searchable-card-demo.md) for the full flow,
truth boundaries, and test matrix.

## Environment variables

```dotenv
BRIGHT_DATA_API_TOKEN=
BRIGHT_DATA_COLLECTOR_ID=
BRIGHT_DATA_TARGET_URL=http://127.0.0.1:4311/players
CARDPULSE_SOURCE_ID=openligadb-football-demo
CARDPULSE_ENABLE_LIVE_MUTATIONS=false
CARDPULSE_OPERATOR_TOKEN=
```

The API enters live mode only when all three `BRIGHT_DATA_*` values are
present and the collector ID is a valid `c_*` value. Public index preparation
and generation require the mutation flag but no browser token. Healing and
development mutation routes additionally require the private 32+ character
admin token in `X-CardPulse-Operator-Token`.

`127.0.0.1` cannot be reached by Bright Data's cloud. For a real run, deploy or
tunnel the chaos source, keep `/__control` private, and set
`BRIGHT_DATA_TARGET_URL` to the public `/players` URL.

Legacy `BIDSENTINEL_*` variables remain a code-only migration fallback. Do not
use them for new setup.

## Commands

```bash
pnpm collect          # one live cycle if configured; safe mock check otherwise
pnpm demo:collector   # local validation/quarantine/amendment story
pnpm check            # lint + typecheck + tests + builds + collector demo
```

Focused workspaces:

```bash
pnpm --filter @bidsentinel/contracts test
pnpm --filter @bidsentinel/brightdata test
pnpm --filter @bidsentinel/collector-worker test
pnpm --filter @bidsentinel/web test
```

Never commit `.env`, paste tokens into recorded terminals, expose `/__control`,
or deploy the `/api/dev/*` routes without real authentication.
