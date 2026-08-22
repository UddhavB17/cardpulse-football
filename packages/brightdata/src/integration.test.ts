import { describe, expect, it } from "vitest";

import { FootballRecordSchema, entityIdOf } from "@bidsentinel/contracts";
import {
  validPlayerFixture,
  validStandingFixtures,
  validTeamFixtures,
} from "@bidsentinel/contracts/fixtures";

import { mapRawRowToFootballRecord } from "./index.js";

describe("mapper/contract integration", () => {
  const observedAt = "2026-08-20T05:00:00.000Z";

  it("maps a raw scraper-style player row into a schema-valid record", () => {
    const raw = {
      id: "p-77",
      playerName: "Jamal Example",
      position: "midfielder",
      team: { teamId: "t-1", name: "FC Example" },
      season: "2025",
      shirt_number: "7",
      url: "https://example.football.test/p/77",
      appearances: "12",
      goals: 4,
      assists: 6,
      yellow_cards: 2,
      reds: 0,
      minutes_played: "980",
    };

    const mapped = mapRawRowToFootballRecord(raw, "openligadb", observedAt);
    const parsed = FootballRecordSchema.parse(mapped);
    expect(parsed.entityType).toBe("player");
    expect(entityIdOf(parsed)).toBe("openligadb:p-77");
    if (parsed.entityType !== "player") {
      throw new Error("expected a player record");
    }
    expect(parsed.stats).toMatchObject({
      appearances: 12,
      yellowCards: 2,
      minutesPlayed: 980,
    });
  });

  it("re-maps canonical fixtures and keeps them schema-valid", () => {
    for (const fixture of [
      validPlayerFixture,
      ...validTeamFixtures,
      ...validStandingFixtures,
    ]) {
      const remapped = mapRawRowToFootballRecord(
        structuredClone(fixture),
        "openligadb",
        observedAt,
      );
      const result = FootballRecordSchema.safeParse(remapped);
      expect(result.success).toBe(true);
    }
  });

  it("passes malformed values through for downstream quarantine", () => {
    const mapped = mapRawRowToFootballRecord(
      { id: "x", rank: "first" },
      "src",
      observedAt,
    ) as Record<string, unknown>;
    expect(mapped["rank"]).toBe("first");
  });
});
