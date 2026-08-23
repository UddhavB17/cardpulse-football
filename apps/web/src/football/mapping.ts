// Mapping layer: converts verified backend snapshots (football domain) into
// CardPulse Football views. This is the ONLY module besides data-client.ts
// that understands backend payload shapes, and it does so structurally so a
// contracts rename never leaks past this file.

import type {
  ClubHealthState,
  ClubIntegrityView,
  ContractPosition,
  DataModeLabel,
  FormMark,
  ModeChip,
  PlayerCardView,
  ReliabilityView,
  TeamCardView,
  TimelineEntry,
} from "./types";
import {
  hashString,
  mulberry32,
  pick,
  redactCollectorId,
  serialNumberFrom,
  signatureFrom,
} from "./util";

// ---------------------------------------------------------------------------
// Structural views of backend payloads (no imports from @bidsentinel/contracts)
// ---------------------------------------------------------------------------

export interface RuntimeLike {
  mode: "mock" | "live";
  sourceId: string;
  collectorConfigured: boolean;
  targetConfigured: boolean;
  liveMutationsEnabled: boolean;
  configurationIssues: string[];
}

export interface PlayerSummaryLike {
  playerId: string;
  sourceId: string;
  playerName: string;
  team: { teamId: string; name: string };
  position: ContractPosition;
  shirtNumber: number | null;
  /** Summary views omit nationality; detail views carry it. */
  nationality?: string | null;
  season: string;
  stats: {
    appearances: number;
    goals: number;
    assists: number;
    yellowCards: number;
    redCards: number;
    minutesPlayed: number | null;
  };
  observedAt: string | null;
  latestSnapshot: { snapshotId: string; version: number };
}

export interface SourceHealthLike {
  sourceId: string;
  state: string;
  checkedAt: string | null;
  lastSuccessfulAt: string | null;
  consecutiveFailures: number;
  recentFailureRate: number;
  activeIncident: { reason: string; detail: string } | null;
  latestRecoveryEvidence: { actions: string[] } | null;
}

export interface TeamListItemLike {
  teamId: string;
  sourceId: string;
  name: string;
  shortName: string | null;
  city: string | null;
  stadium: string | null;
  coach: string | null;
  founded: number | null;
  observedAt: string | null;
  latestSnapshot: { snapshotId: string; version: number };
}

export type HealingState =
  | "healthy"
  | "quarantined"
  | "healing_requested"
  | "awaiting_approval"
  | "preview_valid"
  | "preview_invalid"
  | "approved"
  | "rejected"
  | "recovered"
  | "recovery_failed";

const CLEAN_STATES: readonly HealingState[] = ["healthy", "recovered"] as const;

/** Chrome glitch is active for every state except a clean baseline/recovery. */
export function isCompromisedState(state: HealingState): boolean {
  return !CLEAN_STATES.includes(state);
}

// ---------------------------------------------------------------------------
// Labels — DEMO DATA unless the runtime itself says live provider
// ---------------------------------------------------------------------------

export function resolveDataLabel(
  runtime: RuntimeLike,
  usingFixtureAdapter: boolean,
): DataModeLabel {
  if (usingFixtureAdapter) return "DEMO DATA";
  return runtime.mode === "live" ? "LIVE PROVIDER" : "DEMO DATA";
}

export function resolveModeChip(
  runtime: RuntimeLike,
  usingFixtureAdapter: boolean,
): ModeChip {
  if (usingFixtureAdapter) return "MOCK PIPELINE";
  if (runtime.mode === "live") return "LIVE PROVIDER";
  return "LOCAL API";
}

const POSITION_DISPLAY: Record<ContractPosition, string> = {
  goalkeeper: "GK",
  defender: "DEF",
  midfielder: "MID",
  forward: "FWD",
};

/** Deterministic three-letter club code: first three letters, uppercased. */
export function clubCodeFrom(name: string): string {
  const letters = name.replaceAll(/[^A-Za-z]/g, "").toUpperCase();
  return (letters.slice(0, 3) + "XXX").slice(0, 3);
}

function seasonLabel(season: string): string {
  const startYear = Number.parseInt(season, 10);
  if (!Number.isFinite(startYear)) return `SEASON ${season}`;
  const endShort = (startYear + 1) % 100;
  return `SEASON ${startYear}/${String(endShort).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Player card derivation — provenance is real, presentation stays synthetic
// ---------------------------------------------------------------------------

const STAT_SCALES = {
  GOALS: 25,
  ASSISTS: 15,
  APPEARANCES: 34,
  MINUTES: 3000,
} as const;

function toAttributes(
  stats: PlayerSummaryLike["stats"],
): PlayerCardView["attributes"] {
  const entries: Array<{
    label: string;
    value: number | null;
    scale: number;
  }> = [
    { label: "GOALS", value: stats.goals, scale: STAT_SCALES.GOALS },
    { label: "ASSISTS", value: stats.assists, scale: STAT_SCALES.ASSISTS },
    {
      label: "APPEARANCES",
      value: stats.appearances,
      scale: STAT_SCALES.APPEARANCES,
    },
    {
      label: "MINUTES",
      value: stats.minutesPlayed,
      scale: STAT_SCALES.MINUTES,
    },
  ];

  return entries.flatMap((entry) =>
    entry.value === null
      ? []
      : [
          {
            label: entry.label,
            value: entry.value,
            pct: Math.max(
              4,
              Math.min(100, Math.round((entry.value / entry.scale) * 100)),
            ),
          },
        ],
  );
}

function toFormMarks(seedSource: string): FormMark[] {
  const random = mulberry32(hashString(`form:${seedSource}`));
  const pool: readonly FormMark[] = ["W", "W", "W", "D", "D", "L"] as const;
  return Array.from({ length: 5 }, () => pick(random, pool));
}

/**
 * Build the matchday hero card from a verified player record.
 * Identity and stats come from the snapshot; form marks are a deterministic
 * presentation index derived from the record id + version.
 */
export function buildPlayerCard(
  player: PlayerSummaryLike | null,
  collectorId: string | null,
): PlayerCardView | null {
  if (player === null) return null;
  return {
    id: player.playerId,
    playerName: player.playerName,
    position: player.position,
    positionDisplay:
      POSITION_DISPLAY[player.position] ?? player.position.toUpperCase(),
    shirtNumber: player.shirtNumber,
    nationality: player.nationality ?? null,
    clubName: player.team.name,
    clubCode: clubCodeFrom(player.team.name),
    serialNumber: serialNumberFrom(
      `${player.playerId}:${player.latestSnapshot.version}`,
    ),
    seasonLabel: seasonLabel(player.season),
    attributes: toAttributes(player.stats),
    form: toFormMarks(`${player.playerId}:${player.latestSnapshot.version}`),
    provenance: {
      sourceId: player.sourceId,
      entityId: player.playerId,
      snapshotId: player.latestSnapshot.snapshotId,
      snapshotVersion: player.latestSnapshot.version,
      verifiedAt: player.observedAt,
      signature: signatureFrom(
        `${player.playerId}:${player.latestSnapshot.snapshotId}:${player.latestSnapshot.version}`,
      ),
      collectorIdRedacted: redactCollectorId(collectorId),
    },
  };
}

// ---------------------------------------------------------------------------
// Team summary cards
// ---------------------------------------------------------------------------

export function buildTeamViews(
  teams: readonly TeamListItemLike[],
  sources: readonly SourceHealthLike[],
): TeamCardView[] {
  const stateBySource = new Map(
    sources.map((source) => [source.sourceId, source.state]),
  );
  return teams.map((team) => ({
    teamId: team.teamId,
    name: team.name,
    shortName: team.shortName,
    city: team.city,
    stadium: team.stadium,
    coach: team.coach,
    founded: team.founded,
    snapshotVersion: team.latestSnapshot.version,
    observedAt: team.observedAt,
    state: toClubHealthState(stateBySource.get(team.sourceId) ?? ""),
  }));
}

// ---------------------------------------------------------------------------
// Club integrity cards from source health records
// ---------------------------------------------------------------------------

function toClubHealthState(state: string): ClubHealthState | null {
  if (state === "healthy") return "healthy";
  if (state === "recovering") return "recovering";
  if (state === "degraded") return "degraded";
  if (state === "quarantined") return "quarantined";
  return null;
}

export function buildClubViews(
  sources: readonly SourceHealthLike[],
): ClubIntegrityView[] {
  return sources.map((source) => ({
    sourceId: source.sourceId,
    clubName: `${clubCodeFrom(source.sourceId)}·${source.sourceId}`,
    clubCode: clubCodeFrom(source.sourceId),
    state: toClubHealthState(source.state) ?? "quarantined",
    checkedAt: source.checkedAt,
    lastSuccessfulAt: source.lastSuccessfulAt,
    consecutiveFailures: source.consecutiveFailures,
    recentFailureRate: Math.round(source.recentFailureRate * 100),
    incidentReason: source.activeIncident?.reason ?? null,
    incidentDetail: source.activeIncident?.detail ?? null,
    recoveryActions: source.latestRecoveryEvidence?.actions ?? [],
  }));
}

// ---------------------------------------------------------------------------
// Section render states — empty secondary datasets must never look broken
// ---------------------------------------------------------------------------

/**
 * Which visual state the "Team summary" section should render.
 * A player-rows-only collector (e.g. StatBunker EPL 25/26) legitimately serves
 * an empty team list, so that case gets explanatory copy instead of an error.
 */
export type TeamSectionState =
  | { kind: "team-cards"; teams: TeamCardView[] }
  | { kind: "source-cards"; clubs: ClubIntegrityView[] }
  | { kind: "player-only"; note: string }
  | { kind: "empty"; note: string };

const TEAM_SECTION_EMPTY_NOTE = "No tracked teams yet — run the pipeline once.";

export function resolveTeamSectionState(options: {
  teams: readonly TeamListItemLike[];
  sources: readonly SourceHealthLike[];
  playerCount: number;
}): TeamSectionState {
  if (options.teams.length > 0) {
    return {
      kind: "team-cards",
      teams: buildTeamViews(options.teams, options.sources),
    };
  }
  if (options.sources.length > 0) {
    return { kind: "source-cards", clubs: buildClubViews(options.sources) };
  }
  if (options.playerCount > 0) {
    return {
      kind: "player-only",
      note:
        `This collector extracts verified player rows only — the empty team ` +
        `summary is expected, not a failure. ${options.playerCount} verified ` +
        `player records remain available.`,
    };
  }
  return { kind: "empty", note: TEAM_SECTION_EMPTY_NOTE };
}

/** Whether the standings table shows provider rows or the demo simulation. */
export type StandingsMode = "provider" | "simulated";

export function resolveStandingsMode(
  rowCount: number,
  providerBacked = true,
): StandingsMode {
  return providerBacked && rowCount > 0 ? "provider" : "simulated";
}

/**
 * Single source of truth for standings captions/notes. The simulated mode is
 * always labelled as demo data — even while the runtime reports live — so the
 * fallback table can never be mistaken for provider output.
 */
export function standingsTableCopy(mode: StandingsMode): {
  caption: string;
  note: string;
} {
  if (mode === "provider") {
    return {
      caption: "Season 2025 · provider-synced table · labelled by runtime",
      note: "Rows come from the verified standings snapshot · arrows show reorder since last sync",
    };
  }
  return {
    caption: "Season 25/26 · simulated league · demo data",
    note: "Simulated standings · fictional clubs · always demo data",
  };
}

// ---------------------------------------------------------------------------
// Reliability drawer view
// ---------------------------------------------------------------------------

export function buildReliabilityView(options: {
  runtime: RuntimeLike;
  usingFixtureAdapter: boolean;
  jobsTriggered: number;
  quarantineCount: number;
  amendmentCount: number;
  stale: boolean;
  receivedAt: string | null;
  collectorId: string | null;
}): ReliabilityView {
  const { runtime } = options;
  const ready =
    runtime.mode === "mock" ||
    (runtime.collectorConfigured && runtime.targetConfigured);
  return {
    modeChip: resolveModeChip(runtime, options.usingFixtureAdapter),
    dataLabel: resolveDataLabel(runtime, options.usingFixtureAdapter),
    ready,
    issues: [...runtime.configurationIssues],
    collectorIdRedacted: redactCollectorId(options.collectorId),
    jobsTriggered: options.jobsTriggered,
    evidenceCount: options.quarantineCount + options.amendmentCount,
    quarantineCount: options.quarantineCount,
    amendmentCount: options.amendmentCount,
    stale: options.stale,
    receivedAt: options.receivedAt,
    liveMutationsEnabled: runtime.liveMutationsEnabled,
  };
}

// ---------------------------------------------------------------------------
// Change / healing copy
// ---------------------------------------------------------------------------

export function describeHealing(state: HealingState): string {
  switch (state) {
    case "healthy":
      return "Baseline verified against the frozen contract.";
    case "quarantined":
      return "Broken extraction quarantined. Last verified card protected.";
    case "healing_requested":
      return "Same-collector repair requested.";
    case "awaiting_approval":
      return "Repair preview fetched. Awaiting contract validation.";
    case "preview_valid":
      return "Preview passed schema and count canaries. Ready for approval.";
    case "preview_invalid":
      return "Preview failed validation. Approval blocked.";
    case "approved":
      return "Approved. Collector rerun in progress.";
    case "recovered":
      return "Verified recovery. Card re-materialized from clean extraction.";
    case "recovery_failed":
      return "Recovery failed safely. The verified card is still protected.";
    default:
      return `Pipeline state: ${state}`;
  }
}

export function healingTone(state: HealingState): TimelineEntry["tone"] {
  if (["healthy", "recovered", "preview_valid"].includes(state)) return "good";
  if (["preview_invalid", "recovery_failed", "rejected"].includes(state))
    return "bad";
  if (["quarantined"].includes(state)) return "warn";
  return "info";
}

interface StatChangeLike {
  kind: string;
  before?: number | string | null;
  after?: number | string | null;
  yellowBefore?: number;
  yellowAfter?: number;
  redBefore?: number;
  redAfter?: number;
  field?: string;
}

/** Human-readable copy for one typed stat change on a verified record. */
export function describeStatChange(change: StatChangeLike): string | null {
  const labelFor = (kind: string): string =>
    kind === "minutes"
      ? "Minutes played"
      : kind.charAt(0).toUpperCase() + kind.slice(1);
  switch (change.kind) {
    case "goals":
    case "assists":
    case "appearances":
    case "minutes":
      return `${labelFor(change.kind)} moved ${change.before} → ${change.after}.`;
    case "discipline":
      return `Discipline updated: yellows ${change.yellowBefore}→${change.yellowAfter}, reds ${change.redBefore}→${change.redAfter}.`;
    case "profile":
      return `Profile field ${change.field} changed ${formatValue(change.before)} → ${formatValue(change.after)}.`;
    case "standing":
      return `Table ${change.field} moved ${formatValue(change.before)} → ${formatValue(change.after)}.`;
    default:
      return null;
  }
}

function formatValue(value: number | string | null | undefined): string {
  return value === null || value === undefined || value === ""
    ? "—"
    : String(value);
}
