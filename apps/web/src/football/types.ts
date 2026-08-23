// CardPulse Football — search/card domain views.
//
// These types describe what the UI renders. They are intentionally structural:
// only `src/data-client.ts` talks HTTP, and `src/football/mapping.ts` turns
// normalized payloads into these views.

export type DataMode = "live";

export interface PaletteView {
  /** Team-inspired decorative hues, deterministic per club name. */
  primary: string;
  secondary: string;
  accent: string;
}

export interface SearchHitView {
  playerId: string;
  playerName: string;
  clubName: string;
  positionDisplay: string;
  seasons: string[];
}

export type ResultState =
  "idle" | "too-short" | "loading" | "source-unavailable" | "empty" | "results";

export type SeasonKey = "2023" | "2024" | "2025" | "2026";

export interface SeasonOptionView {
  key: SeasonKey;
  label: string;
  available: boolean;
  inProgress: boolean;
}

export interface AttributeLine {
  label: string;
  value: number;
  /** Bar width percentage, precomputed by the mapping layer. */
  pct: number;
}

/** Season totals for the card face; null means the source did not publish it. */
export interface StatTotals {
  appearances: number | null;
  goals: number | null;
  assists: number | null;
  minutesPlayed: number | null;
  yellowCards: number | null;
  redCards: number | null;
}

export interface CardFrontView {
  playerId: string;
  playerName: string;
  clubName: string;
  clubCode: string;
  positionDisplay: string;
  shirtNumber: number | null;
  seasonLabel: string;
  serialNumber: string;
  palette: PaletteView;
  totals: StatTotals;
  attributes: AttributeLine[];
  verifiedAtLabel: string | null;
  seasonInProgress: boolean;
}

export interface MatchView {
  matchId: string | null;
  dateLabel: string;
  opponent: string;
  venue: "Home" | "Away";
  scoreLabel: string | null;
  goals: number | null;
  assists: number | null;
  minutes: number | null;
}

export interface TimelineEntryView {
  title: string;
  detail: string;
  tone: "good" | "info" | "warn" | "bad";
}

export interface CardBackView {
  headlineMatch: MatchView | null;
  timeline: TimelineEntryView[];
  note: string | null;
}

export interface ProvenanceView {
  sourceUrl: string | null;
  observedAtLabel: string | null;
  snapshotVersionLabel: string;
  snapshotHashShort: string;
  collectorRedacted: string;
  scrapeRunLabel: string;
  scrapeStatusLabel: string;
  cacheLabel: string;
  sourceHealthLabel: string;
  healingLabel: string;
}

export interface CardBundle {
  front: CardFrontView;
  back: CardBackView;
  provenance: ProvenanceView;
  seasonKey: SeasonKey;
  mode: DataMode;
}

export type CompareDirection = "up" | "down" | "flat" | "unknown";

export interface CompareDeltaView {
  metric: string;
  currentLabel: string;
  previousLabel: string;
  deltaLabel: string;
  direction: CompareDirection;
}
