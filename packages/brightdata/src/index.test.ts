import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ExternalCollectionNotConfiguredError,
  UnconfiguredBrightDataProvider,
  BrightDataCollectionProvider,
  mapRawRowToFootballRecord,
  BrightDataHealingProvider,
  UnconfiguredBrightDataHealingProvider,
} from "./index.js";
import type { BrightDataApiError } from "./index.js";

describe("UnconfiguredBrightDataProvider", () => {
  it("fails closed without making a network request", async () => {
    const provider = new UnconfiguredBrightDataProvider();

    await expect(
      provider.collect({
        sourceId: "openligadb",
        targetUrl: "https://example.football.test/players",
        requestedAt: "2026-08-20T05:00:00.000Z",
      }),
    ).rejects.toBeInstanceOf(ExternalCollectionNotConfiguredError);
  });
});

describe("BrightDataCollectionProvider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("successfully triggers collector, polls, and returns dataset payloads", async () => {
    let pollCount = 0;
    const mockFetch = vi.fn((url: string, options?: RequestInit) => {
      if (url.includes("/dca/trigger")) {
        expect(options?.method).toBe("POST");
        expect(url).toContain("queue_next=1");
        expect(options?.body).toContain(
          "https://example.football.test/players",
        );
        return Promise.resolve(
          new Response(JSON.stringify({ collection_id: "j_success_123" }), {
            status: 200,
          }),
        );
      }
      if (url.includes("/dca/dataset?id=j_success_123")) {
        expect(options?.method).toBe("GET");
        pollCount++;
        if (pollCount === 1) {
          return Promise.resolve(new Response("", { status: 202 }));
        }
        if (pollCount === 2) {
          return Promise.resolve(
            new Response(JSON.stringify({ status: "building" }), {
              status: 200,
            }),
          );
        }
        return Promise.resolve(
          new Response(
            JSON.stringify([
              {
                id: "2026-player-001",
                playerName: "Max Example",
                url: "https://example.football.test/players/001",
                position: "midfielder",
                teamName: "FC Example",
              },
            ]),
            { status: 200 },
          ),
        );
      }
      return Promise.reject(new Error("Unknown URL"));
    });

    vi.stubGlobal("fetch", mockFetch);

    const provider = new BrightDataCollectionProvider({
      apiToken: "test-token",
      collectorId: "c_test_123",
      pollingIntervalMs: 1,
      timeoutMs: 1000,
      maxRetries: 0,
    });

    const result = await provider.collect({
      sourceId: "openligadb",
      targetUrl: "https://example.football.test/players",
      requestedAt: "2026-08-20T05:00:00.000Z",
    });

    expect(result.sourceId).toBe("openligadb");
    expect(result.collectorId).toBe("c_test_123");
    expect(result.extractorVersion).toBe("brightdata-c_test_123");
    expect(result.payloads).toHaveLength(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mapped = result.payloads[0] as any;
    expect(mapped.entityType).toBe("player");
    expect(mapped.externalId).toBe("2026-player-001");
    expect(mapped.playerId).toBe("openligadb:2026-player-001");
    expect(mapped.playerName).toBe("Max Example");
    expect(mapped.team.name).toBe("FC Example");
    expect(mockFetch).toHaveBeenCalledTimes(4);
  });

  it("handles authentication failure immediately", async () => {
    const mockFetch = vi.fn((url: string) => {
      if (url.includes("/dca/trigger")) {
        return Promise.resolve(new Response("", { status: 401 }));
      }
      return Promise.reject(new Error("Unknown URL"));
    });

    vi.stubGlobal("fetch", mockFetch);

    const provider = new BrightDataCollectionProvider({
      apiToken: "invalid-token",
      collectorId: "c_test_123",
      pollingIntervalMs: 1,
      timeoutMs: 1000,
      maxRetries: 0,
    });

    await expect(
      provider.collect({
        sourceId: "openligadb",
        targetUrl: "https://example.football.test/players",
        requestedAt: "2026-08-20T05:00:00.000Z",
      }),
    ).rejects.toMatchObject({
      name: "BrightDataApiError",
      code: "authentication",
      status: 401,
    } satisfies Partial<BrightDataApiError>);
  });

  it("aborts a hung HTTP request within the configured request timeout", async () => {
    const hangingFetch = vi.fn(
      (_input: Parameters<typeof fetch>[0], init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(init.signal?.reason),
            { once: true },
          );
        }),
    ) as typeof fetch;
    const provider = new BrightDataCollectionProvider({
      apiToken: "secret-token-that-must-not-leak",
      collectorId: "c_test_123",
      requestTimeoutMs: 5,
      maxRetries: 0,
      fetchFn: hangingFetch,
    });

    let caught: unknown;
    try {
      await provider.collect({
        sourceId: "openligadb",
        targetUrl: "https://example.football.test/players",
        requestedAt: "2026-08-20T05:00:00.000Z",
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({ code: "timeout", transient: true });
    expect(String(caught)).not.toContain("secret-token-that-must-not-leak");
    expect(hangingFetch).toHaveBeenCalledTimes(1);
  });

  it("aborts and throws a timeout error if polling exceeds timeout limit", async () => {
    const mockFetch = vi.fn((url: string) => {
      if (url.includes("/dca/trigger")) {
        return Promise.resolve(
          new Response(JSON.stringify({ collection_id: "j_timeout_123" }), {
            status: 200,
          }),
        );
      }
      if (url.includes("/dca/dataset?id=j_timeout_123")) {
        return Promise.resolve(new Response("", { status: 202 }));
      }
      return Promise.reject(new Error("Unknown URL"));
    });

    vi.stubGlobal("fetch", mockFetch);

    const provider = new BrightDataCollectionProvider({
      apiToken: "test-token",
      collectorId: "c_test_123",
      pollingIntervalMs: 1,
      timeoutMs: 10,
      maxRetries: 0,
    });

    await expect(
      provider.collect({
        sourceId: "openligadb",
        targetUrl: "https://example.football.test/players",
        requestedAt: "2026-08-20T05:00:00.000Z",
      }),
    ).rejects.toMatchObject({ code: "timeout", transient: true });
  });

  it("retries on transient 5xx errors with exponential backoff", async () => {
    let triggerCount = 0;
    let pollCount = 0;

    const mockFetch = vi.fn((url: string) => {
      if (url.includes("/dca/trigger")) {
        triggerCount++;
        if (triggerCount === 1) {
          return Promise.resolve(
            new Response("Service Unavailable", { status: 503 }),
          );
        }
        return Promise.resolve(
          new Response(JSON.stringify({ collection_id: "j_retry_123" }), {
            status: 200,
          }),
        );
      }
      if (url.includes("/dca/dataset?id=j_retry_123")) {
        pollCount++;
        if (pollCount === 1) {
          return Promise.resolve(
            new Response("Internal Server Error", { status: 500 }),
          );
        }
        return Promise.resolve(
          new Response(JSON.stringify([]), { status: 200 }),
        );
      }
      return Promise.reject(new Error("Unknown URL"));
    });

    vi.stubGlobal("fetch", mockFetch);

    const provider = new BrightDataCollectionProvider({
      apiToken: "test-token",
      collectorId: "c_test_123",
      pollingIntervalMs: 1,
      timeoutMs: 1000,
      maxRetries: 2,
      retryDelayMs: 1,
    });

    const result = await provider.collect({
      sourceId: "openligadb",
      targetUrl: "https://example.football.test/players",
      requestedAt: "2026-08-20T05:00:00.000Z",
    });

    expect(result.payloads).toEqual([]);
    expect(triggerCount).toBe(2);
    expect(pollCount).toBe(2);
  });

  it("rejects on malformed JSON response from dataset endpoint", async () => {
    const mockFetch = vi.fn((url: string) => {
      if (url.includes("/dca/trigger")) {
        return Promise.resolve(
          new Response(JSON.stringify({ collection_id: "j_malformed_123" }), {
            status: 200,
          }),
        );
      }
      if (url.includes("/dca/dataset?id=j_malformed_123")) {
        return Promise.resolve(new Response("not-json", { status: 200 }));
      }
      return Promise.reject(new Error("Unknown URL"));
    });

    vi.stubGlobal("fetch", mockFetch);

    const provider = new BrightDataCollectionProvider({
      apiToken: "test-token",
      collectorId: "c_test_123",
      pollingIntervalMs: 1,
      timeoutMs: 1000,
      maxRetries: 0,
    });

    await expect(
      provider.collect({
        sourceId: "openligadb",
        targetUrl: "https://example.football.test/players",
        requestedAt: "2026-08-20T05:00:00.000Z",
      }),
    ).rejects.toMatchObject({ code: "malformed_response" });
  });

  it("rejects a non-string collection ID before polling", async () => {
    const mockFetch = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ collection_id: 123 }), { status: 200 }),
      ),
    );

    const provider = new BrightDataCollectionProvider({
      apiToken: "test-token",
      collectorId: "c_test_123",
      maxRetries: 0,
      fetchFn: mockFetch,
    });

    await expect(
      provider.collect({
        sourceId: "openligadb",
        targetUrl: "https://example.football.test/players",
        requestedAt: "2026-08-20T05:00:00.000Z",
      }),
    ).rejects.toMatchObject({ code: "malformed_response" });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("processes mixed valid and invalid rows independently through mapping", () => {
    const observedAt = "2026-08-20T05:00:00.000Z";
    const validRow = {
      id: "valid-id",
      playerName: "Max Example",
      position: "midfielder",
      season: "2025",
      team: { teamId: "team-1", name: "FC Example" },
      url: "https://example.football.test/players/valid",
      stats: { appearances: 10, goals: 3, yellowCards: 1 },
    };
    const invalidRow = {
      id: "invalid-id",
      url: "not-a-url",
      position: "midfielder",
    };

    type MappedRecord = {
      entityType?: unknown;
      playerId?: unknown;
      playerName?: unknown;
      sourceUrl?: unknown;
      stats?: Record<string, unknown>;
      team?: { name?: unknown; teamId?: unknown };
      shirtNumber?: unknown;
      nationality?: unknown;
    };
    const mappedValid = mapRawRowToFootballRecord(
      validRow,
      "openligadb",
      observedAt,
    ) as MappedRecord;
    const mappedInvalid = mapRawRowToFootballRecord(
      invalidRow,
      "openligadb",
      observedAt,
    ) as MappedRecord;

    expect(mappedValid.entityType).toBe("player");
    expect(mappedValid.playerId).toBe("openligadb:valid-id");
    expect(mappedValid.playerName).toBe("Max Example");
    expect(mappedValid.team?.name).toBe("FC Example");
    expect(mappedValid.stats?.["yellowCards"]).toBe(1);

    expect(mappedInvalid.entityType).toBe("player");
    expect(mappedInvalid.playerId).toBe("openligadb:invalid-id");
    expect(mappedInvalid.playerName).toBeUndefined();
    expect(mappedInvalid.sourceUrl).toBe("not-a-url");
    expect(mappedInvalid.shirtNumber).toBeNull();
    expect(mappedInvalid.nationality).toBeNull();
  });

  it("maps explicit standing rows without inventing arithmetic data", () => {
    const observedAt = "2026-08-20T05:00:00.000Z";
    const row = {
      entityType: "standing",
      id: "bundesliga-2025-bayern",
      competition: "Bundesliga",
      season: "2025",
      teamId: "bayern",
      teamName: "Bayern München",
      rank: "2",
      played: 34,
      won: 25,
      drawn: 5,
      lost: 4,
      goalsFor: 92,
      goalsAgainst: 32,
      points: "80",
      url: "https://example.football.test/standings/bayern",
    };

    type MappedStanding = {
      entityType?: unknown;
      rank?: unknown;
      points?: unknown;
      goalsAgainst?: unknown;
      season?: unknown;
    };
    const mapped = mapRawRowToFootballRecord(
      row,
      "openligadb",
      observedAt,
    ) as MappedStanding;

    expect(mapped.entityType).toBe("standing");
    expect(mapped.rank).toBe(2);
    expect(mapped.points).toBe(80);
    expect(mapped.goalsAgainst).toBe(32);
    expect(mapped.season).toBe("2025");

    const playerRow = {
      ...row,
      entityType: undefined,
      rank: undefined,
      points: undefined,
      played: undefined,
      won: undefined,
      drawn: undefined,
      lost: undefined,
      goalsFor: undefined,
      goalsAgainst: undefined,
      playerName: "Inferred Player",
      position: "forward",
    };
    const inferred = mapRawRowToFootballRecord(
      playerRow,
      "openligadb",
      observedAt,
    ) as MappedStanding & { position?: unknown };
    expect(inferred.entityType).toBe("player");
    expect(inferred.position).toBe("forward");
  });
});

describe("BrightDataHealingProvider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("successfully triggers refactor template with prompt", async () => {
    const mockFetch = vi.fn((url: string, options?: RequestInit) => {
      if (url.includes("/refactor_template")) {
        expect(options?.method).toBe("POST");
        expect(JSON.parse(String(options?.body))).toEqual({
          prompt: "fix layout drift",
          custom_input: [],
        });
        return Promise.resolve(new Response("", { status: 200 }));
      }
      return Promise.reject(new Error("Unknown URL"));
    });

    vi.stubGlobal("fetch", mockFetch);

    const provider = new BrightDataHealingProvider({
      apiToken: "test-token",
      maxRetries: 0,
    });
    await provider.triggerRefactor("c_test_123", "fix layout drift");
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("successfully polls refactor progress", async () => {
    const mockFetch = vi.fn((url: string, options?: RequestInit) => {
      if (url.includes("/refactor_template/progress")) {
        expect(options?.method).toBe("GET");
        return Promise.resolve(
          new Response(
            JSON.stringify({
              status: "pending_answer",
              step: "review",
              preview_result: [{ playerName: "Recovered Player" }],
            }),
            { status: 200 },
          ),
        );
      }
      return Promise.reject(new Error("Unknown URL"));
    });

    vi.stubGlobal("fetch", mockFetch);

    const provider = new BrightDataHealingProvider({
      apiToken: "test-token",
      maxRetries: 0,
    });
    const progress = await provider.pollRefactorProgress("c_test_123");
    expect(progress).toEqual({
      status: "pending_answer",
      step: "review",
      previewResult: [{ playerName: "Recovered Player" }],
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("successfully resumes automation job with approve option", async () => {
    const mockFetch = vi.fn((url: string, options?: RequestInit) => {
      if (url.includes("/resume_automation_job")) {
        expect(options?.method).toBe("POST");
        expect(JSON.parse(String(options?.body))).toEqual({ message: true });
        return Promise.resolve(new Response("", { status: 200 }));
      }
      return Promise.reject(new Error("Unknown URL"));
    });

    vi.stubGlobal("fetch", mockFetch);

    const provider = new BrightDataHealingProvider({
      apiToken: "test-token",
      maxRetries: 0,
    });
    await provider.resumeAutomationJob("c_test_123", true);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

describe("UnconfiguredBrightDataHealingProvider", () => {
  it("fails closed on trigger, poll, and resume", async () => {
    const provider = new UnconfiguredBrightDataHealingProvider();
    await expect(
      provider.triggerRefactor("c_test_123", "fix"),
    ).rejects.toBeInstanceOf(ExternalCollectionNotConfiguredError);
    await expect(
      provider.pollRefactorProgress("c_test_123"),
    ).rejects.toBeInstanceOf(ExternalCollectionNotConfiguredError);
    await expect(
      provider.resumeAutomationJob("c_test_123", true),
    ).rejects.toBeInstanceOf(ExternalCollectionNotConfiguredError);
  });
});
