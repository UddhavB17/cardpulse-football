import { describe, expect, it } from "vitest";

import { FootballRecordSchema } from "@bidsentinel/contracts";

import {
  buildRecordsForMode,
  fixtureEnvelope,
  trackedGoalsAfter,
  trackedGoalsBefore,
  trackedPlayerName,
} from "./fixtures.js";

describe("chaos source fixtures", () => {
  it("keeps baseline-table and drift-cards business data identical", () => {
    expect(buildRecordsForMode("drift-cards")).toEqual(
      buildRecordsForMode("baseline-table"),
    );
  });

  it("changes only the tracked striker stats when amended", () => {
    const baseline = buildRecordsForMode("drift-cards");
    const amended = buildRecordsForMode("amended-stats");

    const baselinePlayers = baseline.filter(
      (record) => record.entityType === "player",
    );
    const amendedPlayers = amended.filter(
      (record) => record.entityType === "player",
    );

    const changed = amendedPlayers.filter((player, index) => {
      const before = baselinePlayers[index];
      return (
        before === undefined ||
        JSON.stringify(before.stats) !== JSON.stringify(player.stats)
      );
    });

    expect(changed).toHaveLength(1);
    const striker = changed[0];
    if (striker?.entityType !== "player") {
      throw new Error("Amended batch must contain the tracked player");
    }
    expect(striker.playerName).toBe(trackedPlayerName);
    expect(striker.stats.goals).toBe(trackedGoalsAfter);
    expect(striker.stats.goals).toBeGreaterThan(trackedGoalsBefore);
  });

  it.each(["baseline-table", "drift-cards", "amended-stats"] as const)(
    "emits canonical football records for %s",
    (mode) => {
      for (const record of buildRecordsForMode(mode)) {
        expect(FootballRecordSchema.safeParse(record).success).toBe(true);
      }
      expect(fixtureEnvelope(mode).mode).toBe(mode);
    },
  );
});
