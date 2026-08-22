import { describe, expect, it, vi } from "vitest";

import {
  type FootballHealingProgress,
  type FootballHealingProvider,
} from "@bidsentinel/brightdata";
import { amendedPlayerFixture } from "@bidsentinel/contracts/fixtures";

import { SelfHealingCoordinator } from "./healing-coordinator.js";
import { CardPulsePipeline } from "./pipeline.js";

const observedAt = "2026-08-20T14:00:00.000Z";
const collectorId = "c_same_collector";
const context = {
  sourceId: "openligadb",
  collectorId,
  extractorVersion: "football-parser-v1",
  observedAt,
};

import { validPlayerFixture } from "@bidsentinel/contracts/fixtures";

class ScriptedHealingProvider implements FootballHealingProvider {
  readonly triggerRefactor = vi.fn(async () => undefined);
  readonly resumeAutomationJob = vi.fn(async () => undefined);
  readonly pollRefactorProgress = vi.fn(async () => {
    const progress = this.progress.shift();
    if (!progress) throw new Error("No scripted healing progress remains");
    return progress;
  });

  constructor(private readonly progress: FootballHealingProgress[]) {}
}

function validVerification() {
  return {
    success: true,
    validRecordCount: 1,
    quarantinedCount: 0,
    sampleEntityIds: [validPlayerFixture.playerId],
    payloadHashes: ["a".repeat(64)],
  };
}

describe("SelfHealingCoordinator reliability gate", () => {
  it("heals confirmed structural drift using the first-class collector ID", async () => {
    const provider = new ScriptedHealingProvider([]);
    const coordinator = new SelfHealingCoordinator(provider, {
      pollIntervalMs: 0,
    });
    const pipeline = new CardPulsePipeline();
    pipeline.healingCoordinator = coordinator;
    await pipeline.processWithHealing(validPlayerFixture, context);

    const result = await pipeline.processWithHealing(
      {
        entityType: "player",
        playerId: validPlayerFixture.playerId,
        sourceUrl: validPlayerFixture.sourceUrl,
      },
      context,
    );

    expect(result.outcome).toBe("quarantined");
    expect(provider.triggerRefactor).toHaveBeenCalledWith(
      collectorId,
      expect.stringContaining("Confirmed batch-level layout drift"),
    );
    expect(coordinator.getHealingState("openligadb")).toBe("healing_requested");
    expect(coordinator.getIncident("openligadb")?.collectorId).toBe(
      collectorId,
    );
  });

  it("does not heal one malformed stat and preserves the verified card", async () => {
    const provider = new ScriptedHealingProvider([]);
    const coordinator = new SelfHealingCoordinator(provider);
    const pipeline = new CardPulsePipeline();
    pipeline.healingCoordinator = coordinator;
    pipeline.process(validPlayerFixture, context);

    const result = await pipeline.processWithHealing(
      {
        ...validPlayerFixture,
        stats: { ...validPlayerFixture.stats, goals: "eighteen" },
      },
      context,
    );

    expect(result.outcome).toBe("quarantined");
    expect(provider.triggerRefactor).not.toHaveBeenCalled();
    expect(pipeline.snapshots.list(validPlayerFixture.playerId)).toHaveLength(
      1,
    );
    const stored = pipeline.snapshots.latest(validPlayerFixture.playerId);
    if (stored?.record.entityType === "player") {
      expect(stored.record.stats.goals).toBe(validPlayerFixture.stats.goals);
    }
  });

  it("requires repeated evidence for a single missing structural field", async () => {
    const provider = new ScriptedHealingProvider([]);
    const coordinator = new SelfHealingCoordinator(provider);
    const pipeline = new CardPulsePipeline();
    pipeline.healingCoordinator = coordinator;
    const missingName = structuredClone(validPlayerFixture) as Record<
      string,
      unknown
    >;
    delete missingName.playerName;

    await pipeline.processWithHealing(missingName, context);
    expect(provider.triggerRefactor).not.toHaveBeenCalled();

    await pipeline.processWithHealing(missingName, context);
    expect(provider.triggerRefactor).toHaveBeenCalledTimes(1);
  });

  it("surfaces a self-healing trigger failure and records failed state", async () => {
    const provider = new ScriptedHealingProvider([]);
    provider.triggerRefactor.mockRejectedValueOnce(new Error("trigger failed"));
    const coordinator = new SelfHealingCoordinator(provider);
    const pipeline = new CardPulsePipeline();
    pipeline.healingCoordinator = coordinator;
    await pipeline.processWithHealing(validPlayerFixture, context);

    await expect(
      pipeline.processWithHealing(
        { entityType: "player", playerId: "openligadb:player:broken" },
        context,
      ),
    ).rejects.toThrow("trigger failed");
    expect(coordinator.getHealingState("openligadb")).toBe("recovery_failed");
    expect(coordinator.getIncident("openligadb")?.evidence?.outcome).toBe(
      "failed",
    );
  });

  it("refuses approval until the preview passes the football schema canary", async () => {
    const provider = new ScriptedHealingProvider([
      {
        status: "pending_answer",
        previewResult: [{ playerName: "still broken" }],
      },
    ]);
    const coordinator = new SelfHealingCoordinator(provider);
    await coordinator.handleDrift(
      "openligadb",
      collectorId,
      "schema-drift",
      "restore the player card fields",
      observedAt,
    );
    await coordinator.pollProgress("openligadb", observedAt);

    await expect(
      coordinator.approveOrReject(
        "openligadb",
        true,
        async () => validVerification(),
        observedAt,
      ),
    ).rejects.toThrow("schema-valid preview is required");
    expect(
      coordinator.handlePreview(
        "openligadb",
        [{ playerName: "still broken" }],
        1,
        observedAt,
      ),
    ).toBe(false);
    await expect(
      coordinator.approveOrReject(
        "openligadb",
        true,
        async () => validVerification(),
        observedAt,
      ),
    ).rejects.toThrow("schema-valid preview is required");

    await coordinator.approveOrReject(
      "openligadb",
      false,
      async () => validVerification(),
      observedAt,
    );
    expect(coordinator.getHealingState("openligadb")).toBe("rejected");
    expect(provider.resumeAutomationJob).toHaveBeenCalledWith(
      collectorId,
      false,
      { autoSave: false },
    );
  });

  it("polls to done after approval, then reruns the same collector", async () => {
    const provider = new ScriptedHealingProvider([
      { status: "pending_answer", previewResult: [validPlayerFixture] },
      { status: "in_progress", previewResult: [] },
      { status: "done", previewResult: [] },
    ]);
    const coordinator = new SelfHealingCoordinator(provider, {
      pollIntervalMs: 0,
      approvalTimeoutMs: 1000,
    });
    await coordinator.handleDrift(
      "openligadb",
      collectorId,
      "schema-drift",
      "restore the player card fields",
      observedAt,
    );
    const awaiting = await coordinator.pollProgress("openligadb", observedAt);
    expect(awaiting.previewResult).toEqual([validPlayerFixture]);
    expect(
      coordinator.handlePreview(
        "openligadb",
        awaiting.previewResult,
        1,
        observedAt,
      ),
    ).toBe(true);

    const rerun = vi.fn(async () => validVerification());
    await coordinator.approveOrReject("openligadb", true, rerun, observedAt);

    expect(provider.resumeAutomationJob).toHaveBeenCalledWith(
      collectorId,
      true,
      { autoSave: true },
    );
    expect(provider.pollRefactorProgress).toHaveBeenCalledTimes(3);
    expect(rerun).toHaveBeenCalledTimes(1);
    expect(coordinator.getHealingState("openligadb")).toBe("recovered");
    expect(coordinator.getIncident("openligadb")?.collectorId).toBe(
      collectorId,
    );
    expect(coordinator.getIncident("openligadb")?.evidence?.actions).toContain(
      `Bright Data completed the heal for the same collector ${collectorId}`,
    );
    expect(
      coordinator.getIncident("openligadb")?.evidence?.verification,
    ).toEqual(
      expect.objectContaining({
        validRecordCount: 1,
        payloadHashes: ["a".repeat(64)],
      }),
    );
  });

  it("accepts an amended but schema-valid preview through the canary", async () => {
    const provider = new ScriptedHealingProvider([
      {
        status: "pending_answer",
        previewResult: [amendedPlayerFixture],
      },
    ]);
    const coordinator = new SelfHealingCoordinator(provider);
    await coordinator.handleDrift(
      "openligadb",
      collectorId,
      "schema-drift",
      "restore the player card fields",
      observedAt,
    );
    await coordinator.pollProgress("openligadb", observedAt);
    expect(coordinator.getHealingState("openligadb")).toBe("awaiting_approval");

    const valid = coordinator.handlePreview(
      "openligadb",
      [amendedPlayerFixture],
      1,
      observedAt,
    );

    expect(valid).toBe(true);
    expect(coordinator.getHealingState("openligadb")).toBe("preview_valid");
  });

  it("fails closed on an undocumented progress status", async () => {
    const provider = new ScriptedHealingProvider([
      { status: "mystery_terminal", previewResult: [] },
    ]);
    const coordinator = new SelfHealingCoordinator(provider);
    await coordinator.handleDrift(
      "openligadb",
      collectorId,
      "schema-drift",
      "restore the player card fields",
      observedAt,
    );

    await expect(
      coordinator.pollProgress("openligadb", observedAt),
    ).rejects.toThrow("Unknown Bright Data self-healing status");
    expect(coordinator.getHealingState("openligadb")).toBe("recovery_failed");
    expect(coordinator.getIncident("openligadb")?.evidence).toMatchObject({
      outcome: "failed",
      verification: { validRecordCount: 0, quarantinedCount: 1 },
    });
  });
});
