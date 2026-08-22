import { describe, expect, it, vi } from "vitest";

import {
  validChangeEventListResponseFixture,
  validPlayerListResponseFixture,
  validQuarantineListResponseFixture,
  validSourceHealthListResponseFixture,
  validStandingsListResponseFixture,
  validTeamListResponseFixture,
} from "@bidsentinel/contracts/fixtures";

import {
  FixtureCardPulseDataClient,
  HttpCardPulseDataClient,
  isGeneratedDataStale,
} from "./data-client";

describe("fixture dashboard adapter", () => {
  it("runs the deterministic recovery flow before emitting an amendment", async () => {
    const client = new FixtureCardPulseDataClient();

    expect((await client.load()).healing.state).toBe("healthy");
    await client.collect("drift");
    const snapshot = await client.load();
    expect(snapshot.healing.state).toBe("healing_requested");
    expect(snapshot.quarantines.data).toHaveLength(1);
    expect(snapshot.players.data[0]?.latestSnapshot.version).toBe(1);

    await client.progressHealing();
    expect((await client.load()).healing.state).toBe("awaiting_approval");
    await client.validatePreview();
    expect((await client.load()).healing.state).toBe("preview_valid");
    await client.approve(true);
    expect((await client.load()).healing.state).toBe("recovered");

    await client.collect("amended");
    const amended = await client.load();
    expect(amended.changes.data).toHaveLength(1);
    expect(amended.players.data[0]?.latestSnapshot.version).toBe(2);
    // The tracked striker's goal tally moved with the verified rerun.
    expect(amended.players.data[0]?.stats.goals).toBe(21);
  });

  it("serves teams and standings lists alongside players", async () => {
    const snapshot = await new FixtureCardPulseDataClient().load();

    expect(snapshot.teams.data[0]?.name).toContain("Rheinland");
    expect(snapshot.standings.data.length).toBeGreaterThanOrEqual(3);
    const leader = [...snapshot.standings.data].sort(
      (a, b) => a.rank - b.rank,
    )[0];
    if (leader === undefined) throw new Error("Missing standings fixture");
    // Standings arithmetic is enforced by the frozen contract.
    expect(leader.points).toBe(leader.won * 3 + leader.drawn);
  });

  it("exposes safe preview failure, recovery failure, stale and unavailable states", async () => {
    const client = new FixtureCardPulseDataClient();

    client.setInspectionScenario("preview_invalid");
    expect((await client.load()).healing.state).toBe("preview_invalid");
    client.setInspectionScenario("recovery_failed");
    expect((await client.load()).healing.state).toBe("recovery_failed");
    client.setInspectionScenario("stale");
    expect((await client.load()).stale).toBe(true);
    client.setInspectionScenario("unavailable");
    await expect(client.load()).rejects.toMatchObject({ status: 503 });
  });
});

describe("HTTP dashboard adapter", () => {
  it("loads and contract-validates every API view", async () => {
    const responses: Record<string, unknown> = {
      "/api/runtime": {
        data: {
          schemaVersion: 1,
          service: "cardpulse-api",
          domain: "football",
          mode: "mock",
          sourceId: "openligadb",
          collectorConfigured: false,
          targetConfigured: false,
          liveMutationsEnabled: false,
          configurationIssues: [],
        },
        generatedAt: "2026-08-21T14:15:00.000Z",
      },
      "/api/players": validPlayerListResponseFixture,
      "/api/teams": validTeamListResponseFixture,
      "/api/standings": validStandingsListResponseFixture,
      "/api/changes": validChangeEventListResponseFixture,
      "/api/sources": validSourceHealthListResponseFixture,
      "/api/quarantines": validQuarantineListResponseFixture,
      "/api/healing/openligadb": {
        data: {
          mode: "mock",
          sourceId: "openligadb",
          state: "recovered",
          incident: null,
        },
      },
    };
    const fetchFn = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input), "http://test.local");
      return new Response(JSON.stringify(responses[url.pathname]), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const client = new HttpCardPulseDataClient(
      "http://test.local",
      fetchFn as typeof fetch,
    );

    const snapshot = await client.load();
    expect(snapshot.runtime.mode).toBe("mock");
    expect(snapshot.players.data).toHaveLength(1);
    expect(snapshot.healing.state).toBe("recovered");
    expect(fetchFn).toHaveBeenCalledTimes(8);
  });

  it("rejects payloads that violate the frozen runtime contract", async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: { mode: "sometimes" },
            generatedAt: "2026-08-21T14:15:00.000Z",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    const client = new HttpCardPulseDataClient(
      "http://test.local",
      fetchFn as typeof fetch,
    );

    await expect(client.load()).rejects.toBeTruthy();
  });

  it("sends the operator token only on a mutation request", async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    const client = new HttpCardPulseDataClient(
      "http://test.local",
      fetchFn as typeof fetch,
    );

    await client.approve(true, { operatorToken: "secret-operator-token" });

    const calls = fetchFn.mock.calls as unknown as Array<
      [input: unknown, init?: RequestInit]
    >;
    const [, init] = calls[0] ?? [];
    expect(init?.headers).toMatchObject({
      "x-cardpulse-operator-token": "secret-operator-token",
    });
    expect(init?.body).toBe('{"approve":true}');
  });
});

describe("freshness", () => {
  it("marks responses stale after the explicit two-minute boundary", () => {
    const now = Date.parse("2026-08-20T10:05:00.000Z");
    expect(isGeneratedDataStale(["2026-08-20T10:04:00.000Z"], now)).toBe(false);
    expect(isGeneratedDataStale(["2026-08-20T10:02:59.999Z"], now)).toBe(true);
  });
});
