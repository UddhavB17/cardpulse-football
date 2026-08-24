import { describe, expect, it, vi } from "vitest";

import { FootballRecordSchema, entityIdOf } from "@bidsentinel/contracts";

import {
  DEFAULT_STATBUNKER_SOURCE_ID,
  STATBUNKER_SOURCE_ID,
  STATBUNKER_SOURCE_PROFILE,
  BrightDataCollectionProvider,
  StatBunkerRowMapper,
  createStatBunkerPipelineRowMapper,
  normalizeStatBunkerSeason,
  statBunkerExternalId,
  statBunkerSourceIdMatches,
} from "./index.js";

const observedAt = "2026-08-23T09:00:00.000Z";
const sourceId = DEFAULT_STATBUNKER_SOURCE_ID;

/** A row exactly matching scrapers/statbunker studio-prompt.md output. */
function specRow(
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

describe("StatBunker source profile selection", () => {
  it("matches the bare profile name and suffixed variants", () => {
    expect(statBunkerSourceIdMatches("statbunker")).toBe(true);
    expect(statBunkerSourceIdMatches("statbunker-football-public")).toBe(true);
    expect(statBunkerSourceIdMatches("statbunker-premier-league")).toBe(true);
    expect(statBunkerSourceIdMatches("statbunker_premier")).toBe(true);
    expect(statBunkerSourceIdMatches("  StatBunker-Premier-League ")).toBe(
      true,
    );
  });

  it("does not match other sources or loose substrings", () => {
    expect(statBunkerSourceIdMatches("openligadb")).toBe(false);
    expect(statBunkerSourceIdMatches("openligadb-football-demo")).toBe(false);
    expect(statBunkerSourceIdMatches("xstatbunker")).toBe(false);
    expect(statBunkerSourceIdMatches("statbunkerparsing")).toBe(false);
    expect(statBunkerSourceIdMatches("")).toBe(false);
  });
});

describe("normalizeStatBunkerSeason", () => {
  it.each([
    ["2025", "2025"],
    ["2025/26", "2025"],
    ["2025 / 26", "2025"],
    ["2024/2025", "2024"],
  ])("normalizes %s to the starting year %s", (raw, expected) => {
    expect(normalizeStatBunkerSeason(raw)).toBe(expected);
  });

  it.each(["25/26", "9/10", "2025/1", "bundesliga", "", "20"])(
    "rejects ambiguous or malformed season %s instead of guessing",
    (raw) => {
      expect(normalizeStatBunkerSeason(raw)).toBeNull();
    },
  );
});

describe("statBunkerExternalId", () => {
  it("prefers the site's own player_id query parameter", () => {
    const url = new URL(
      "https://www.statbunker.com/players/getPlayerStats?player_id=9000000001",
    );
    expect(
      statBunkerExternalId({ playerUrl: url, playerName: "A", teamName: "B" }),
    ).toBe("9000000001");
  });

  it("uses a non-generic URL path segment when there is no player_id", () => {
    const url = new URL(
      "https://www.statbunker.com/en/players/Finn-Kr%C3%BCger",
    );
    expect(
      statBunkerExternalId({ playerUrl: url, playerName: "X", teamName: "Y" }),
    ).toBe("finn-kruger");
  });

  it("never collapses every row onto a generic endpoint script name", () => {
    const first = new URL(
      "https://www.statbunker.com/players/getPlayerStats?player_id=111",
    );
    const second = new URL(
      "https://www.statbunker.com/players/getPlayerStats?player_id=222",
    );
    const idFor = (url: URL, name: string) =>
      statBunkerExternalId({ playerUrl: url, playerName: name, teamName: "T" });
    expect(idFor(first, "Player One")).not.toBe(idFor(second, "Player Two"));
  });

  it("falls back to the deterministic name slug and degrades identically for non-Latin names", () => {
    const noUrl = {
      playerUrl: null,
      playerName: "Luka Marić",
      teamName: "Rheinland FC 04",
    };
    expect(statBunkerExternalId(noUrl)).toBe("luka-maric-rheinland-fc-04");
    expect(statBunkerExternalId({ ...noUrl, playerName: "Luka Marić" })).toBe(
      statBunkerExternalId(noUrl),
    );
  });
});

describe("StatBunkerRowMapper", () => {
  it("requires a canonical source id at construction", () => {
    expect(
      () => new StatBunkerRowMapper({ sourceId: "Not Canonical!" }),
    ).toThrow(/canonical source ID/);
    expect(new StatBunkerRowMapper({ sourceId }).sourceId).toBe(sourceId);
  });

  it("maps a spec-shaped row into a schema-valid canonical player record", () => {
    const mapper = new StatBunkerRowMapper({ sourceId });
    const outcome = mapper.map(specRow(), observedAt);
    if (!outcome.ok)
      throw new Error(`expected acceptance: ${JSON.stringify(outcome.issues)}`);

    const parsed = FootballRecordSchema.parse(outcome.record);
    expect(parsed.entityType).toBe("player");
    expect(entityIdOf(parsed)).toBe(`${sourceId}:9000000001`);
    if (parsed.entityType !== "player") throw new Error("unreachable");
    expect(parsed.sourceId).toBe(sourceId);
    expect(parsed.externalId).toBe("9000000001");
    expect(parsed.playerName).toBe("Finn Krüger");
    expect(parsed.team).toEqual({
      teamId: `${sourceId}:rheinland-fc-04`,
      name: "Rheinland FC 04",
    });
    expect(parsed.position).toBe("forward");
    expect(parsed.season).toBe("2025");
    expect(parsed.nationality).toBe("Germany");
    expect(parsed.shirtNumber).toBeNull();
    expect(parsed.observedAt).toBe(observedAt);
    expect(parsed.sourceUrl).toBe(
      "https://www.statbunker.com/players/getPlayerStats?player_id=9000000001",
    );
    // Discipline canon: total dismissals = straight reds + second yellows.
    expect(parsed.stats).toEqual({
      appearances: 33,
      goals: 18,
      assists: 5,
      yellowCards: 3,
      redCards: 3,
      minutesPlayed: 2820,
    });
  });

  it("tolerates case/punctuation key variants and title-cased positions", () => {
    const mapper = new StatBunkerRowMapper({ sourceId });
    const messyRow = {
      "Player Name": "Milan Horvat",
      "Player URL":
        "https://www.statbunker.com/players/getPlayerDetails?player_id=9000000002",
      Club: "FC Adlersberg 03",
      Position: "Midfielder",
      Apps: "32",
      Goals: 9,
      Assists: 12,
      Yellows: 5,
      "Second Yellows": 0,
      Reds: "0",
      Mins: "2,705",
      Nationality: "Croatia",
      Season: "2025/26",
      PageURL:
        "https://www.statbunker.com/competitions/PlayerStandings?comp_id=776",
    };
    const outcome = mapper.map(messyRow, observedAt);
    if (!outcome.ok) throw new Error(JSON.stringify(outcome.issues));
    const record = FootballRecordSchema.parse(outcome.record);
    if (record.entityType !== "player") throw new Error("unreachable");
    expect(record.playerId).toBe(`${sourceId}:9000000002`);
    expect(record.position).toBe("midfielder");
    expect(record.stats).toMatchObject({
      appearances: 32,
      minutesPlayed: 2705,
      redCards: 0,
    });
    expect(record.season).toBe("2025");
    // Per-player provenance wins; the list page URL is only a fallback.
    expect(record.sourceUrl).toBe(
      "https://www.statbunker.com/players/getPlayerDetails?player_id=9000000002",
    );
  });

  it("maps abbreviated positions gk, df, mf and fw", () => {
    const mapper = new StatBunkerRowMapper({ sourceId });
    for (const [raw, expected] of [
      ["GK", "goalkeeper"],
      ["df", "defender"],
      ["MF", "midfielder"],
      ["Fw", "forward"],
    ] as const) {
      const outcome = mapper.map(specRow({ position: raw }), observedAt);
      expect(outcome.ok).toBe(true);
      if (outcome.ok && outcome.record.entityType === "player") {
        expect(outcome.record.position).toBe(expected);
      }
    }
  });

  it("fails closed with structured issues on missing, dashed-out, or malformed fields", () => {
    const mapper = new StatBunkerRowMapper({ sourceId });

    const emptyOutcome = mapper.map({}, observedAt);
    expect(emptyOutcome.ok).toBe(false);
    if (!emptyOutcome.ok) {
      const codes = emptyOutcome.issues.map((issue) => issue.code);
      expect(codes).toContain("missing_field");
      const paths = emptyOutcome.issues.map((issue) => issue.path.join("."));
      expect(paths).toContain("playerName");
      expect(paths).toContain("team");
      expect(paths).toContain("position");
      expect(paths).toContain("season");
      expect(paths).toContain("sourceUrl");
      expect(paths).toContain("stats.redCards");
    }

    // Site dash markers mean "no value" and must never become invented zeros.
    const dashed = mapper.map(
      specRow({
        appearances: "-",
        nationality: "–",
        assists: null,
        minutes_played: null,
        second_yellow_cards: null,
      }),
      observedAt,
    );
    expect(dashed.ok).toBe(false);
    if (!dashed.ok) {
      const codes = dashed.issues.map((issue) => issue.code);
      expect(codes).toContain("unavailable_field");
      expect(
        dashed.issues.some((i) =>
          i.message.includes("refusing to assume zero"),
        ),
      ).toBe(true);
    }

    const malformed = mapper.map(specRow({ goals: "lots" }), observedAt);
    expect(malformed.ok).toBe(false);
    if (!malformed.ok) {
      expect(malformed.issues.map((issue) => issue.code)).toContain(
        "invalid_field",
      );
    }

    expect(mapper.map(null, observedAt)).toMatchObject({
      ok: false,
      issues: [{ code: "row_not_object" }],
    });
    expect(mapper.map([specRow()], observedAt)).toMatchObject({
      ok: false,
      issues: [{ code: "row_not_object" }],
    });
  });

  it("rejects unmappable positions and ambiguous seasons without guessing", () => {
    const mapper = new StatBunkerRowMapper({ sourceId });
    const badPosition = mapper.map(specRow({ position: "Anchor" }), observedAt);
    expect(badPosition).toMatchObject({
      ok: false,
      issues: [{ code: "unsupported_position" }],
    });

    const ambiguousSeason = mapper.map(
      specRow({ season: "25/26" }),
      observedAt,
    );
    expect(ambiguousSeason).toMatchObject({
      ok: false,
      issues: [
        {
          code: "unsupported_season",
          message: expect.stringContaining("without guessing"),
        },
      ],
    });
  });

  it("keeps honest nulls for unavailable profile and minutes fields", () => {
    const mapper = new StatBunkerRowMapper({ sourceId });
    const nullProfile = mapper.map(
      specRow({ nationality: null, minutes_played: "-" }),
      observedAt,
    );
    expect(nullProfile.ok).toBe(true);
    if (nullProfile.ok && nullProfile.record.entityType === "player") {
      expect(nullProfile.record.nationality).toBeNull();
      expect(nullProfile.record.stats.minutesPlayed).toBeNull();
    }

    const nullNationalityOnly = mapper.map(
      specRow({ nationality: null }),
      observedAt,
    );
    expect(nullNationalityOnly.ok).toBe(true);
    if (
      nullNationalityOnly.ok &&
      nullNationalityOnly.record.entityType === "player"
    ) {
      expect(nullNationalityOnly.record.nationality).toBeNull();
    }
  });

  it("splits batches into records and rejections that keep their raw rows", () => {
    const mapper = new StatBunkerRowMapper({ sourceId });
    const good = specRow();
    const bad = specRow({ player_name: "--" });
    const batch = mapper.mapRows([good, bad], observedAt);
    expect(batch.records).toHaveLength(1);
    expect(batch.rejectedRows).toHaveLength(1);
    expect(batch.rejectedRows[0]?.row).toBe(bad);
    expect(batch.rejectedRows[0]?.issues.length).toBeGreaterThan(0);
  });

  it("reports schema mismatches from the frozen contract as fail-closed issues", () => {
    const mapper = new StatBunkerRowMapper({ sourceId });
    const outOfRange = mapper.map(
      specRow({ minutes_played: 500_000 }),
      observedAt,
    );
    expect(outOfRange.ok).toBe(false);
    if (!outOfRange.ok) {
      expect(outOfRange.issues.map((issue) => issue.code)).toContain(
        "schema_mismatch",
      );
    }
  });
});

describe("createStatBunkerPipelineRowMapper", () => {
  it("returns canonical records for accepted rows and untouched raw rows for rejects", () => {
    const mapRow = createStatBunkerPipelineRowMapper();
    const good = specRow();
    const bad = { player_name: "Broken", goals: "NaN everywhere" };

    const accepted = mapRow(good, sourceId, observedAt);
    expect(FootballRecordSchema.parse(accepted)).toMatchObject({
      entityType: "player",
      playerId: `${sourceId}:9000000001`,
    });

    // Rejections pass through completely unmapped so pipeline quarantine and
    // structural drift signals stay authoritative.
    const rejected = mapRow(bad, sourceId, observedAt);
    expect(rejected).toBe(bad);

    // Non-object junk also passes through for downstream quarantine.
    expect(mapRow(42, sourceId, observedAt)).toBe(42);
  });

  it("caches one mapper per source id and never throws", () => {
    const mapRow = createStatBunkerPipelineRowMapper();
    const first = mapRow(specRow(), sourceId, observedAt);
    const second = mapRow(specRow(), sourceId, observedAt);
    expect(first).toEqual(second);

    const otherSource = mapRow(
      specRow(),
      "statbunker-football-public",
      observedAt,
    );
    expect(FootballRecordSchema.parse(otherSource)).toMatchObject({
      sourceId: "statbunker-football-public",
      playerId: "statbunker-football-public:9000000001",
    });

    // An invalid source id must degrade to raw passthrough, not throw.
    expect(mapRow(specRow(), "!!!invalid!!!", observedAt)).toBeInstanceOf(
      Object,
    );
  });
});

describe("profile constants", () => {
  it("expose the named boundary and the standardized default source id", () => {
    expect(STATBUNKER_SOURCE_PROFILE).toBe("statbunker");
    expect(STATBUNKER_SOURCE_ID).toBe("statbunker-epl-2025-26");
    expect(DEFAULT_STATBUNKER_SOURCE_ID).toBe(STATBUNKER_SOURCE_ID);
    expect(statBunkerSourceIdMatches(DEFAULT_STATBUNKER_SOURCE_ID)).toBe(true);
  });
});

describe("stable ID collision regressions", () => {
  const mapper = new StatBunkerRowMapper({ sourceId });

  it("keeps distinct IDs when every player shares the getPlayerStats pathname", () => {
    // Live-run regression: /players/getPlayerStats is identical for all
    // players, so only the player_id query parameter discriminates them.
    const rice = mapper.map(
      specRow({ player_name: "Declan Rice", team_name: "Arsenal" }),
      observedAt,
    );
    const saka = mapper.map(
      specRow({
        player_name: "Bukayo Saka",
        team_name: "Arsenal",
        player_url:
          "https://www.statbunker.com/players/getPlayerStats?player_id=9000000042",
      }),
      observedAt,
    );
    if (!rice.ok || !saka.ok) throw new Error("both rows must map");
    if (
      rice.record.entityType !== "player" ||
      saka.record.entityType !== "player"
    ) {
      throw new Error("unreachable");
    }
    expect(rice.record.playerId).toBe(`${sourceId}:9000000001`);
    expect(saka.record.playerId).toBe(`${sourceId}:9000000042`);
  });

  it("prefers an explicit player_id cell over the URL query parameter", () => {
    const outcome = mapper.map(
      specRow({
        player_id: "777",
        player_url:
          "https://www.statbunker.com/players/getPlayerStats?player_id=9000000001",
      }),
      observedAt,
    );
    expect(outcome.ok).toBe(true);
    if (outcome.ok && outcome.record.entityType === "player") {
      expect(outcome.record.externalId).toBe("777");
    }
  });

  it("falls back to name+team slugs (distinct per team) when no ID signal survives", () => {
    const sharedGenericUrl =
      "https://www.statbunker.com/players/getPlayerStats";
    const home = mapper.map(
      specRow({
        player_url: sharedGenericUrl,
        player_name: "Alex Wood",
        team_name: "Rheinland FC 04",
      }),
      observedAt,
    );
    const away = mapper.map(
      specRow({
        player_url: sharedGenericUrl,
        player_name: "Alex Wood",
        team_name: "FC Adlersberg 03",
      }),
      observedAt,
    );
    if (!home.ok || !away.ok) throw new Error("both rows must map");
    const ids = [
      home.record.entityType === "player" && home.record.playerId,
      away.record.entityType === "player" && away.record.playerId,
    ];
    expect(ids[0]).toBe(`${sourceId}:alex-wood-rheinland-fc-04`);
    expect(ids[1]).toBe(`${sourceId}:alex-wood-fc-adlersberg-03`);
    expect(new Set(ids).size).toBe(2);
  });

  it("derives deterministic distinct IDs across a whole mixed batch", () => {
    const rows = [
      specRow(),
      specRow({
        player_name: "Bukayo Saka",
        player_url:
          "https://www.statbunker.com/players/getPlayerStats?player_id=9000000042",
      }),
      specRow({
        player_name: "Alex Wood",
        team_name: "Rheinland FC 04",
        player_url: "https://www.statbunker.com/players/getPlayerStats",
      }),
      specRow({
        player_name: "Alex Wood",
        team_name: "FC Adlersberg 03",
        player_url: "https://www.statbunker.com/players/getPlayerStats",
      }),
    ];
    const batch = mapper.mapRows(rows, observedAt);
    expect(batch.records).toHaveLength(4);
    const entityIds = new Set(batch.records.map(entityIdOf));
    expect(entityIds.size).toBe(4);
  });
});

describe("partial selector failure resilience (#show incident)", () => {
  const mapper = new StatBunkerRowMapper({ sourceId });

  it("accepts unavailable optional enrichment without fabricating zero minutes", () => {
    // The verified one-page collector intentionally skips the broken #show
    // detail interaction. Core list stats remain authoritative while
    // minutes/nationality are represented as unavailable.
    const complete = specRow();
    const noMinutes = specRow({
      player_name: "Enriched Missing",
      player_url:
        "https://www.statbunker.com/players/getPlayerStats?player_id=8000000001",
      minutes_played: "-",
      nationality: "-",
    });
    const noDetailAtAll = specRow({
      player_name: "Detail Gone",
      player_url:
        "https://www.statbunker.com/players/getPlayerStats?player_id=8000000002",
      minutes_played: null,
      nationality: null,
    });

    const batch = mapper.mapRows(
      [complete, noMinutes, noDetailAtAll],
      observedAt,
    );
    expect(batch.records).toHaveLength(3);
    expect(batch.rejectedRows).toHaveLength(0);

    const minutes = batch.records.map((record) => {
      if (record.entityType !== "player") throw new Error("unreachable");
      return record.stats.minutesPlayed;
    });
    expect(minutes).toEqual([2820, null, null]);
    expect(batch.records[0]?.entityType).toBe("player");
    if (batch.records[0]?.entityType === "player") {
      expect(batch.records[0].nationality).toBe("Germany");
    }
    for (const record of batch.records.slice(1)) {
      if (record.entityType !== "player") throw new Error("unreachable");
      expect(record.nationality).toBeNull();
    }
  });

  it("still quarantines malformed non-null minutes", () => {
    const outcome = mapper.map(
      specRow({ minutes_played: "ninety minutes" }),
      observedAt,
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.issues).toContainEqual(
        expect.objectContaining({
          code: "invalid_field",
          path: ["stats", "minutesPlayed"],
        }),
      );
    }
  });

  it("still accepts rows whose only enrichment loss is the nullable nationality", () => {
    const outcome = mapper.map(
      specRow({
        player_id: 8000000003,
        nationality: "-",
      }),
      observedAt,
    );
    expect(outcome.ok).toBe(true);
    if (outcome.ok && outcome.record.entityType === "player") {
      expect(outcome.record.nationality).toBeNull();
      expect(outcome.record.stats.minutesPlayed).toBe(2820);
    }
  });
});

describe("BrightDataCollectionProvider with the StatBunker row mapper", () => {
  it("maps dataset rows through the StatBunker boundary during trigger/poll", async () => {
    const rawRows = [
      specRow(),
      specRow({
        player_name: "Luka Marić",
        player_url:
          "https://www.statbunker.com/players/getPlayerStats?player_id=9000000002",
        team_name: "Rheinland FC 04",
        position: "defender",
        appearances: 31,
        goals: 2,
        assists: null, // unavailable → row must fail closed
      }),
    ];
    const mockFetch = vi.fn((url: string) => {
      if (url.includes("/dca/trigger")) {
        return Promise.resolve(
          new Response(JSON.stringify({ collection_id: "j_statbunker_1" }), {
            status: 200,
          }),
        );
      }
      if (url.includes("/dca/dataset?id=j_statbunker_1")) {
        return Promise.resolve(
          new Response(JSON.stringify(rawRows), { status: 200 }),
        );
      }
      return Promise.reject(new Error(`Unknown URL: ${url}`));
    });

    const provider = new BrightDataCollectionProvider({
      apiToken: "test-token",
      collectorId: "c_statbunker_test",
      overrideIncompatibleSchema: true,
      rowMapper: createStatBunkerPipelineRowMapper(),
      fetchFn: mockFetch as unknown as typeof fetch,
      maxRetries: 0,
    });

    const batch = await provider.collect({
      sourceId: "statbunker-football-public",
      targetUrl:
        "https://www.statbunker.com/competitions/PlayerStandings?comp_id=776",
      requestedAt: observedAt,
    });

    expect(mockFetch.mock.calls[0]?.[0]).toContain(
      "override_incompatible_schema=1",
    );
    expect(batch.collectorId).toBe("c_statbunker_test");
    expect(batch.sourceId).toBe("statbunker-football-public");
    expect(batch.payloads).toHaveLength(2);

    const accepted = FootballRecordSchema.parse(batch.payloads[0]);
    expect(entityIdOf(accepted)).toBe("statbunker-football-public:9000000001");
    if (accepted.entityType === "player") {
      expect(accepted.stats.redCards).toBe(3);
    }

    // The rejected row keeps no StatBunker identity or discipline canon: it
    // flows to the pipeline generically mapped and must stay schema-invalid
    // there (unavailable assists cannot satisfy the frozen contract).
    const rejectedOutcome = FootballRecordSchema.safeParse(batch.payloads[1]);
    expect(rejectedOutcome.success).toBe(false);
    expect(batch.payloads[1]).toMatchObject({ playerName: "Luka Marić" });
  });

  it("leaves rows untouched by the generic mapper when no rowMapper is configured", async () => {
    const mockFetch = vi.fn((url: string) => {
      if (url.includes("/dca/trigger")) {
        return Promise.resolve(
          new Response(JSON.stringify({ collection_id: "j_plain_1" }), {
            status: 200,
          }),
        );
      }
      if (url.includes("/dca/dataset?id=j_plain_1")) {
        return Promise.resolve(
          new Response(
            JSON.stringify([{ id: "p-1", playerName: "Generic Player" }]),
            { status: 200 },
          ),
        );
      }
      return Promise.reject(new Error(`Unknown URL: ${url}`));
    });

    const provider = new BrightDataCollectionProvider({
      apiToken: "test-token",
      collectorId: "c_plain_test",
      fetchFn: mockFetch as unknown as typeof fetch,
      maxRetries: 0,
    });

    const batch = await provider.collect({
      sourceId: "openligadb",
      targetUrl: "https://example.football.test/players",
      requestedAt: observedAt,
    });
    const mapped = batch.payloads[0] as Record<string, unknown>;
    expect(mapped["entityType"]).toBe("player");
    expect(mapped["playerName"]).toBe("Generic Player");
  });
});
