# Football snapshot and semantic diff rules

`diffFootballSnapshots` is a pure deterministic function. It accepts a
previous `FootballSnapshot` or `null`, a current snapshot or `null`, and
`SnapshotSourceHealth`. It performs no network or LLM calls.

## Decisions

| Decision          | Meaning                                                            |
| ----------------- | ------------------------------------------------------------------ |
| `accept_current`  | current snapshot is structurally and operationally trusted         |
| `retain_previous` | input is invalid, unhealthy, suspicious, or absence is unconfirmed |
| `mark_removed`    | a healthy non-empty source confirmed entity absence twice          |

An `invalid_snapshot` event can only accompany `retain_previous`; the result
schema enforces that invariant.

## Safety order

1. Parse previous/current snapshots and source health with strict contracts.
2. Reject unhealthy source state, identity mismatch, chronology regression,
   and non-monotonic versions.
3. Reject suspicious record-count collapse and temporary empty results.
4. Require two healthy absence confirmations before removal.
5. Compare canonical scalar fields for player, team, or standing records.

Default count policy:

- collapse checks begin at 10 previous records;
- a drop greater than 50% retains the previous snapshot;
- zero after non-zero is invalid, not removal;
- removal requires two consecutive absences and a healthy non-empty batch.

## Event vocabulary

The semantic engine emits `new_record`, `field_changed`, `entity_removed`,
`no_change`, or `invalid_snapshot`, each with `semantic-diff-v1` evidence.

The product-facing change detector groups accepted scalar changes into:

- player goals, assists, appearances, minutes, discipline, and profile;
- team profile changes;
- standing rank, points, played/won/drawn/lost, goals for/against, and team
  label changes.

Every accepted material state has a stable payload hash. Re-observing identical
business data does not create another snapshot merely because `observedAt`
changed.

## Batch drift is separate from semantic change

The pipeline only requests healing when layout drift is confirmed:

- a verified batch collapses below its safety threshold;
- a structural majority of rows fails after a baseline; or
- before any baseline, the same majority structural signature repeats across
  two runs.

A first-ever empty batch and a minority malformed row are never sufficient.
They are either ignored as no baseline evidence or quarantined as row noise.
This keeps self-healing useful without making one malformed football value a
billable scraper mutation.
