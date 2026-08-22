import { validPlayerFixture } from "@bidsentinel/contracts/fixtures";

import { CardPulsePipeline } from "./pipeline.js";

const pipeline = new CardPulsePipeline();
const sourceId = validPlayerFixture.sourceId;
const baseContext = {
  sourceId,
  extractorVersion: "fixture-v1",
  observedAt: validPlayerFixture.observedAt,
};

const initial = pipeline.process(validPlayerFixture, baseContext);
const invalid = pipeline.process(
  {
    ...validPlayerFixture,
    stats: { ...validPlayerFixture.stats, goals: "eighteen" },
  },
  { ...baseContext, observedAt: "2026-08-20T14:05:00.000Z" },
);
const amended = pipeline.process(
  {
    ...validPlayerFixture,
    stats: { ...validPlayerFixture.stats, goals: 21, appearances: 34 },
    observedAt: "2026-08-21T14:00:00.000Z",
  },
  { ...baseContext, observedAt: "2026-08-21T14:00:00.000Z" },
);

console.log(
  JSON.stringify(
    {
      outcomes: [initial.outcome, invalid.outcome, amended.outcome],
      snapshotVersions: pipeline.snapshots
        .list(validPlayerFixture.playerId)
        .map((snapshot) => snapshot.version),
      changeKinds: pipeline.changeEvents
        .list()
        .flatMap((event) => event.changes.map((change) => change.kind)),
      quarantinedExtractions:
        pipeline.quarantines.listBySource(sourceId).length,
      recoveryEvidence: pipeline.recoveryEvidence.listBySource(sourceId).length,
      sourceState: pipeline.sourceHealth.get(sourceId)?.state,
    },
    null,
    2,
  ),
);
