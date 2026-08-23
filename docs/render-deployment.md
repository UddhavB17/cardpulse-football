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
- Build command: `corepack enable && pnpm install --frozen-lockfile`
- Start command: `pnpm --filter @bidsentinel/collector-worker start`
- Health check path: `/health`

Environment:

```text
HOST=0.0.0.0
CARDPULSE_ALLOWED_ORIGINS=https://<your-static-site>.onrender.com
CARDPULSE_SOURCE_ID=statbunker-epl-2025-26
CARDPULSE_SOURCE_PROFILE=statbunker
CARDPULSE_ENABLE_LIVE_MUTATIONS=true
BRIGHT_DATA_TARGET_URL=https://www.statbunker.com/competitions/PlayerStandings?comp_id=776
BRIGHT_DATA_API_TOKEN=<secret>
BRIGHT_DATA_COLLECTOR_ID=<secret c_* collector ID>
CARDPULSE_OPERATOR_TOKEN=<private random value of at least 32 characters>
```

Render supplies `PORT`; do not hardcode it. The server validates the port,
binds to `HOST`, and fails closed if the CORS origin list contains paths or
malformed values.

## Manual frontend settings

- Runtime: `Static Site`
- Branch: `player-search-experience`
- Root directory: blank
- Build command: `corepack enable && pnpm install --frozen-lockfile && pnpm --filter @bidsentinel/web build`
- Publish directory: `apps/web/dist`
- Environment: `VITE_API_BASE_URL=https://<your-api>.onrender.com`

If either Render service gets a different hostname, update both
`VITE_API_BASE_URL` and `CARDPULSE_ALLOWED_ORIGINS`, then redeploy the static
site so Vite embeds the corrected API URL.

## Operational limitation

The current MVP keeps its player index and generated cards in process memory.
A backend restart or free-tier sleep starts with an empty index. Refresh the
desired season after a restart before searching. Use an always-on instance for
a judge session if losing that in-memory state would interrupt the demo.
