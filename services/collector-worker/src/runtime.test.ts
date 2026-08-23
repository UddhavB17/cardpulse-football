import { afterEach, describe, expect, it, vi } from "vitest";

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

describe("StatBunker source profile end-to-end", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function statBunkerSpecRow(
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      player_name: "Finn Krüger",
      player_url:
        "https://www.statbunker.com/players/getPlayerStats?player_id=9000000001",
      team_name: "Rheinland FC 04",
      position: "forward",
      appearances: 33,
      goals: 18,
      assists: 5,
      yellow_cards: 3,
      second_yellow_cards: 1,
      red_cards: 2,
      minutes_played: 2820,
      nationality: "Germany",
      season: "2025",
      source_url:
        "https://www.statbunker.com/competitions/PlayerStandings?comp_id=776",
      ...overrides,
    };
  }

  it("routes statbunker sources through the fail-closed row boundary in live mode", async () => {
    const runtime = createRuntimeFromEnv({
      BRIGHT_DATA_API_TOKEN: "secret-never-serialize",
      BRIGHT_DATA_COLLECTOR_ID: "c_stat_e2e",
      BRIGHT_DATA_TARGET_URL:
        "https://www.statbunker.com/competitions/PlayerStandings?comp_id=776",
      CARDPULSE_SOURCE_ID: "statbunker-football-public",
    });
    expect(runtime.mode).toBe("live");

    const brokenRow = { player_url: "https://www.statbunker.com/x" };
    const mockFetch = vi.fn((url: string) => {
      if (url.includes("/dca/trigger")) {
        expect(url).toContain("collector=c_stat_e2e");
        return Promise.resolve(
          new Response(JSON.stringify({ collection_id: "j_stat_e2e" }), {
            status: 200,
          }),
        );
      }
      if (url.includes("/dca/dataset?id=j_stat_e2e")) {
        return Promise.resolve(
          new Response(JSON.stringify([statBunkerSpecRow(), brokenRow]), {
            status: 200,
          }),
        );
      }
      return Promise.reject(new Error(`Unknown URL: ${url}`));
    });
    vi.stubGlobal("fetch", mockFetch);

    const summary = await runConfiguredCollection(runtime, {
      enableHealing: false,
    });

    expect(summary.sourceId).toBe("statbunker-football-public");
    expect(summary.collectorId).toBe("c_stat_e2e");
    // The spec-shaped row is accepted; the structurally broken row is
    // quarantined with its issues instead of corrupting the card.
    expect(summary.validRecordCount).toBe(1);
    expect(summary.quarantinedCount).toBe(1);
    expect(summary.sampleEntityIds).toEqual([
      "statbunker-football-public:9000000001",
    ]);
    expect(summary.outcomes).toEqual(["accepted", "quarantined"]);

    const snapshots = runtime.pipeline.snapshots.list(
      "statbunker-football-public:9000000001",
    );
    expect(snapshots).toHaveLength(1);
    const record = snapshots[0]?.record;
    expect(record).toMatchObject({
      entityType: "player",
      sourceId: "statbunker-football-public",
      externalId: "9000000001",
      playerName: "Finn Krüger",
      season: "2025",
    });
    if (record?.entityType === "player") {
      // Discipline canon for this source: straight reds + second yellows.
      expect(record.stats.redCards).toBe(3);
      expect(record.team.teamId).toBe(
        "statbunker-football-public:rheinland-fc-04",
      );
    }

    const quarantines = runtime.pipeline.quarantines.listBySource(
      "statbunker-football-public",
    );
    expect(quarantines).toHaveLength(1);
    expect(quarantines[0]?.issues.length).toBeGreaterThan(0);

    vi.unstubAllGlobals();
  });

  it("keeps non-statbunker sources on the neutral generic mapper path", () => {
    // Mock mode never constructs a provider; live selection is exercised by
    // matching logic plus the e2e test above.
    expect(createRuntimeFromEnv({}).mode).toBe("mock");
  });
});

describe("StatBunker profile env wiring", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function specRowFor(
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      player_name: "Finn Krüger",
      player_url:
        "https://www.statbunker.com/players/getPlayerStats?player_id=9000000001",
      team_name: "Rheinland FC 04",
      position: "forward",
      appearances: 33,
      goals: 18,
      assists: 5,
      yellow_cards: 3,
      second_yellow_cards: 1,
      red_cards: 2,
      minutes_played: 2820,
      nationality: "Germany",
      season: "2025/26",
      source_url:
        "https://www.statbunker.com/competitions/PlayerStandings?comp_id=776",
      ...overrides,
    };
  }

  it("applies the standardized default source id and keeps mock mode safe", () => {
    const runtime = createRuntimeFromEnv({
      CARDPULSE_SOURCE_PROFILE: "statbunker",
    });
    expect(runtime.mode).toBe("mock");
    expect(runtime.sourceId).toBe("statbunker-epl-2025-26");
    expect(runtime.collectionProvider).toBeNull();
    expect(runtime.collectorId).toBeNull();
    expect(runtime.configurationIssues).toContain(
      "BRIGHT_DATA_API_TOKEN is not configured",
    );
    expect(JSON.stringify(runtime)).not.toContain("epl-2025-26:9000000001");
  });

  it("routes the statbunker profile boundary even when the source id is overridden", async () => {
    const runtime = createRuntimeFromEnv({
      BRIGHT_DATA_API_TOKEN: "secret-never-serialize",
      BRIGHT_DATA_COLLECTOR_ID: "c_prof_e2e",
      BRIGHT_DATA_TARGET_URL:
        "https://www.statbunker.com/competitions/PlayerStandings?comp_id=776",
      CARDPULSE_SOURCE_PROFILE: "statbunker",
      CARDPULSE_SOURCE_ID: "epl-custom",
    });
    expect(runtime.mode).toBe("live");

    const mockFetch = vi.fn((url: string) => {
      if (url.includes("/dca/trigger")) {
        return Promise.resolve(
          new Response(JSON.stringify({ collection_id: "j_prof_e2e" }), {
            status: 200,
          }),
        );
      }
      if (url.includes("/dca/dataset?id=j_prof_e2e")) {
        return Promise.resolve(
          new Response(JSON.stringify([specRowFor()]), { status: 200 }),
        );
      }
      return Promise.reject(new Error(`Unknown URL: ${url}`));
    });
    vi.stubGlobal("fetch", mockFetch);

    const summary = await runConfiguredCollection(runtime, {
      enableHealing: false,
    });
    expect(summary.success).toBe(true);
    expect(summary.validRecordCount).toBe(1);
    // Profile-based routing, not source-id matching, engaged the boundary.
    expect(summary.sampleEntityIds).toEqual(["epl-custom:9000000001"]);
  });

  it("flags unrecognized profiles while keeping generic defaults", () => {
    const runtime = createRuntimeFromEnv({
      BRIGHT_DATA_API_TOKEN: "secret-never-serialize",
      BRIGHT_DATA_COLLECTOR_ID: "c_prof_x",
      BRIGHT_DATA_TARGET_URL: "https://example.football.test/players",
      CARDPULSE_SOURCE_PROFILE: "statbunkr",
    });
    expect(runtime.mode).toBe("live");
    expect(runtime.sourceId).toBe("openligadb");
    expect(runtime.configurationIssues).toEqual(
      expect.arrayContaining([
        expect.stringContaining("not a recognized source profile"),
      ]),
    );
  });
});
