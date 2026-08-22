// CardPulse Football domain model.
//
// These types are intentionally structural rather than imported from the
// backend contracts package. Only `src/data-client.ts` may know about
// `@bidsentinel/contracts`; this layer survives backend renames as long as
// runtime payloads keep their shape.

export type DataModeLabel = "DEMO DATA" | "LIVE PROVIDER";

export type ModeChip = "MOCK PIPELINE" | "LOCAL API" | "LIVE PROVIDER";

/** Contract positions, mirrored structurally. */
export type ContractPosition =
  "goalkeeper" | "defender" | "midfielder" | "forward";

export type FormMark = "W" | "D" | "L";

export interface AttributeLine {
  label: string;
  /** Real stat value from the verified record. */
  value: number;
  /** Bar width percentage, precomputed by the mapping layer. */
  pct: number;
}

export interface CardProvenance {
  sourceId: string;
  entityId: string;
  snapshotId: string;
  snapshotVersion: number;
  verifiedAt: string | null;
  signature: string;
  collectorIdRedacted: string;
}

export interface PlayerCardView {
  id: string;
  playerName: string;
  position: ContractPosition;
  positionDisplay: string;
  shirtNumber: number | null;
  nationality: string | null;
  clubName: string;
  clubCode: string;
  serialNumber: string;
  seasonLabel: string;
  attributes: AttributeLine[];
  form: FormMark[];
  provenance: CardProvenance;
}

export type ClubHealthState =
  "healthy" | "degraded" | "quarantined" | "recovering";

export interface ClubIntegrityView {
  sourceId: string;
  clubName: string;
  clubCode: string;
  state: ClubHealthState;
  checkedAt: string | null;
  lastSuccessfulAt: string | null;
  consecutiveFailures: number;
  recentFailureRate: number;
  incidentReason: string | null;
  incidentDetail: string | null;
  recoveryActions: string[];
}

export interface TeamCardView {
  teamId: string;
  name: string;
  shortName: string | null;
  city: string | null;
  stadium: string | null;
  coach: string | null;
  founded: number | null;
  snapshotVersion: number;
  observedAt: string | null;
  state: ClubHealthState | null;
}

export interface StandingRowView {
  /** Stable ordering key (provider team id or simulated club code). */
  key: string;
  clubName: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDiff: number;
  points: number;
  rank: number | null;
  isHeroClub: boolean;
}

export interface TimelineEntry {
  time: string | null;
  title: string;
  detail: string;
  tone: "good" | "warn" | "bad" | "info";
}

export interface ReliabilityView {
  modeChip: ModeChip;
  dataLabel: DataModeLabel;
  ready: boolean;
  issues: string[];
  collectorIdRedacted: string;
  jobsTriggered: number;
  evidenceCount: number;
  quarantineCount: number;
  amendmentCount: number;
  stale: boolean;
  receivedAt: string | null;
  liveMutationsEnabled: boolean;
}
