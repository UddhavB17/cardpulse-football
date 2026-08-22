import type { FootballRecord } from "@bidsentinel/contracts";
import {
  amendedPlayerFixture,
  demoSourceId,
  demoRecordsFor,
  validPlayerFixtures,
} from "@bidsentinel/contracts/fixtures";

export const chaosModes = [
  "baseline-table",
  "drift-cards",
  "amended-stats",
  "unavailable",
] as const;

export type ChaosMode = (typeof chaosModes)[number];
export type AvailableChaosMode = Exclude<ChaosMode, "unavailable">;

export function isChaosMode(value: string): value is ChaosMode {
  return (chaosModes as readonly string[]).includes(value);
}

/** Layout modes return identical business data. Only their HTML differs. */
export function buildRecordsForMode(
  mode: AvailableChaosMode,
): FootballRecord[] {
  if (mode === "amended-stats") {
    return structuredClone(demoRecordsFor("amended"));
  }

  return structuredClone(demoRecordsFor("valid"));
}

export function fixtureEnvelope(mode: AvailableChaosMode) {
  return {
    sourceId: demoSourceId,
    extractorVersion: "chaos-source-v3",
    mode,
    items: buildRecordsForMode(mode),
  };
}

export const trackedPlayerName = validPlayerFixtures[0]?.playerName ?? "";
export const trackedGoalsBefore = validPlayerFixtures[0]?.stats.goals ?? 0;
export const trackedGoalsAfter = amendedPlayerFixture.stats.goals;
