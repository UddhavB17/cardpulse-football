import { describe, expect, it } from "vitest";

import {
  CardBundleSchema,
  CardProvenanceSchema,
  CacheFreshnessSchema,
  GenerateResultSchema,
  MatchAvailabilitySchema,
  PlayerIndexEntrySchema,
  REDACTED_COLLECTOR_ID,
  ScrapeRunSchema,
  ScrapeStageSchema,
  VerifiedSeasonMetadataSchema,
  redactCollectorId,
} from "./index.js";

const NOW = "2026-08-23T09:00:00.000Z";
const LATER = "2026-08-23T09:01:00.000Z";

const indexEntry = {
  schemaVersion: 1,
  playerId: "statbunker-epl-2025-26:9000000001",
  sourceId: "statbunker-epl-2025-26",
  playerName: "Erling Haaland",
  team: {
    teamId: "statbunker-epl-2025-26:manchester-city",
    name: "Manchester City",
  },
  position: "forward",
  nationality: "Norway",
  seasons: ["2024", "2025"],
  lastObservedAt: NOW,
} as const;

const seasonMetadata = {
  schemaVersion: 1,
  season: "2025",
  label: "2025/26",
  compId: 776,
  sourceUrl:
    "https://www.statbunker.com/competitions/PlayerStandings?comp_id=776",
  complete: true,
} as const;

const freshness = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  state: "fresh",
  fetchedAt: NOW,
  ttlSeconds: 900,
  ageSeconds: 60,
  evaluatedAt: LATER,
  ...overrides,
});

const provenance = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  dataOriginLabel: "LIVE PROVIDER",
  sourceId: "statbunker-epl-2025-26",
  sourceUrl:
    "https://www.statbunker.com/competitions/PlayerStandings?comp_id=776",
  snapshotHash: "a".repeat(64),
  snapshotVersion: 3,
  collectedAt: NOW,
  collectorId: REDACTED_COLLECTOR_ID,
  ...overrides,
});

const cardBundle = (
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  schemaVersion: 1,
  cardId: "statbunker-epl-2025-26:9000000001:2025:v2",
  bundleVersion: 2,
  playerId: "statbunker-epl-2025-26:9000000001",
  playerName: "Erling Haaland",
  season: "2025",
  stats: {
    appearances: 35,
    goals: 28,
    assists: 5,
    yellowCards: 4,
    redCards: 0,
    minutesPlayed: 2995,
  },
  team: {
    teamId: "statbunker-epl-2025-26:manchester-city",
    name: "Manchester City",
  },
  position: "forward",
  shirtNumber: null,
  nationality: "Norway",
  observedAt: NOW,
  provenance: provenance(),
  freshness: freshness(),
  ...overrides,
});

const stageRecord = (
  stage: string,
  overrides: Record<string, unknown> = {},
) => ({
  stage,
  enteredAt: NOW,
  completedAt: LATER,
  detail: "done",
  ...overrides,
});

const scrapeRun = (
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  schemaVersion: 1,
  runId: "00000000-0000-4000-8000-000000000001",
  playerId: "statbunker-epl-2025-26:9000000001",
  playerName: "Erling Haaland",
  season: "2025",
  sourceUrl:
    "https://www.statbunker.com/competitions/PlayerStandings?comp_id=776",
  requestedAt: NOW,
  stageHistory: [
    stageRecord("finding_player"),
    stageRecord("starting_collector"),
    stageRecord("extracting_statistics"),
    stageRecord("validating_data"),
    stageRecord("printing_card"),
  ],
  currentStage: null,
  terminalStatus: "succeeded",
  failureReason: null,
  cardId: "statbunker-epl-2025-26:9000000001:2025:v1",
  ...overrides,
});

describe("redacted collector identity", () => {
  it("always collapses to the public literal", () => {
    expect(redactCollectorId("c_secret_collector_42")).toBe("[redacted]");
    expect(redactCollectorId(null)).toBe("[redacted]");
    expect(redactCollectorId(undefined)).toBe("[redacted]");
  });

  it("is the only collector value accepted in public provenance", () => {
    expect(CardProvenanceSchema.safeParse(provenance()).success).toBe(true);
    const leaked = CardProvenanceSchema.safeParse(
      provenance({ collectorId: "c_secret_collector_42" }),
    );
    expect(leaked.success).toBe(false);
  });
});

describe("PlayerIndexEntrySchema", () => {
  it("accepts a searchable entry with merged seasons", () => {
    expect(PlayerIndexEntrySchema.safeParse(indexEntry).success).toBe(true);
  });

  it("requires at least one available season and a known position", () => {
    expect(
      PlayerIndexEntrySchema.safeParse({
        ...indexEntry,
        seasons: [],
      }).success,
    ).toBe(false);
    expect(
      PlayerIndexEntrySchema.safeParse({
        ...indexEntry,
        position: "striker",
      }).success,
    ).toBe(false);
  });

  it("rejects unknown keys", () => {
    expect(
      PlayerIndexEntrySchema.safeParse({ ...indexEntry, extra: true }).success,
    ).toBe(false);
  });
});

describe("VerifiedSeasonMetadataSchema", () => {
  it("accepts registry metadata including an incomplete season", () => {
    expect(VerifiedSeasonMetadataSchema.safeParse(seasonMetadata).success).toBe(
      true,
    );
    expect(
      VerifiedSeasonMetadataSchema.safeParse({
        ...seasonMetadata,
        season: "2026",
        label: "2026/27",
        compId: 791,
        complete: false,
      }).success,
    ).toBe(true);
  });

  it("rejects malformed labels and non-URL sources", () => {
    expect(
      VerifiedSeasonMetadataSchema.safeParse({
        ...seasonMetadata,
        label: "25/26",
      }).success,
    ).toBe(false);
    expect(
      VerifiedSeasonMetadataSchema.safeParse({
        ...seasonMetadata,
        sourceUrl: "not-a-url",
      }).success,
    ).toBe(false);
  });
});

describe("MatchAvailabilitySchema", () => {
  const row = {
    schemaVersion: 1,
    matchId: "m-1",
    season: "2025",
    playedOn: "2026-01-02",
    competition: "Premier League",
    homeTeam: "Manchester City",
    awayTeam: "Arsenal",
    homeGoals: 3,
    awayGoals: 1,
    playerTeam: "Manchester City",
    opponent: "Arsenal",
    venue: "home",
    playerGoals: 2,
    playerAssists: 1,
    playerMinutes: 90,
    sourceUrl:
      "https://www.statbunker.com/competitions/PlayerStandings?comp_id=776",
  };

  it("accepts an available season whose rows match the requested season", () => {
    expect(
      MatchAvailabilitySchema.safeParse({
        schemaVersion: 1,
        playerId: "p1",
        season: "2025",
        available: true,
        reason: null,
        rows: [row],
      }).success,
    ).toBe(true);
  });

  it("rejects unavailable seasons that still carry rows or lack a reason", () => {
    expect(
      MatchAvailabilitySchema.safeParse({
        schemaVersion: 1,
        playerId: "p1",
        season: "2026",
        available: false,
        reason: "not published yet",
        rows: [row],
      }).success,
    ).toBe(false);
    expect(
      MatchAvailabilitySchema.safeParse({
        schemaVersion: 1,
        playerId: "p1",
        season: "2026",
        available: false,
        reason: null,
        rows: [],
      }).success,
    ).toBe(false);
  });

  it("rejects rows bound to a different season than the answer", () => {
    expect(
      MatchAvailabilitySchema.safeParse({
        schemaVersion: 1,
        playerId: "p1",
        season: "2024",
        available: true,
        reason: null,
        rows: [row],
      }).success,
    ).toBe(false);
  });
});

describe("CacheFreshnessSchema", () => {
  it("derives state from age versus TTL", () => {
    expect(CacheFreshnessSchema.safeParse(freshness()).success).toBe(true);
    expect(
      CacheFreshnessSchema.safeParse(
        freshness({ state: "stale", ageSeconds: 900 }),
      ).success,
    ).toBe(true);
    expect(
      CacheFreshnessSchema.safeParse(
        freshness({ state: "fresh", ageSeconds: 900 }),
      ).success,
    ).toBe(false);
    expect(
      CacheFreshnessSchema.safeParse(
        freshness({ state: "stale", ageSeconds: 899 }),
      ).success,
    ).toBe(false);
  });
});

describe("CardBundleSchema", () => {
  it("accepts a versioned bundle with provenance and freshness", () => {
    expect(CardBundleSchema.safeParse(cardBundle()).success).toBe(true);
  });

  it("keeps unavailable minutes explicit instead of zero", () => {
    const parsed = CardBundleSchema.parse(
      cardBundle({
        stats: {
          appearances: 30,
          goals: 20,
          assists: 4,
          yellowCards: 2,
          redCards: 0,
          minutesPlayed: null,
        },
      }),
    );
    expect(parsed.stats.minutesPlayed).toBeNull();
  });

  it("rejects bundles without valid provenance or freshness", () => {
    expect(
      CardBundleSchema.safeParse(cardBundle({ provenance: null })).success,
    ).toBe(false);
    expect(
      CardBundleSchema.safeParse(cardBundle({ freshness: undefined })).success,
    ).toBe(false);
  });
});

describe("GenerateResultSchema", () => {
  const base = {
    schemaVersion: 1,
    playerId: "p1",
    season: "2025",
    runId: "00000000-0000-4000-8000-00000000000a",
    failureReason: null,
  };

  it("accepts cache-hit only without run id and with a bundle", () => {
    expect(
      GenerateResultSchema.safeParse({
        ...base,
        outcome: "cache-hit",
        runId: null,
        cardBundle: cardBundle(),
      }).success,
    ).toBe(true);
    expect(
      GenerateResultSchema.safeParse({
        ...base,
        outcome: "cache-hit",
        cardBundle: cardBundle(),
      }).success,
    ).toBe(false);
    expect(
      GenerateResultSchema.safeParse({
        ...base,
        outcome: "cache-hit",
        runId: null,
        cardBundle: null,
      }).success,
    ).toBe(false);
  });

  it("accepts collected only with run id and bundle", () => {
    expect(
      GenerateResultSchema.safeParse({
        ...base,
        outcome: "collected",
        cardBundle: cardBundle(),
      }).success,
    ).toBe(true);
    expect(
      GenerateResultSchema.safeParse({
        ...base,
        outcome: "collected",
        cardBundle: null,
      }).success,
    ).toBe(false);
  });

  it("requires failed results to explain themselves", () => {
    expect(
      GenerateResultSchema.safeParse({
        ...base,
        outcome: "failed",
        failureReason: "collector timed out",
        cardBundle: cardBundle(),
      }).success,
    ).toBe(true);
    expect(
      GenerateResultSchema.safeParse({
        ...base,
        outcome: "failed",
        cardBundle: null,
      }).success,
    ).toBe(false);
  });
});

describe("ScrapeRunSchema", () => {
  it("exposes exactly the five truthful stages", () => {
    expect(ScrapeStageSchema.options).toEqual([
      "finding_player",
      "starting_collector",
      "extracting_statistics",
      "validating_data",
      "printing_card",
    ]);
  });

  it("accepts succeeded and failed terminal runs", () => {
    expect(ScrapeRunSchema.safeParse(scrapeRun()).success).toBe(true);
    const history = scrapeRun()["stageHistory"] as Array<
      Record<string, unknown>
    >;
    expect(
      ScrapeRunSchema.safeParse(
        scrapeRun({
          stageHistory: history.slice(0, 2),
          terminalStatus: "failed",
          failureReason: "Bright Data trigger rejected the request",
          cardId: null,
        }),
      ).success,
    ).toBe(true);
  });

  it("accepts a running run whose last stage is open", () => {
    const history = [
      stageRecord("finding_player"),
      stageRecord("starting_collector", { completedAt: null, detail: null }),
    ];
    expect(
      ScrapeRunSchema.safeParse(
        scrapeRun({
          stageHistory: history,
          currentStage: "starting_collector",
          terminalStatus: null,
          cardId: null,
        }),
      ).success,
    ).toBe(true);
  });

  it.each([
    [
      "terminal status with a current stage",
      (run: Record<string, unknown>) => ({
        ...run,
        currentStage: "printing_card",
      }),
    ],
    [
      "neither current stage nor terminal status",
      (run: Record<string, unknown>) => ({
        ...run,
        currentStage: null,
        terminalStatus: null,
      }),
    ],
    [
      "succeeded without a card",
      (run: Record<string, unknown>) => ({ ...run, cardId: null }),
    ],
    [
      "succeeded with a failure reason",
      (run: Record<string, unknown>) => ({ ...run, failureReason: "x" }),
    ],
    [
      "failed without a failure reason",
      (run: Record<string, unknown>) => ({
        ...run,
        terminalStatus: "failed",
        cardId: null,
      }),
    ],
    [
      "failed while claiming a card",
      (run: Record<string, unknown>) => ({ ...run, terminalStatus: "failed" }),
    ],
  ])("%s is rejected", (_label, mutate) => {
    expect(ScrapeRunSchema.safeParse(mutate(scrapeRun())).success).toBe(false);
  });

  it("rejects success that does not end on printing_card", () => {
    const history = scrapeRun()["stageHistory"] as Array<
      Record<string, unknown>
    >;
    expect(
      ScrapeRunSchema.safeParse(
        scrapeRun({
          stageHistory: history.slice(0, 4),
          terminalStatus: "succeeded",
        }),
      ).success,
    ).toBe(false);
  });

  it("enforces forward-only complete stage histories", () => {
    const history = [
      stageRecord("finding_player"),
      stageRecord("starting_collector", {
        enteredAt: "2026-08-23T08:59:00.000Z",
      }),
    ];
    expect(
      ScrapeRunSchema.safeParse(
        scrapeRun({
          stageHistory: history,
          currentStage: null,
          terminalStatus: null,
        }),
      ).success,
    ).toBe(false);

    const gap = [
      stageRecord("finding_player"),
      stageRecord("starting_collector", { completedAt: null }),
      stageRecord("extracting_statistics"),
    ];
    expect(
      ScrapeRunSchema.safeParse(
        scrapeRun({
          stageHistory: gap,
          currentStage: null,
          terminalStatus: null,
        }),
      ).success,
    ).toBe(false);
  });
});
