# CardPulse Football API contract

`packages/contracts/src/index.ts` is authoritative. Responses are JSON,
schemas are strict, and every timestamp is ISO 8601 with an explicit offset.

## Conventions

List responses contain `data`, `pagination`, and `generatedAt`. Detail
responses contain `data` and `generatedAt`.

List query parameters:

| Parameter | Default | Rule                 |
| --------- | ------: | -------------------- |
| `limit`   |      50 | integer, 1–100       |
| `offset`  |       0 | non-negative integer |

Errors use a common envelope with `code`, HTTP `status`, safe `message`,
`requestId`, `details`, and `generatedAt`. Supported codes are
`invalid_request`, `not_found`, `method_not_allowed`, `conflict`,
`validation_failed`, `rate_limited`, `internal_error`, and
`service_unavailable`.

## Read endpoints

| Endpoint                      | Response contract                | Purpose                                         |
| ----------------------------- | -------------------------------- | ----------------------------------------------- |
| `GET /health`                 | `ApiHealthResponseSchema`        | readiness                                       |
| `GET /api/runtime`            | `RuntimeStatusResponseSchema`    | `mock`/`live`, source, configuration readiness  |
| `GET /api/players`            | `PlayerListResponseSchema`       | current verified player cards                   |
| `GET /api/players/{playerId}` | `PlayerDetailResponseSchema`     | player plus full snapshot hash                  |
| `GET /api/teams`              | `TeamListResponseSchema`         | verified team summaries                         |
| `GET /api/standings`          | `StandingsListResponseSchema`    | verified table ordered by rank                  |
| `GET /api/changes`            | `ChangeEventListResponseSchema`  | material football changes                       |
| `GET /api/sources`            | `SourceHealthListResponseSchema` | source health and recovery evidence             |
| `GET /api/quarantines`        | `QuarantineListResponseSchema`   | rejected payload evidence                       |
| `GET /api/healing/{sourceId}` | healing status envelope          | incident, preview, state, and redacted evidence |

## Searchable card endpoints

These serve search → season → generate. Search reads a local cached index;
only an explicit generate can start a real (billable) player-specific match
collection, and every run reports its truthful stage, including failures.

| Endpoint                                      | Purpose                                                                                                 |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `GET /api/search/players?q=&season=`          | partial, case-insensitive lookup over the local cached index; never calls a provider                    |
| `POST /api/player-index/refresh`              | explicit, operator-gated refresh for one registry season; accepts `{ "season": "2025" }`                |
| `GET /api/seasons`                            | verified registry (`745`/`596`/`776`/`791`) with canonical source URLs and completeness                 |
| `POST /api/cards/generate`                    | operator-gated generation; returns a fresh cached card (`200`) or an actual run acknowledgement (`202`) |
| `GET /api/scrapes/{runId}`                    | real run state and stage history; embeds the card only after success                                    |
| `GET /api/cards/{playerId}?season=`           | latest verified, versioned card bundle for one player-season                                            |
| `GET /api/players/{playerId}/seasons`         | verified seasons present in the local index for the player                                              |
| `GET /api/players/{playerId}/matches?season=` | season-bound match availability and rows; unavailability is explained, never zero-filled                |

Rules that hold across all of them:

- unknown seasons fail closed (`invalid_request`), never a guessed URL;
- cached responses carry the same contract shape as fresh ones plus provenance
  showing cache hit versus freshly collected;
- a stale/missing generation uses a cached numeric player ID when available;
  otherwise its one collector run resolves exactly one public exact-name
  search result, proves the numeric ID plus canonical season-match URL on
  every row, validates each completed match, and derives totals only from the
  accepted season-bound rows;
- the default card freshness TTL is 15 minutes and is evaluated only on an
  explicit Generate action; no background or in-match polling is claimed;
- failed or quarantined collections never return demo/fixture data;
- billable generation obeys the same live-mutation flag + operator token
  controls as every other mutation.

The only scrape-stage vocabulary is `finding_player`, `starting_collector`,
`extracting_statistics`, `validating_data`, and `printing_card`, followed by
terminal `succeeded` or `failed`. Stages advance when the corresponding real
operation resolves; no timer manufactures progress.

### Player summary shape

```json
{
  "schemaVersion": 1,
  "playerId": "openligadb-football-demo:player:10",
  "sourceId": "openligadb-football-demo",
  "playerName": "Ari Vega",
  "team": {
    "teamId": "openligadb-football-demo:team:north",
    "name": "Northstar FC"
  },
  "position": "forward",
  "shirtNumber": 10,
  "season": "2025",
  "stats": {
    "appearances": 31,
    "goals": 18,
    "assists": 9,
    "yellowCards": 3,
    "redCards": 0,
    "minutesPlayed": 2520
  },
  "observedAt": "2026-08-20T14:00:00.000Z",
  "latestSnapshot": {
    "snapshotId": "00000000-0000-4000-8000-000000000001",
    "version": 1
  }
}
```

The exact fixture values may differ; this example documents the structure.
`stats.minutesPlayed` is an integer when the source publishes minutes and
explicitly `null` when it does not; unavailable minutes are never converted
to zero.

## Demo/operator mutations

Preserved unchanged from the reliability story; they are local operator
controls, not the judge-facing search flow.

| Endpoint                                                 | Effect                                  |
| -------------------------------------------------------- | --------------------------------------- |
| `POST /api/dev/collect?mode=valid\|drift\|amended\|live` | run one collection scenario             |
| `POST /api/dev/heal-progress`                            | poll the active same-collector refactor |
| `POST /api/dev/validate-preview`                         | run preview schema/count canary         |
| `POST /api/dev/approve`                                  | accept `{ "approve": boolean }`         |

Mock mutation modes are deterministic. In live mode every mutation is denied
unless `CARDPULSE_ENABLE_LIVE_MUTATIONS=true` and the request carries the
configured value in `X-CardPulse-Operator-Token`. Approval returns `409` unless
the incident is already `preview_valid`.

Healing progress, preview validation, and approval accept an optional
`sourceId` query parameter. It defaults to the configured base source. For
player-match drift, use the match source ID from card provenance so preview
mapping and the approved rerun use that exact remembered player-season target;
the same collector ID remains internal and unchanged.

The healing state vocabulary is `healthy`, `quarantined`,
`healing_requested`, `awaiting_approval`, `preview_valid`, `preview_invalid`,
`approved`, `rejected`, `recovered`, and `recovery_failed`.
