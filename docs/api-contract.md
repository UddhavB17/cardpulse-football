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

| Endpoint                                                 | Effect                                  |
| -------------------------------------------------------- | --------------------------------------- |
| `POST /api/dev/collect?mode=valid\|drift\|amended\|live` | run one collection scenario             |
| `POST /api/dev/heal-progress`                            | poll the active same-collector refactor |
| `POST /api/dev/validate-preview`                         | run preview schema/count canary         |
| `POST /api/dev/approve`                                  | accept `{ "approve": true               | false }` |

Mock mutation modes are deterministic. In live mode every mutation is denied
unless `CARDPULSE_ENABLE_LIVE_MUTATIONS=true` and the request carries the
configured value in `X-CardPulse-Operator-Token`. Approval returns `409` unless
the incident is already `preview_valid`.

The healing state vocabulary is `healthy`, `quarantined`,
`healing_requested`, `awaiting_approval`, `preview_valid`, `preview_invalid`,
`approved`, `rejected`, `recovered`, and `recovery_failed`.
