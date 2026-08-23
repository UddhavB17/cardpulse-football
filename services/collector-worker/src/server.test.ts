import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { CardPulsePipeline } from "./pipeline.js";
import {
  MockBrightDataHealingProvider,
  STATBUNKER_SOURCE_ID,
  StatBunkerRowMapper,
  statBunkerPlayerSearchResolverUrl,
  type FootballCollectionRequest,
} from "@bidsentinel/brightdata";
import {
  trackedPlayerId,
  validPlayerFixture,
} from "@bidsentinel/contracts/fixtures";
import { SelfHealingCoordinator } from "./healing-coordinator.js";
import {
  createRequestHandler,
  resolveAllowedOrigins,
  resolveServerHost,
  resolveServerPort,
} from "./server.js";
import { createRuntimeFromEnv, type CardPulseRuntime } from "./runtime.js";

const SOURCE_ID = "openligadb";
const OPERATOR_TOKEN = "operator-token-with-at-least-32-chars";
const HAALAND_ID = `${STATBUNKER_SOURCE_ID}:60023`;

function statBunkerHaalandRow(): Record<string, unknown> {
  return {
    player_name: "Erling Haaland",
    player_url:
      "https://www.statbunker.com/players/getPlayerStats?player_id=60023",
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
    source_url:
      "https://www.statbunker.com/competitions/PlayerStandings?comp_id=776",
  };
}

function statBunkerHaalandMatchRow(): Record<string, unknown> {
  return {
    competition: "Premier League 25/26",
    home_team: "Liverpool",
    away_team: "Manchester City",
    score: "1 - 2",
    started: 1,
    substitute: 0,
    minutes_played: 90,
    goals: 1,
    assists: 1,
    yellow_cards: 1,
    second_yellow_cards: 0,
    red_cards: 0,
    played_on: "08 Feb 2026",
  };
}

function resolvedStatBunkerHaalandMatchRow(): Record<string, unknown> {
  return {
    ...statBunkerHaalandMatchRow(),
    resolved_player_name: "Erling Haaland",
    resolved_player_id: "60023",
    resolved_player_url:
      "https://www.statbunker.com/players/getPlayerStats?player_id=60023",
    source_url:
      "https://www.statbunker.com/players/SeasonMatches?comps_id=776&comps_type=EPL&player_id=60023",
  };
}

async function startRuntimeServer(runtime: CardPulseRuntime) {
  const server = createServer(
    createRequestHandler(runtime.pipeline, runtime.coordinator, runtime),
  );
  const baseUrl = await new Promise<string>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as AddressInfo;
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
  return { server, baseUrl };
}

async function stopRuntimeServer(server: ReturnType<typeof createServer>) {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

describe("deployment configuration", () => {
  it("preserves local binding defaults and accepts Render values", () => {
    expect(resolveServerHost(undefined)).toBe("127.0.0.1");
    expect(resolveServerHost(" 0.0.0.0 ")).toBe("0.0.0.0");
    expect(resolveServerPort(undefined)).toBe(4321);
    expect(resolveServerPort("10000")).toBe(10000);
  });

  it("fails fast for an invalid deployment origin or port", () => {
    expect(() => resolveAllowedOrigins("https://example.com/path")).toThrow(
      /origins without paths/,
    );
    expect(() => resolveServerPort("invalid")).toThrow(/PORT/);
  });
});

describe("CardPulse Football API Server", () => {
  let server: ReturnType<typeof createServer>;
  let baseUrl: string;
  let pipeline: CardPulsePipeline;
  let coordinator: SelfHealingCoordinator;

  beforeAll(async () => {
    pipeline = new CardPulsePipeline();
    const healingProvider = new MockBrightDataHealingProvider([
      validPlayerFixture,
    ]);
    coordinator = new SelfHealingCoordinator(healingProvider, {
      pollIntervalMs: 0,
    });
    pipeline.healingCoordinator = coordinator;

    const runtime: CardPulseRuntime = {
      mode: "mock",
      pipeline,
      coordinator,
      collectionProvider: null,
      sourceId: SOURCE_ID,
      collectorId: null,
      targetUrl: null,
      configurationIssues: ["test runtime"],
      liveMutationsEnabled: false,
      operatorTokenHash: null,
    };
    const handler = createRequestHandler(pipeline, coordinator, runtime, {
      allowedOrigins: resolveAllowedOrigins(
        "https://cardpulse-football-web.onrender.com",
      ),
    });
    server = createServer(handler);

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const address = server.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${address.port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  it("GET /health returns health metrics for cardpulse-api", async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { service: string; status: string };
    };
    expect(body.data.service).toBe("cardpulse-api");
    expect(body.data.status).toBe("ok");
  });

  it("allows the configured production web origin and rejects other origins", async () => {
    const allowed = await fetch(`${baseUrl}/health`, {
      headers: { Origin: "https://cardpulse-football-web.onrender.com" },
    });
    expect(allowed.headers.get("access-control-allow-origin")).toBe(
      "https://cardpulse-football-web.onrender.com",
    );
    expect(allowed.headers.get("vary")).toContain("Origin");

    const rejected = await fetch(`${baseUrl}/health`, {
      headers: { Origin: "https://untrusted.example" },
    });
    expect(rejected.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("GET /api/runtime explicitly labels deterministic mock mode", async () => {
    const res = await fetch(`${baseUrl}/api/runtime`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: {
        mode: string;
        domain: string;
        collectorConfigured: boolean;
        sourceId: string;
      };
    };
    expect(body.data).toMatchObject({
      mode: "mock",
      domain: "football",
      collectorConfigured: false,
      sourceId: SOURCE_ID,
    });
  });

  it("GET /api/players returns empty list initially (before dev collect)", async () => {
    const res = await fetch(`${baseUrl}/api/players`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: unknown[];
      pagination: { total: number };
    };
    expect(body.data).toEqual([]);
    expect(body.pagination.total).toBe(0);
  });

  it("POST /api/dev/collect?mode=valid seeds verified football cards", async () => {
    const res = await fetch(`${baseUrl}/api/dev/collect?mode=valid`, {
      method: "POST",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      outcomes: string[];
      collectorId: string;
    };
    expect(body.success).toBe(true);
    expect(body.outcomes.every((outcome) => outcome === "accepted")).toBe(true);
    expect(body.collectorId).toBe("[redacted]");

    const listRes = await fetch(`${baseUrl}/api/players`);
    const listBody = (await listRes.json()) as {
      data: Array<{ playerId: string; stats: { goals: number } }>;
    };
    expect(listBody.data).toHaveLength(3);
    // Living leaderboard: the top scorer is listed first.
    expect(listBody.data[0]?.playerId).toBe(trackedPlayerId);
    expect(listBody.data[0]?.stats.goals).toBe(18);

    const standingsRes = await fetch(`${baseUrl}/api/standings`);
    const standingsBody = (await standingsRes.json()) as {
      data: Array<{ rank: number; teamName: string }>;
    };
    expect(standingsBody.data).toHaveLength(3);
    expect(standingsBody.data[0]?.rank).toBe(1);

    const teamsRes = await fetch(`${baseUrl}/api/teams`);
    const teamsBody = (await teamsRes.json()) as { data: unknown[] };
    expect(teamsBody.data).toHaveLength(3);
  });

  it("GET /api/players/{playerId} returns the living card details", async () => {
    const res = await fetch(
      `${baseUrl}/api/players/${encodeURIComponent(trackedPlayerId)}`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: {
        playerId: string;
        stats: { goals: number };
        latestSnapshot: { version: number; payloadHash: string };
      };
    };
    expect(body.data.playerId).toBe(trackedPlayerId);
    expect(body.data.stats.goals).toBe(18);
    expect(body.data.latestSnapshot.version).toBe(1);
    expect(body.data.latestSnapshot.payloadHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("GET /api/players/{playerId} returns 404 for a missing player", async () => {
    const res = await fetch(
      `${baseUrl}/api/players/openligadb%3Aplayer%3Amissing-id`,
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("not_found");
  });

  it("POST /api/dev/collect?mode=amended records a real semantic stat change", async () => {
    const res = await fetch(`${baseUrl}/api/dev/collect?mode=amended`, {
      method: "POST",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      outcomes: string[];
    };
    expect(body.success).toBe(true);

    const changesRes = await fetch(`${baseUrl}/api/changes`);
    const changesBody = (await changesRes.json()) as {
      data: Array<{
        entityId: string;
        entityType: string;
        changes: Array<{ kind: string; before: number; after: number }>;
      }>;
    };
    expect(changesBody.data).toHaveLength(1);
    const event = changesBody.data[0];
    expect(event?.entityId).toBe(trackedPlayerId);
    expect(event?.entityType).toBe("player");
    expect(event?.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "goals", before: 18, after: 21 }),
      ]),
    );

    const detailRes = await fetch(
      `${baseUrl}/api/players/${encodeURIComponent(trackedPlayerId)}`,
    );
    const detailBody = (await detailRes.json()) as {
      data: { stats: { goals: number }; latestSnapshot: { version: number } };
    };
    expect(detailBody.data.stats.goals).toBe(21);
    expect(detailBody.data.latestSnapshot.version).toBe(2);
  });

  it("POST /api/dev/collect?mode=drift quarantines the batch, preserves the last verified card, and triggers healing", async () => {
    const res = await fetch(`${baseUrl}/api/dev/collect?mode=drift`, {
      method: "POST",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      outcomes: string[];
      healingState: string;
    };
    expect(body.outcomes.every((o) => o === "quarantined")).toBe(true);
    expect(body.healingState).toBe("healing_requested");

    // The last verified card survives the layout drift untouched.
    const detailRes = await fetch(
      `${baseUrl}/api/players/${encodeURIComponent(trackedPlayerId)}`,
    );
    const detailBody = (await detailRes.json()) as {
      data: { stats: { goals: number }; latestSnapshot: { version: number } };
    };
    expect(detailBody.data.stats.goals).toBe(21);
    expect(detailBody.data.latestSnapshot.version).toBe(2);

    const qRes = await fetch(`${baseUrl}/api/quarantines`);
    const qBody = (await qRes.json()) as { data: unknown[] };
    expect(qBody.data.length).toBeGreaterThan(0);

    const sRes = await fetch(`${baseUrl}/api/sources`);
    const sBody = (await sRes.json()) as { data: Array<{ state: string }> };
    expect(sBody.data[0]?.state).toBe("recovering");
  });

  it("POST /api/dev/heal-progress and POST /api/dev/approve recover the same mock collector", async () => {
    let res = await fetch(`${baseUrl}/api/dev/heal-progress`, {
      method: "POST",
    });
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("pending_answer");

    // Approval is forbidden until the preview passes the football schema canary.
    res = await fetch(`${baseUrl}/api/dev/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ approve: true }),
    });
    expect(res.status).toBe(409);

    res = await fetch(`${baseUrl}/api/dev/validate-preview`, {
      method: "POST",
    });
    const previewBody = (await res.json()) as {
      success: boolean;
      healingState: string;
    };
    expect(previewBody.success).toBe(true);
    expect(previewBody.healingState).toBe("preview_valid");

    res = await fetch(`${baseUrl}/api/dev/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ approve: true }),
    });
    const approveBody = (await res.json()) as { healingState: string };
    expect(approveBody.healingState).toBe("recovered");

    const healingRes = await fetch(`${baseUrl}/api/healing/${SOURCE_ID}`);
    const healingBody = (await healingRes.json()) as {
      data: {
        state: string;
        incident: { collectorId: string; evidence: { outcome: string } | null };
      };
    };
    expect(healingBody.data.state).toBe("recovered");
    expect(healingBody.data.incident.collectorId).toBe("[redacted]");
    expect(healingBody.data.incident.evidence?.outcome).toBe("recovered");

    const sRes = await fetch(`${baseUrl}/api/sources`);
    const sBody = (await sRes.json()) as { data: Array<{ state: string }> };
    expect(sBody.data[0]?.state).toBe("healthy");

    // The recovered rerun re-verified the amended card.
    const detailRes = await fetch(
      `${baseUrl}/api/players/${encodeURIComponent(trackedPlayerId)}`,
    );
    const detailBody = (await detailRes.json()) as {
      data: { latestSnapshot: { version: number } };
    };
    expect(detailBody.data.latestSnapshot.version).toBeGreaterThanOrEqual(2);
  });

  it("rejects unsupported dev collect modes", async () => {
    const res = await fetch(`${baseUrl}/api/dev/collect?mode=surprise`, {
      method: "POST",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("invalid_request");
  });
});

describe("CardPulse source-health projection", () => {
  it("keeps the public source contract valid when healing starts after a healthy snapshot", async () => {
    const runtime = createRuntimeFromEnv({
      CARDPULSE_SOURCE_ID: SOURCE_ID,
    });
    runtime.pipeline.process(validPlayerFixture, {
      sourceId: SOURCE_ID,
      extractorVersion: "fixture-v1",
      observedAt: validPlayerFixture.observedAt,
    });
    await runtime.coordinator.handleDrift(
      SOURCE_ID,
      "c_mock_cardpulse",
      "schema-drift",
      "The player table changed structure",
      validPlayerFixture.observedAt,
    );
    const { server, baseUrl } = await startRuntimeServer(runtime);

    try {
      const response = await fetch(`${baseUrl}/api/sources`);
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        data: Array<{
          state: string;
          activeIncident: { reason: string; detail: string } | null;
        }>;
      };
      expect(body.data[0]).toMatchObject({
        state: "recovering",
        activeIncident: {
          reason: "schema-drift",
          detail: "The player table changed structure",
        },
      });
    } finally {
      await stopRuntimeServer(server);
    }
  });
});

describe("CardPulse live mutation authorization", () => {
  const liveEnv = {
    BRIGHT_DATA_API_TOKEN: "bright-data-token",
    BRIGHT_DATA_COLLECTOR_ID: "c_exact",
    BRIGHT_DATA_TARGET_URL:
      "https://data.football-demo.test/openligadb/players",
    CARDPULSE_SOURCE_ID: SOURCE_ID,
  };

  it("fails closed before a provider call when live mutations are disabled", async () => {
    const runtime = createRuntimeFromEnv(liveEnv);
    const collect = vi.fn(async () => ({
      sourceId: SOURCE_ID,
      collectorId: "c_exact",
      extractorVersion: "parser-v2",
      receivedAt: validPlayerFixture.observedAt,
      payloads: [validPlayerFixture],
    }));
    runtime.collectionProvider = { collect };
    const { server, baseUrl } = await startRuntimeServer(runtime);

    try {
      const response = await fetch(`${baseUrl}/api/dev/collect?mode=live`, {
        method: "POST",
      });
      expect(response.status).toBe(403);
      expect(collect).not.toHaveBeenCalled();
    } finally {
      await stopRuntimeServer(server);
    }
  });

  it("rejects the wrong operator token and accepts the configured CardPulse header", async () => {
    const operatorToken = "operator-token-with-at-least-32-chars";
    const runtime = createRuntimeFromEnv({
      ...liveEnv,
      CARDPULSE_ENABLE_LIVE_MUTATIONS: "true",
      CARDPULSE_OPERATOR_TOKEN: operatorToken,
    });
    const collect = vi.fn(async () => ({
      sourceId: SOURCE_ID,
      collectorId: "c_exact",
      extractorVersion: "parser-v2",
      receivedAt: validPlayerFixture.observedAt,
      payloads: [validPlayerFixture],
    }));
    runtime.collectionProvider = { collect };
    const { server, baseUrl } = await startRuntimeServer(runtime);

    try {
      const denied = await fetch(`${baseUrl}/api/dev/collect?mode=live`, {
        method: "POST",
        headers: { "X-CardPulse-Operator-Token": "wrong-token" },
      });
      expect(denied.status).toBe(403);
      expect(collect).not.toHaveBeenCalled();

      const allowed = await fetch(`${baseUrl}/api/dev/collect?mode=live`, {
        method: "POST",
        headers: { "X-CardPulse-Operator-Token": operatorToken },
      });
      expect(allowed.status).toBe(200);
      expect(collect).toHaveBeenCalledTimes(1);
    } finally {
      await stopRuntimeServer(server);
    }
  });
});

describe("searchable player-card HTTP flow", () => {
  function liveStatBunkerRuntime(): CardPulseRuntime {
    return createRuntimeFromEnv({
      BRIGHT_DATA_API_TOKEN: "bright-data-token",
      BRIGHT_DATA_COLLECTOR_ID: "c_exact",
      BRIGHT_DATA_TARGET_URL:
        "https://www.statbunker.com/competitions/PlayerStandings?comp_id=776",
      CARDPULSE_SOURCE_ID: STATBUNKER_SOURCE_ID,
      CARDPULSE_SOURCE_PROFILE: "statbunker",
      CARDPULSE_ENABLE_LIVE_MUTATIONS: "true",
      CARDPULSE_OPERATOR_TOKEN: OPERATOR_TOKEN,
    });
  }

  it("resolves an actual list-only search hit through one exact-name generation run", async () => {
    const runtime = liveStatBunkerRuntime();
    const collect = vi.fn(
      async (request: {
        sourceId: string;
        targetUrl: string;
        requestedAt: string;
      }) => {
        const rawRows = request.targetUrl.includes("PlayerStandings")
          ? [statBunkerHaalandRow()]
          : [resolvedStatBunkerHaalandMatchRow()];
        if (request.targetUrl.includes("PlayerStandings")) {
          (rawRows[0] as Record<string, unknown>).player_url = null;
        }
        return {
          sourceId: request.sourceId,
          collectorId: "c_exact",
          extractorVersion: "statbunker-resolver-test",
          receivedAt: "2026-08-23T09:00:00.000Z",
          rawPayloads: rawRows,
          payloads: rawRows,
        };
      },
    );
    runtime.collectionProvider = { collect };
    const { server, baseUrl } = await startRuntimeServer(runtime);

    try {
      const refreshed = await fetch(`${baseUrl}/api/player-index/refresh`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-CardPulse-Operator-Token": OPERATOR_TOKEN,
        },
        body: JSON.stringify({ season: "2025" }),
      });
      expect(refreshed.status).toBe(200);

      const search = await fetch(
        `${baseUrl}/api/search/players?q=haaland&season=2025`,
      );
      const searchBody = (await search.json()) as {
        data: Array<{ playerId: string }>;
      };
      const fallbackPlayerId = searchBody.data[0]?.playerId;
      expect(fallbackPlayerId).toBe(
        `${STATBUNKER_SOURCE_ID}:erling-haaland-manchester-city`,
      );

      const generated = await fetch(`${baseUrl}/api/cards/generate`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-CardPulse-Operator-Token": OPERATOR_TOKEN,
        },
        body: JSON.stringify({ playerId: fallbackPlayerId, season: "2025" }),
      });
      expect(generated.status).toBe(202);
      const acknowledgement = (await generated.json()) as {
        data: { runId: string };
      };

      type ResolverTerminal = {
        data: {
          status: string;
          card: null | { provenance: { sourceUrl: string } };
        };
      };
      let terminal: ResolverTerminal | null = null;
      for (let attempt = 0; attempt < 10; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        const response = await fetch(
          `${baseUrl}/api/scrapes/${acknowledgement.data.runId}`,
        );
        terminal = (await response.json()) as ResolverTerminal;
        if (terminal?.data.status === "succeeded") break;
      }
      expect(terminal).toMatchObject({
        data: {
          status: "succeeded",
          card: {
            provenance: {
              sourceUrl:
                "https://www.statbunker.com/players/SeasonMatches?comps_id=776&comps_type=EPL&player_id=60023",
            },
          },
        },
      });
      expect(collect).toHaveBeenCalledTimes(2);
      expect(collect.mock.calls[1]?.[0].targetUrl).toBe(
        statBunkerPlayerSearchResolverUrl(776, "Erling Haaland"),
      );
    } finally {
      await stopRuntimeServer(server);
    }
  });

  it("searches locally, refreshes with auth, collects matches, then serves a cache hit", async () => {
    const runtime = liveStatBunkerRuntime();
    const collect = vi.fn(
      async (request: {
        sourceId: string;
        targetUrl: string;
        requestedAt: string;
      }) => {
        const rawRows = request.targetUrl.includes("/players/SeasonMatches")
          ? [statBunkerHaalandMatchRow()]
          : [statBunkerHaalandRow()];
        return {
          sourceId: request.sourceId,
          collectorId: "c_exact",
          extractorVersion: "statbunker-test",
          receivedAt: "2026-08-23T09:00:00.000Z",
          rawPayloads: rawRows,
          payloads: rawRows,
        };
      },
    );
    runtime.collectionProvider = { collect };
    const { server, baseUrl } = await startRuntimeServer(runtime);

    try {
      const empty = await fetch(
        `${baseUrl}/api/search/players?q=haaland&season=2025`,
      );
      expect(((await empty.json()) as { data: unknown[] }).data).toEqual([]);
      expect(collect).not.toHaveBeenCalled();

      const denied = await fetch(`${baseUrl}/api/player-index/refresh`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ season: "2025" }),
      });
      expect(denied.status).toBe(403);
      expect(collect).not.toHaveBeenCalled();

      const refreshed = await fetch(`${baseUrl}/api/player-index/refresh`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-CardPulse-Operator-Token": OPERATOR_TOKEN,
        },
        body: JSON.stringify({ season: "2025" }),
      });
      expect(refreshed.status).toBe(200);
      expect(collect).toHaveBeenCalledTimes(1);
      expect(collect.mock.calls[0]?.[0]).toMatchObject({
        targetUrl:
          "https://www.statbunker.com/competitions/PlayerStandings?comp_id=776",
      });

      const search = await fetch(
        `${baseUrl}/api/search/players?q=HAALAND&season=2025`,
      );
      const searchBody = (await search.json()) as {
        data: Array<{ playerId: string; playerName: string }>;
      };
      expect(searchBody.data).toEqual([
        expect.objectContaining({
          playerId: HAALAND_ID,
          playerName: "Erling Haaland",
        }),
      ]);

      const generated = await fetch(`${baseUrl}/api/cards/generate`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-CardPulse-Operator-Token": OPERATOR_TOKEN,
        },
        body: JSON.stringify({
          playerId: HAALAND_ID,
          season: "2025",
          mode: "live",
        }),
      });
      expect(generated.status).toBe(202);
      const acknowledgement = (await generated.json()) as {
        data: { runId: string };
      };
      type TerminalResponse = {
        data: {
          status: string;
          card: null | {
            playerName: string;
            provenance: { collectorId: string };
          };
        };
      };
      let terminal: TerminalResponse | null = null;
      for (let attempt = 0; attempt < 10; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        const polled = await fetch(
          `${baseUrl}/api/scrapes/${acknowledgement.data.runId}`,
        );
        terminal = (await polled.json()) as TerminalResponse;
        if (terminal?.data.status === "succeeded") break;
      }
      expect(terminal).not.toBeNull();
      if (terminal === null) throw new Error("expected a terminal response");
      expect(terminal.data.card?.playerName).toBe("Erling Haaland");
      expect(terminal.data.card?.provenance.collectorId).toBe("[redacted]");
      expect(JSON.stringify(terminal)).not.toContain("c_exact");
      expect(collect).toHaveBeenCalledTimes(2);
      expect(collect.mock.calls[1]?.[0].targetUrl).toBe(
        "https://www.statbunker.com/players/SeasonMatches?comps_id=776&comps_type=EPL&player_id=60023",
      );

      const matches = await fetch(
        `${baseUrl}/api/players/${encodeURIComponent(HAALAND_ID)}/matches?season=2025`,
      );
      expect(await matches.json()).toMatchObject({
        data: {
          available: true,
          rows: [
            expect.objectContaining({
              opponent: "Liverpool",
              venue: "away",
              playerGoals: 1,
              playerAssists: 1,
              playerMinutes: 90,
            }),
          ],
        },
      });

      const cached = await fetch(`${baseUrl}/api/cards/generate`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-CardPulse-Operator-Token": OPERATOR_TOKEN,
        },
        body: JSON.stringify({ playerId: HAALAND_ID, season: "2025" }),
      });
      expect(cached.status).toBe(200);
      expect(collect).toHaveBeenCalledTimes(2);
    } finally {
      await stopRuntimeServer(server);
    }
  });

  it("returns 202 immediately and exposes real scrape stages while work runs", async () => {
    const runtime = liveStatBunkerRuntime();
    const observedAt = "2026-08-23T09:00:00.000Z";
    const mapped = new StatBunkerRowMapper({
      sourceId: STATBUNKER_SOURCE_ID,
    }).map(statBunkerHaalandRow(), observedAt);
    if (!mapped.ok) throw new Error("expected a valid StatBunker fixture");
    runtime.pipeline.process(mapped.record, {
      sourceId: STATBUNKER_SOURCE_ID,
      extractorVersion: "index-seed",
      observedAt,
    });

    let release!: (value: {
      sourceId: string;
      collectorId: string;
      extractorVersion: string;
      receivedAt: string;
      rawPayloads?: unknown[];
      payloads: unknown[];
    }) => void;
    const collect = vi.fn(
      () =>
        new Promise<{
          sourceId: string;
          collectorId: string;
          extractorVersion: string;
          receivedAt: string;
          rawPayloads?: unknown[];
          payloads: unknown[];
        }>((resolve) => {
          release = resolve;
        }),
    );
    runtime.collectionProvider = { collect };
    const { server, baseUrl } = await startRuntimeServer(runtime);

    try {
      const response = await fetch(`${baseUrl}/api/cards/generate`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-CardPulse-Operator-Token": OPERATOR_TOKEN,
        },
        body: JSON.stringify({ playerId: HAALAND_ID, season: "2025" }),
      });
      expect(response.status).toBe(202);
      const acknowledgement = (await response.json()) as {
        data: { runId: string; status: string };
      };
      expect(acknowledgement.data.status).toBe("starting_collector");

      const pending = await fetch(
        `${baseUrl}/api/scrapes/${acknowledgement.data.runId}`,
      );
      expect((await pending.json()) as unknown).toMatchObject({
        data: { status: "starting_collector", terminalStatus: null },
      });

      release({
        sourceId: STATBUNKER_SOURCE_ID,
        collectorId: "c_exact",
        extractorVersion: "statbunker-test",
        receivedAt: observedAt,
        rawPayloads: [statBunkerHaalandMatchRow()],
        payloads: [statBunkerHaalandMatchRow()],
      });

      let terminal: { data: { status: string; card: unknown } } | null = null;
      for (let attempt = 0; attempt < 10; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        const polled = await fetch(
          `${baseUrl}/api/scrapes/${acknowledgement.data.runId}`,
        );
        terminal = (await polled.json()) as {
          data: { status: string; card: unknown };
        };
        if (terminal.data.status === "succeeded") break;
      }
      expect(terminal).toMatchObject({
        data: {
          status: "succeeded",
          card: expect.objectContaining({ playerName: "Erling Haaland" }),
        },
      });
      expect(collect).toHaveBeenCalledTimes(1);
    } finally {
      await stopRuntimeServer(server);
    }
  });

  it("validates and reruns the exact player-match source through guarded healing", async () => {
    const runtime = liveStatBunkerRuntime();
    const matchSource = `${STATBUNKER_SOURCE_ID}-matches-60023-2025`;
    const healingProvider = new MockBrightDataHealingProvider([
      statBunkerHaalandMatchRow(),
    ]);
    runtime.coordinator = new SelfHealingCoordinator(healingProvider, {
      pollIntervalMs: 0,
    });
    runtime.pipeline.healingCoordinator = runtime.coordinator;

    let repaired = false;
    const collect = vi.fn(async (request: FootballCollectionRequest) => {
      const rawRows = request.targetUrl.includes("PlayerStandings")
        ? [statBunkerHaalandRow()]
        : repaired
          ? [statBunkerHaalandMatchRow()]
          : [
              {
                schemaVersion: 1,
                entityType: "match",
                unexpected_layout: true,
              },
              {
                schemaVersion: 1,
                entityType: "match",
                unexpected_layout: true,
              },
            ];
      return {
        sourceId: request.sourceId,
        collectorId: "c_exact",
        extractorVersion: "statbunker-test",
        receivedAt: "2026-08-23T09:00:00.000Z",
        rawPayloads: rawRows,
        payloads: rawRows,
      };
    });
    runtime.collectionProvider = { collect };
    const { server, baseUrl } = await startRuntimeServer(runtime);
    const operatorHeaders = {
      "content-type": "application/json",
      "X-CardPulse-Operator-Token": OPERATOR_TOKEN,
    };

    const runFailedGeneration = async (): Promise<void> => {
      const started = await fetch(`${baseUrl}/api/cards/generate`, {
        method: "POST",
        headers: operatorHeaders,
        body: JSON.stringify({ playerId: HAALAND_ID, season: "2025" }),
      });
      expect(started.status).toBe(202);
      const acknowledgement = (await started.json()) as {
        data: { runId: string };
      };
      for (let attempt = 0; attempt < 10; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        const response = await fetch(
          `${baseUrl}/api/scrapes/${acknowledgement.data.runId}`,
        );
        const body = (await response.json()) as { data: { status: string } };
        if (body.data.status === "failed") return;
      }
      throw new Error("player-match generation did not fail as expected");
    };

    try {
      const refresh = await fetch(`${baseUrl}/api/player-index/refresh`, {
        method: "POST",
        headers: operatorHeaders,
        body: JSON.stringify({ season: "2025" }),
      });
      expect(refresh.status).toBe(200);

      // First-ever structural drift is quarantined without healing; the same
      // two-row signature must repeat before the coordinator mutates anything.
      await runFailedGeneration();
      expect(runtime.coordinator.getHealingState(matchSource)).toBe("healthy");
      await runFailedGeneration();
      expect(runtime.coordinator.getHealingState(matchSource)).toBe(
        "healing_requested",
      );

      const progress = await fetch(
        `${baseUrl}/api/dev/heal-progress?sourceId=${encodeURIComponent(matchSource)}`,
        { method: "POST", headers: operatorHeaders },
      );
      expect(progress.status).toBe(200);
      expect(await progress.json()).toMatchObject({
        sourceId: matchSource,
        healingState: "awaiting_approval",
      });

      const preview = await fetch(
        `${baseUrl}/api/dev/validate-preview?sourceId=${encodeURIComponent(matchSource)}`,
        { method: "POST", headers: operatorHeaders },
      );
      expect(preview.status).toBe(200);
      expect(await preview.json()).toMatchObject({
        success: true,
        sourceId: matchSource,
        healingState: "preview_valid",
      });

      repaired = true;
      const approved = await fetch(
        `${baseUrl}/api/dev/approve?sourceId=${encodeURIComponent(matchSource)}`,
        {
          method: "POST",
          headers: operatorHeaders,
          body: JSON.stringify({ approve: true }),
        },
      );
      expect(approved.status).toBe(200);
      expect(await approved.json()).toMatchObject({
        success: true,
        sourceId: matchSource,
        healingState: "recovered",
      });
      expect(collect).toHaveBeenCalledTimes(4);

      const card = await fetch(
        `${baseUrl}/api/cards/${encodeURIComponent(HAALAND_ID)}?season=2025`,
      );
      expect(await card.json()).toMatchObject({
        data: { stats: { goals: 1 } },
      });
    } finally {
      await stopRuntimeServer(server);
    }
  });

  it("keeps live generation unavailable in mock mode", async () => {
    const runtime = createRuntimeFromEnv({});
    const { server, baseUrl } = await startRuntimeServer(runtime);
    try {
      const response = await fetch(`${baseUrl}/api/cards/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          playerId: "demo:erling-haaland",
          season: "2025",
          mode: "demo",
        }),
      });
      expect(response.status).toBe(409);
    } finally {
      await stopRuntimeServer(server);
    }
  });
});
