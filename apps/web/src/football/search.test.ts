import { describe, expect, it } from "vitest";

import {
  MIN_QUERY_LENGTH,
  announceResultState,
  dedupeHits,
  firstMatchSpan,
  handleSearchKey,
  isSearchableQuery,
  normalizeQuery,
  resolveResultState,
  type ComboboxState,
  type SearchOption,
} from "./search";

const options: SearchOption[] = [
  {
    id: "opt-0",
    playerId: "p-1",
    playerName: "Rio Marchetti",
    clubName: "Northgate United",
    positionDisplay: "MID",
    seasons: ["2024", "2025"],
  },
  {
    id: "opt-1",
    playerId: "p-2",
    playerName: "Callum Oduya",
    clubName: "Harbor City FC",
    positionDisplay: "FWD",
    seasons: ["2023"],
  },
];

describe("query gating", () => {
  it("requires at least two characters after normalization", () => {
    expect(MIN_QUERY_LENGTH).toBe(2);
    expect(isSearchableQuery("r")).toBe(false);
    expect(isSearchableQuery(" r ")).toBe(false);
    expect(isSearchableQuery("ri")).toBe(true);
    expect(isSearchableQuery("  o d  ")).toBe(true);
  });

  it("collapses whitespace runs so 'od   ya' still searches cleanly", () => {
    expect(normalizeQuery("  rio   marchetti ")).toBe("rio marchetti");
  });
});

describe("case/partial matching", () => {
  it("matches case-insensitively and reports the span for highlighting", () => {
    expect(firstMatchSpan("Rio Marchetti", "marc")).toEqual([4, 8]);
    expect(firstMatchSpan("HARBOR CITY", "harbor")).toEqual([0, 6]);
    expect(firstMatchSpan("Marchetti", "zzz")).toBeNull();
  });

  it("ignores diacritics when matching", () => {
    expect(firstMatchSpan("Tomás Ferreyra", "tomas")).not.toBeNull();
    expect(firstMatchSpan("Tomas Ferreyra", "tomás")).not.toBeNull();
  });

  it("dedupes hits by player id while keeping server order", () => {
    const dupes = [...options, { ...options[0]!, id: "opt-dup" }];
    expect(dedupeHits(dupes)).toHaveLength(2);
    expect(dedupeHits(options).map((o) => o.playerId)).toEqual(["p-1", "p-2"]);
  });
});

describe("combobox keyboard semantics", () => {
  const open: ComboboxState = { open: true, activeIndex: 0, optionCount: 3 };

  it("moves down with wraparound", () => {
    expect(handleSearchKey(open, "ArrowDown")).toEqual({
      type: "highlight",
      index: 1,
    });
    const last: ComboboxState = { ...open, activeIndex: 2 };
    expect(handleSearchKey(last, "ArrowDown")).toEqual({
      type: "highlight",
      index: 0,
    });
  });

  it("moves up with wraparound", () => {
    expect(handleSearchKey(open, "ArrowUp")).toEqual({
      type: "highlight",
      index: 2,
    });
    const second: ComboboxState = { ...open, activeIndex: 1 };
    expect(handleSearchKey(second, "ArrowUp")).toEqual({
      type: "highlight",
      index: 0,
    });
  });

  it("supports Home and End jumps", () => {
    expect(handleSearchKey(open, "Home")).toEqual({
      type: "highlight",
      index: 0,
    });
    expect(handleSearchKey(open, "End")).toEqual({
      type: "highlight",
      index: 2,
    });
  });

  it("selects the highlighted option on Enter and closes on Escape", () => {
    const mid: ComboboxState = { ...open, activeIndex: 1 };
    expect(handleSearchKey(mid, "Enter")).toEqual({ type: "select", index: 1 });
    expect(handleSearchKey(mid, "Escape")).toEqual({ type: "close" });
  });

  it("opens at the right end when the listbox was closed", () => {
    const closed: ComboboxState = {
      open: false,
      activeIndex: 0,
      optionCount: 3,
    };
    expect(handleSearchKey(closed, "ArrowDown")).toEqual({
      type: "highlight",
      index: 0,
    });
    expect(handleSearchKey(closed, "ArrowUp")).toEqual({
      type: "highlight",
      index: 2,
    });
    // Enter does nothing while closed — no phantom selection.
    expect(handleSearchKey(closed, "Enter")).toEqual({ type: "none" });
  });

  it("degrades safely with no options or unknown keys", () => {
    const empty: ComboboxState = { open: true, activeIndex: 0, optionCount: 0 };
    for (const key of ["ArrowDown", "ArrowUp", "Home", "End", "Enter"]) {
      expect(handleSearchKey(empty, key)).toEqual({ type: "none" });
    }
    expect(handleSearchKey(empty, "Escape")).toEqual({ type: "close" });
    expect(handleSearchKey(open, "Tab")).toEqual({ type: "none" });
    expect(handleSearchKey(open, "a")).toEqual({ type: "none" });
  });
});

describe("result state resolution", () => {
  it("walks through every required state truthfully", () => {
    expect(
      resolveResultState({
        queryLength: 5,
        loading: true,
        failed: false,
        resultCount: 0,
      }),
    ).toBe("loading");
    expect(
      resolveResultState({
        queryLength: 5,
        loading: false,
        failed: true,
        resultCount: 0,
      }),
    ).toBe("source-unavailable");
    expect(
      resolveResultState({
        queryLength: 1,
        loading: false,
        failed: false,
        resultCount: 0,
      }),
    ).toBe("too-short");
    expect(
      resolveResultState({
        queryLength: 5,
        loading: false,
        failed: false,
        resultCount: 0,
      }),
    ).toBe("empty");
    expect(
      resolveResultState({
        queryLength: 5,
        loading: false,
        failed: false,
        resultCount: 3,
      }),
    ).toBe("results");
    expect(
      resolveResultState({
        queryLength: 0,
        loading: false,
        failed: false,
        resultCount: 0,
      }),
    ).toBe("too-short");
  });

  it("produces screen-reader announcements per state", () => {
    expect(announceResultState("loading")).toMatch(/searching/i);
    expect(announceResultState("source-unavailable")).toMatch(/unavailable/i);
    expect(announceResultState("empty")).toMatch(/no players/i);
    expect(announceResultState("results", 1)).toContain("1 player");
    expect(announceResultState("results", 4)).toContain("4 players");
    expect(announceResultState("too-short")).toContain("2");
  });
});
