import { describe, expect, it, vi } from "vitest";

import type { FootballSnapshot } from "@bidsentinel/contracts";
import { REDACTED_COLLECTOR_ID } from "@bidsentinel/contracts";
import {
  STATBUNKER_SOURCE_ID,
  StatBunkerRowMapper,
  statBunkerPlayerSearchResolverUrl,
} from "@bidsentinel/brightdata";

import {
  buildVerifiedSnapshot,
  PlayerExperienceService,
  type PlayerExperienceCollectionBatch,
  type PlayerExperienceCollectionRequest,
} from "./player-experience.js";

const T0 = Date.parse("2026-08-23T09:00:00.000Z");
const OBSERVED_AT = "2026-08-23T09:00:00.000Z";
const SECRET_COLLECTOR_ID = "c_secret_collector_42";
const HAALAND_ID = `${STATBUNKER_SOURCE_ID}:900000001`;
const BROOKS_KINGSLEY_ID = `${STATBUNKER_SOURCE_ID}:900000002`;
const BROOKS_HARBOUR_ID = `${STATBUNKER_SOURCE_ID}:900000003`;
const STANDINGS_URL_596 =
  "https://www.statbunker.com/competitions/PlayerStandings?comp_id=596";
const STANDINGS_URL_776 =
  "https://www.statbunker.com/competitions/PlayerStandings?comp_id=776";
const STANDINGS_URL_791 =
  "https://www.statbunker.com/competitions/PlayerStandings?comp_id=791";
const MATCH_URL_596 =
  "https://www.statbunker.com/players/SeasonMatches?comps_id=596&comps_type=EPL&player_id=900000001";
const MATCH_URL_776 =
  "https://www.statbunker.com/players/SeasonMatches?comps_id=776&comps_type=EPL&player_id=900000001";
const MATCH_URL_791 =
  "https://www.statbunker.com/players/SeasonMatches?comps_id=791&comps_type=EPL&player_id=900000001";
const RESOLVED_MATCH_URL_776 =
  "https://www.statbunker.com/players/SeasonMatches?comps_id=776&comps_type=EPL&player_id=60023";
const SEARCH_URL_776 = statBunkerPlayerSearchResolverUrl(776, "Erling Haaland");
const MATCH_SOURCE_2025 = `${STATBUNKER_SOURCE_ID}-matches-900000001-2025`;
const MATCH_SOURCE_2026 = `${STATBUNKER_SOURCE_ID}-matches-900000001-2026`;

let currentMs = T0;
const clock = (): Date => new Date(currentMs);
function advanceMs(delta: number): void {
  currentMs += delta;
}

/** A row exactly matching the StatBunker Scraper Studio output shape. */
function statBunkerRow(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    player_name: "Erling Haaland",
    player_url:
      "https://www.statbunker.com/players/getPlayerStats?player_id=900000001",
    team_name: "Manchester City",
    position: "Forward",
    appearances: 28,
    goals: 19,
    assists: 6,
    yellow_cards: 2,
    second_yellow_cards: 0,
    red_cards: 0,
    minutes_played: 2380,
    nationality: "Norway",
    season: "2025",
    source_url: STANDINGS_URL_776,
    ...overrides,
  };
}

/** A strict row matching the player SeasonMatches collector output shape. */
function statBunkerMatchRow(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    competition: "Premier League 25/26",
    home_team: "Manchester City",
    away_team: "Liverpool",
    score: "2 - 1",
    started: 1,
    substitute: 0,
    minutes_played: 90,
    goals: 2,
    assists: 1,
    yellow_cards: 0,
    second_yellow_cards: 0,
    red_cards: 0,
    played_on: "08 Feb 2026",
    ...overrides,
  };
}

function resolvedStatBunkerMatchRow(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return statBunkerMatchRow({
    resolved_player_name: "Erling Haaland",
    resolved_player_url:
      "https://www.statbunker.com/players/getPlayerStats?player_id=60023",
    resolved_player_id: "60023",
    source_url: RESOLVED_MATCH_URL_776,
    ...overrides,
  });
}

const mapper = new StatBunkerRowMapper({ sourceId: STATBUNKER_SOURCE_ID });

function snapshotForRow(
  row: Record<string, unknown>,
  observedAt = OBSERVED_AT,
): FootballSnapshot {
  const outcome = mapper.map(row, observedAt);
  if (!outcome.ok) {
    throw new Error(`fixture row rejected: ${JSON.stringify(outcome.issues)}`);
  }
  return buildVerifiedSnapshot(outcome.record, observedAt);
}

interface CollectorHarness {
  readonly requests: PlayerExperienceCollectionRequest[];
  readonly collect: (
    request: PlayerExperienceCollectionRequest,
  ) => Promise<PlayerExperienceCollectionBatch>;
  serveRows(rows: unknown[]): void;
  failWith(error: Error | null): void;
}

function makeCollector(initialRows: unknown[] = []): CollectorHarness {
  const requests: PlayerExperienceCollectionRequest[] = [];
  const state: { rows: unknown[]; error: Error | null } = {
    rows: initialRows,
    error: null,
  };
  const collect = vi.fn(
    async (
      request: PlayerExperienceCollectionRequest,
    ): Promise<PlayerExperienceCollectionBatch> => {
      requests.push(request);
      if (state.error !== null) throw state.error;
      return {
        collectorId: SECRET_COLLECTOR_ID,
        extractorVersion: `brightdata-${SECRET_COLLECTOR_ID}`,
        rawRows: [...state.rows],
      };
    },
  );
  return {
    requests,
    collect,
    serveRows(rows: unknown[]) {
      state.rows = rows;
    },
    failWith(error: Error | null) {
      state.error = error;
    },
  };
}

function makeService(collect: CollectorHarness["collect"]) {
  return new PlayerExperienceService({
    collect,
    now: clock,
    freshnessTtlSeconds: 900,
  });
}

async function generateHaalandOnce() {
  const collector = makeCollector([statBunkerMatchRow()]);
  const service = makeService(collector.collect);
  service.indexPlayers([snapshotForRow(statBunkerRow())]);
  const result = await service.generate({
    schemaVersion: 1,
    playerId: HAALAND_ID,
    season: "2025",
  });
  return { collector, service, result };
}

describe("index and search (never collects)", () => {
  it("finds Erling Haaland by full name, case-insensitively and partially", async () => {
    const { collector, service, result } = await generateHaalandOnce();
    expect(result.outcome).toBe("collected");
    for (const query of [
      "Erling Haaland",
      "erling haaland",
      "ERLING HAALAND",
      "Haaland",
      "haalan",
      "Manchester City",
      "Manchester City players",
    ]) {
      const hits = service.searchPlayers(query);
      expect(hits).toHaveLength(1);
      expect(hits[0]?.playerId).toBe(HAALAND_ID);
      expect(hits[0]?.playerName).toBe("Erling Haaland");
    }
    // Search alone never triggers billing.
    expect(collector.collect).toHaveBeenCalledTimes(1);
  });

  it("merges available seasons across indexed snapshots", () => {
    const collector = makeCollector();
    const service = makeService(collector.collect);
    service.indexPlayers([
      snapshotForRow(statBunkerRow({ season: "2024" })),
      snapshotForRow(statBunkerRow({ season: "2025" })),
    ]);
    expect(service.getPlayerSeasons(HAALAND_ID)).toEqual(["2024", "2025"]);
    expect(service.searchPlayers("haaland")).toHaveLength(1);
    expect(service.searchPlayers("haaland", { season: "2024" })).toHaveLength(
      1,
    );
    expect(service.searchPlayers("haaland", { season: "2023" })).toHaveLength(
      0,
    );
    expect(service.searchPlayers("haaland", { season: "1998" })).toHaveLength(
      0,
    );
    expect(collector.collect).not.toHaveBeenCalled();
  });

  it("disambiguates duplicate-name players by club and position", () => {
    const collector = makeCollector();
    const service = makeService(collector.collect);
    service.indexPlayers([
      snapshotForRow(
        statBunkerRow({
          player_name: "Taylor Brooks",
          player_url:
            "https://www.statbunker.com/players/getPlayerStats?player_id=900000002",
          team_name: "Kingsley Rovers FC",
          position: "Defender",
          goals: 3,
        }),
      ),
      snapshotForRow(
        statBunkerRow({
          player_name: "Taylor Brooks",
          player_url:
            "https://www.statbunker.com/players/getPlayerStats?player_id=900000003",
          team_name: "Harbour Athletic FC",
          position: "Midfielder",
          goals: 7,
          assists: 9,
        }),
      ),
    ]);

    const both = service.searchPlayers("taylor brooks");
    expect(both.map((hit) => hit.playerId)).toEqual([
      BROOKS_KINGSLEY_ID,
      BROOKS_HARBOUR_ID,
    ]);
    expect(both[1]?.team.name).toBe("Harbour Athletic FC");

    expect(service.searchPlayers("brooks", { club: "kingsley" })).toEqual([
      expect.objectContaining({ playerId: BROOKS_KINGSLEY_ID }),
    ]);
    expect(service.searchPlayers("brooks", { position: "midfielder" })).toEqual(
      [expect.objectContaining({ playerId: BROOKS_HARBOUR_ID })],
    );
    expect(collector.collect).not.toHaveBeenCalled();
  });

  it("returns nothing for empty queries without collecting", () => {
    const collector = makeCollector();
    const service = makeService(collector.collect);
    service.seedDemoData();
    expect(service.searchPlayers("")).toEqual([]);
    expect(service.searchPlayers("   ")).toEqual([]);
    expect(collector.collect).not.toHaveBeenCalled();
  });

  it("exposes the verified registry seasons including incomplete 2026", () => {
    const collector = makeCollector();
    const service = makeService(collector.collect);
    expect(service.listSeasons().map((season) => season.compId)).toEqual([
      745, 596, 776, 791,
    ]);
    expect(service.listSeasons().map((season) => season.label)).toEqual([
      "2023/24",
      "2024/25",
      "2025/26",
      "2026/27",
    ]);
    expect(service.listSeasons().at(-1)?.complete).toBe(false);
    expect(service.listSeasons()[0]?.complete).toBe(true);
  });
});

describe("generate fails closed before any billable work", () => {
  it("rejects unlisted seasons without guessing a URL or creating a run", async () => {
    const collector = makeCollector();
    const service = makeService(collector.collect);
    service.indexPlayers([snapshotForRow(statBunkerRow())]);
    const result = await service.generate({
      schemaVersion: 1,
      playerId: HAALAND_ID,
      season: "2019",
    });
    expect(result.outcome).toBe("failed");
    expect(result.runId).toBeNull();
    expect(result.cardBundle).toBeNull();
    expect(result.failureReason).toContain("verified StatBunker registry");
    expect(collector.collect).not.toHaveBeenCalled();
  });

  it("rejects players missing from the cached index", async () => {
    const collector = makeCollector();
    const service = makeService(collector.collect);
    const result = await service.generate({
      schemaVersion: 1,
      playerId: `${STATBUNKER_SOURCE_ID}:nobody`,
      season: "2025",
    });
    expect(result.outcome).toBe("failed");
    expect(result.failureReason).toContain("cached index");
    expect(collector.collect).not.toHaveBeenCalled();
  });
});

describe("generation, freshness, and single-collection guarantee", () => {
  it("exposes a real run id before the collector promise resolves", async () => {
    let release!: (batch: PlayerExperienceCollectionBatch) => void;
    const collect = vi.fn(
      () =>
        new Promise<PlayerExperienceCollectionBatch>((resolve) => {
          release = resolve;
        }),
    );
    const service = makeService(collect);
    service.indexPlayers([snapshotForRow(statBunkerRow())]);

    const start = service.startGenerate({
      schemaVersion: 1,
      playerId: HAALAND_ID,
      season: "2025",
    });
    expect(start.kind).toBe("started");
    if (start.kind !== "started") throw new Error("expected a live run");
    expect(service.getRun(start.runId)).toMatchObject({
      currentStage: "starting_collector",
      terminalStatus: null,
    });

    release({
      collectorId: SECRET_COLLECTOR_ID,
      extractorVersion: "statbunker-test",
      rawRows: [statBunkerMatchRow()],
    });
    await expect(start.completion).resolves.toMatchObject({
      outcome: "collected",
      runId: start.runId,
    });
  });

  it("refreshes the local index, then collects matches once and caches the card", async () => {
    const collector = makeCollector([statBunkerRow()]);
    const service = makeService(collector.collect);

    const refreshed = await service.refreshIndex("2025");
    expect(refreshed).toMatchObject({
      season: "2025",
      acceptedCount: 1,
      quarantinedCount: 0,
      indexedPlayerCount: 1,
    });
    expect(service.searchPlayers("HAALAND")[0]?.playerId).toBe(HAALAND_ID);

    collector.serveRows([statBunkerMatchRow()]);
    const generated = await service.generate({
      schemaVersion: 1,
      playerId: HAALAND_ID,
      season: "2025",
    });
    expect(generated.outcome).toBe("collected");
    expect(service.getMatches(HAALAND_ID, "2025").available).toBe(true);

    const cached = await service.generate({
      schemaVersion: 1,
      playerId: HAALAND_ID,
      season: "2025",
    });
    expect(cached.outcome).toBe("cache-hit");
    expect(collector.collect).toHaveBeenCalledTimes(2);
  });

  it("rejects index rows from a different season than the verified target", async () => {
    const collector = makeCollector([
      statBunkerRow({ season: "2024", source_url: STANDINGS_URL_596 }),
    ]);
    const service = makeService(collector.collect);
    const refreshed = await service.refreshIndex("2025");
    expect(refreshed).toMatchObject({
      acceptedCount: 0,
      quarantinedCount: 1,
      indexedPlayerCount: 0,
    });
    expect(service.searchPlayers("haaland")).toEqual([]);
  });

  it("indexes 2026/27 rows whose extractor still stamps the old 2025 season", async () => {
    const collector = makeCollector([
      statBunkerRow({
        player_name: "Bukayo Saka",
        team_name: "Arsenal",
        season: "2025",
        source_url: STANDINGS_URL_791,
      }),
    ]);
    const service = makeService(collector.collect);
    const refreshed = await service.refreshIndex("2026");
    expect(refreshed).toMatchObject({
      season: "2026",
      acceptedCount: 1,
      quarantinedCount: 0,
    });
    expect(service.searchPlayers("saka", { season: "2026" })[0]).toMatchObject({
      playerName: "Bukayo Saka",
    });
  });

  it("serves a fresh cache hit without calling the collector", async () => {
    const { collector, service, result } = await generateHaalandOnce();
    expect(result.outcome).toBe("collected");
    expect(result.cardBundle?.bundleVersion).toBe(1);

    const second = await service.generate({
      schemaVersion: 1,
      playerId: HAALAND_ID,
      season: "2025",
    });
    expect(second.outcome).toBe("cache-hit");
    expect(second.runId).toBeNull();
    expect(second.cardBundle?.cardId).toBe(result.cardBundle?.cardId);
    expect(collector.collect).toHaveBeenCalledTimes(1);
  });

  it("recollects exactly once when the cached card goes stale", async () => {
    const { collector, service, result } = await generateHaalandOnce();
    advanceMs(900_001);

    const refreshed = await service.generate({
      schemaVersion: 1,
      playerId: HAALAND_ID,
      season: "2025",
    });
    expect(refreshed.outcome).toBe("collected");
    expect(refreshed.cardBundle?.bundleVersion).toBe(2);
    expect(refreshed.cardBundle?.freshness.state).toBe("fresh");
    expect(refreshed.runId).not.toBeNull();
    expect(collector.collect).toHaveBeenCalledTimes(2);

    const run = service.getRun(refreshed.runId ?? "");
    expect(run?.terminalStatus).toBe("succeeded");
    expect(run?.cardId).toBe(refreshed.cardBundle?.cardId);
    expect(result.cardBundle?.bundleVersion).toBe(1);
  });

  it("passes the verified player-season match URL to the collector", async () => {
    const { collector } = await generateHaalandOnce();
    expect(collector.requests).toHaveLength(1);
    expect(collector.requests[0]).toMatchObject({
      sourceId: MATCH_SOURCE_2025,
      targetUrl: MATCH_URL_776,
      season: "2025",
    });
  });

  it("resolves a list-only player exactly once, then reuses the proven numeric ID", async () => {
    const indexed = snapshotForRow(statBunkerRow({ player_url: null }));
    if (indexed.record.entityType !== "player") {
      throw new Error("expected player fixture");
    }
    const fallbackPlayerId = indexed.record.playerId;
    const collector = makeCollector([
      resolvedStatBunkerMatchRow({ goals: 2, assists: 0 }),
    ]);
    const service = makeService(collector.collect);
    service.indexPlayers([indexed]);

    const resolved = await service.generate({
      schemaVersion: 1,
      playerId: fallbackPlayerId,
      season: "2025",
    });
    expect(resolved).toMatchObject({
      outcome: "collected",
      cardBundle: {
        stats: { goals: 2 },
        provenance: { sourceUrl: RESOLVED_MATCH_URL_776 },
      },
    });
    expect(collector.requests[0]).toMatchObject({
      targetUrl: SEARCH_URL_776,
      season: "2025",
    });
    expect(collector.requests[0]?.sourceId).toMatch(
      /^statbunker-epl-2025-26-matches-[a-f0-9]{16}-2025$/,
    );

    // A later list refresh still has no player URL. It cannot erase the
    // numeric identity proven by the successful resolver collection.
    advanceMs(900_001);
    service.indexPlayers([
      snapshotForRow(
        statBunkerRow({ player_url: null }),
        clock().toISOString(),
      ),
    ]);
    collector.serveRows([statBunkerMatchRow({ goals: 3, assists: 0 })]);
    const refreshed = await service.generate({
      schemaVersion: 1,
      playerId: fallbackPlayerId,
      season: "2025",
    });
    expect(refreshed).toMatchObject({
      outcome: "collected",
      cardBundle: { stats: { goals: 3 }, bundleVersion: 2 },
    });
    expect(collector.requests[1]).toMatchObject({
      targetUrl: RESOLVED_MATCH_URL_776,
      season: "2025",
    });
    expect(collector.collect).toHaveBeenCalledTimes(2);
  });

  it("reruns the exact resolver target during guarded recovery after caching its numeric ID", async () => {
    const indexed = snapshotForRow(statBunkerRow({ player_url: null }));
    if (indexed.record.entityType !== "player") {
      throw new Error("expected player fixture");
    }
    const collector = makeCollector([
      resolvedStatBunkerMatchRow({ goals: 2, assists: 0 }),
    ]);
    const service = makeService(collector.collect);
    service.indexPlayers([indexed]);
    const first = await service.generate({
      schemaVersion: 1,
      playerId: indexed.record.playerId,
      season: "2025",
    });
    expect(first.outcome).toBe("collected");
    const resolverSourceId = collector.requests[0]?.sourceId;
    if (resolverSourceId === undefined) {
      throw new Error("expected resolver source ID");
    }

    collector.serveRows([resolvedStatBunkerMatchRow({ goals: 4, assists: 0 })]);
    const recovered = await service.verifyRecovery(resolverSourceId);

    expect(recovered).toMatchObject({
      success: true,
      quarantinedCount: 0,
    });
    expect(
      service.getLatestCard(indexed.record.playerId, "2025")?.stats.goals,
    ).toBe(4);
    expect(collector.requests[1]).toMatchObject({
      sourceId: resolverSourceId,
      targetUrl: SEARCH_URL_776,
      season: "2025",
    });
    expect(collector.collect).toHaveBeenCalledTimes(2);
  });

  it("proves identity from live Bright Data wrapping, not only exact source_url stamps", async () => {
    const indexed = snapshotForRow(statBunkerRow({ player_url: null }));
    if (indexed.record.entityType !== "player") {
      throw new Error("expected player fixture");
    }
    const collector = makeCollector([
      { error: null, input: { url: SEARCH_URL_776 } },
      resolvedStatBunkerMatchRow({
        resolved_player_id: 60023,
        source_url: SEARCH_URL_776,
        input: { url: SEARCH_URL_776 },
      }),
      statBunkerMatchRow({
        goals: 1,
        assists: 0,
        played_on: "16 Aug 2025",
      }),
    ]);
    const service = makeService(collector.collect);
    service.indexPlayers([indexed]);

    const result = await service.generate({
      schemaVersion: 1,
      playerId: indexed.record.playerId,
      season: "2025",
    });
    expect(result).toMatchObject({
      outcome: "collected",
      cardBundle: {
        provenance: { sourceUrl: RESOLVED_MATCH_URL_776 },
        stats: { goals: 3, assists: 1 },
      },
    });
  });

  it("does not treat one Bright Data envelope row as majority match drift", async () => {
    const indexed = snapshotForRow(statBunkerRow({ player_url: null }));
    if (indexed.record.entityType !== "player") {
      throw new Error("expected player fixture");
    }
    const collector = makeCollector([
      {
        error: null,
        timestamp: "2026-08-23T09:00:00.000Z",
        input: { url: SEARCH_URL_776 },
      },
      resolvedStatBunkerMatchRow({
        source_url: SEARCH_URL_776,
        input: { url: SEARCH_URL_776 },
      }),
    ]);
    const service = makeService(collector.collect);
    service.indexPlayers([indexed]);

    const result = await service.generate({
      schemaVersion: 1,
      playerId: indexed.record.playerId,
      season: "2025",
    });
    expect(result.outcome).toBe("collected");
    expect(result.cardBundle?.stats.goals).toBe(2);
  });

  it("fails closed when resolver rows do not prove one exact identity", async () => {
    const indexed = snapshotForRow(statBunkerRow({ player_url: null }));
    if (indexed.record.entityType !== "player") {
      throw new Error("expected player fixture");
    }
    const collector = makeCollector([
      resolvedStatBunkerMatchRow(),
      resolvedStatBunkerMatchRow({
        resolved_player_name: "Another Player",
      }),
    ]);
    const service = makeService(collector.collect);
    service.indexPlayers([indexed]);

    const result = await service.generate({
      schemaVersion: 1,
      playerId: indexed.record.playerId,
      season: "2025",
    });
    expect(result.outcome).toBe("failed");
    expect(result.cardBundle).toBeNull();
    expect(result.failureReason).toContain("exact StatBunker player ID");
    expect(collector.requests).toHaveLength(1);
    expect(collector.requests[0]?.targetUrl).toBe(SEARCH_URL_776);
  });

  it.each([
    [
      "player link",
      {
        resolved_player_url:
          "https://www.statbunker.com/players/getPlayerStats?player_id=99999",
      },
    ],
    [
      "match source",
      {
        source_url:
          "https://www.statbunker.com/players/SeasonMatches?comps_id=791&comps_type=EPL&player_id=60023",
      },
    ],
  ])(
    "rejects a resolver row whose claimed %s is not canonical",
    async (_, overrides) => {
      const indexed = snapshotForRow(statBunkerRow({ player_url: null }));
      if (indexed.record.entityType !== "player") {
        throw new Error("expected player fixture");
      }
      const collector = makeCollector([resolvedStatBunkerMatchRow(overrides)]);
      const service = makeService(collector.collect);
      service.indexPlayers([indexed]);

      const result = await service.generate({
        schemaVersion: 1,
        playerId: indexed.record.playerId,
        season: "2025",
      });
      expect(result).toMatchObject({ outcome: "failed", cardBundle: null });
      expect(result.failureReason).toContain("exact StatBunker player ID");
      expect(
        service.getMatches(indexed.record.playerId, "2025").available,
      ).toBe(false);
    },
  );

  it("updates an in-progress 2026/27 card after a completed match changes upstream", async () => {
    const collector = makeCollector([
      statBunkerMatchRow({
        competition: "Premier League 26/27",
        played_on: "23 Aug 2026",
        score: "0 - 0",
        goals: 0,
        assists: 0,
      }),
    ]);
    const service = makeService(collector.collect);
    service.indexPlayers([
      snapshotForRow(
        statBunkerRow({
          season: "2026",
          source_url: STANDINGS_URL_791,
          appearances: 1,
          goals: 0,
          assists: 0,
        }),
      ),
    ]);

    const beforeGoal = await service.generate({
      schemaVersion: 1,
      playerId: HAALAND_ID,
      season: "2026",
    });
    expect(beforeGoal.cardBundle?.stats.goals).toBe(0);
    expect(collector.requests[0]).toMatchObject({
      sourceId: MATCH_SOURCE_2026,
      targetUrl: MATCH_URL_791,
      season: "2026",
    });

    advanceMs(900_001);
    collector.serveRows([
      statBunkerMatchRow({
        competition: "Premier League 26/27",
        played_on: "23 Aug 2026",
        score: "1 - 0",
        goals: 1,
        assists: 0,
      }),
    ]);
    const afterGoal = await service.generate({
      schemaVersion: 1,
      playerId: HAALAND_ID,
      season: "2026",
    });

    expect(afterGoal.outcome).toBe("collected");
    expect(afterGoal.cardBundle?.season).toBe("2026");
    expect(afterGoal.cardBundle?.stats.goals).toBe(1);
    expect(afterGoal.cardBundle?.bundleVersion).toBe(2);
    expect(service.getMatches(HAALAND_ID, "2026").rows[0]).toMatchObject({
      playedOn: "2026-08-23",
      playerGoals: 1,
      homeGoals: 1,
      awayGoals: 0,
    });
    expect(service.listSeasons().at(-1)?.complete).toBe(false);
    expect(collector.collect).toHaveBeenCalledTimes(2);
  });

  it("keeps per-season bundles independent when switching seasons", async () => {
    const collector = makeCollector([
      statBunkerMatchRow({
        competition: "Premier League 24/25",
        played_on: "10 May 2025",
        home_team: "Arsenal",
        away_team: "Chelsea",
        goals: 22,
      }),
    ]);
    const service = makeService(collector.collect);
    service.indexPlayers([
      snapshotForRow(
        statBunkerRow({
          season: "2024",
          team_name: "Arsenal",
          goals: 22,
        }),
      ),
      snapshotForRow(statBunkerRow({ season: "2025", goals: 19 })),
    ]);

    const for2024 = await service.generate({
      schemaVersion: 1,
      playerId: HAALAND_ID,
      season: "2024",
    });
    collector.serveRows([statBunkerMatchRow({ goals: 19 })]);
    const for2025 = await service.generate({
      schemaVersion: 1,
      playerId: HAALAND_ID,
      season: "2025",
    });

    expect(for2024.outcome).toBe("collected");
    expect(for2025.outcome).toBe("collected");
    expect(for2024.cardBundle?.season).toBe("2024");
    expect(for2025.cardBundle?.season).toBe("2025");
    expect(for2024.cardBundle?.team.name).toBe("Arsenal");
    expect(for2025.cardBundle?.team.name).toBe("Manchester City");
    expect(for2024.cardBundle?.stats.goals).toBe(22);
    expect(for2025.cardBundle?.stats.goals).toBe(19);
    expect(for2024.cardBundle?.cardId).not.toBe(for2025.cardBundle?.cardId);
    expect(for2024.cardBundle?.provenance.snapshotHash).not.toBe(
      for2025.cardBundle?.provenance.snapshotHash,
    );
    expect(service.getLatestCard(HAALAND_ID, "2024")?.season).toBe("2024");
    expect(service.getLatestCard(HAALAND_ID, "2025")?.season).toBe("2025");
    expect(
      service.searchPlayers("haaland", { season: "2024", club: "arsenal" }),
    ).toHaveLength(1);
    expect(
      service.searchPlayers("haaland", { season: "2024", club: "city" }),
    ).toHaveLength(0);
    expect(collector.requests[0]?.targetUrl).toBe(MATCH_URL_596);
    expect(collector.requests[1]?.targetUrl).toBe(MATCH_URL_776);
  });

  it("records the five truthful stages on success", async () => {
    const { result, service } = await generateHaalandOnce();
    const run = service.getRun(result.runId ?? "");
    expect(run?.stageHistory.map((stage) => stage.stage)).toEqual([
      "finding_player",
      "starting_collector",
      "extracting_statistics",
      "validating_data",
      "printing_card",
    ]);
    expect(run?.terminalStatus).toBe("succeeded");
    expect(run?.currentStage).toBeNull();
    expect(run?.stageHistory.every((stage) => stage.completedAt !== null)).toBe(
      true,
    );
  });

  it("canonicalizes and reruns the exact player-match source for guarded recovery", async () => {
    const { collector, service } = await generateHaalandOnce();
    const preview = service.canonicalizeHealingPreview(
      MATCH_SOURCE_2025,
      [statBunkerMatchRow({ goals: 3 })],
      OBSERVED_AT,
    );
    expect(preview[0]).toMatchObject({
      entityType: "match",
      sourceId: MATCH_SOURCE_2025,
      playerId: HAALAND_ID,
      season: "2025",
      goals: 3,
      sourceUrl: MATCH_URL_776,
    });
    expect(service.hasRecoveryTarget(MATCH_SOURCE_2025)).toBe(true);

    advanceMs(900_001);
    collector.serveRows([statBunkerMatchRow({ goals: 3 })]);
    const recovery = await service.verifyRecovery(MATCH_SOURCE_2025);
    expect(recovery).toMatchObject({
      success: true,
      validRecordCount: 2,
      quarantinedCount: 0,
    });
    expect(recovery.sampleEntityIds).toContain(HAALAND_ID);
    expect(recovery.payloadHashes).toHaveLength(2);
    expect(service.getLatestCard(HAALAND_ID, "2025")?.stats.goals).toBe(3);
    expect(collector.requests.at(-1)).toMatchObject({
      sourceId: MATCH_SOURCE_2025,
      targetUrl: MATCH_URL_776,
      season: "2025",
    });
  });
});

describe("failures preserve the last verified card", () => {
  it("keeps the verified bundle when every collected row is malformed", async () => {
    const collector = makeCollector([statBunkerMatchRow()]);
    const service = makeService(collector.collect);
    service.indexPlayers([snapshotForRow(statBunkerRow())]);
    const good = await service.generate({
      schemaVersion: 1,
      playerId: HAALAND_ID,
      season: "2025",
    });
    expect(good.outcome).toBe("collected");

    advanceMs(900_001);
    collector.serveRows([{ totally: "malformed" }, "not-even-an-object"]);
    const bad = await service.generate({
      schemaVersion: 1,
      playerId: HAALAND_ID,
      season: "2025",
    });

    expect(bad.outcome).toBe("failed");
    expect(bad.failureReason).toContain("preserving the last verified card");
    expect(bad.cardBundle?.cardId).toBe(good.cardBundle?.cardId);
    expect(bad.cardBundle?.provenance.snapshotHash).toBe(
      good.cardBundle?.provenance.snapshotHash,
    );
    expect(service.getLatestCard(HAALAND_ID, "2025")?.bundleVersion).toBe(1);
    expect(
      service.pipeline.quarantines.listBySource(MATCH_SOURCE_2025),
    ).toHaveLength(2);
    const run = service.getRun(bad.runId ?? "");
    expect(run?.terminalStatus).toBe("failed");
    expect(run?.failureReason).toContain("Most player-match rows failed");
    expect(run?.stageHistory.at(-1)?.stage).toBe("validating_data");
    expect(collector.collect).toHaveBeenCalledTimes(2);
  });

  it("fails validating_data when rows do not contain the indexed player's team", async () => {
    const collector = makeCollector([statBunkerMatchRow()]);
    const service = makeService(collector.collect);
    service.indexPlayers([snapshotForRow(statBunkerRow())]);
    const good = await service.generate({
      schemaVersion: 1,
      playerId: HAALAND_ID,
      season: "2025",
    });
    advanceMs(900_001);
    collector.serveRows([
      statBunkerMatchRow({
        home_team: "Chelsea",
        away_team: "Arsenal",
      }),
    ]);
    const bad = await service.generate({
      schemaVersion: 1,
      playerId: HAALAND_ID,
      season: "2025",
    });
    expect(bad.outcome).toBe("failed");
    expect(bad.failureReason).toContain("preserving the last verified card");
    expect(bad.cardBundle?.cardId).toBe(good.cardBundle?.cardId);
    const run = service.getRun(bad.runId ?? "");
    expect(run?.terminalStatus).toBe("failed");
    expect(run?.stageHistory.at(-1)?.stage).toBe("validating_data");
  });

  it("never converts a live failure into demo data", async () => {
    const collector = makeCollector([statBunkerMatchRow()]);
    const service = makeService(collector.collect);
    service.indexPlayers([snapshotForRow(statBunkerRow())]);
    const good = await service.generate({
      schemaVersion: 1,
      playerId: HAALAND_ID,
      season: "2025",
    });
    advanceMs(900_001);
    collector.failWith(new Error("Bright Data rate limited the request"));
    const failed = await service.generate({
      schemaVersion: 1,
      playerId: HAALAND_ID,
      season: "2025",
    });

    expect(failed.outcome).toBe("failed");
    expect(failed.failureReason).toContain("rate limited");
    // The preserved bundle keeps its original LIVE PROVIDER identity.
    expect(failed.cardBundle?.provenance.dataOriginLabel).toBe("LIVE PROVIDER");
    expect(failed.cardBundle?.cardId).toBe(good.cardBundle?.cardId);
    const serialized = JSON.stringify(
      service.getLatestCard(HAALAND_ID, "2025"),
    );
    expect(serialized).not.toContain("DEMO DATA");

    // Without a previous bundle, failure serves nothing rather than inventing data.
    service.indexPlayers([
      snapshotForRow(
        statBunkerRow({
          player_name: "Newcomer Nine",
          player_url:
            "https://www.statbunker.com/players/getPlayerStats?player_id=900000009",
        }),
      ),
    ]);
    collector.failWith(new Error("Bright Data trigger rejected the request"));
    const noCache = await service.generate({
      schemaVersion: 1,
      playerId: `${STATBUNKER_SOURCE_ID}:900000009`,
      season: "2025",
    });
    expect(noCache.outcome).toBe("failed");
    expect(noCache.cardBundle).toBeNull();
    expect(
      service.getLatestCard(`${STATBUNKER_SOURCE_ID}:900000009`, "2025"),
    ).toBeNull();
  });
});

describe("redaction of public collector identity", () => {
  it("never leaks the real collector id through cards, runs, or results", async () => {
    const { collector, result, service } = await generateHaalandOnce();
    const run = service.getRun(result.runId ?? "");
    const card = service.getCard(result.cardBundle?.cardId ?? "");
    const serialized = JSON.stringify({
      result,
      run,
      card,
      seasons: service.listSeasons(),
    });
    expect(serialized).not.toContain(SECRET_COLLECTOR_ID);
    expect(serialized).not.toMatch(/c_[A-Za-z0-9_-]{4,}/);
    expect(card?.provenance.collectorId).toBe(REDACTED_COLLECTOR_ID);
    expect(result.cardBundle?.provenance.collectorId).toBe(
      REDACTED_COLLECTOR_ID,
    );
    expect(collector.collect).toHaveBeenCalledTimes(1);
  });

  it("sanitizes collector tokens embedded in extractor versions", async () => {
    const collector = makeCollector([{ totally: "malformed" }]);
    const service = makeService(collector.collect);
    service.indexPlayers([snapshotForRow(statBunkerRow())]);
    await service.generate({
      schemaVersion: 1,
      playerId: HAALAND_ID,
      season: "2025",
    });
    const quarantines =
      service.pipeline.quarantines.listBySource(MATCH_SOURCE_2025);
    expect(quarantines.length).toBeGreaterThan(0);
    for (const quarantine of quarantines) {
      expect(quarantine.extractorVersion).not.toContain(SECRET_COLLECTOR_ID);
      expect(quarantine.extractorVersion).toContain(REDACTED_COLLECTOR_ID);
    }
  });
});

describe("honest, season-bound match availability", () => {
  it("binds demo matches to their season and reports gaps honestly", () => {
    const collector = makeCollector();
    const service = makeService(collector.collect);
    service.seedDemoData();

    const available2025 = service.getMatches("demo:erling-haaland", "2025");
    expect(available2025.available).toBe(true);
    expect(available2025.rows).toHaveLength(2);
    expect(available2025.rows.every((row) => row.season === "2025")).toBe(true);

    const unavailable2026 = service.getMatches("demo:erling-haaland", "2026");
    expect(unavailable2026.available).toBe(false);
    expect(unavailable2026.rows).toEqual([]);
    expect(unavailable2026.reason).toContain("incomplete");

    const unavailable2023 = service.getMatches("demo:erling-haaland", "2023");
    expect(unavailable2023.available).toBe(false);
    expect(unavailable2023.rows).toEqual([]);

    expect(() =>
      service.addMatchRows("demo:erling-haaland", "2024", [
        {
          schemaVersion: 1,
          matchId: "mismatch",
          season: "2025",
          playedOn: null,
          competition: "Premier League",
          homeTeam: "A",
          awayTeam: "B",
          homeGoals: 0,
          awayGoals: 0,
          sourceUrl: STANDINGS_URL_596,
        },
      ]),
    ).toThrow(/cannot bind/);
    expect(collector.collect).not.toHaveBeenCalled();
  });

  it("throws for unknown seasons instead of guessing availability", () => {
    const collector = makeCollector();
    const service = makeService(collector.collect);
    expect(() => service.getMatches("demo:erling-haaland", "1998")).toThrow(
      /verified StatBunker registry/,
    );
  });
});

describe("explicit demo seeding", () => {
  it("labels demo cards DEMO DATA permanently and needs no collection", () => {
    const collector = makeCollector();
    const service = makeService(collector.collect);
    service.seedDemoData();

    const hits = service.searchPlayers("erling haaland");
    expect(hits).toHaveLength(1);
    expect(hits[0]?.seasons).toEqual(["2023", "2024", "2025"]);

    const card = service.getLatestCard("demo:erling-haaland", "2024");
    expect(card?.provenance.dataOriginLabel).toBe("DEMO DATA");
    expect(card?.provenance.collectorId).toBe(REDACTED_COLLECTOR_ID);
    expect(card?.stats.goals).toBe(22);

    expect(service.searchPlayers("taylor brooks")).toHaveLength(2);
    expect(collector.collect).not.toHaveBeenCalled();
  });

  it("is idempotent", () => {
    const collector = makeCollector();
    const service = makeService(collector.collect);
    service.seedDemoData();
    service.seedDemoData();
    expect(service.searchPlayers("taylor brooks")).toHaveLength(2);
    expect(service.getPlayerSeasons("demo:taylor-brooks-kingsley")).toEqual([
      "2024",
      "2025",
    ]);
    expect(
      service.getLatestCard("demo:erling-haaland", "2025")?.bundleVersion,
    ).toBe(1);
  });
});
