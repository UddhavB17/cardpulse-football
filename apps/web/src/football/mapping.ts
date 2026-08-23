// Mapping layer: turns normalized backend payloads (see data-client.ts) into
// CardPulse Football views. Presentation-only derivations (serial numbers,
// form-style flourishes) are deterministic functions of real record ids so a
// re-render never changes what is printed.

import type {
  AttributeLine,
  CardBackView,
  CardBundle,
  CardFrontView,
  MatchView,
  PaletteView,
  ProvenanceView,
  SeasonKey,
  StatTotals,
  TimelineEntryView,
} from "./types";
import { isInProgressSeason, seasonLabel } from "./seasons";
import { hashString, redactCollectorId, serialNumberFrom, clamp } from "./util";

// ---------------------------------------------------------------------------
// Inputs — structural shapes produced by the data-client normalizers
// ---------------------------------------------------------------------------

export interface CardPayloadLike {
  playerId: string;
  playerName: string;
  position: string | null;
  shirtNumber: number | null;
  clubName: string;
  season: string;
  mode: "live" | "demo";
  totals: StatTotals;
  sourceUrl: string | null;
  sourceId: string | null;
  observedAt: string | null;
  snapshotVersion: number | null;
  snapshotHash: string | null;
  collectorId: string | null;
  scrapeRunId: string | null;
  scrapeStatus: string | null;
  fetchedAt: string | null;
  cacheAgeSeconds: number | null;
}

export interface SourceHealthSummaryLike {
  state: string;
  lastSuccessfulAt: string | null;
  activeIncidentReason: string | null;
  healingState: string | null;
}

export interface MatchPayloadLike {
  matchId: string | null;
  date: string | null;
  opponent: string;
  venue: "home" | "away" | null;
  scoreFor: number | null;
  scoreAgainst: number | null;
  goals: number | null;
  assists: number | null;
  minutes: number | null;
}

const POSITION_DISPLAY: Record<string, string> = {
  goalkeeper: "GK",
  defender: "DEF",
  midfielder: "MID",
  forward: "FWD",
};

export function positionDisplay(position: string | null): string {
  if (position === null) return "—";
  const key = position.trim().toLowerCase();
  return POSITION_DISPLAY[key] ?? key.toUpperCase().slice(0, 3);
}

/** Deterministic three-letter club code: first three letters, uppercased. */
export function clubCodeFrom(name: string): string {
  const letters = name.replaceAll(/[^A-Za-z]/g, "").toUpperCase();
  return (letters.slice(0, 3) + "XXX").slice(0, 3);
}

// ---------------------------------------------------------------------------
// Team-inspired palette — original decorative hues derived from the club name.
// Colors evoke kit families without reproducing any crest or logo.
// ---------------------------------------------------------------------------

const HUE_FAMILIES: ReadonlyArray<readonly [number, number]> = [
  [152, 52], // pitch green / lime
  [210, 26], // royal blue / sky
  [352, 264], // claret / magenta
  [38, 12], // amber / brick
  [266, 192], // violet / teal
  [122, 200], // emerald / azure
  [18, 224], // vermilion / indigo
  [300, 58], // orchid / mustard
];

export function paletteFromClub(clubName: string): PaletteView {
  const family =
    HUE_FAMILIES[hashString(clubName.toLowerCase()) % HUE_FAMILIES.length];
  const primaryHue = family?.[0] ?? 210;
  const secondaryHue = family?.[1] ?? 26;
  return {
    primary: `hsl(${primaryHue} 62% 28%)`,
    secondary: `hsl(${secondaryHue} 68% 44%)`,
    accent: `hsl(${primaryHue} 88% 55%)`,
  };
}

// ---------------------------------------------------------------------------
// Card face building
// ---------------------------------------------------------------------------

function statScale(value: number, scale: number): number {
  if (!Number.isFinite(value) || value <= 0) return 4;
  return clamp(Math.round((value / scale) * 100), 4, 100);
}

function toAttributes(totals: StatTotals): AttributeLine[] {
  const lines: AttributeLine[] = [];
  if (totals.goals !== null)
    lines.push({
      label: "GOALS",
      value: totals.goals,
      pct: statScale(totals.goals, 30),
    });
  if (totals.assists !== null)
    lines.push({
      label: "ASSISTS",
      value: totals.assists,
      pct: statScale(totals.assists, 16),
    });
  if (totals.appearances !== null)
    lines.push({
      label: "APPEARANCES",
      value: totals.appearances,
      pct: statScale(totals.appearances, 38),
    });
  if (totals.minutesPlayed !== null)
    lines.push({
      label: "MINUTES",
      value: totals.minutesPlayed,
      pct: statScale(totals.minutesPlayed, 3420),
    });
  return lines;
}

export function buildCardFront(payload: CardPayloadLike): CardFrontView {
  const seasonKey = payload.season;
  return {
    playerId: payload.playerId,
    playerName: payload.playerName,
    clubName: payload.clubName,
    clubCode: clubCodeFrom(payload.clubName),
    positionDisplay: positionDisplay(payload.position),
    shirtNumber: payload.shirtNumber,
    seasonLabel: seasonLabel(
      (/^\d{4}$/.test(seasonKey) ? seasonKey : "2025") as SeasonKey,
    ),
    serialNumber: serialNumberFrom(`${payload.playerId}:${payload.season}`),
    palette: paletteFromClub(payload.clubName),
    totals: payload.totals,
    attributes: toAttributes(payload.totals),
    verifiedAtLabel: payload.observedAt,
    isDemo: payload.mode === "demo",
    seasonInProgress: isInProgressSeason(
      (/^\d{4}$/.test(seasonKey) ? seasonKey : "2025") as SeasonKey,
    ),
  };
}

// ---------------------------------------------------------------------------
// Match history + goal timeline for the card back
// ---------------------------------------------------------------------------

export function buildMatchView(match: MatchPayloadLike): MatchView {
  const scoreLabel =
    match.scoreFor === null || match.scoreAgainst === null
      ? null
      : `${match.venue === "away" ? match.scoreAgainst : match.scoreFor}–${
          match.venue === "away" ? match.scoreFor : match.scoreAgainst
        }`;
  return {
    matchId: match.matchId,
    dateLabel: formatDate(match.date),
    opponent: match.opponent,
    venue: match.venue === "away" ? "Away" : "Home",
    scoreLabel,
    goals: match.goals,
    assists: match.assists,
    minutes: match.minutes,
  };
}

/**
 * The back-face headline match: the season-bound game where the player scored
 * most; ties break toward the most recent. Null when no matches exist.
 */
export function headlineMatch(
  matches: readonly MatchPayloadLike[],
): MatchPayloadLike | null {
  let best: MatchPayloadLike | null = null;
  for (const match of matches) {
    const bestGoals = best === null ? -1 : (best.goals ?? -1);
    const goals = match.goals ?? -1;
    if (goals > bestGoals) best = match;
  }
  return best;
}

export function buildGoalTimeline(
  matches: readonly MatchPayloadLike[],
): TimelineEntryView[] {
  return [...matches]
    .filter((match) => (match.goals ?? 0) > 0)
    .sort(compareByDateDescending)
    .map((match) => ({
      title: `${formatDate(match.date)} · ${match.venue === "away" ? "@" : "vs"} ${match.opponent}`,
      detail: `${match.goals} ${match.goals === 1 ? "goal" : "goals"}${
        match.assists
          ? `, ${match.assists} assist${match.assists === 1 ? "" : "s"}`
          : ""
      }`,
      tone: "good" as const,
    }));
}

function compareByDateDescending(
  a: MatchPayloadLike,
  b: MatchPayloadLike,
): number {
  return timestampOf(b.date) - timestampOf(a.date);
}

function timestampOf(value: string | null): number {
  if (value === null) return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function formatDate(value: string | null): string {
  if (value === null) return "Date n/a";
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(
    new Date(parsed),
  );
}

export function buildCardBack(
  matches: readonly MatchPayloadLike[],
  options: { matchesUnavailable: boolean },
): CardBackView {
  const top = headlineMatch(matches);
  const timeline = buildGoalTimeline(matches);
  let note: string | null = null;
  if (options.matchesUnavailable) {
    note = "Per-match history is not published by this source.";
  } else if (top === null) {
    note = "No completed matches recorded for this season yet.";
  }
  return {
    headlineMatch: top === null ? null : buildMatchView(top),
    timeline,
    note,
  };
}

// ---------------------------------------------------------------------------
// Provenance view — every value shown is real; collectors stay redacted.
// ---------------------------------------------------------------------------

export function buildProvenanceView(options: {
  payload: CardPayloadLike;
  sourceHealth: SourceHealthSummaryLike | null;
}): ProvenanceView {
  const { payload, sourceHealth } = options;
  let cacheLabel = "Fetch time unknown";
  if (payload.cacheAgeSeconds !== null) {
    cacheLabel = `${payload.cacheAgeSeconds}s old at render`;
  } else if (payload.fetchedAt !== null) {
    cacheLabel = `Fetched ${formatTimestampLabel(payload.fetchedAt)}`;
  }
  return {
    sourceUrl: payload.sourceUrl,
    observedAtLabel:
      payload.observedAt === null
        ? null
        : formatTimestampLabel(payload.observedAt),
    snapshotVersionLabel:
      payload.snapshotVersion === null
        ? "unknown"
        : `v${payload.snapshotVersion}`,
    snapshotHashShort:
      payload.snapshotHash === null
        ? "unhashed"
        : payload.snapshotHash.slice(0, 10),
    collectorRedacted: redactCollectorId(payload.collectorId),
    scrapeRunLabel: payload.scrapeRunId ?? "not recorded",
    scrapeStatusLabel: payload.scrapeStatus ?? "n/a",
    cacheLabel,
    sourceHealthLabel: sourceHealth?.state ?? "health unknown",
    healingLabel:
      sourceHealth?.healingState ??
      (sourceHealth?.activeIncidentReason != null
        ? `incident: ${sourceHealth.activeIncidentReason}`
        : "no healing events"),
    isDemo: payload.mode === "demo",
  };
}

function formatTimestampLabel(value: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(parsed));
}

// ---------------------------------------------------------------------------
// Bundle assembly
// ---------------------------------------------------------------------------

export function buildCardBundle(options: {
  payload: CardPayloadLike;
  matches: readonly MatchPayloadLike[];
  matchesUnavailable: boolean;
  sourceHealth: SourceHealthSummaryLike | null;
}): CardBundle {
  const seasonKey = (
    /^\d{4}$/.test(options.payload.season) ? options.payload.season : "2025"
  ) as SeasonKey;
  return {
    front: buildCardFront(options.payload),
    back: buildCardBack(options.matches, {
      matchesUnavailable: options.matchesUnavailable,
    }),
    provenance: buildProvenanceView({
      payload: options.payload,
      sourceHealth: options.sourceHealth,
    }),
    seasonKey,
    mode: options.payload.mode,
  };
}
