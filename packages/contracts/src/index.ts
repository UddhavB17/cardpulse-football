import { z } from "zod";

export const SCHEMA_VERSION = 1 as const;

export const IsoDateTimeSchema = z
  .string()
  .datetime({ offset: true })
  .describe("ISO 8601 timestamp with an explicit timezone offset");

export const SourceIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9][a-z0-9._-]*$/);

/** Bright Data collector IDs are first-class and always start with c_. */
export const CollectorIdSchema = z
  .string()
  .trim()
  .regex(/^c_[A-Za-z0-9_-]+$/, "A Bright Data collector ID must start with c_");

export const SeasonSchema = z
  .string()
  .trim()
  .regex(/^\d{4}$/, "Season must be a four digit starting year such as 2025");

export const PositionSchema = z.enum([
  "goalkeeper",
  "defender",
  "midfielder",
  "forward",
]);

const TeamRefSchema = z
  .object({
    teamId: z.string().trim().min(1).max(120),
    name: z.string().trim().min(1).max(200),
  })
  .strict();

const PlayerStatsSchema = z
  .object({
    appearances: z.number().int().nonnegative().max(200),
    goals: z.number().int().nonnegative().max(500),
    assists: z.number().int().nonnegative().max(500),
    yellowCards: z.number().int().nonnegative().max(200),
    redCards: z.number().int().nonnegative().max(50),
    // Some public leaderboards publish the core stat line without minutes.
    // Keep the field explicit and nullable so "unavailable" is never
    // misrepresented as zero.
    minutesPlayed: z.number().int().nonnegative().max(100_000).nullable(),
  })
  .strict();

export const PlayerCardSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    entityType: z.literal("player"),
    playerId: z.string().trim().min(1).max(250),
    sourceId: SourceIdSchema,
    externalId: z.string().trim().min(1).max(200),
    playerName: z.string().trim().min(1).max(200),
    team: TeamRefSchema,
    position: PositionSchema,
    shirtNumber: z.number().int().min(1).max(99).nullable(),
    nationality: z.string().trim().min(1).max(80).nullable(),
    season: SeasonSchema,
    stats: PlayerStatsSchema,
    sourceUrl: z.string().url(),
    observedAt: IsoDateTimeSchema,
  })
  .strict();

export const TeamSummaryRecordSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    entityType: z.literal("team"),
    teamId: z.string().trim().min(1).max(250),
    sourceId: SourceIdSchema,
    externalId: z.string().trim().min(1).max(200),
    name: z.string().trim().min(1).max(200),
    shortName: z.string().trim().min(1).max(60).nullable(),
    country: z
      .string()
      .regex(/^[A-Z]{2}$/)
      .nullable(),
    city: z.string().trim().min(1).max(120).nullable(),
    stadium: z.string().trim().min(1).max(160).nullable(),
    founded: z.number().int().min(1850).max(2100).nullable(),
    coach: z.string().trim().min(1).max(160).nullable(),
    sourceUrl: z.string().url(),
    observedAt: IsoDateTimeSchema,
  })
  .strict();

export const StandingEntrySchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    entityType: z.literal("standing"),
    sourceId: SourceIdSchema,
    externalId: z.string().trim().min(1).max(200),
    competition: z.string().trim().min(1).max(120),
    season: SeasonSchema,
    teamId: z.string().trim().min(1).max(250),
    teamName: z.string().trim().min(1).max(200),
    rank: z.number().int().min(1).max(40),
    played: z.number().int().nonnegative().max(200),
    won: z.number().int().nonnegative().max(200),
    drawn: z.number().int().nonnegative().max(200),
    lost: z.number().int().nonnegative().max(200),
    goalsFor: z.number().int().nonnegative().max(999),
    goalsAgainst: z.number().int().nonnegative().max(999),
    points: z.number().int().nonnegative().max(999),
    sourceUrl: z.string().url(),
    observedAt: IsoDateTimeSchema,
  })
  .strict();

function standingConsistencyIssues(
  record: FootballRecordBase,
  context: z.RefinementCtx,
): void {
  if (record.entityType !== "standing") {
    return;
  }

  if (record.won + record.drawn + record.lost !== record.played) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "won, drawn, and lost must add up to played",
      path: ["played"],
    });
  }

  if (record.points !== record.won * 3 + record.drawn) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "points must equal won * 3 + drawn",
      path: ["points"],
    });
  }
}

const FootballRecordBaseSchema = z.discriminatedUnion("entityType", [
  PlayerCardSchema,
  TeamSummaryRecordSchema,
  StandingEntrySchema,
]);

/**
 * Parsed form of any extracted football record. Standings additionally carry
 * arithmetic consistency guarantees enforced here so downstream consumers can
 * trust won/drawn/lost/points without recomputing them.
 */
export const FootballRecordSchema = FootballRecordBaseSchema.superRefine(
  standingConsistencyIssues,
);

type FootballRecordBase = z.infer<typeof FootballRecordBaseSchema>;

export type FootballEntityType = FootballRecord["entityType"];

/** Canonical stable identity of an extracted record inside one source. */
export function entityIdOf(record: FootballRecord): string {
  switch (record.entityType) {
    case "player":
      return record.playerId;
    case "team":
      return record.teamId;
    case "standing":
      return `${record.competition}:${record.season}:${record.teamId}`;
  }
}

export const FootballSnapshotSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    snapshotId: z.string().uuid(),
    entityId: z.string().trim().min(1).max(400),
    entityType: z.enum(["player", "team", "standing"]),
    sourceId: SourceIdSchema,
    version: z.number().int().positive(),
    observedAt: IsoDateTimeSchema,
    payloadHash: z.string().regex(/^[a-f0-9]{64}$/),
    record: FootballRecordSchema,
  })
  .strict()
  .superRefine((snapshot, context) => {
    if (snapshot.entityId !== entityIdOf(snapshot.record)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Snapshot and record entity IDs must match",
        path: ["entityId"],
      });
    }

    if (snapshot.sourceId !== snapshot.record.sourceId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Snapshot and record source IDs must match",
        path: ["sourceId"],
      });
    }
  });

const NumericStatChangeSchema = z
  .object({
    kind: z.enum(["goals", "assists", "appearances", "minutes"]),
    before: z.number().int(),
    after: z.number().int(),
  })
  .strict();

const DisciplineChangeSchema = z
  .object({
    kind: z.literal("discipline"),
    yellowBefore: z.number().int(),
    yellowAfter: z.number().int(),
    redBefore: z.number().int(),
    redAfter: z.number().int(),
  })
  .strict();

const ProfileChangeFieldSchema = z.enum([
  "playerName",
  "team",
  "position",
  "shirtNumber",
  "nationality",
  "name",
  "shortName",
  "country",
  "city",
  "stadium",
  "founded",
  "coach",
]);

const ProfileChangeSchema = z
  .object({
    kind: z.literal("profile"),
    field: ProfileChangeFieldSchema,
    before: z.union([z.string(), z.number()]).nullable(),
    after: z.union([z.string(), z.number()]).nullable(),
  })
  .strict();

const StandingChangeFieldSchema = z.enum([
  "rank",
  "points",
  "played",
  "won",
  "drawn",
  "lost",
  "goalsFor",
  "goalsAgainst",
  "teamName",
]);

const StandingChangeSchema = z
  .object({
    kind: z.literal("standing"),
    field: StandingChangeFieldSchema,
    before: z.union([z.string(), z.number()]).nullable(),
    after: z.union([z.string(), z.number()]).nullable(),
  })
  .strict();

export const StatChangeSchema = z.discriminatedUnion("kind", [
  NumericStatChangeSchema,
  DisciplineChangeSchema,
  ProfileChangeSchema,
  StandingChangeSchema,
]);

export const FootballChangeEventSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    changeEventId: z.string().uuid(),
    entityId: z.string().trim().min(1).max(400),
    entityType: z.enum(["player", "team", "standing"]),
    sourceId: SourceIdSchema,
    fromSnapshotId: z.string().uuid(),
    toSnapshotId: z.string().uuid(),
    detectedAt: IsoDateTimeSchema,
    changes: z.array(StatChangeSchema).min(1),
  })
  .strict();

export const SourceIncidentReasonSchema = z.enum([
  "invalid-extraction",
  "network-error",
  "rate-limited",
  "schema-drift",
  "unknown",
]);

export const RecoveryStrategySchema = z.enum([
  "next-poll-revalidation",
  "retry-with-backoff",
  "alternate-parser",
  "manual-intervention",
]);

export const RecoveryEvidenceSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    recoveryEvidenceId: z.string().uuid(),
    incidentId: z.string().uuid(),
    sourceId: SourceIdSchema,
    strategy: RecoveryStrategySchema,
    startedAt: IsoDateTimeSchema,
    completedAt: IsoDateTimeSchema,
    outcome: z.enum(["recovered", "failed"]),
    actions: z.array(z.string().trim().min(1).max(500)).min(1),
    verification: z
      .object({
        validRecordCount: z.number().int().nonnegative(),
        quarantinedCount: z.number().int().nonnegative(),
        sampleEntityIds: z.array(z.string().trim().min(1).max(400)).max(20),
        payloadHashes: z.array(z.string().regex(/^[a-f0-9]{64}$/)).max(20),
      })
      .strict(),
  })
  .strict()
  .superRefine((evidence, context) => {
    if (Date.parse(evidence.completedAt) < Date.parse(evidence.startedAt)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Recovery cannot complete before it starts",
        path: ["completedAt"],
      });
    }
  });

export const SourceHealthStateSchema = z.enum([
  "healthy",
  "degraded",
  "quarantined",
  "recovering",
]);

export const SourceHealthSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    sourceId: SourceIdSchema,
    state: SourceHealthStateSchema,
    checkedAt: IsoDateTimeSchema,
    lastSuccessfulAt: IsoDateTimeSchema.nullable(),
    consecutiveFailures: z.number().int().nonnegative(),
    recentFailureRate: z.number().min(0).max(1),
    activeIncident: z
      .object({
        incidentId: z.string().uuid(),
        openedAt: IsoDateTimeSchema,
        reason: SourceIncidentReasonSchema,
        detail: z.string().trim().min(1).max(2_000),
      })
      .strict()
      .nullable(),
    latestRecoveryEvidence: RecoveryEvidenceSchema.nullable(),
  })
  .strict()
  .superRefine((health, context) => {
    if (health.state === "healthy" && health.activeIncident !== null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A healthy source cannot have an active incident",
        path: ["activeIncident"],
      });
    }

    if (health.state !== "healthy" && health.activeIncident === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "An unhealthy source must reference an active incident",
        path: ["activeIncident"],
      });
    }
  });

export const QuarantinedExtractionSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    quarantineId: z.string().uuid(),
    sourceId: SourceIdSchema,
    extractorVersion: z.string().trim().min(1).max(100),
    observedAt: IsoDateTimeSchema,
    payloadHash: z.string().regex(/^[a-f0-9]{64}$/),
    rawPayload: z.unknown(),
    issues: z
      .array(
        z
          .object({
            code: z.string().trim().min(1),
            path: z.array(z.union([z.string(), z.number().int()])),
            message: z.string().trim().min(1),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

export const SnapshotSourceHealthSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    sourceId: SourceIdSchema,
    state: z.enum(["healthy", "degraded", "quarantined", "recovering"]),
    checkedAt: IsoDateTimeSchema,
    previousRecordCount: z.number().int().nonnegative(),
    currentRecordCount: z.number().int().nonnegative(),
    consecutiveEmptyResults: z.number().int().nonnegative(),
    consecutiveAbsences: z.number().int().nonnegative(),
  })
  .strict();

const SemanticEvidenceFactScalarSchema = z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);

const SemanticEvidenceFactSchema = z.union([
  SemanticEvidenceFactScalarSchema,
  z.array(SemanticEvidenceFactScalarSchema),
]);

export const SemanticDiffEvidenceSchema = z
  .object({
    engineVersion: z.literal("semantic-diff-v1"),
    rule: z.enum([
      "first_verified_snapshot",
      "field_value_changed",
      "confirmed_entity_absence",
      "semantic_state_unchanged",
      "absence_unconfirmed",
      "no_baseline_or_current",
      "snapshot_rejected",
    ]),
    sourceId: SourceIdSchema,
    observedAt: IsoDateTimeSchema,
    previousSnapshotId: z.string().uuid().nullable(),
    currentSnapshotId: z.string().uuid().nullable(),
    facts: z.record(SemanticEvidenceFactSchema),
  })
  .strict();

export const SemanticDiffIssueSchema = z
  .object({
    code: z.string().trim().min(1).max(100),
    path: z.array(z.union([z.string(), z.number().int()])),
    message: z.string().trim().min(1).max(2_000),
  })
  .strict();

const SemanticEntityIdSchema = z.string().trim().min(1).max(400);

const NewRecordSemanticEventSchema = z
  .object({
    kind: z.literal("new_record"),
    entityId: SemanticEntityIdSchema,
    entityType: z.enum(["player", "team", "standing"]),
    evidence: SemanticDiffEvidenceSchema,
  })
  .strict();

const FieldChangedSemanticEventSchema = z
  .object({
    kind: z.literal("field_changed"),
    entityId: SemanticEntityIdSchema,
    entityType: z.enum(["player", "team", "standing"]),
    field: z.string().trim().min(1).max(80),
    before: SemanticEvidenceFactScalarSchema,
    after: SemanticEvidenceFactScalarSchema,
    evidence: SemanticDiffEvidenceSchema,
  })
  .strict();

const EntityRemovedSemanticEventSchema = z
  .object({
    kind: z.literal("entity_removed"),
    entityId: SemanticEntityIdSchema,
    entityType: z.enum(["player", "team", "standing"]),
    evidence: SemanticDiffEvidenceSchema,
  })
  .strict();

const NoChangeSemanticEventSchema = z
  .object({
    kind: z.literal("no_change"),
    entityId: SemanticEntityIdSchema.nullable(),
    reason: z.enum([
      "semantic_state_unchanged",
      "absence_unconfirmed",
      "no_baseline_or_current",
    ]),
    evidence: SemanticDiffEvidenceSchema,
  })
  .strict();

const InvalidSnapshotSemanticEventSchema = z
  .object({
    kind: z.literal("invalid_snapshot"),
    entityId: SemanticEntityIdSchema.nullable(),
    issues: z.array(SemanticDiffIssueSchema).min(1),
    evidence: SemanticDiffEvidenceSchema,
  })
  .strict();

export const SemanticDiffEventSchema = z.discriminatedUnion("kind", [
  NewRecordSemanticEventSchema,
  FieldChangedSemanticEventSchema,
  EntityRemovedSemanticEventSchema,
  NoChangeSemanticEventSchema,
  InvalidSnapshotSemanticEventSchema,
]);

export const SemanticDiffResultSchema = z
  .object({
    decision: z.enum(["accept_current", "retain_previous", "mark_removed"]),
    lastVerifiedSnapshot: FootballSnapshotSchema.nullable(),
    events: z.array(SemanticDiffEventSchema).min(1),
  })
  .strict()
  .superRefine((result, context) => {
    if (
      result.decision === "accept_current" &&
      result.lastVerifiedSnapshot === null
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Accepting the current snapshot requires a verified snapshot",
        path: ["lastVerifiedSnapshot"],
      });
    }

    if (
      result.decision === "mark_removed" &&
      !result.events.some((event) => event.kind === "entity_removed")
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A removal decision requires entity_removed evidence",
        path: ["events"],
      });
    }

    if (
      result.events.some((event) => event.kind === "invalid_snapshot") &&
      result.decision !== "retain_previous"
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Invalid snapshots must retain the previous verified snapshot",
        path: ["decision"],
      });
    }
  });

export const ApiHealthResponseSchema = z
  .object({
    data: z
      .object({
        schemaVersion: z.literal(SCHEMA_VERSION),
        service: z.literal("cardpulse-api"),
        status: z.literal("ok"),
      })
      .strict(),
    generatedAt: IsoDateTimeSchema,
  })
  .strict();

export const RuntimeStatusSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    service: z.literal("cardpulse-api"),
    domain: z.literal("football"),
    mode: z.enum(["mock", "live"]),
    sourceId: SourceIdSchema,
    collectorConfigured: z.boolean(),
    targetConfigured: z.boolean(),
    liveMutationsEnabled: z.boolean(),
    configurationIssues: z.array(z.string().trim().min(1)),
  })
  .strict();

export const RuntimeStatusResponseSchema = z
  .object({
    data: RuntimeStatusSchema,
    generatedAt: IsoDateTimeSchema,
  })
  .strict();

export const PaginationSchema = z
  .object({
    limit: z.number().int().min(1).max(100),
    offset: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
    hasMore: z.boolean(),
  })
  .strict();

const SummarySnapshotSchema = z
  .object({
    snapshotId: z.string().uuid(),
    version: z.number().int().positive(),
  })
  .strict();

const DetailSnapshotSchema = SummarySnapshotSchema.extend({
  payloadHash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

export const PlayerSummarySchema = PlayerCardSchema.pick({
  schemaVersion: true,
  playerId: true,
  sourceId: true,
  playerName: true,
  team: true,
  position: true,
  shirtNumber: true,
  season: true,
  stats: true,
  observedAt: true,
})
  .extend({
    latestSnapshot: SummarySnapshotSchema,
  })
  .strict();

export const PlayerDetailSchema = PlayerCardSchema.extend({
  latestSnapshot: DetailSnapshotSchema,
}).strict();

export const TeamListItemSchema = TeamSummaryRecordSchema.extend({
  latestSnapshot: SummarySnapshotSchema,
}).strict();

export const TeamDetailSchema = TeamSummaryRecordSchema.extend({
  latestSnapshot: DetailSnapshotSchema,
}).strict();

export const StandingsListItemSchema = StandingEntrySchema.extend({
  latestSnapshot: SummarySnapshotSchema,
}).strict();

function createListResponseSchema<ItemSchema extends z.ZodTypeAny>(
  itemSchema: ItemSchema,
) {
  return z
    .object({
      data: z.array(itemSchema),
      pagination: PaginationSchema,
      generatedAt: IsoDateTimeSchema,
    })
    .strict()
    .superRefine((response, context) => {
      if (response.data.length > response.pagination.limit) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "A page cannot contain more items than its limit",
          path: ["data"],
        });
      }

      if (
        response.data.length > 0 &&
        response.pagination.offset + response.data.length >
          response.pagination.total
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Page items cannot extend beyond the reported total",
          path: ["pagination", "total"],
        });
      }

      if (
        response.data.length === 0 &&
        response.pagination.offset < response.pagination.total
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "An in-range page cannot be empty",
          path: ["data"],
        });
      }

      const expectedHasMore =
        response.pagination.offset + response.data.length <
        response.pagination.total;
      if (response.pagination.hasMore !== expectedHasMore) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "hasMore must match the page position and reported total",
          path: ["pagination", "hasMore"],
        });
      }
    });
}

function createDetailResponseSchema<ItemSchema extends z.ZodTypeAny>(
  itemSchema: ItemSchema,
) {
  return z
    .object({
      data: itemSchema,
      generatedAt: IsoDateTimeSchema,
    })
    .strict();
}

export const PlayerListResponseSchema =
  createListResponseSchema(PlayerSummarySchema);
export const PlayerDetailResponseSchema =
  createDetailResponseSchema(PlayerDetailSchema);
export const TeamListResponseSchema =
  createListResponseSchema(TeamListItemSchema);
export const TeamDetailResponseSchema =
  createDetailResponseSchema(TeamDetailSchema);
export const StandingsListResponseSchema = createListResponseSchema(
  StandingsListItemSchema,
);
export const ChangeEventListResponseSchema = createListResponseSchema(
  FootballChangeEventSchema,
);
export const SourceHealthListResponseSchema =
  createListResponseSchema(SourceHealthSchema);
export const QuarantineListResponseSchema = createListResponseSchema(
  QuarantinedExtractionSchema,
);
export const RecoveryEvidenceResponseSchema = createDetailResponseSchema(
  RecoveryEvidenceSchema,
);

export const ApiErrorCodeSchema = z.enum([
  "invalid_request",
  "not_found",
  "method_not_allowed",
  "conflict",
  "validation_failed",
  "rate_limited",
  "internal_error",
  "service_unavailable",
]);

export const ApiErrorDetailSchema = z
  .object({
    code: z.string().trim().min(1).max(100),
    path: z.array(z.union([z.string(), z.number().int()])),
    message: z.string().trim().min(1).max(2_000),
  })
  .strict();

const API_ERROR_STATUS_BY_CODE = {
  invalid_request: 400,
  not_found: 404,
  method_not_allowed: 405,
  conflict: 409,
  validation_failed: 422,
  rate_limited: 429,
  internal_error: 500,
  service_unavailable: 503,
} as const;

export const ApiErrorResponseSchema = z
  .object({
    error: z
      .object({
        code: ApiErrorCodeSchema,
        status: z.number().int().min(400).max(599),
        message: z.string().trim().min(1).max(2_000),
        requestId: z.string().trim().min(1).max(200),
        details: z.array(ApiErrorDetailSchema).max(100),
      })
      .strict(),
    generatedAt: IsoDateTimeSchema,
  })
  .strict()
  .superRefine((response, context) => {
    if (
      response.error.status !== API_ERROR_STATUS_BY_CODE[response.error.code]
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Error status must match the error code",
        path: ["error", "status"],
      });
    }
  });

export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;
export type ApiErrorDetail = z.infer<typeof ApiErrorDetailSchema>;
export type ApiErrorResponse = z.infer<typeof ApiErrorResponseSchema>;
export type ApiHealthResponse = z.infer<typeof ApiHealthResponseSchema>;
export type ChangeEventListResponse = z.infer<
  typeof ChangeEventListResponseSchema
>;
export type CollectorId = z.infer<typeof CollectorIdSchema>;
export type FootballChangeEvent = z.infer<typeof FootballChangeEventSchema>;
export type FootballRecord = z.infer<typeof FootballRecordSchema>;
export type FootballSnapshot = z.infer<typeof FootballSnapshotSchema>;
export type PaginatedListResponse<Item> = {
  data: Item[];
  pagination: Pagination;
  generatedAt: string;
};
export type Pagination = z.infer<typeof PaginationSchema>;
export type PlayerCard = z.infer<typeof PlayerCardSchema>;
export type PlayerDetail = z.infer<typeof PlayerDetailSchema>;
export type PlayerDetailResponse = z.infer<typeof PlayerDetailResponseSchema>;
export type PlayerListResponse = z.infer<typeof PlayerListResponseSchema>;
export type PlayerStats = z.infer<typeof PlayerStatsSchema>;
export type PlayerSummary = z.infer<typeof PlayerSummarySchema>;
export type Position = z.infer<typeof PositionSchema>;
export type QuarantineListResponse = z.infer<
  typeof QuarantineListResponseSchema
>;
export type QuarantinedExtraction = z.infer<typeof QuarantinedExtractionSchema>;
export type RecoveryEvidence = z.infer<typeof RecoveryEvidenceSchema>;
export type RecoveryEvidenceResponse = z.infer<
  typeof RecoveryEvidenceResponseSchema
>;
export type RuntimeStatus = z.infer<typeof RuntimeStatusSchema>;
export type RuntimeStatusResponse = z.infer<typeof RuntimeStatusResponseSchema>;
export type SemanticDiffEvent = z.infer<typeof SemanticDiffEventSchema>;
export type SemanticDiffEvidence = z.infer<typeof SemanticDiffEvidenceSchema>;
export type SemanticDiffIssue = z.infer<typeof SemanticDiffIssueSchema>;
export type SemanticDiffResult = z.infer<typeof SemanticDiffResultSchema>;
export type SnapshotSourceHealth = z.infer<typeof SnapshotSourceHealthSchema>;
export type SourceHealth = z.infer<typeof SourceHealthSchema>;
export type SourceHealthListResponse = z.infer<
  typeof SourceHealthListResponseSchema
>;
export type StandingEntry = z.infer<typeof StandingEntrySchema>;
export type StandingsListItem = z.infer<typeof StandingsListItemSchema>;
export type StandingsListResponse = z.infer<typeof StandingsListResponseSchema>;
export type StatChange = z.infer<typeof StatChangeSchema>;
export type TeamListItem = z.infer<typeof TeamListItemSchema>;
export type TeamDetail = z.infer<typeof TeamDetailSchema>;
export type TeamDetailResponse = z.infer<typeof TeamDetailResponseSchema>;
export type TeamListResponse = z.infer<typeof TeamListResponseSchema>;
export type TeamRef = z.infer<typeof TeamRefSchema>;
export type TeamSummaryRecord = z.infer<typeof TeamSummaryRecordSchema>;
