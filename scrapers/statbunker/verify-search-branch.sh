#!/usr/bin/env bash
# One-shot verification for the StatBunker collector search branch.
# Run after publishing the healed template in Scraper Studio UI.
set -euo pipefail
cd "$(dirname "$0")/../.."
set -a; source .env; set +a

SEARCH_URL="https://www.statbunker.com/usual/search?action=Find&search=Erling%20Haaland&comps_id=776&comps_type=EPL"
SAKA_URL="https://www.statbunker.com/usual/search?action=Find&search=Bukayo%20Saka&comps_id=776&comps_type=EPL"
STANDINGS_URL="https://www.statbunker.com/competitions/PlayerStandings?comp_id=776"

echo "1) Haaland search"
npx -y -p @brightdata/cli bdata scraper run "$BRIGHT_DATA_COLLECTOR_ID" "$SEARCH_URL" --timeout 300 2>/dev/null \
  | jq '{rows: length, errors: [.[] | select(has("error"))] | length, player_id: .[0].resolved_player_id, source: .[0].source_url}'

echo "2) Standings (expect ~679)"
npx -y -p @brightdata/cli bdata scraper run "$BRIGHT_DATA_COLLECTOR_ID" "$STANDINGS_URL" --timeout 300 2>/dev/null \
  | jq 'length'

echo "3) Saka search error rows (expect 0)"
npx -y -p @brightdata/cli bdata scraper run "$BRIGHT_DATA_COLLECTOR_ID" "$SAKA_URL" --timeout 300 2>/dev/null \
  | jq '[.[] | select(has("error"))] | length'
