// Pure search/combobox logic for the CardPulse player finder.
// No DOM access — everything here is unit testable. The orchestrator binds
// these results to the ARIA combobox pattern.

import type { ResultState } from "./types";

/** Minimum query length before any request is made (inclusive). */
export const MIN_QUERY_LENGTH = 2;

export interface SearchOption {
  /** DOM id for aria-activedescendant wiring. */
  id: string;
  playerId: string;
  playerName: string;
  clubName: string;
  positionDisplay: string;
  seasons: string[];
}

export function normalizeQuery(raw: string): string {
  return raw.replaceAll(/\s+/g, " ").trim();
}

export function isSearchableQuery(query: string): boolean {
  return normalizeQuery(query).length >= MIN_QUERY_LENGTH;
}

/**
 * Case/diacritic-insensitive containment check for client-side filtering and
 * highlighting. Returns the match span for the first occurrence, or null.
 */
export function firstMatchSpan(
  text: string,
  query: string,
): [number, number] | null {
  const fold = (value: string): string =>
    value.normalize("NFD").replaceAll(/\p{M}/gu, "").toLowerCase();
  if (query.length === 0) return null;
  const index = fold(text).indexOf(fold(query));
  if (index < 0) return null;
  return [index, index + query.length];
}

/** Deduplicate hits by playerId while preserving server order. */
export function dedupeHits<T extends { playerId: string }>(hits: T[]): T[] {
  const seen = new Set<string>();
  return hits.filter((hit) => {
    if (seen.has(hit.playerId)) return false;
    seen.add(hit.playerId);
    return true;
  });
}

/** Which visual/announced state the search box is in. */
export function resolveResultState(options: {
  queryLength: number;
  loading: boolean;
  failed: boolean;
  resultCount: number;
}): ResultState {
  if (options.loading) return "loading";
  if (options.failed && options.queryLength >= MIN_QUERY_LENGTH)
    return "source-unavailable";
  if (options.queryLength < MIN_QUERY_LENGTH) return "too-short";
  if (options.resultCount === 0) return "empty";
  return "results";
}

/** Screen-reader announcement copy for the current search state. */
export function announceResultState(state: ResultState, count = 0): string {
  switch (state) {
    case "loading":
      return "Searching players…";
    case "source-unavailable":
      return "Player source unavailable.";
    case "empty":
      return "No players found.";
    case "results":
      return `${count} ${count === 1 ? "player" : "players"} found.`;
    case "too-short":
      return `Type at least ${MIN_QUERY_LENGTH} characters to search.`;
    default:
      return "";
  }
}

export type SearchKeyAction =
  | { type: "highlight"; index: number }
  | { type: "select"; index: number }
  | { type: "close" }
  | { type: "none" };

export interface ComboboxState {
  open: boolean;
  activeIndex: number;
  optionCount: number;
}

const FIRST_KEY = "Home";
const LAST_KEY = "End";

/**
 * Pure keyboard semantics for the listbox attached to the combobox input.
 * ArrowDown/ArrowUp move with wraparound, Home/End jump, Enter selects the
 * highlighted option, Escape closes the listbox without selecting.
 * Out-of-range or closed states degrade to a no-op.
 */
export function handleSearchKey(
  state: ComboboxState,
  key: string,
): SearchKeyAction {
  if (state.optionCount <= 0) {
    return key === "Escape" ? { type: "close" } : { type: "none" };
  }
  const last = state.optionCount - 1;
  const clampedActive = Math.min(Math.max(state.activeIndex, 0), last);
  switch (key) {
    case "ArrowDown":
      return {
        type: "highlight",
        index: !state.open ? 0 : (clampedActive + 1) % state.optionCount,
      };
    case "ArrowUp":
      return {
        type: "highlight",
        index: !state.open
          ? last
          : (clampedActive - 1 + state.optionCount) % state.optionCount,
      };
    case FIRST_KEY:
      return { type: "highlight", index: 0 };
    case LAST_KEY:
      return { type: "highlight", index: last };
    case "Enter":
      if (!state.open) return { type: "none" };
      return { type: "select", index: clampedActive };
    case "Escape":
      return { type: "close" };
    default:
      return { type: "none" };
  }
}
