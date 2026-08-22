import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { CardPulsePipeline } from "./pipeline.js";
import { MockBrightDataHealingProvider } from "@bidsentinel/brightdata";
import {
  trackedPlayerId,
  validPlayerFixture,
} from "@bidsentinel/contracts/fixtures";
import { SelfHealingCoordinator } from "./healing-coordinator.js";
import { createRequestHandler } from "./server.js";
import { createRuntimeFromEnv, type CardPulseRuntime } from "./runtime.js";

const SOURCE_ID = "openligadb";

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
    const handler = createRequestHandler(pipeline, coordinator, runtime);
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
    expect(body.collectorId).toBe("c_mock_cardpulse");

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
    expect(healingBody.data.incident.collectorId).toBe("c_mock_cardpulse");
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
