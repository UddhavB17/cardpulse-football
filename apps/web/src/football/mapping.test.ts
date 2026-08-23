import { describe, expect, it } from "vitest";

import {
  buildCardBack,
  buildCardBundle,
  buildCardFront,
  buildGoalTimeline,
  buildMatchView,
  buildProvenanceView,
  clubCodeFrom,
  headlineMatch,
  paletteFromClub,
  positionDisplay,
  type CardPayloadLike,
  type MatchPayloadLike,
} from "./mapping";

const card: CardPayloadLike = {
  playerId: "statbunker:player:rice",
  playerName: "Declan Rice",
  position: "midfielder",
  shirtNumber: 41,
  clubName: "Arsenal",
  season: "2025",
  mode: "live",
  totals: {
    appearances: 13,
    goals: 2,
    assists: 4,
    yellowCards: 3,
    redCards: 0,
    minutesPlayed: 1130,
  },
  sourceUrl: "https://example.test/snapshots/epl-2025",
  sourceId: "statbunker-epl-2025-26",
  observedAt: "2026-08-21T17:30:00.000Z",
  snapshotVersion: 3,
  snapshotHash: "9c1f4a52deadbeefcafe0123456789ab",
  collectorId: "c_statbunker_epl_9f3a17",
  scrapeRunId: "run-7712",
  scrapeStatus: "completed",
  fetchedAt: "2026-08-21T17:31:10.000Z",
  cacheAgeSeconds: 42,
};

const matches: MatchPayloadLike[] = [
  {
    matchId: "m1",
    date: "2025-09-13T14:00:00.000Z",
    opponent: "Harbor City FC",
    venue: "home",
    scoreFor: 3,
    scoreAgainst: 1,
    goals: 2,
    assists: 0,
    minutes: 90,
  },
  {
    matchId: "m2",
    date: "2025-11-01T14:00:00.000Z",
    opponent: "Sable Rovers",
    venue: "away",
    scoreFor: 1,
    scoreAgainst: 1,
    goals: 1,
    assists: 1,
    minutes: 82,
  },
  {
    matchId: "m3",
    date: "2025-08-16T14:00:00.000Z",
    opponent: "Kingsmoor Town",
    venue: "home",
    scoreFor: 0,
    scoreAgainst: 2,
    goals: 0,
    assists: 0,
    minutes: 65,
  },
];

describe("card front", () => {
  it("renders real totals with deterministic presentation flourishes", () => {
    const front = buildCardFront(card);
    expect(front.playerName).toBe("Declan Rice");
    expect(front.clubCode).toBe("ARS");
    expect(front.positionDisplay).toBe("MID");
    expect(front.seasonLabel).toBe("2025/26");
    expect(front.serialNumber).toMatch(/^CP-\d{4}\/26$/);
    expect(front.totals.minutesPlayed).toBe(1130);
    expect(front.archetypeId).toBe("midfield-engine");
    expect(front.archetypeTitle).toBe("Midfield Engine");
    expect(front.archetypeSpecial).toBe(false);
    expect(front.sourcePosition).toBe("midfielder");
    expect(front.attributes.map((a) => a.label)).toEqual([
      "GOALS",
      "ASSISTS",
      "APPEARANCES",
      "MINUTES",
    ]);
  });

  it("omits bars for stats the source does not publish", () => {
    const front = buildCardFront({
      ...card,
      totals: { ...card.totals, minutesPlayed: null },
    });
    expect(front.attributes.map((a) => a.label)).not.toContain("MINUTES");
    expect(front.attributes.every((a) => a.pct > 0 && a.pct <= 100)).toBe(true);
  });

  it("flags the in-progress current season", () => {
    const current = buildCardFront({ ...card, season: "2026" });
    expect(current.seasonInProgress).toBe(true);
  });

  it("maps positions and derives club codes", () => {
    expect(positionDisplay("forward")).toBe("FWD");
    expect(positionDisplay("Goalkeeper")).toBe("GK");
    expect(positionDisplay(null)).toBe("—");
    expect(clubCodeFrom("West Ham United")).toBe("WES");
  });

  it("resolves curated player editions independently of position", () => {
    const haaland = buildCardFront({
      ...card,
      playerId: "statbunker:player:haaland",
      playerName: "Erling Haaland",
      position: "forward",
    });
    expect(haaland.archetypeId).toBe("nordic-no-9");
    expect(haaland.archetypeTitle).toBe("Nordic No. 9");
    expect(haaland.archetypeSpecial).toBe(true);

    const rodri = buildCardFront({
      ...card,
      playerId: "statbunker:player:rodri",
      playerName: "Rodri",
      position: "goalkeeper",
    });
    expect(rodri.archetypeId).toBe("midfield-architect");
    expect(rodri.archetypeSpecial).toBe(true);
  });
});

describe("palette derivation", () => {
  it("is deterministic per club and stays inside curated hue families", () => {
    const arsenal = paletteFromClub("Arsenal");
    expect(paletteFromClub("Arsenal")).toEqual(arsenal);
    for (const value of Object.values(arsenal)) {
      expect(value).toMatch(/^hsl\(\d+ \d+% \d+%\)$/);
    }
  });
});

describe("match views and timeline", () => {
  it("orients scores from the player's perspective", () => {
    const home = buildMatchView(matches[0]!);
    expect(home.venue).toBe("Home");
    expect(home.scoreLabel).toBe("3–1");
    const away = buildMatchView(matches[1]!);
    expect(away.venue).toBe("Away");
    // Player team scored one away goal; away perspective keeps 1–1.
    expect(away.scoreLabel).toBe("1–1");
  });

  it("picks the highest-scoring match as the headline", () => {
    expect(headlineMatch(matches)?.matchId).toBe("m1");
    expect(headlineMatch([])).toBeNull();
  });

  it("builds a goal timeline sorted newest first with truthful counts", () => {
    const timeline = buildGoalTimeline(matches);
    expect(timeline).toHaveLength(2);
    expect(timeline[0]?.title).toContain("Sable Rovers");
    expect(timeline[0]?.detail).toContain("1 goal");
    expect(timeline[1]?.detail).toContain("2 goals");
  });

  it("explains missing match history instead of rendering an empty back", () => {
    const unavailable = buildCardBack([], { matchesUnavailable: true });
    expect(unavailable.headlineMatch).toBeNull();
    expect(unavailable.note).toMatch(/not published/i);

    const emptySeason = buildCardBack([], { matchesUnavailable: false });
    expect(emptySeason.note).toMatch(/no completed matches/i);

    const populated = buildCardBack(matches, { matchesUnavailable: false });
    expect(populated.note).toBeNull();
    expect(populated.headlineMatch?.opponent).toBe("Harbor City FC");
  });
});

describe("provenance view", () => {
  it("shows real provenance and redacts the collector id", () => {
    const view = buildProvenanceView({
      payload: card,
      sourceHealth: {
        state: "healthy",
        lastSuccessfulAt: "2026-08-21T17:31:00.000Z",
        activeIncidentReason: null,
        healingState: null,
      },
    });
    expect(view.sourceUrl).toContain("example.test");
    expect(view.observedAtLabel).toContain("2026");
    expect(view.snapshotVersionLabel).toBe("v3");
    expect(view.snapshotHashShort).toBe("9c1f4a52de");
    expect(view.collectorRedacted).toBe("c_st••••3a17");
    expect(view.collectorRedacted).not.toContain("atbunker_epl_9f3a17");
    expect(view.scrapeRunLabel).toBe("run-7712");
    expect(view.scrapeStatusLabel).toBe("completed");
    expect(view.cacheLabel).toContain("42s old");
    expect(view.sourceHealthLabel).toBe("healthy");
    expect(view.healingLabel).toMatch(/no healing events/i);
  });

  it("stays truthful when provenance fields are absent", () => {
    const view = buildProvenanceView({
      payload: {
        ...card,
        snapshotHash: null,
        cacheAgeSeconds: null,
        fetchedAt: null,
      },
      sourceHealth: null,
    });
    expect(view.snapshotHashShort).toBe("unhashed");
    expect(view.cacheLabel).toBe("Fetch time unknown");
    expect(view.sourceHealthLabel).toBe("health unknown");
  });
});

describe("card bundle", () => {
  it("assembles front, back and provenance with the season key", () => {
    const bundle = buildCardBundle({
      payload: card,
      matches,
      matchesUnavailable: false,
      sourceHealth: null,
    });
    expect(bundle.front.playerName).toBe("Declan Rice");
    expect(bundle.back.headlineMatch?.matchId).toBe("m1");
    expect(bundle.provenance.collectorRedacted).toBe("c_st••••3a17");
    expect(bundle.seasonKey).toBe("2025");
    expect(bundle.mode).toBe("live");
  });
});
