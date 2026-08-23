import { describe, expect, it } from "vitest";

import {
  FootballRecordSchema,
  PlayerMatchRecordSchema,
  entityIdOf,
} from "@bidsentinel/contracts";

import { StatBunkerMatchRowMapper } from "./statbunker-matches.js";

const SOURCE_ID = "statbunker-epl-2025-26-matches-60023-2025";
const SOURCE_URL =
  "https://www.statbunker.com/players/SeasonMatches?comps_id=776&comps_type=EPL&player_id=60023";
const OBSERVED_AT = "2026-08-23T09:00:00.000Z";
const mapper = new StatBunkerMatchRowMapper(SOURCE_ID);
const context = {
  playerId: "statbunker-epl-2025-26:60023",
  playerExternalId: "60023",
  playerName: "Erling Haaland",
  playerTeam: "Manchester City",
  season: "2025",
  sourceUrl: SOURCE_URL,
  observedAt: OBSERVED_AT,
};

function matchRow(overrides: Record<string, unknown> = {}) {
  return {
    competition: "Premier League 25/26",
    home_club: "Liverpool",
    away_club: "Manchester City",
    score: "1 - 2",
    start: "1",
    sub: "-",
    mp: "90",
    goals: "1",
    a: "1",
    yellow_cards: "1",
    second_yellow_cards: "-",
    red_cards: "-",
    date: "08 Feb 2026",
    ...overrides,
  };
}

describe("StatBunkerMatchRowMapper", () => {
  it("maps the verified SeasonMatches columns into a frozen match record", () => {
    const outcome = mapper.map(matchRow(), context);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(PlayerMatchRecordSchema.parse(outcome.record)).toMatchObject({
      entityType: "match",
      playerId: context.playerId,
      playerName: "Erling Haaland",
      playerTeam: "Manchester City",
      playedOn: "2026-02-08",
      homeTeam: "Liverpool",
      awayTeam: "Manchester City",
      homeGoals: 1,
      awayGoals: 2,
      venue: "away",
      appeared: true,
      goals: 1,
      assists: 1,
      minutesPlayed: 90,
      yellowCards: 1,
      redCards: 0,
      sourceUrl: SOURCE_URL,
    });
    expect(FootballRecordSchema.safeParse(outcome.record).success).toBe(true);
    expect(entityIdOf(outcome.record)).toBe(outcome.record.matchId);
  });

  it("treats StatBunker dashes as zero only for count columns", () => {
    const outcome = mapper.map(
      matchRow({
        start: "-",
        sub: "-",
        mp: "-",
        goals: "-",
        a: "-",
        yellow_cards: "-",
      }),
      context,
    );
    expect(outcome).toMatchObject({
      ok: true,
      record: {
        appeared: false,
        goals: 0,
        assists: 0,
        minutesPlayed: null,
        yellowCards: 0,
      },
    });
  });

  it("accepts explicit goal columns as an alternative to the score cell", () => {
    const outcome = mapper.map(
      matchRow({ score: undefined, home_goals: 3, away_goals: 3 }),
      context,
    );
    expect(outcome).toMatchObject({
      ok: true,
      record: { homeGoals: 3, awayGoals: 3 },
    });
  });

  it("builds a deterministic identity for duplicate restatements", () => {
    const first = mapper.map(matchRow(), context);
    const second = mapper.map(matchRow(), context);
    expect(first.ok && second.ok && first.record.matchId).toBe(
      second.ok ? second.record.matchId : "unreachable",
    );
  });

  it.each([
    ["missing date", { date: "-" }],
    ["invalid calendar date", { date: "31 Feb 2026" }],
    ["missing score", { score: "-" }],
    ["wrong clubs", { home_club: "Chelsea", away_club: "Arsenal" }],
    ["missing appearance markers", { start: undefined, sub: undefined }],
    ["wrong competition", { competition: "FA Cup 25/26" }],
    ["date outside the requested season", { date: "08 Feb 2025" }],
  ])("fails closed for %s", (_label, overrides) => {
    const outcome = mapper.map(matchRow(overrides), context);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.issues.length).toBeGreaterThan(0);
  });

  it("rejects a canonical row for a different requested player", () => {
    const first = mapper.map(matchRow(), context);
    if (!first.ok) throw new Error("fixture failed");
    const outcome = mapper.map(first.record, {
      ...context,
      playerId: "statbunker-epl-2025-26:other",
    });
    expect(outcome.ok).toBe(false);
  });
});
