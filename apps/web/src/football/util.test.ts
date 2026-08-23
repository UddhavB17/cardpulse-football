import { describe, expect, it } from "vitest";

import { buildSeasonTable } from "./content";
import {
  hashString,
  mulberry32,
  orderShifts,
  redactCollectorId,
  serialNumberFrom,
  signatureFrom,
} from "./util";

describe("deterministic primitives", () => {
  it("hashes stably and within the uint32 range", () => {
    expect(hashString("cardpulse")).toBe(hashString("cardpulse"));
    expect(hashString("cardpulse")).not.toBe(hashString("football"));
    expect(hashString("")).toBe(0x811c9dc5);
  });

  it("produces identical sequences for identical seeds", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const sequenceA = [a(), a(), a()];
    const sequenceB = [b(), b(), b()];
    expect(sequenceB).toEqual(sequenceA);
  });

  it("derives stable signatures and serial numbers", () => {
    expect(signatureFrom("player:1")).toBe(signatureFrom("player:1"));
    expect(serialNumberFrom("player:1")).toMatch(/^CP-\d{4}\/26$/);
  });
});

describe("collector redaction", () => {
  it("masks the middle of realistic collector ids", () => {
    expect(redactCollectorId("c_abcdef1234567890")).toBe("c_ab••••7890");
  });

  it("handles short, empty and missing ids without leaking", () => {
    expect(redactCollectorId("c_12")).toBe("c_••••");
    expect(redactCollectorId("abc123")).toBe("ab••••");
    expect(redactCollectorId("")).toBe("unassigned");
    expect(redactCollectorId(null)).toBe("unassigned");
    expect(redactCollectorId(undefined)).toBe("unassigned");
  });
});

describe("standings engine", () => {
  it("plays a full deterministic single round robin with consistent points", () => {
    const table = buildSeasonTable("test-season", null, 0);
    expect(table).toHaveLength(10);

    const totalPlayed = table.reduce((sum, row) => sum + row.played, 0);
    // Ten teams, nine matches each, single round robin.
    expect(totalPlayed).toBe(90);

    // Points must be internally consistent: 3 per win, 1 per draw.
    const wins = table.reduce((sum, row) => sum + row.won, 0);
    const draws = table.reduce((sum, row) => sum + row.drawn, 0);
    const points = table.reduce((sum, row) => sum + row.points, 0);
    expect(points).toBe(wins * 3 + draws);
    // Every match is either a win for someone or a draw.
    expect(wins + draws / 2).toBe(45);
  });

  it("sorts by points, then goal difference, then goals for", () => {
    const table = buildSeasonTable("test-season", null, 0);
    for (let index = 1; index < table.length; index += 1) {
      const previous = table[index - 1];
      const current = table[index];
      if (previous === undefined || current === undefined) continue;
      if (previous.points !== current.points) {
        expect(previous.points).toBeGreaterThan(current.points);
        continue;
      }
      const previousDiff = previous.goalsFor - previous.goalsAgainst;
      const currentDiff = current.goalsFor - current.goalsAgainst;
      if (previousDiff !== currentDiff) {
        expect(previousDiff).toBeGreaterThan(currentDiff);
        continue;
      }
      expect(previous.goalsFor).toBeGreaterThanOrEqual(current.goalsFor);
    }
  });

  it("applies bonus points to the hero club before sorting", () => {
    const base = buildSeasonTable("test-season", "RHE", 0);
    const boosted = buildSeasonTable("test-season", "RHE", 3);

    const rheBase = base.find((row) => row.clubCode === "RHE");
    const rheBoosted = boosted.find((row) => row.clubCode === "RHE");
    expect(rheBoosted?.points).toBe((rheBase?.points ?? 0) + 3);
    expect(boosted[0]?.clubCode).toBe("RHE");
    // The rest of the league is untouched.
    expect(
      boosted.filter((row) => !row.isHeroClub).map((row) => row.points),
    ).toEqual(base.filter((row) => !row.isHeroClub).map((row) => row.points));
  });

  it("never highlights a real provider club inside the fictional table", () => {
    // A live hero card (e.g. Arsenal) must not appear to play in the
    // simulated league — only fictional codes can be highlighted.
    const table = buildSeasonTable("cardpulse-2526", "ARS", 3);
    expect(table.some((row) => row.isHeroClub)).toBe(false);
  });
});

describe("order shifts", () => {
  it("reports positive values for rows that moved up", () => {
    const shifts = orderShifts(["a", "b", "c"], ["c", "a", "b"]);
    expect(shifts).toEqual({ c: 2, a: -1, b: -1 });
  });

  it("tracks surviving rows when others are added or removed", () => {
    const shifts = orderShifts(["a", "b"], ["b", "x"]);
    expect(shifts).toEqual({ b: 1 });
  });

  it("returns no shifts for an unchanged order", () => {
    expect(orderShifts(["a", "b"], ["a", "b"])).toEqual({});
  });
});
