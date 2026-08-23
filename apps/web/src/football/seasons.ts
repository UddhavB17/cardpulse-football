// Pure season-catalog and comparison logic for CardPulse Football.

import type { CompareDeltaView, SeasonKey, SeasonOptionView } from "./types";

export const SEASON_KEYS: readonly SeasonKey[] = [
  "2023",
  "2024",
  "2025",
  "2026",
] as const;

/** The newest catalog season; live data for it is legitimately incomplete. */
export const CURRENT_SEASON: SeasonKey = "2026";

export const SEASON_UNAVAILABLE_MESSAGE = "Source data not available yet.";

/** Catalog label, e.g. 2023 -> "2023/24". */
export function seasonLabel(key: SeasonKey): string {
  return `${key}/${(Number.parseInt(key, 10) + 1) % 100}`;
}

export function isInProgressSeason(key: SeasonKey): boolean {
  return key === CURRENT_SEASON;
}

/** Newest catalog season that is not the in-progress campaign. */
export function latestCompleteSeason(): SeasonKey {
  const complete = SEASON_KEYS.filter((key) => key !== CURRENT_SEASON);
  return complete.at(-1) ?? "2025";
}

/**
 * Accepts a raw season value from an API payload and maps it into the fixed
 * four-season catalog. Understands "2025", "2025/26" and "25/26" spellings.
 * Anything outside the catalog returns null (an unknown season).
 */
export function parseSeasonKey(value: unknown): SeasonKey | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{2,4})/.exec(value.trim());
  if (match === null) return null;
  let year = Number.parseInt(match[1] ?? "", 10);
  if (!Number.isFinite(year)) return null;
  if (year < 100) year += year >= 50 ? 1900 : 2000;
  const asString = String(year);
  return (SEASON_KEYS as readonly string[]).includes(asString)
    ? (asString as SeasonKey)
    : null;
}

/** Newest available season for a player, or null when none are usable. */
export function latestAvailableSeason(
  keys: Iterable<SeasonKey>,
): SeasonKey | null {
  let found: SeasonKey | null = null;
  for (const key of keys) {
    if (
      found === null ||
      SEASON_KEYS.indexOf(key) > SEASON_KEYS.indexOf(found)
    ) {
      found = key;
    }
  }
  return found;
}

/**
 * Build the ordered selector options. `availableSeasons` is the set the
 * player actually has verified data for (empty set = none). Unknown seasons
 * never appear; known-but-unavailable seasons render disabled so the UI can
 * explain itself instead of failing later.
 */
export function buildSeasonOptions(
  availableSeasons: ReadonlySet<SeasonKey>,
): SeasonOptionView[] {
  return SEASON_KEYS.map((key) => ({
    key,
    label: seasonLabel(key) + (isInProgressSeason(key) ? " · in progress" : ""),
    available: availableSeasons.has(key),
    inProgress: isInProgressSeason(key),
  }));
}

export interface StatTotalsLike {
  appearances: number | null;
  goals: number | null;
  assists: number | null;
  minutesPlayed: number | null;
}

const COMPARE_METRICS: Array<{
  metric: string;
  read: (totals: StatTotalsLike) => number | null;
}> = [
  { metric: "Goals", read: (t) => t.goals },
  { metric: "Assists", read: (t) => t.assists },
  { metric: "Appearances", read: (t) => t.appearances },
  { metric: "Minutes", read: (t) => t.minutesPlayed },
];

function formatCount(value: number | null): string {
  return value === null ? "n/a" : String(value);
}

/**
 * Deltas between two seasons. A missing value on either side is reported
 * truthfully as "n/a" with no fabricated zero-delta.
 */
export function buildCompareDeltas(
  current: StatTotalsLike | null,
  previous: StatTotalsLike | null,
): CompareDeltaView[] {
  return COMPARE_METRICS.map(({ metric, read }) => {
    const now = current === null ? null : read(current);
    const before = previous === null ? null : read(previous);
    if (
      now === null ||
      before === null ||
      current === null ||
      previous === null
    ) {
      return {
        metric,
        currentLabel: formatCount(now),
        previousLabel: formatCount(before),
        deltaLabel: "—",
        direction: "unknown" as const,
      };
    }
    const delta = now - before;
    return {
      metric,
      currentLabel: formatCount(now),
      previousLabel: formatCount(before),
      deltaLabel: delta > 0 ? `+${delta}` : String(delta),
      direction:
        delta > 0
          ? ("up" as const)
          : delta < 0
            ? ("down" as const)
            : ("flat" as const),
    };
  });
}
