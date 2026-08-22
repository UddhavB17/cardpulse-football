import { describe, expect, it, vi } from "vitest";

import {
  BrightDataApiError,
  MockBrightDataHealingProvider,
  type FootballHealingProgress,
  type FootballHealingProvider,
} from "@bidsentinel/brightdata";
import {
  amendedPlayerFixture,
  validPlayerFixture,
} from "@bidsentinel/contracts/fixtures";

import { SelfHealingCoordinator } from "./healing-coordinator.js";
import { CardPulsePipeline } from "./pipeline.js";
import {
  buildMockPreviewRecord,
  createRuntimeFromEnv,
  isAuthorizedOperatorToken,
  runConfiguredCollection,
  type CardPulseRuntime,
} from "./runtime.js";

function liveRuntimeWith(
  provider: FootballCollectionProviderLike,
): CardPulseRuntime {
  const pipeline = new CardPulsePipeline();
  const coordinator = new SelfHealingCoordinator(
    new MockBrightDataHealingProvider([buildMockPreviewRecord("openligadb")]),
    { pollIntervalMs: 0 },
  );
  pipeline.healingCoordinator = coordinator;
  return {
    mode: "live",
    pipeline,
    coordinator,
    collectionProvider: provider,
    sourceId: "openligadb",
    collectorId: "c_exact",
    targetUrl: "https://data.football-demo.test/openligadb/players",
    configurationIssues: [],
    liveMutationsEnabled: false,
    operatorTokenHash: null,
  };
}

interface FootballCollectionProviderLike {
  collect(request: {
    sourceId: string;
    targetUrl: string;
    requestedAt: string;
  }): Promise<{
    sourceId: string;
    collectorId: string;
    extractorVersion: string;
    receivedAt: string;
    payloads: unknown[];
  }>;
}

describe("runtime selection and live collection", () => {
  it("selects explicitly labeled mock mode unless every live variable exists", () => {
    const mock = createRuntimeFromEnv({
      BRIGHT_DATA_API_TOKEN: "secret-never-serialize",
    });
    expect(mock.mode).toBe("mock");
    expect(mock.configurationIssues).toEqual(
      expect.arrayContaining([
        "BRIGHT_DATA_COLLECTOR_ID is not configured",
        "BRIGHT_DATA_TARGET_URL is not configured",
      ]),
    );
    expect(JSON.stringify(mock.configurationIssues)).not.toContain(
      "secret-never-serialize",
    );

    const live = createRuntimeFromEnv({
      BRIGHT_DATA_API_TOKEN: "secret-never-serialize",
      BRIGHT_DATA_COLLECTOR_ID: "c_exact",
      BRIGHT_DATA_TARGET_URL: "https://data.football-demo.test/players",
      CARDPULSE_SOURCE_ID: "openligadb",
    });
    expect(live.mode).toBe("live");
    expect(live.collectorId).toBe("c_exact");
    expect(live.liveMutationsEnabled).toBe(false);
    expect(live.configurationIssues).toEqual(
      expect.arrayContaining([
        "CARDPULSE_ENABLE_LIVE_MUTATIONS is not true",
        "CARDPULSE_OPERATOR_TOKEN must contain at least 32 characters",
      ]),
    );
  });

  it("treats a malformed collector ID as a configuration issue and stays in mock mode", () => {
    const runtime = createRuntimeFromEnv({
      BRIGHT_DATA_API_TOKEN: "secret-never-serialize",
      BRIGHT_DATA_COLLECTOR_ID: "collector-not-c-prefixed",
      BRIGHT_DATA_TARGET_URL: "https://data.football-demo.test/players",
    });
    expect(runtime.mode).toBe("mock");
    expect(runtime.collectorId).toBeNull();
    expect(runtime.configurationIssues).toContain(
      "BRIGHT_DATA_COLLECTOR_ID must be a first-class c_* collector ID",
    );
  });

  it("honors CardPulse env overrides over the historical names", () => {
    const runtime = createRuntimeFromEnv({
      BRIGHT_DATA_API_TOKEN: "secret-never-serialize",
      BRIGHT_DATA_COLLECTOR_ID: "c_exact",
      BRIGHT_DATA_TARGET_URL: "https://data.football-demo.test/players",
      CARDPULSE_SOURCE_ID: "kicker-demo",
      BIDSENTINEL_SOURCE_ID: "openligadb",
    });
    expect(runtime.sourceId).toBe("kicker-demo");
  });

  it("enables live mutations only with the explicit flag and a strong operator token", () => {
    const operatorToken = "operator-token-with-at-least-32-chars";
    const live = createRuntimeFromEnv({
      BRIGHT_DATA_API_TOKEN: "secret-never-serialize",
      BRIGHT_DATA_COLLECTOR_ID: "c_exact",
      BRIGHT_DATA_TARGET_URL: "https://data.football-demo.test/players",
      BIDSENTINEL_SOURCE_ID: "openligadb",
      CARDPULSE_ENABLE_LIVE_MUTATIONS: "true",
      CARDPULSE_OPERATOR_TOKEN: operatorToken,
    });

    expect(live.mode).toBe("live");
    expect(live.liveMutationsEnabled).toBe(true);
    expect(live.configurationIssues).toEqual([]);
    expect(isAuthorizedOperatorToken(live, operatorToken)).toBe(true);
    expect(isAuthorizedOperatorToken(live, "wrong-token")).toBe(false);
    expect(JSON.stringify(live)).not.toContain(operatorToken);
  });

  it("processes every football row while preserving the provider collector ID", async () => {
    const collect = vi.fn(async () => ({
      sourceId: "openligadb",
      collectorId: "c_exact",
      extractorVersion: "parser-v2",
      receivedAt: validPlayerFixture.observedAt,
      payloads: [validPlayerFixture, { title: "invalid row" }],
    }));
    const runtime = liveRuntimeWith({ collect });

    const summary = await runConfiguredCollection(runtime, {
      enableHealing: false,
    });

    expect(collect).toHaveBeenCalledTimes(1);
    expect(summary.collectorId).toBe("c_exact");
    expect(summary.outcomes).toEqual(["accepted", "quarantined"]);
    expect(summary).toMatchObject({
      success: false,
      validRecordCount: 1,
      quarantinedCount: 1,
      sampleEntityIds: [validPlayerFixture.playerId],
    });
  });

  it("rejects a batch whose collector ID does not match runtime configuration", async () => {
    const runtime = liveRuntimeWith({
      collect: async () => ({
        sourceId: "openligadb",
        collectorId: "c_other",
        extractorVersion: "parser-v2",
        receivedAt: validPlayerFixture.observedAt,
        payloads: [validPlayerFixture],
      }),
    });

    await expect(runConfiguredCollection(runtime)).rejects.toThrow(
      "unexpected collector ID",
    );
    expect(
      runtime.pipeline.snapshots.list(validPlayerFixture.playerId),
    ).toEqual([]);
  });

  it("records transient collection failure without requesting healing", async () => {
    const runtime = liveRuntimeWith({
      collect: async () => {
        throw new BrightDataApiError("timeout", "collection timed out", {
          transient: true,
        });
      },
    });
    const trigger = vi.spyOn(runtime.coordinator, "handleDrift");

    await expect(runConfiguredCollection(runtime)).rejects.toMatchObject({
      code: "timeout",
    });
    expect(runtime.pipeline.sourceHealth.get("openligadb")).toMatchObject({
      state: "degraded",
      activeIncident: { reason: "network-error" },
    });
    expect(trigger).not.toHaveBeenCalled();
  });

  it("approval polls Bright Data to done before rerunning the exact provider", async () => {
    const collectedBatches: unknown[][] = [
      [validPlayerFixture],
      [
        {
          entityType: "player",
          playerId: validPlayerFixture.playerId,
          sourceUrl: validPlayerFixture.sourceUrl,
        },
      ],
      [amendedPlayerFixture],
    ];
    const collect = vi.fn(async () => ({
      sourceId: "openligadb",
      collectorId: "c_exact",
      extractorVersion: "parser-v2",
      receivedAt: "2026-08-21T14:00:00.000Z",
      payloads: collectedBatches.shift() ?? [],
    }));
    const triggerRefactor = vi.fn(async () => undefined);
    const resumeAutomationJob = vi.fn(async () => undefined);
    const progress: FootballHealingProgress[] = [
      { status: "pending_answer", previewResult: [validPlayerFixture] },
      { status: "done", previewResult: [] },
    ];
    const healingProvider: FootballHealingProvider = {
      triggerRefactor,
      resumeAutomationJob,
      pollRefactorProgress: async () => {
        const next = progress.shift();
        if (!next) throw new Error("No progress response left");
        return next;
      },
    };
    const pipeline = new CardPulsePipeline();
    const coordinator = new SelfHealingCoordinator(healingProvider, {
      pollIntervalMs: 0,
    });
    pipeline.healingCoordinator = coordinator;
    const runtime: CardPulseRuntime = {
      mode: "live",
      pipeline,
      coordinator,
      collectionProvider: { collect },
      sourceId: "openligadb",
      collectorId: "c_exact",
      targetUrl: "https://data.football-demo.test/openligadb/players",
      configurationIssues: [],
      liveMutationsEnabled: false,
      operatorTokenHash: null,
    };

    expect((await runConfiguredCollection(runtime)).success).toBe(true);
    expect((await runConfiguredCollection(runtime)).success).toBe(false);
    expect(triggerRefactor).toHaveBeenCalledWith(
      "c_exact",
      expect.stringContaining("Confirmed batch-level layout drift"),
    );

    const pending = await coordinator.pollProgress(
      "openligadb",
      "2026-08-21T14:01:00.000Z",
    );
    expect(
      coordinator.handlePreview(
        "openligadb",
        pending.previewResult,
        1,
        "2026-08-21T14:01:00.000Z",
      ),
    ).toBe(true);
    await coordinator.approveOrReject(
      "openligadb",
      true,
      () => runConfiguredCollection(runtime, { enableHealing: false }),
      "2026-08-21T14:02:00.000Z",
    );

    expect(resumeAutomationJob).toHaveBeenCalledWith("c_exact", true, {
      autoSave: true,
    });
    expect(collect).toHaveBeenCalledTimes(3);
    expect(coordinator.getHealingState("openligadb")).toBe("recovered");
    expect(coordinator.getIncident("openligadb")?.collectorId).toBe("c_exact");
  });
});
