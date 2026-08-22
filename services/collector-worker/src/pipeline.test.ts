import { describe, expect, it, vi } from "vitest";

import { MockBrightDataHealingProvider } from "@bidsentinel/brightdata";

import {
  amendedPlayerFixture,
  demoRecordsFor,
  validPlayerFixture,
} from "@bidsentinel/contracts/fixtures";

import { CardPulsePipeline } from "./pipeline.js";
import { SelfHealingCoordinator } from "./healing-coordinator.js";

const context = {
  sourceId: "openligadb",
  extractorVersion: "fixture-v1",
  observedAt: validPlayerFixture.observedAt,
};

function playerRow(index: number) {
  return {
    ...validPlayerFixture,
    playerId: `openligadb:player:row-${index}`,
    externalId: `player-row-${index}`,
    sourceUrl: `https://data.football-demo.test/openligadb/players/row-${index}`,
  };
}

describe("CardPulsePipeline", () => {
  it("creates immutable card versions and suppresses duplicate observations", () => {
    const pipeline = new CardPulsePipeline();
    const first = pipeline.process(validPlayerFixture, context);
    const duplicate = pipeline.process(
      {
        ...validPlayerFixture,
        observedAt: "2026-08-20T14:10:00.000Z",
      },
      { ...context, observedAt: "2026-08-20T14:10:00.000Z" },
    );

    expect(first.outcome).toBe("accepted");
    expect(duplicate.outcome).toBe("accepted");
    if (first.outcome === "accepted" && duplicate.outcome === "accepted") {
      expect(first.snapshot?.version).toBe(1);
      expect(duplicate.snapshot).toBeNull();
    }
    expect(pipeline.snapshots.list(validPlayerFixture.playerId)).toHaveLength(
      1,
    );
  });

  it("detects amended stats as living-card changes", () => {
    const pipeline = new CardPulsePipeline();
    pipeline.process(validPlayerFixture, context);
    const changed = pipeline.process(amendedPlayerFixture, {
      ...context,
      observedAt: amendedPlayerFixture.observedAt,
    });

    expect(changed.outcome).toBe("accepted");
    if (changed.outcome === "accepted") {
      expect(changed.snapshot?.version).toBe(2);
      expect(changed.changeEvent?.changes.map((change) => change.kind)).toEqual(
        ["appearances", "goals", "minutes"],
      );
      expect(changed.changeEvent?.changes).toMatchObject([
        { kind: "appearances", before: 33, after: 34 },
        { kind: "goals", before: 18, after: 21 },
        { kind: "minutes", before: 2820, after: 2910 },
      ]);
    }
  });

  it("quarantines invalid extraction and records verified recovery", () => {
    const pipeline = new CardPulsePipeline();
    const invalid = pipeline.process(
      {
        ...validPlayerFixture,
        stats: { ...validPlayerFixture.stats, goals: "eighteen" },
      },
      context,
    );
    const recoveryTime = "2026-08-20T14:10:00.000Z";
    const recovered = pipeline.process(
      { ...validPlayerFixture, observedAt: recoveryTime },
      { ...context, observedAt: recoveryTime },
    );

    expect(invalid.outcome).toBe("quarantined");
    if (invalid.outcome === "quarantined") {
      expect(invalid.health.state).toBe("quarantined");
    }
    expect(pipeline.quarantines.listBySource("openligadb")).toHaveLength(1);

    expect(recovered.outcome).toBe("accepted");
    if (recovered.outcome === "accepted") {
      expect(recovered.health.state).toBe("healthy");
      expect(recovered.recoveryEvidence?.outcome).toBe("recovered");
      expect(recovered.recoveryEvidence?.verification).toMatchObject({
        validRecordCount: 1,
        quarantinedCount: 1,
        sampleEntityIds: [validPlayerFixture.playerId],
      });
    }
    expect(pipeline.recoveryEvidence.listBySource("openligadb")).toHaveLength(
      1,
    );
  });

  it("rejects semantically regressed snapshots without replacing the verified card", () => {
    const pipeline = new CardPulsePipeline();
    pipeline.process(validPlayerFixture, context);

    const regressed = pipeline.process(
      {
        ...validPlayerFixture,
        stats: { ...validPlayerFixture.stats, goals: 2 },
        observedAt: "2026-08-19T14:00:00.000Z",
      },
      { ...context, observedAt: "2026-08-19T14:00:00.000Z" },
    );

    expect(regressed.outcome).toBe("quarantined");
    expect(pipeline.snapshots.list(validPlayerFixture.playerId)).toHaveLength(
      1,
    );
    const stored = pipeline.snapshots.latest(validPlayerFixture.playerId);
    expect(stored?.record.entityType).toBe("player");
    if (stored?.record.entityType === "player") {
      expect(stored.record.stats.goals).toBe(18);
    }
  });

  it("keeps stored cards isolated from returned mutable objects", () => {
    const pipeline = new CardPulsePipeline();
    const accepted = pipeline.process(validPlayerFixture, context);
    if (accepted.outcome !== "accepted" || accepted.snapshot === null) {
      throw new Error("Fixture must produce a snapshot");
    }

    if (accepted.snapshot.record.entityType === "player") {
      accepted.snapshot.record.stats.goals = 0;
    }
    accepted.health.state = "quarantined";
    const readCopy = pipeline.snapshots.latest(validPlayerFixture.playerId);
    if (readCopy === null) {
      throw new Error("Expected stored snapshot");
    }
    if (readCopy.record.entityType === "player") {
      readCopy.record.stats.goals = 99;
    }

    const storedAfterMutation = pipeline.snapshots.latest(
      validPlayerFixture.playerId,
    );
    if (storedAfterMutation?.record.entityType === "player") {
      expect(storedAfterMutation.record.stats.goals).toBe(18);
    }
    expect(pipeline.sourceHealth.get("openligadb")?.state).toBe("healthy");
  });

  it("classifies structural extraction failure as schema drift", () => {
    const pipeline = new CardPulsePipeline();
    const invalidShape: Record<string, unknown> =
      structuredClone(validPlayerFixture);
    Reflect.deleteProperty(invalidShape, "playerName");

    const result = pipeline.process(invalidShape, context);

    expect(result.outcome).toBe("quarantined");
    if (result.outcome === "quarantined") {
      expect(result.health.activeIncident?.reason).toBe("schema-drift");
    }
  });

  it("quarantines one malformed row in a large batch without healing", async () => {
    const provider = new MockBrightDataHealingProvider();
    const trigger = vi.spyOn(provider, "triggerRefactor");
    const pipeline = new CardPulsePipeline();
    pipeline.healingCoordinator = new SelfHealingCoordinator(provider);
    const validRows = Array.from({ length: 99 }, (_, index) =>
      playerRow(index),
    );

    const results = await pipeline.processBatchWithHealing(
      [
        ...validRows,
        { entityType: "player", playerId: "openligadb:player:broken" },
      ],
      { ...context, collectorId: "c_batch_safe" },
    );

    expect(
      results.filter((result) => result.outcome === "accepted"),
    ).toHaveLength(99);
    expect(
      results.filter((result) => result.outcome === "quarantined"),
    ).toHaveLength(1);
    expect(trigger).not.toHaveBeenCalled();
  });

  it("does not heal a first-ever empty batch without a verified baseline", async () => {
    const provider = new MockBrightDataHealingProvider();
    const trigger = vi.spyOn(provider, "triggerRefactor");
    const pipeline = new CardPulsePipeline();
    pipeline.healingCoordinator = new SelfHealingCoordinator(provider);

    const results = await pipeline.processBatchWithHealing([], {
      ...context,
      collectorId: "c_initial_empty",
    });

    expect(results).toEqual([]);
    expect(pipeline.quarantines.listBySource("openligadb")).toEqual([]);
    expect(trigger).not.toHaveBeenCalled();
  });

  it("heals a count collapse only after a verified batch baseline", async () => {
    const provider = new MockBrightDataHealingProvider();
    const trigger = vi.spyOn(provider, "triggerRefactor");
    const pipeline = new CardPulsePipeline();
    pipeline.healingCoordinator = new SelfHealingCoordinator(provider);
    const baseline = Array.from({ length: 4 }, (_, index) => playerRow(index));
    const batchContext = { ...context, collectorId: "c_collapse" };

    await pipeline.processBatchWithHealing(baseline, batchContext);
    expect(trigger).not.toHaveBeenCalled();
    const collapsed = await pipeline.processBatchWithHealing([], batchContext);

    expect(collapsed).toHaveLength(1);
    expect(collapsed[0]?.outcome).toBe("quarantined");
    expect(trigger).toHaveBeenCalledTimes(1);
    expect(trigger).toHaveBeenCalledWith(
      "c_collapse",
      expect.stringContaining("result-count collapse"),
    );
  });

  it("heals the same majority structural signature repeated across two runs", async () => {
    const provider = new MockBrightDataHealingProvider();
    const trigger = vi.spyOn(provider, "triggerRefactor");
    const pipeline = new CardPulsePipeline();
    pipeline.healingCoordinator = new SelfHealingCoordinator(provider);
    const broken = [
      {
        entityType: "player",
        playerId: "openligadb:player:broken-1",
      },
      {
        entityType: "player",
        playerId: "openligadb:player:broken-2",
      },
    ];
    const batchContext = { ...context, collectorId: "c_repeat" };

    await pipeline.processBatchWithHealing(broken, batchContext);
    expect(trigger).not.toHaveBeenCalled();
    await pipeline.processBatchWithHealing(broken, batchContext);

    expect(trigger).toHaveBeenCalledTimes(1);
    expect(trigger).toHaveBeenCalledWith(
      "c_repeat",
      expect.stringContaining("Confirmed batch-level layout drift"),
    );
  });

  it("processes the full deterministic demo batch without drift", async () => {
    const provider = new MockBrightDataHealingProvider();
    const trigger = vi.spyOn(provider, "triggerRefactor");
    const pipeline = new CardPulsePipeline();

    const results = await pipeline.processBatchWithHealing(
      demoRecordsFor("valid"),
      { ...context, collectorId: "c_demo_seed" },
    );

    expect(results.every((result) => result.outcome === "accepted")).toBe(true);
    expect(results).toHaveLength(9);
    expect(trigger).not.toHaveBeenCalled();
    expect(pipeline.snapshots.listUniqueEntityIds()).toHaveLength(9);
  });
});
