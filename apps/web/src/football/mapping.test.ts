import { describe, expect, it } from "vitest";

import {
  FixtureCardPulseDataClient,
  HttpCardPulseDataClient,
} from "../data-client";
import {
  buildClubViews,
  buildPlayerCard,
  buildReliabilityView,
  buildTeamViews,
  clubCodeFrom,
  describeHealing,
  describeStatChange,
  healingTone,
  isCompromisedState,
  resolveDataLabel,
  resolveModeChip,
  type PlayerSummaryLike,
} from "./mapping";

const runtime = {
  mode: "mock" as const,
  sourceId: "openligadb",
  collectorConfigured: false,
  targetConfigured: false,
  liveMutationsEnabled: false,
  configurationIssues: [],
};

// Fictional player record mirroring the contract summary shape.
const player: PlayerSummaryLike = {
  playerId: "demo:player:test-striker",
  sourceId: "openligadb",
  playerName: "Test Striker",
  team: { teamId: "demo:rheinland-fc", name: "Rheinland FC" },
  position: "forward",
  shirtNumber: 11,
  nationality: "Germany",
  season: "2025",
  stats: {
    appearances: 33,
    goals: 18,
    assists: 5,
    yellowCards: 3,
    redCards: 0,
    minutesPlayed: 2820,
  },
  observedAt: "2026-08-20T14:00:00.000Z",
  latestSnapshot: {
    snapshotId: "7b4b518c-24a6-423b-b083-5e53e46f9082",
    version: 1,
  },
};

describe("data labels", () => {
  it("labels demo data for mock runtimes and fixture adapters", () => {
    expect(resolveDataLabel(runtime, false)).toBe("DEMO DATA");
    expect(resolveDataLabel(runtime, true)).toBe("DEMO DATA");
  });

  it("labels live provider only when the runtime itself reports live", () => {
    expect(resolveDataLabel({ ...runtime, mode: "live" }, false)).toBe(
      "LIVE PROVIDER",
    );
  });

  it("never claims live provider while the fixture adapter is active", () => {
    expect(resolveDataLabel({ ...runtime, mode: "live" }, true)).toBe(
      "DEMO DATA",
    );
  });

  it("resolves the collection-mode chip per adapter and runtime", () => {
    expect(resolveModeChip(runtime, true)).toBe("MOCK PIPELINE");
    expect(resolveModeChip(runtime, false)).toBe("LOCAL API");
    expect(resolveModeChip({ ...runtime, mode: "live" }, false)).toBe(
      "LIVE PROVIDER",
    );
  });
});

describe("player card derivation", () => {
  it("is deterministic for a given record and snapshot version", () => {
    const first = buildPlayerCard(player, null);
    const second = buildPlayerCard(player, null);
    expect(first).not.toBeNull();
    expect(second).toEqual(first);
  });

  it("surfaces real verified stats on the card face", () => {
    const card = buildPlayerCard(player, null);
    expect(card?.attributes.find((a) => a.label === "GOALS")?.value).toBe(18);
    expect(card?.attributes.every((a) => a.pct > 0 && a.pct <= 100)).toBe(true);
    expect(card?.positionDisplay).toBe("FWD");
    expect(card?.clubCode).toBe("RHE");
    expect(card?.seasonLabel).toBe("SEASON 2025/26");
  });

  it("binds provenance from the verified snapshot and redacts collectors", () => {
    const card = buildPlayerCard(player, "c_abcdef1234567890");
    expect(card?.provenance.snapshotVersion).toBe(1);
    expect(card?.provenance.sourceId).toBe("openligadb");
    expect(card?.provenance.verifiedAt).toBe("2026-08-20T14:00:00.000Z");
    expect(card?.provenance.collectorIdRedacted).toBe("c_ab••••7890");
    // The signature must change when the underlying snapshot changes.
    const evolved = buildPlayerCard(
      { ...player, latestSnapshot: { ...player.latestSnapshot, version: 2 } },
      null,
    );
    expect(evolved?.provenance.signature).not.toBe(card?.provenance.signature);
    expect(evolved?.serialNumber).not.toBe(card?.serialNumber);
  });

  it("returns no card without a verified record", () => {
    expect(buildPlayerCard(null, null)).toBeNull();
  });

  it("keeps form marks valid", () => {
    const card = buildPlayerCard(player, null);
    for (const mark of card?.form ?? []) {
      expect(["W", "D", "L"]).toContain(mark);
    }
    expect(card?.form).toHaveLength(5);
  });
});

describe("club code derivation", () => {
  it("takes the first three letters, uppercased, ignoring digits", () => {
    expect(clubCodeFrom("Rheinland FC")).toBe("RHE");
    expect(clubCodeFrom("SV Nordstern Nordhafen")).toBe("SVN");
    expect(clubCodeFrom("Adlersberg")).toBe("ADL");
    expect(clubCodeFrom("Elbe 04")).toBe("ELB");
  });
});

describe("compromise states", () => {
  it("treats only healthy and recovered as clean", () => {
    expect(isCompromisedState("healthy")).toBe(false);
    expect(isCompromisedState("recovered")).toBe(false);
    for (const state of [
      "quarantined",
      "healing_requested",
      "awaiting_approval",
      "preview_valid",
      "preview_invalid",
      "recovery_failed",
    ] as const) {
      expect(isCompromisedState(state)).toBe(true);
    }
  });

  it("describes every healing state with judge-readable copy", () => {
    expect(describeHealing("healthy")).toMatch(/baseline/i);
    expect(describeHealing("quarantined")).toMatch(/protected/i);
    expect(healingTone("preview_invalid")).toBe("bad");
    expect(healingTone("healthy")).toBe("good");
  });
});

describe("club integrity views", () => {
  it("maps source health into club cards with incident context", () => {
    const clubs = buildClubViews([
      {
        sourceId: "openligadb",
        state: "quarantined",
        checkedAt: "2026-08-21T14:10:00.000Z",
        lastSuccessfulAt: "2026-08-21T14:00:00.000Z",
        consecutiveFailures: 2,
        recentFailureRate: 0.5,
        activeIncident: {
          reason: "schema-drift",
          detail: "Rows became cards.",
        },
        latestRecoveryEvidence: { actions: ["Reran the same collector"] },
      },
    ]);

    expect(clubs).toHaveLength(1);
    const club = clubs[0];
    expect(club?.state).toBe("quarantined");
    expect(club?.incidentReason).toBe("schema-drift");
    expect(club?.incidentDetail).toBe("Rows became cards.");
    expect(club?.recoveryActions).toEqual(["Reran the same collector"]);
    expect(club?.recentFailureRate).toBe(50);
  });
});

describe("team summary views", () => {
  it("merges tracked teams with their source health state", () => {
    const teams = buildTeamViews(
      [
        {
          teamId: "demo:rheinland-fc",
          sourceId: "openligadb",
          name: "Rheinland FC",
          shortName: "Rheinland",
          city: "Rheinstadt",
          stadium: "Stadion am Rheindamm",
          coach: "M. Falkner",
          founded: 1904,
          observedAt: "2026-08-20T14:00:00.000Z",
          latestSnapshot: {
            snapshotId: player.latestSnapshot.snapshotId,
            version: 1,
          },
        },
      ],
      [
        {
          sourceId: "openligadb",
          state: "recovering",
          checkedAt: null,
          lastSuccessfulAt: null,
          consecutiveFailures: 1,
          recentFailureRate: 0.5,
          activeIncident: null,
          latestRecoveryEvidence: null,
        },
      ],
    );

    expect(teams).toHaveLength(1);
    expect(teams[0]?.state).toBe("recovering");
    expect(teams[0]?.city).toBe("Rheinstadt");
    expect(teams[0]?.snapshotVersion).toBe(1);
  });
});

describe("reliability view", () => {
  it("counts evidence honestly and never exposes a full collector id", () => {
    const view = buildReliabilityView({
      runtime: {
        ...runtime,
        configurationIssues: ["No Bright Data token set"],
      },
      usingFixtureAdapter: false,
      jobsTriggered: 3,
      quarantineCount: 1,
      amendmentCount: 2,
      stale: true,
      receivedAt: "2026-08-20T16:00:00.000Z",
      collectorId: "c_0123456789abcdef",
    });

    expect(view.evidenceCount).toBe(3);
    expect(view.collectorIdRedacted).toBe("c_01••••cdef");
    expect(view.collectorIdRedacted).not.toContain("2345");
    expect(view.modeChip).toBe("LOCAL API");
    expect(view.stale).toBe(true);
    expect(view.ready).toBe(true);
    expect(view.issues).toEqual(["No Bright Data token set"]);
  });
});

describe("stat change copy", () => {
  it("describes numeric, discipline, profile and standing changes", () => {
    expect(
      describeStatChange({ kind: "goals", before: 18, after: 21 }),
    ).toContain("Goals moved 18 → 21");
    expect(
      describeStatChange({ kind: "minutes", before: 2820, after: 2910 }),
    ).toContain("Minutes played");
    expect(
      describeStatChange({
        kind: "discipline",
        yellowBefore: 3,
        yellowAfter: 4,
        redBefore: 0,
        redAfter: 0,
      }),
    ).toContain("yellows 3→4");
    expect(
      describeStatChange({
        kind: "profile",
        field: "coach",
        before: "A",
        after: "B",
      }),
    ).toContain("coach");
    expect(
      describeStatChange({
        kind: "standing",
        field: "points",
        before: 66,
        after: 69,
      }),
    ).toContain("points");
    expect(describeStatChange({ kind: "mystery" })).toBeNull();
  });
});

describe("adapter boundary", () => {
  it("fixture snapshots map into football views without contract leakage", async () => {
    const client = new FixtureCardPulseDataClient();
    await client.collect("drift");
    const snapshot = await client.load();

    expect(snapshot.runtime.mode).toBe("mock");
    expect(isCompromisedState(snapshot.healing.state)).toBe(true);

    const record = snapshot.players.data[0] ?? null;
    const card = buildPlayerCard(record, null);
    expect(card).not.toBeNull();
    expect(card?.provenance.sourceId).toBe(snapshot.runtime.sourceId);
  });

  it("http runtime payloads keep their shape through structural mapping", async () => {
    const fetchFn = (async () =>
      new Response(
        JSON.stringify({
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
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      )) as typeof fetch;

    const client = new HttpCardPulseDataClient("http://test.local", fetchFn);
    await expect(client.load()).rejects.toMatchObject({
      name: "DataClientError",
    });
  });
});
