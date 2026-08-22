import type {
  ApiErrorResponse,
  ApiHealthResponse,
  ChangeEventListResponse,
  FootballChangeEvent,
  FootballRecord,
  FootballSnapshot,
  Pagination,
  PlayerCard,
  PlayerDetail,
  PlayerDetailResponse,
  PlayerListResponse,
  PlayerSummary,
  QuarantineListResponse,
  QuarantinedExtraction,
  RecoveryEvidence,
  RecoveryEvidenceResponse,
  SourceHealth,
  SourceHealthListResponse,
  StandingsListResponse,
  StandingEntry,
  TeamDetailResponse,
  TeamListResponse,
  TeamSummaryRecord,
} from "./index.js";

/**
 * Deterministic OpenLigaDB-inspired demo data for CardPulse Football.
 * Clubs, players, and URLs are fictional and clearly labelled demo data;
 * no copyrighted crests or photos are used anywhere.
 */

export const demoSourceId = "openligadb";
export const demoCompetition = "bl1-demo";
export const demoSeason = "2025";

const baselineObservedAt = "2026-08-20T14:00:00.000Z";
const amendedObservedAt = "2026-08-21T14:00:00.000Z";
const sourceBase = "https://data.football-demo.test/openligadb";

function playerUrl(externalId: string): string {
  return `${sourceBase}/players/${externalId}`;
}

export const validPlayerFixtures: PlayerCard[] = [
  {
    schemaVersion: 1,
    entityType: "player",
    playerId: "openligadb:player:finn-krueger",
    sourceId: demoSourceId,
    externalId: "player-finn-krueger",
    playerName: "Finn Krüger",
    team: { teamId: "openligadb:rheinland-fc-04", name: "Rheinland FC 04" },
    position: "forward",
    shirtNumber: 11,
    nationality: "Germany",
    season: demoSeason,
    stats: {
      appearances: 33,
      goals: 18,
      assists: 5,
      yellowCards: 3,
      redCards: 0,
      minutesPlayed: 2820,
    },
    sourceUrl: playerUrl("player-finn-krueger"),
    observedAt: baselineObservedAt,
  },
  {
    schemaVersion: 1,
    entityType: "player",
    playerId: "openligadb:player:milan-horvat",
    sourceId: demoSourceId,
    externalId: "player-milan-horvat",
    playerName: "Milan Horvat",
    team: { teamId: "openligadb:adlersberg-03", name: "FC Adlersberg 03" },
    position: "midfielder",
    shirtNumber: 8,
    nationality: "Croatia",
    season: demoSeason,
    stats: {
      appearances: 32,
      goals: 9,
      assists: 12,
      yellowCards: 5,
      redCards: 0,
      minutesPlayed: 2705,
    },
    sourceUrl: playerUrl("player-milan-horvat"),
    observedAt: baselineObservedAt,
  },
  {
    schemaVersion: 1,
    entityType: "player",
    playerId: "openligadb:player:jonas-brandt",
    sourceId: demoSourceId,
    externalId: "player-jonas-brandt",
    playerName: "Jonas Brandt",
    team: {
      teamId: "openligadb:nordstern-nordhafen",
      name: "SV Nordstern Nordhafen",
    },
    position: "forward",
    shirtNumber: 10,
    nationality: "Germany",
    season: demoSeason,
    stats: {
      appearances: 31,
      goals: 14,
      assists: 7,
      yellowCards: 2,
      redCards: 0,
      minutesPlayed: 2544,
    },
    sourceUrl: playerUrl("player-jonas-brandt"),
    observedAt: baselineObservedAt,
  },
];

/** The striker whose goal tally moves in the amended demo step. */
export const trackedPlayerId =
  validPlayerFixtures[0]?.playerId ?? "openligadb:player:finn-krueger";

export const amendedPlayerFixture: PlayerCard = {
  ...(validPlayerFixtures[0] as PlayerCard),
  observedAt: amendedObservedAt,
  stats: {
    appearances: 34,
    goals: 21,
    assists: 5,
    yellowCards: 3,
    redCards: 0,
    minutesPlayed: 2910,
  },
};

export const validTeamFixtures: TeamSummaryRecord[] = [
  {
    schemaVersion: 1,
    entityType: "team",
    teamId: "openligadb:rheinland-fc-04",
    sourceId: demoSourceId,
    externalId: "rheinland-fc-04",
    name: "Rheinland FC 04",
    shortName: "Rheinland",
    country: "DE",
    city: "Rheinstadt",
    stadium: "Stadion am Rheindamm",
    founded: 1904,
    coach: "M. Falkner",
    sourceUrl: `${sourceBase}/teams/rheinland-fc-04`,
    observedAt: baselineObservedAt,
  },
  {
    schemaVersion: 1,
    entityType: "team",
    teamId: "openligadb:adlersberg-03",
    sourceId: demoSourceId,
    externalId: "adlersberg-03",
    name: "FC Adlersberg 03",
    shortName: "Adlersberg",
    country: "DE",
    city: "Adlersberg",
    stadium: "Adlerpark",
    founded: 1903,
    coach: "S. Kovač",
    sourceUrl: `${sourceBase}/teams/adlersberg-03`,
    observedAt: baselineObservedAt,
  },
  {
    schemaVersion: 1,
    entityType: "team",
    teamId: "openligadb:nordstern-nordhafen",
    sourceId: demoSourceId,
    externalId: "nordstern-nordhafen",
    name: "SV Nordstern Nordhafen",
    shortName: "Nordstern",
    country: "DE",
    city: "Nordhafen",
    stadium: "Hafenring",
    founded: 1899,
    coach: "T. Brenner",
    sourceUrl: `${sourceBase}/teams/nordstern-nordhafen`,
    observedAt: baselineObservedAt,
  },
];

function standing(
  teamSlug: string,
  teamName: string,
  rank: number,
  won: number,
  drawn: number,
  lost: number,
  goalsFor: number,
  goalsAgainst: number,
  points: number,
): StandingEntry {
  return {
    schemaVersion: 1,
    entityType: "standing",
    sourceId: demoSourceId,
    externalId: `${demoCompetition}:${demoSeason}:${teamSlug}`,
    competition: demoCompetition,
    season: demoSeason,
    teamId: `openligadb:${teamSlug}`,
    teamName,
    rank,
    played: won + drawn + lost,
    won,
    drawn,
    lost,
    goalsFor,
    goalsAgainst,
    points,
    sourceUrl: `${sourceBase}/tables/${demoCompetition}/${demoSeason}`,
    observedAt: baselineObservedAt,
  };
}

export const validStandingFixtures: StandingEntry[] = [
  standing("rheinland-fc-04", "Rheinland FC 04", 1, 24, 7, 3, 71, 32, 79),
  standing("adlersberg-03", "FC Adlersberg 03", 2, 22, 8, 4, 66, 35, 74),
  standing(
    "nordstern-nordhafen",
    "SV Nordstern Nordhafen",
    3,
    19,
    9,
    6,
    60,
    38,
    66,
  ),
];

export const validPlayerFixture: PlayerCard = validPlayerFixtures[0]
  ? structuredClone(validPlayerFixtures[0])
  : ({} as PlayerCard);

/** Full deterministic extraction batch used by the demo collection cycle. */
export function demoRecordsFor(mode: "valid" | "amended"): FootballRecord[] {
  if (mode === "amended") {
    return [
      amendedPlayerFixture,
      ...validPlayerFixtures.slice(1),
      ...validTeamFixtures,
      ...validStandingFixtures,
    ];
  }
  return [
    ...validPlayerFixtures,
    ...validTeamFixtures,
    ...validStandingFixtures,
  ];
}

export const validRecoveryEvidenceFixture = {
  schemaVersion: 1,
  recoveryEvidenceId: "a75cb389-875d-4d1a-9df3-8cc2ebd98f89",
  incidentId: "ec1ef7d9-f67c-45ab-b4a9-dfcf406564d2",
  sourceId: demoSourceId,
  strategy: "next-poll-revalidation",
  startedAt: "2026-08-21T14:05:00.000Z",
  completedAt: "2026-08-21T14:10:00.000Z",
  outcome: "recovered",
  actions: ["Accepted a schema-valid payload on the next scheduled poll"],
  verification: {
    validRecordCount: 1,
    quarantinedCount: 1,
    sampleEntityIds: [trackedPlayerId],
    payloadHashes: ["a".repeat(64)],
  },
} satisfies RecoveryEvidence;

export const recoveryEvidenceFixture = validRecoveryEvidenceFixture;

export const validSourceHealthFixture = {
  schemaVersion: 1,
  sourceId: demoSourceId,
  state: "healthy",
  checkedAt: "2026-08-21T14:10:00.000Z",
  lastSuccessfulAt: "2026-08-21T14:10:00.000Z",
  consecutiveFailures: 0,
  recentFailureRate: 0.1,
  activeIncident: null,
  latestRecoveryEvidence: validRecoveryEvidenceFixture,
} satisfies SourceHealth;

export const validPlayerSnapshotFixture = {
  schemaVersion: 1,
  snapshotId: "7b4b518c-24a6-423b-b083-5e53e46f9082",
  entityId: validPlayerFixture.playerId,
  entityType: "player",
  sourceId: validPlayerFixture.sourceId,
  version: 1,
  observedAt: validPlayerFixture.observedAt,
  payloadHash: "b".repeat(64),
  record: validPlayerFixture,
} satisfies FootballSnapshot;

export const validPlayerSummaryFixture = {
  schemaVersion: 1,
  playerId: validPlayerFixture.playerId,
  sourceId: validPlayerFixture.sourceId,
  playerName: validPlayerFixture.playerName,
  team: validPlayerFixture.team,
  position: validPlayerFixture.position,
  shirtNumber: validPlayerFixture.shirtNumber,
  season: validPlayerFixture.season,
  stats: validPlayerFixture.stats,
  observedAt: validPlayerFixture.observedAt,
  latestSnapshot: {
    snapshotId: validPlayerSnapshotFixture.snapshotId,
    version: validPlayerSnapshotFixture.version,
  },
} satisfies PlayerSummary;

export const validPlayerDetailFixture = {
  ...validPlayerFixture,
  latestSnapshot: {
    snapshotId: validPlayerSnapshotFixture.snapshotId,
    version: validPlayerSnapshotFixture.version,
    payloadHash: validPlayerSnapshotFixture.payloadHash,
  },
} satisfies PlayerDetail;

export const validChangeEventFixture = {
  schemaVersion: 1,
  changeEventId: "8ebbd601-b247-44e8-89ee-928164ebfad9",
  entityId: trackedPlayerId,
  entityType: "player",
  sourceId: demoSourceId,
  fromSnapshotId: validPlayerSnapshotFixture.snapshotId,
  toSnapshotId: "56f00f0d-f6f1-47a3-8693-1578423dc6b1",
  detectedAt: "2026-08-21T14:00:00.000Z",
  changes: [
    { kind: "appearances", before: 33, after: 34 },
    { kind: "goals", before: 18, after: 21 },
    { kind: "minutes", before: 2820, after: 2910 },
  ],
} satisfies FootballChangeEvent;

export const validQuarantinedExtractionFixture = {
  schemaVersion: 1,
  quarantineId: "0db38b22-1595-4e1d-b66c-58aebf5ca387",
  sourceId: demoSourceId,
  extractorVersion: "fixture-v1",
  observedAt: "2026-08-20T14:05:00.000Z",
  payloadHash: "c".repeat(64),
  rawPayload: {
    ...validPlayerFixture,
    stats: { ...validPlayerFixture.stats, goals: "eighteen" },
  },
  issues: [
    {
      code: "invalid_type",
      path: ["stats", "goals"],
      message: "Expected number, received string",
    },
  ],
} satisfies QuarantinedExtraction;

export const firstPagePaginationFixture = {
  limit: 50,
  offset: 0,
  total: 1,
  hasMore: false,
} satisfies Pagination;

export const emptyPaginationFixture = {
  limit: 50,
  offset: 0,
  total: 0,
  hasMore: false,
} satisfies Pagination;

const responseGeneratedAt = "2026-08-21T14:15:00.000Z";

export const validApiHealthResponseFixture = {
  data: {
    schemaVersion: 1,
    service: "cardpulse-api",
    status: "ok",
  },
  generatedAt: responseGeneratedAt,
} satisfies ApiHealthResponse;

export const validPlayerListResponseFixture = {
  data: [validPlayerSummaryFixture],
  pagination: firstPagePaginationFixture,
  generatedAt: responseGeneratedAt,
} satisfies PlayerListResponse;

export const emptyPlayerListResponseFixture = {
  data: [],
  pagination: emptyPaginationFixture,
  generatedAt: responseGeneratedAt,
} satisfies PlayerListResponse;

export const validPlayerDetailResponseFixture = {
  data: validPlayerDetailFixture,
  generatedAt: responseGeneratedAt,
} satisfies PlayerDetailResponse;

export const validTeamListResponseFixture = {
  data: [
    {
      ...(validTeamFixtures[0] as TeamSummaryRecord),
      latestSnapshot: {
        snapshotId: validPlayerSnapshotFixture.snapshotId,
        version: 1,
      },
    },
  ],
  pagination: firstPagePaginationFixture,
  generatedAt: responseGeneratedAt,
} satisfies TeamListResponse;

export const emptyTeamListResponseFixture = {
  data: [],
  pagination: emptyPaginationFixture,
  generatedAt: responseGeneratedAt,
} satisfies TeamListResponse;

export const validStandingsListResponseFixture = {
  data: [
    {
      ...(validStandingFixtures[0] as StandingEntry),
      latestSnapshot: {
        snapshotId: validPlayerSnapshotFixture.snapshotId,
        version: 1,
      },
    },
  ],
  pagination: firstPagePaginationFixture,
  generatedAt: responseGeneratedAt,
} satisfies StandingsListResponse;

export const emptyStandingsListResponseFixture = {
  data: [],
  pagination: emptyPaginationFixture,
  generatedAt: responseGeneratedAt,
} satisfies StandingsListResponse;

export const validChangeEventListResponseFixture = {
  data: [validChangeEventFixture],
  pagination: firstPagePaginationFixture,
  generatedAt: responseGeneratedAt,
} satisfies ChangeEventListResponse;

export const emptyChangeEventListResponseFixture = {
  data: [],
  pagination: emptyPaginationFixture,
  generatedAt: responseGeneratedAt,
} satisfies ChangeEventListResponse;

export const validSourceHealthListResponseFixture = {
  data: [validSourceHealthFixture],
  pagination: firstPagePaginationFixture,
  generatedAt: responseGeneratedAt,
} satisfies SourceHealthListResponse;

export const emptySourceHealthListResponseFixture = {
  data: [],
  pagination: emptyPaginationFixture,
  generatedAt: responseGeneratedAt,
} satisfies SourceHealthListResponse;

export const validQuarantineListResponseFixture = {
  data: [validQuarantinedExtractionFixture],
  pagination: firstPagePaginationFixture,
  generatedAt: responseGeneratedAt,
} satisfies QuarantineListResponse;

export const emptyQuarantineListResponseFixture = {
  data: [],
  pagination: emptyPaginationFixture,
  generatedAt: responseGeneratedAt,
} satisfies QuarantineListResponse;

export const validRecoveryEvidenceResponseFixture = {
  data: validRecoveryEvidenceFixture,
  generatedAt: responseGeneratedAt,
} satisfies RecoveryEvidenceResponse;

export const validTeamDetailResponseFixture = {
  data: {
    ...(validTeamFixtures[0] as TeamSummaryRecord),
    latestSnapshot: {
      snapshotId: validPlayerSnapshotFixture.snapshotId,
      version: 1,
      payloadHash: "d".repeat(64),
    },
  },
  generatedAt: responseGeneratedAt,
} satisfies TeamDetailResponse;

export const validApiErrorResponseFixture = {
  error: {
    code: "not_found",
    status: 404,
    message: "Player openligadb:missing was not found",
    requestId: "req-01k32nq4xdmkhkdxj8c86v9a8w",
    details: [],
  },
  generatedAt: responseGeneratedAt,
} satisfies ApiErrorResponse;
