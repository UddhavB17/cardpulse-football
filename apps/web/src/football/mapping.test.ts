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
  resolveStandingsMode,
  resolveTeamSectionState,
  standingsTableCopy,
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

// Live StatBunker EPL 25/26 runtime: player-rows-only collector.
const statbunkerLiveRuntime = {
  mode: "live" as const,
  sourceId: "statbunker-epl-2025-26",
  collectorConfigured: true,
  targetConfigured: true,
  liveMutationsEnabled: true,
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

describe("StatBunker live-data compatibility", () => {
  // Realistic canonical StatBunker EPL 2025/26 record: real names, full stat
  // line, player-rows-only source id.
  const statbunkerPlayer: PlayerSummaryLike = {
    playerId: "statbunker-epl-2025-26:player:declan-rice",
    sourceId: "statbunker-epl-2025-26",
    playerName: "Declan Rice",
    team: { teamId: "statbunker-epl-2025-26:team:arsenal", name: "Arsenal" },
    position: "midfielder",
    shirtNumber: 41,
    season: "2025",
    stats: {
      appearances: 13,
      goals: 2,
      assists: 4,
      yellowCards: 3,
      redCards: 0,
      minutesPlayed: 1130,
    },
    observedAt: "2026-08-21T17:30:00.000Z",
    latestSnapshot: {
      snapshotId: "9c1f4a52-6d0e-4a7a-8f3e-2b1c5d7e9a01",
      version: 3,
    },
  };

  const statbunkerSource = {
    sourceId: "statbunker-epl-2025-26",
    state: "healthy",
    checkedAt: "2026-08-21T17:31:00.000Z",
    lastSuccessfulAt: "2026-08-21T17:30:00.000Z",
    consecutiveFailures: 0,
    recentFailureRate: 0,
    activeIncident: null,
    latestRecoveryEvidence: null,
  };

  it("renders the hero card from a canonical record with honest provenance", () => {
    const card = buildPlayerCard(statbunkerPlayer, "c_statbunker_epl_9f3a17");
    if (card === null) throw new Error("Canonical record must produce a card");

    expect(card.playerName).toBe("Declan Rice");
    expect(card.clubName).toBe("Arsenal");
    expect(card.clubCode).toBe("ARS");
    expect(card.positionDisplay).toBe("MID");
    expect(card.seasonLabel).toBe("SEASON 2025/26");
    expect(card.attributes.map((a) => `${a.label}:${a.value}`)).toEqual([
      "GOALS:2",
      "ASSISTS:4",
      "APPEARANCES:13",
      "MINUTES:1130",
    ]);
    expect(card.attributes.every((a) => a.pct > 0 && a.pct <= 100)).toBe(true);
    expect(card.provenance.sourceId).toBe("statbunker-epl-2025-26");
    expect(card.provenance.snapshotVersion).toBe(3);
    // Collector identity stays visible but redacted.
    expect(card.provenance.collectorIdRedacted).toBe("c_st••••3a17");
    expect(card.provenance.collectorIdRedacted).not.toContain("tatbunker");
  });

  it("omits the minutes bar when the source does not publish minutes", () => {
    const card = buildPlayerCard(
      {
        ...statbunkerPlayer,
        stats: { ...statbunkerPlayer.stats, minutesPlayed: null },
      },
      "c_statbunker_epl_9f3a17",
    );
    if (card === null) throw new Error("Canonical record must produce a card");

    expect(card.attributes.map((attribute) => attribute.label)).toEqual([
      "GOALS",
      "ASSISTS",
      "APPEARANCES",
    ]);
  });

  it("labels StatBunker output live only when the runtime reports live", () => {
    expect(resolveDataLabel(statbunkerLiveRuntime, false)).toBe(
      "LIVE PROVIDER",
    );
    expect(resolveModeChip(statbunkerLiveRuntime, false)).toBe("LIVE PROVIDER");
    // The fixture fallback must never borrow the provider's language.
    expect(resolveDataLabel(statbunkerLiveRuntime, true)).toBe("DEMO DATA");
    expect(resolveModeChip(statbunkerLiveRuntime, true)).toBe("MOCK PIPELINE");
  });

  it("falls back to source-integrity cards while team metadata stays empty", () => {
    const section = resolveTeamSectionState({
      teams: [],
      sources: [statbunkerSource],
      playerCount: 14,
    });
    if (section.kind !== "source-cards") {
      throw new Error(`Expected source-cards, received ${section.kind}`);
    }
    expect(section.clubs).toHaveLength(1);
    expect(section.clubs[0]?.sourceId).toBe("statbunker-epl-2025-26");
    expect(section.clubs[0]?.clubCode).toBe("STA");
    expect(section.clubs[0]?.state).toBe("healthy");
  });

  it("explains player-only collectors instead of looking broken", () => {
    const section = resolveTeamSectionState({
      teams: [],
      sources: [],
      playerCount: 14,
    });
    if (section.kind !== "player-only") {
      throw new Error(`Expected player-only, received ${section.kind}`);
    }
    expect(section.note).toMatch(/player rows only/i);
    expect(section.note).toMatch(/expected/i);
    expect(section.note).toContain("14");
    // The stale run-the-pipeline hint would look broken here.
    expect(section.note).not.toMatch(/run the pipeline/i);
  });

  it("keeps the run-the-pipeline hint for genuinely empty dashboards", () => {
    const section = resolveTeamSectionState({
      teams: [],
      sources: [],
      playerCount: 0,
    });
    if (section.kind !== "empty") {
      throw new Error(`Expected empty, received ${section.kind}`);
    }
    expect(section.note).toMatch(/run the pipeline once/i);
  });

  it("renders real team cards whenever the collector does supply them", () => {
    const section = resolveTeamSectionState({
      teams: [
        {
          teamId: "statbunker-epl-2025-26:team:arsenal",
          sourceId: "statbunker-epl-2025-26",
          name: "Arsenal",
          shortName: null,
          city: null,
          stadium: null,
          coach: null,
          founded: null,
          observedAt: "2026-08-21T17:30:00.000Z",
          latestSnapshot: {
            snapshotId: statbunkerPlayer.latestSnapshot.snapshotId,
            version: 3,
          },
        },
      ],
      sources: [statbunkerSource],
      playerCount: 14,
    });
    if (section.kind !== "team-cards") {
      throw new Error(`Expected team-cards, received ${section.kind}`);
    }
    expect(section.teams).toHaveLength(1);
    expect(section.teams[0]?.name).toBe("Arsenal");
    expect(section.teams[0]?.state).toBe("healthy");
  });
});

describe("standings labelling", () => {
  it("requires both provider rows and a live provider runtime", () => {
    expect(resolveStandingsMode(0)).toBe("simulated");
    expect(resolveStandingsMode(20)).toBe("provider");
    expect(resolveStandingsMode(20, false)).toBe("simulated");
  });

  it("keeps simulated copy unmistakably demo even under a live runtime", () => {
    const copy = standingsTableCopy("simulated");
    expect(copy.caption.toLowerCase()).toContain("simulated");
    expect(copy.note).toMatch(/demo data/);
    expect(`${copy.caption}\n${copy.note}`).not.toMatch(/provider/i);
  });

  it("marks provider-backed tables explicitly", () => {
    const copy = standingsTableCopy("provider");
    expect(copy.caption).toMatch(/provider-synced/);
    expect(copy.note).toMatch(/verified standings snapshot/);
  });
});
