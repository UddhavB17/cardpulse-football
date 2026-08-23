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

The browser workflow is live-operator only. A new API process has an empty live
index until an authorized refresh:

```bash
curl -s "http://127.0.0.1:4321/api/search/players?q=haaland" | jq '.data' # [] before refresh
curl -s http://127.0.0.1:4321/api/seasons | jq '[.data[].compId]'   # 745, 596, 776, 791
```

Search reads a local cached index. Open **Live operator controls**
in the browser and explicitly refresh one verified season before searching;
the refresh and a stale/missing generation are protected billable mutations.
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
present and the collector ID is a valid `c_*` value. A live collection or heal
also requires the mutation flag plus a private token of at least 32 characters.
Send that token only in `X-CardPulse-Operator-Token`.

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
