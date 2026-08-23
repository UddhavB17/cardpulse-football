import { describe, expect, it } from "vitest";

import {
  CURRENT_SEASON,
  SEASON_KEYS,
  SEASON_UNAVAILABLE_MESSAGE,
  buildCompareDeltas,
  buildSeasonOptions,
  isInProgressSeason,
  latestAvailableSeason,
  latestCompleteSeason,
  parseSeasonKey,
  seasonCardMissingMessage,
  seasonLabel,
  seasonNotIndexedMessage,
} from "./seasons";

describe("season catalog", () => {
  it("covers 2023/24 through the verified in-progress 2026/27", () => {
    expect([...SEASON_KEYS]).toEqual(["2023", "2024", "2025", "2026"]);
    expect(CURRENT_SEASON).toBe("2026");
    expect(seasonLabel("2023")).toBe("2023/24");
    expect(seasonLabel("2025")).toBe("2025/26");
    expect(seasonLabel("2026")).toBe("2026/27");
    expect(isInProgressSeason("2026")).toBe(true);
    expect(isInProgressSeason("2025")).toBe(false);
  });

  it("parses documented season spellings into catalog keys", () => {
    expect(parseSeasonKey("2025")).toBe("2025");
    expect(parseSeasonKey("2025/26")).toBe("2025");
    expect(parseSeasonKey("25/26")).toBe("2025");
    expect(parseSeasonKey(2024)).toBeNull();
    expect(parseSeasonKey("1998/99")).toBeNull(); // outside the fixed catalog
    expect(parseSeasonKey("nonsense")).toBeNull();
  });
});

describe("selector options", () => {
  it("marks seasons the player lacks as unavailable and labels the current one", () => {
    const options = buildSeasonOptions(new Set(["2024", "2025", "2026"]));
    expect(options.map((option) => option.available)).toEqual([
      false,
      true,
      true,
      true,
    ]);
    const current = options.find((option) => option.key === "2026");
    expect(current?.inProgress).toBe(true);
    expect(current?.label).toContain("in progress");
  });

  it("disables everything when the player has no verified seasons yet", () => {
    const options = buildSeasonOptions(new Set());
    expect(options.every((option) => !option.available)).toBe(true);
  });

  it("picks the newest available season for the initial selection", () => {
    expect(latestAvailableSeason(["2023", "2024"])).toBe("2024");
    expect(latestAvailableSeason([])).toBeNull();
    expect(latestAvailableSeason(["2023", "2026"])).toBe("2026");
  });

  it("names the latest complete catalog season as the search fallback", () => {
    expect(latestCompleteSeason()).toBe("2025");
  });

  it("exposes the exact unavailable-season message", () => {
    expect(SEASON_UNAVAILABLE_MESSAGE).toBe("Source data not available yet.");
  });

  it("explains missing cards vs missing index seasons distinctly", () => {
    expect(seasonCardMissingMessage("2024")).toContain("No card cached");
    expect(seasonCardMissingMessage("2024")).toContain("Generate live card");
    expect(seasonNotIndexedMessage("2023")).toContain("not in this player's verified index");
  });
});

describe("compare deltas", () => {
  it("computes signed deltas for goals, assists, appearances and minutes", () => {
    const deltas = buildCompareDeltas(
      { appearances: 34, goals: 9, assists: 11, minutesPlayed: 2971 },
      { appearances: 31, goals: 4, assists: 7, minutesPlayed: 2588 },
    );
    expect(deltas.map((d) => `${d.metric}:${d.deltaLabel}`)).toEqual([
      "Goals:+5",
      "Assists:+4",
      "Appearances:+3",
      "Minutes:+383",
    ]);
    expect(deltas.every((d) => d.direction === "up")).toBe(true);

    const down = buildCompareDeltas(
      { appearances: 29, goals: 14, assists: 4, minutesPlayed: 2401 },
      { appearances: 33, goals: 22, assists: 6, minutesPlayed: 2814 },
    );
    expect(down[0]).toMatchObject({ deltaLabel: "-8", direction: "down" });

    const flat = buildCompareDeltas(
      { appearances: 10, goals: 2, assists: 1, minutesPlayed: 800 },
      { appearances: 10, goals: 2, assists: 1, minutesPlayed: 800 },
    );
    expect(flat.every((d) => d.direction === "flat")).toBe(true);
  });

  it("never fabricates a zero delta from missing values", () => {
    // Minutes not published this season.
    const missingCurrent = buildCompareDeltas(
      { appearances: 20, goals: 3, assists: 2, minutesPlayed: null },
      { appearances: 30, goals: 8, assists: 4, minutesPlayed: 2600 },
    );
    const minutes = missingCurrent.find((d) => d.metric === "Minutes");
    expect(minutes).toMatchObject({
      currentLabel: "n/a",
      previousLabel: "2600",
      deltaLabel: "—",
      direction: "unknown",
    });

    // Whole previous card missing.
    const noPrevious = buildCompareDeltas(
      { appearances: 30, goals: 8, assists: 4, minutesPlayed: 2600 },
      null,
    );
    expect(noPrevious.every((d) => d.previousLabel === "n/a")).toBe(true);
    expect(noPrevious.every((d) => d.deltaLabel === "—")).toBe(true);

    // Both sides missing.
    const both = buildCompareDeltas(null, null);
    expect(both.every((d) => d.currentLabel === "n/a")).toBe(true);
  });
});
