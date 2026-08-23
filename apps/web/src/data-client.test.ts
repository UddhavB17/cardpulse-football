import { describe, expect, it, vi } from "vitest";
import { validSourceHealthListResponseFixture } from "@bidsentinel/contracts/fixtures";

import {
  DataClientError,
  DemoFootballApiClient,
  HttpFootballApiClient,
  normalizeCardEnvelope,
  normalizeGenerateOutcome,
  normalizeMatchesPayload,
  normalizeScrapePayload,
  normalizeSearchPayload,
  normalizeSeasonsPayload,
  scrapeProgressOf,
} from "./data-client";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function clientFor(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
): { client: HttpFootballApiClient; calls: string[] } {
  const calls: string[] = [];
  const fetchFn = vi.fn(
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push(url);
      return await handler(url, init);
    },
  );
  return {
    client: new HttpFootballApiClient(
      "http://test.local",
      fetchFn as typeof fetch,
    ),
    calls,
  };
}

describe("search payload normalization", () => {
  it("accepts the documented envelope shape", () => {
    const payload = normalizeSearchPayload({
      data: [
        {
          playerId: "p:1",
          playerName: "Rio Marchetti",
          team: { teamId: "t:1", name: "Northgate United" },
          position: "midfielder",
          seasons: ["2024", "2025"],
        },
      ],
      generatedAt: "2026-08-21T10:00:00.000Z",
    });
    expect(payload.results).toHaveLength(1);
    expect(payload.results[0]).toMatchObject({
      playerId: "p:1",
      playerName: "Rio Marchetti",
      clubName: "Northgate United",
      position: "midfielder",
    });
    expect(payload.generatedAt).toBe("2026-08-21T10:00:00.000Z");
  });

  it("tolerates alternate field spellings and bare arrays", () => {
    const payload = normalizeSearchPayload([
      {
        id: "p:2",
        name: "Callum Oduya",
        clubName: "Harbor City FC",
        seasons: [{ season: "2023" }, { key: "2024" }],
      },
    ]);
    expect(payload.results[0]).toMatchObject({
      playerId: "p:2",
      clubName: "Harbor City FC",
    });
    expect(payload.results[0]?.seasons).toEqual(["2023", "2024"]);
  });

  it("rejects entries that cannot identify a player", () => {
    expect(() =>
      normalizeSearchPayload({ data: [{ clubName: "Ghost FC" }] }),
    ).toThrow(DataClientError);
  });

  it("returns an empty result list for an empty page", () => {
    expect(normalizeSearchPayload({ data: [] }).results).toHaveLength(0);
  });
});

describe("seasons payload normalization", () => {
  it("reads plain strings and structured entries", () => {
    expect(
      normalizeSeasonsPayload({ data: ["2024", { season: "2025" }] }).seasons,
    ).toEqual(["2024", "2025"]);
    expect(normalizeSeasonsPayload(["2023"]).seasons).toEqual(["2023"]);
  });
});

describe("card payload normalization", () => {
  it("maps documented card fields including provenance", () => {
    const card = normalizeCardEnvelope({
      data: {
        playerId: "p:1",
        playerName: "Rio Marchetti",
        club: "Northgate United",
        position: "midfielder",
        shirtNumber: 8,
        season: "2025",
        stats: {
          appearances: 34,
          goals: 9,
          assists: 11,
          yellowCards: 2,
          redCards: 0,
          minutesPlayed: 2971,
        },
        provenance: {
          sourceId: "statbunker-epl",
          sourceUrl: "https://example.test/epl/2025",
          observedAt: "2026-08-20T14:00:00.000Z",
          snapshotVersion: 2,
          snapshotHash: "abc123def456",
          collectorId: "c_collector_12345678",
          scrapeRunId: "run-42",
          scrapeStatus: "completed",
        },
      },
    });
    expect(card.totals).toMatchObject({ goals: 9, minutesPlayed: 2971 });
    expect(card.sourceUrl).toContain("example.test");
    expect(card.snapshotVersion).toBe(2);
    expect(card.collectorId).toBe("c_collector_12345678");
    expect(card.mode).toBe("live");
  });

  it("keeps explicitly-null minutes null instead of coercing to zero", () => {
    const card = normalizeCardEnvelope({
      data: {
        playerId: "p:1",
        playerName: "X",
        club: "Y",
        season: "2026",
        stats: { appearances: 2, goals: 0, assists: 0, minutesPlayed: null },
      },
    });
    expect(card.totals.minutesPlayed).toBeNull();
    expect(card.totals.goals).toBe(0);
  });

  it("throws when identity or club fields are missing", () => {
    expect(() =>
      normalizeCardEnvelope({ data: { playerName: "No Id" } }),
    ).toThrow(DataClientError);
    expect(() =>
      normalizeCardEnvelope({ data: { playerId: "p:9", playerName: "X" } }),
    ).toThrow(DataClientError);
  });

  it("labels demo mode only on an explicit demo marker", () => {
    expect(
      normalizeCardEnvelope({
        data: { playerId: "p", playerName: "P", club: "C", mode: "demo" },
      }).mode,
    ).toBe("demo");
  });
});

describe("generate outcome handling", () => {
  it("detects a synchronous finished card", () => {
    const outcome = normalizeGenerateOutcome(
      200,
      normalizeCardEnvelope({
        data: { playerId: "p", playerName: "P", club: "C", season: "2025" },
      }) as unknown,
    );
    expect(outcome.kind).toBe("card");
  });

  it("detects a 202 run acknowledgement", () => {
    const outcome = normalizeGenerateOutcome(202, {
      runId: "run-99",
      status: "queued",
    });
    expect(outcome).toEqual({ kind: "run", runId: "run-99", status: "queued" });
  });

  it("refuses a 202 without a run id and a 500 without anything usable", () => {
    expect(() => normalizeGenerateOutcome(202, {})).toThrow(DataClientError);
    expect(() => normalizeGenerateOutcome(500, { message: "boom" })).toThrow(
      DataClientError,
    );
  });

  it("prefers the run id when both are present (poll path wins)", () => {
    const outcome = normalizeGenerateOutcome(200, {
      runId: "run-7",
      card: { playerId: "p", playerName: "P", club: "C" },
    });
    expect(outcome.kind).toBe("run");
  });
});

describe("scrape run polling payloads", () => {
  it("classifies terminal and non-terminal statuses", () => {
    expect(scrapeProgressOf("succeeded")).toBe("completed");
    expect(scrapeProgressOf("COMPLETED")).toBe("completed");
    expect(scrapeProgressOf("failed")).toBe("failed");
    expect(scrapeProgressOf("quarantined")).toBe("failed");
    expect(scrapeProgressOf("running")).toBe("running");
    expect(scrapeProgressOf("queued")).toBe("queued");
  });

  it("normalizes the run snapshot and embedded cards", () => {
    const snapshot = normalizeScrapePayload({
      data: {
        runId: "run-9",
        status: "succeeded",
        card: { playerId: "p", playerName: "P", club: "C" },
      },
    });
    expect(snapshot.progress).toBe("completed");
    expect(snapshot.card?.playerId).toBe("p");

    const running = normalizeScrapePayload({
      data: { runId: "run-9", status: "extracting" },
    });
    expect(running.progress).toBe("running");
    expect(running.card).toBeNull();
  });

  it("requires a run id in the snapshot", () => {
    expect(() => normalizeScrapePayload({ data: { status: "ok" } })).toThrow(
      DataClientError,
    );
  });
});

describe("matches payload normalization", () => {
  it("maps dates, venue-aware scores and player lines", () => {
    const result = normalizeMatchesPayload({
      data: [
        {
          matchId: "m1",
          date: "2025-09-13T14:00:00.000Z",
          opponent: "Sable Rovers",
          homeAway: "home",
          score: { home: 3, away: 1 },
          goals: 2,
          assists: 0,
          minutes: 90,
        },
        {
          opponent: "Vale Wanderers",
          homeAway: "A",
          score: "0-2",
          goals: 0,
          minutes: 61,
        },
      ],
    });
    expect(result.matches[0]).toMatchObject({
      venue: "home",
      scoreFor: 3,
      scoreAgainst: 1,
      goals: 2,
    });
    // Away perspective: player's team scored 0.
    expect(result.matches[1]).toMatchObject({
      venue: "away",
      scoreFor: 0,
      scoreAgainst: 2,
    });
  });

  it("skips rows without an opponent rather than guessing", () => {
    const result = normalizeMatchesPayload({
      data: [{ goals: 1 }, { opponent: "OK FC" }],
    });
    expect(result.matches).toHaveLength(1);
  });

  it("reads season-bound match rows and preserves explicit unavailability", () => {
    const available = normalizeMatchesPayload({
      data: {
        available: true,
        reason: null,
        rows: [
          {
            matchId: "m-contract",
            playedOn: "2026-01-11",
            teamName: "Manchester City",
            homeTeam: "Manchester City",
            awayTeam: "Chelsea",
            homeGoals: 2,
            awayGoals: 1,
            playerGoals: 1,
            playerAssists: 0,
            playerMinutes: 90,
          },
        ],
      },
    });
    expect(available).toMatchObject({
      available: true,
      reason: null,
      matches: [
        {
          opponent: "Chelsea",
          venue: "home",
          scoreFor: 2,
          scoreAgainst: 1,
          goals: 1,
          minutes: 90,
        },
      ],
    });

    expect(
      normalizeMatchesPayload({
        data: {
          available: false,
          reason: "Source data not available yet.",
          rows: [],
        },
      }),
    ).toEqual({
      matches: [],
      available: false,
      reason: "Source data not available yet.",
    });
  });
});

describe("HTTP transport behaviour", () => {
  it("searches with encoded query params and normalizes the response", async () => {
    const { client, calls } = clientFor(() =>
      jsonResponse({ data: [], generatedAt: "2026-08-21T10:00:00.000Z" }),
    );
    const result = await client.searchPlayers("rio mar", "2025");
    expect(result.results).toHaveLength(0);
    expect(calls[0]).toBe(
      "http://test.local/api/search/players?q=rio+mar&season=2025",
    );
  });

  it("omits the season param when none is selected", async () => {
    const { client, calls } = clientFor(() => jsonResponse({ data: [] }));
    await client.searchPlayers("oduya", null);
    expect(calls[0]).not.toContain("season=");
  });

  it("sends the generate POST body exactly as contracted", async () => {
    let capturedInit: RequestInit | undefined;
    const { client } = clientFor((_url, init) => {
      capturedInit = init;
      return jsonResponse({ runId: "run-1", status: "queued" }, 202);
    });
    const outcome = await client.generateCard({
      playerId: "p:1",
      season: "2025",
      mode: "live",
    });
    expect(outcome.kind).toBe("run");
    expect(capturedInit?.method).toBe("POST");
    expect(capturedInit?.body).toBe(
      '{"playerId":"p:1","season":"2025","mode":"live"}',
    );
  });

  it("sends the operator token only on explicit protected mutations", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = new HttpFootballApiClient(
      "http://test.local",
      async (input, init) => {
        calls.push({
          url: String(input),
          ...(init === undefined ? {} : { init }),
        });
        if (String(input).endsWith("/api/player-index/refresh")) {
          return jsonResponse({
            data: {
              season: "2025",
              acceptedCount: 10,
              quarantinedCount: 0,
              indexedPlayerCount: 10,
            },
          });
        }
        return jsonResponse({ data: [] });
      },
    );
    client.setOperatorToken("operator-secret");

    await client.searchPlayers("haaland", null);
    expect(
      new Headers(calls[0]?.init?.headers).has("X-CardPulse-Operator-Token"),
    ).toBe(false);

    await expect(client.refreshPlayerIndex("2025")).resolves.toMatchObject({
      acceptedCount: 10,
      indexedPlayerCount: 10,
    });
    expect(
      new Headers(calls[1]?.init?.headers).get("X-CardPulse-Operator-Token"),
    ).toBe("operator-secret");
  });

  it("maps card 404s to null so callers can say 'not available yet'", async () => {
    const { client } = clientFor(() => jsonResponse({ error: {} }, 404));
    await expect(client.getCard("p:missing", "2025")).resolves.toBeNull();
  });

  it("surfaces API errors as DataClientErrors with safe messages", async () => {
    const { client } = clientFor(() =>
      jsonResponse(
        {
          error: { message: "Source is healing", code: "service_unavailable" },
        },
        503,
      ),
    );
    await expect(client.searchPlayers("rio", null)).rejects.toMatchObject({
      name: "DataClientError",
      status: 503,
    });
  });

  it("validates /api/runtime against the frozen contract", async () => {
    const good = clientFor(() =>
      jsonResponse({
        data: {
          schemaVersion: 1,
          service: "cardpulse-api",
          domain: "football",
          mode: "live",
          sourceId: "statbunker-epl-2025-26",
          collectorConfigured: true,
          targetConfigured: true,
          liveMutationsEnabled: false,
          configurationIssues: [],
        },
        generatedAt: "2026-08-21T17:30:00.000Z",
      }),
    );
    await expect(good.client.getRuntime()).resolves.toMatchObject({
      mode: "live",
    });

    const bad = clientFor(() =>
      jsonResponse({
        data: { mode: "sometimes" },
        generatedAt: "2026-08-21T17:30:00.000Z",
      }),
    );
    await expect(bad.client.getRuntime()).rejects.toBeInstanceOf(
      DataClientError,
    );
  });

  it("summarizes source health for the provenance drawer", async () => {
    const { client } = clientFor(() =>
      jsonResponse(validSourceHealthListResponseFixture),
    );
    const fixtureSource =
      validSourceHealthListResponseFixture.data[0] ??
      (() => {
        throw new Error("Missing source health fixture");
      })();
    const health = await client.getSourceHealth(fixtureSource.sourceId);
    expect(health?.state).toBe(fixtureSource.state);
    // The shared fixture source is healthy with no open incident.
    expect(health?.activeIncidentReason).toBeNull();
    expect(health?.healingState).toContain("recovery evidence");
    await expect(client.getSourceHealth("unknown-source")).resolves.toBeNull();
  });
});

describe("demo adapter honesty", () => {
  it("includes Haaland and disambiguates duplicate names without losing the demo label", async () => {
    const demo = new DemoFootballApiClient();
    const haaland = await demo.searchPlayers("HAALAND", null);
    expect(haaland.results[0]).toMatchObject({
      playerName: "Erling Haaland",
      clubName: "Manchester City",
    });

    const duplicates = await demo.searchPlayers("Taylor Brooks", "2025");
    expect(duplicates.results.map((player) => player.clubName)).toEqual([
      "Kingsley Rovers FC",
      "Harbour Athletic FC",
    ]);

    const switched = await demo.getCard(haaland.results[0]!.playerId, "2024");
    expect(switched?.mode).toBe("demo");
  });

  it("serves deterministic fictional players with labelled demo cards", async () => {
    const demo = new DemoFootballApiClient();
    const search = await demo.searchPlayers("marchetti", null);
    expect(search.results[0]).toMatchObject({
      playerName: "Rio Marchetti",
      clubName: "Northgate United",
    });

    const seasons = await demo.getPlayerSeasons(search.results[0]!.playerId);
    expect(seasons.seasons.length).toBeGreaterThan(0);

    const outcome = await demo.generateCard({
      playerId: search.results[0]!.playerId,
      season: seasons.seasons.at(-1)!,
      mode: "demo",
    });
    if (outcome.kind !== "card") throw new Error("expected a direct demo card");
    expect(outcome.card.mode).toBe("demo");
    expect(outcome.card.sourceUrl).toContain("demo.cardpulse.local");

    const again = await demo.generateCard({
      playerId: search.results[0]!.playerId,
      season: seasons.seasons.at(-1)!,
      mode: "demo",
    });
    if (again.kind !== "card") throw new Error("expected a direct demo card");
    expect(again.card.totals).toEqual(outcome.card.totals);
  });

  it("keeps demo match scores consistent with the player's goals", async () => {
    const demo = new DemoFootballApiClient();
    const haaland = await demo.searchPlayers("haaland", "2025");
    const matches = await demo.getPlayerMatches(
      haaland.results[0]!.playerId,
      "2025",
    );
    expect(matches.available).toBe(true);
    for (const match of matches.matches) {
      if (match.goals !== null && match.scoreFor !== null) {
        expect(match.scoreFor).toBeGreaterThanOrEqual(match.goals);
      }
    }
  });

  it("filters by season availability and rejects unknown ids", async () => {
    const demo = new DemoFootballApiClient();
    const scoped = await demo.searchPlayers("ferreyra", "2026");
    expect(scoped.results).toHaveLength(1);
    const unscopedSeason = await demo.searchPlayers("ramanathan", "2023");
    expect(unscopedSeason.results).toHaveLength(0);

    await expect(demo.getPlayerSeasons("demo:none")).rejects.toMatchObject({
      status: 404,
    });
    await expect(demo.getCard("demo:none", "2025")).resolves.toBeNull();
  });
});
