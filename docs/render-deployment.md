# Render deployment

CardPulse deploys as two Render services from the repository root:

1. `cardpulse-football-api` — Node web service
2. `cardpulse-football-web` — Vite static site

`render.yaml` contains the complete free-tier configuration. It targets the
`player-search-experience` branch and leaves all secrets for entry in the
Render dashboard.

## Manual backend settings

- Runtime: `Node`
- Branch: `player-search-experience`
- Root directory: blank
- Build command: `pnpm install --frozen-lockfile`
- Start command: `pnpm --filter @bidsentinel/collector-worker start`
- Health check path: `/health`

Environment:

```text
HOST=0.0.0.0
CARDPULSE_ALLOWED_ORIGINS=https://<your-static-site>.onrender.com
CARDPULSE_SOURCE_ID=statbunker-premier-league
CARDPULSE_SOURCE_PROFILE=statbunker
CARDPULSE_ENABLE_LIVE_MUTATIONS=true
BRIGHT_DATA_TARGET_URL=https://www.statbunker.com/competitions/PlayerStandings?comp_id=791
BRIGHT_DATA_API_TOKEN=<secret>
BRIGHT_DATA_COLLECTOR_ID=<secret c_* collector ID>
CARDPULSE_OPERATOR_TOKEN=<server-only admin secret of at least 32 characters>
```

Render supplies `PORT`; do not hardcode it. The server validates the port,
binds to `HOST`, and fails closed if the CORS origin list contains paths or
malformed values.

## Manual frontend settings

- Runtime: `Static Site`
- Branch: `player-search-experience`
- Root directory: blank
- Build command: `pnpm install --frozen-lockfile && pnpm --filter @bidsentinel/web build`
- Publish directory: `apps/web/dist`
- Environment: `VITE_API_BASE_URL=https://<your-api>.onrender.com`

If either Render service gets a different hostname, update both
`VITE_API_BASE_URL` and `CARDPULSE_ALLOWED_ORIGINS`, then redeploy the static
site so Vite embeds the corrected API URL.

The browser never receives or asks for `CARDPULSE_OPERATOR_TOKEN`. Public index
preparation and card generation are enabled by the server-side live-mutation
switch and protected with caching, in-flight deduplication, and per-client rate
limits. The token remains required only for admin/healing mutation routes.

## Operational limitation

The current MVP keeps its player index and generated cards in process memory.
A backend restart or free-tier sleep starts cold, but the web app immediately
prepares 2026/27 and the first concurrent search shares that same Bright Data
run. Use an always-on instance for the smoothest judge session and to preserve
warm caches between visits.
