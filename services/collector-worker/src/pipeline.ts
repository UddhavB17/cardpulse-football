import { randomUUID } from "node:crypto";

import {
  FootballSnapshotSchema,
  QuarantinedExtractionSchema,
  RecoveryEvidenceSchema,
  SourceHealthSchema,
  type FootballChangeEvent,
  type FootballRecord,
  type FootballSnapshot,
  type QuarantinedExtraction,
  type RecoveryEvidence,
  type SourceHealth,
} from "@bidsentinel/contracts";
import {
  hashPayload,
  validateFootballExtraction,
  type ExtractionContext,
} from "@bidsentinel/validation";

import { detectRecordChanges } from "./change-detection.js";
import type { SelfHealingCoordinator } from "./healing-coordinator.js";
import { diffFootballSnapshots } from "./semantic-diff.js";
import {
  InMemoryChangeEventStore,
  InMemoryQuarantineStore,
  InMemoryRecoveryEvidenceStore,
  InMemorySnapshotStore,
  InMemorySourceHealthStore,
} from "./stores.js";

export interface PipelineExtractionContext extends ExtractionContext {
  /** Stable Bright Data collector ID. Never inferred from extractorVersion. */
  collectorId?: string;
}

export type ProcessingResult =
  | {
      outcome: "accepted";
      entityId: string;
      record: FootballRecord;
      snapshot: FootballSnapshot | null;
      changeEvent: FootballChangeEvent | null;
      recoveryEvidence: RecoveryEvidence | null;
      health: SourceHealth;
    }
  | {
      outcome: "quarantined";
      quarantine: QuarantinedExtraction;
      health: SourceHealth;
    };

function recordStateForHash(
  record: FootballRecord,
): Omit<FootballRecord, "observedAt"> {
  const { observedAt: _observedAt, ...state } = record;
  return state;
}

function incidentReasonFor(
  quarantine: QuarantinedExtraction,
): "invalid-extraction" | "schema-drift" {
  const hasStructuralFailure = quarantine.issues.some(
    (issue) =>
      issue.code === "unrecognized_keys" ||
      (issue.code === "invalid_type" && issue.message === "Required"),
  );

  return hasStructuralFailure ? "schema-drift" : "invalid-extraction";
}

/**
 * Root fields whose absence signals page-layout drift rather than a single
 * bad value. The union covers every football entity type because a broken
 * row may not even carry a recognizable entityType field.
 */
const STRUCTURAL_REQUIRED_FIELDS = new Set([
  "entityType",
  "playerId",
  "teamId",
  "playerName",
  "name",
  "team",
  "position",
  "season",
  "competition",
  "rank",
  "stats",
  "matchId",
  "playerTeam",
  "playedOn",
]);

function structuralFailureCount(quarantine: QuarantinedExtraction): number {
  return quarantine.issues.filter((issue) => {
    const rootPath = issue.path[0];
    return (
      issue.code === "record_count_collapse" ||
      issue.code === "unrecognized_keys" ||
      (issue.code === "invalid_type" &&
        issue.message === "Required" &&
        typeof rootPath === "string" &&
        STRUCTURAL_REQUIRED_FIELDS.has(rootPath))
    );
  }).length;
}

function structuralSignature(
  quarantines: QuarantinedExtraction[],
): string | null {
  const facts = quarantines
    .flatMap((quarantine) =>
      quarantine.issues
        .filter((issue) => {
          const rootPath = issue.path[0];
          return (
            issue.code === "unrecognized_keys" ||
            (issue.code === "invalid_type" &&
              issue.message === "Required" &&
              typeof rootPath === "string" &&
              STRUCTURAL_REQUIRED_FIELDS.has(rootPath))
          );
        })
        .map((issue) => `${issue.code}:${String(issue.path[0] ?? "payload")}`),
    )
    .sort();
  return facts.length === 0 ? null : [...new Set(facts)].join("|");
}

export class CardPulsePipeline {
  readonly snapshots = new InMemorySnapshotStore();
  readonly quarantines = new InMemoryQuarantineStore();
  readonly changeEvents = new InMemoryChangeEventStore();
  readonly recoveryEvidence = new InMemoryRecoveryEvidenceStore();
  readonly sourceHealth = new InMemorySourceHealthStore();
  readonly #attempts = new Map<string, boolean[]>();
  readonly #lastValidBatchCounts = new Map<string, number>();
  readonly #lastStructuralBatchSignatures = new Map<string, string>();
  healingCoordinator: SelfHealingCoordinator | null = null;

  process(
    input: unknown,
    context: PipelineExtractionContext,
  ): ProcessingResult {
    const validation = validateFootballExtraction(input, context);

    if (!validation.ok) {
      const outcome = this.quarantine(
        validation.quarantine,
        context,
        incidentReasonFor(validation.quarantine),
      );
      return outcome;
    }

    const record = validation.value;
    const entityId = validation.entityId;
    const previousHealth = this.sourceHealth.get(context.sourceId);
    const previousSnapshot = this.snapshots.latest(entityId);
    const payloadHash = hashPayload(recordStateForHash(record));
    const candidateSnapshot = FootballSnapshotSchema.parse({
      schemaVersion: 1,
      snapshotId: randomUUID(),
      entityId,
      entityType: record.entityType,
      sourceId: record.sourceId,
      version: (previousSnapshot?.version ?? 0) + 1,
      observedAt: record.observedAt,
      payloadHash,
      record,
    });
    const semanticDecision = diffFootballSnapshots({
      previous: previousSnapshot,
      current: candidateSnapshot,
      sourceHealth: {
        schemaVersion: 1,
        sourceId: context.sourceId,
        state: "healthy",
        checkedAt: context.observedAt,
        previousRecordCount: previousSnapshot === null ? 0 : 1,
        currentRecordCount: 1,
        consecutiveEmptyResults: 0,
        consecutiveAbsences: 0,
      },
    });
    const rejection = semanticDecision.events.find(
      (event) => event.kind === "invalid_snapshot",
    );
    if (semanticDecision.decision !== "accept_current") {
      if (rejection?.kind !== "invalid_snapshot") {
        throw new Error("Snapshot safety gate rejected without evidence");
      }

      const quarantine = QuarantinedExtractionSchema.parse({
        schemaVersion: 1,
        quarantineId: randomUUID(),
        sourceId: context.sourceId,
        extractorVersion: context.extractorVersion,
        observedAt: context.observedAt,
        payloadHash: hashPayload(input),
        rawPayload: input,
        issues: rejection.issues,
      });
      const outcome = this.quarantine(
        quarantine,
        context,
        "invalid-extraction",
      );
      return outcome;
    }

    const snapshot =
      previousSnapshot?.payloadHash === payloadHash ? null : candidateSnapshot;
    const changeEvent =
      snapshot !== null && previousSnapshot !== null
        ? detectRecordChanges(previousSnapshot, snapshot, context.observedAt)
        : null;

    const recovered = this.buildRecoveryEvidence(
      previousHealth,
      entityId,
      payloadHash,
      context,
    );

    const health = SourceHealthSchema.parse({
      schemaVersion: 1,
      sourceId: context.sourceId,
      state: "healthy",
      checkedAt: context.observedAt,
      lastSuccessfulAt: context.observedAt,
      consecutiveFailures: 0,
      recentFailureRate: this.projectedFailureRate(context.sourceId, true),
      activeIncident: null,
      latestRecoveryEvidence:
        recovered ?? previousHealth?.latestRecoveryEvidence ?? null,
    });

    this.recordAttempt(context.sourceId, true);
    if (snapshot !== null) {
      this.snapshots.append(snapshot);
    }
    if (changeEvent !== null) {
      this.changeEvents.append(changeEvent);
    }
    if (recovered !== null) {
      this.recoveryEvidence.append(recovered);
    }
    this.sourceHealth.set(health);

    return {
      outcome: "accepted",
      entityId,
      record,
      snapshot,
      changeEvent,
      recoveryEvidence: recovered,
      health,
    };
  }

  async processWithHealing(
    input: unknown,
    context: PipelineExtractionContext,
  ): Promise<ProcessingResult> {
    const results = await this.processBatchWithHealing([input], context);
    const result = results[0];
    if (!result)
      throw new Error("Single-record processing returned no outcome");
    return result;
  }

  async processBatchWithHealing(
    payloads: unknown[],
    context: PipelineExtractionContext,
    expectedMinCount = 1,
    enableHealing = true,
  ): Promise<ProcessingResult[]> {
    // Safety invariant: a first-ever empty batch has no verified baseline to
    // contradict, so it can never trigger healing.
    const previousCount = this.#lastValidBatchCounts.get(context.sourceId) ?? 0;
    if (payloads.length === 0 && previousCount === 0) return [];
    const collapseThreshold =
      previousCount > 1 ? Math.ceil(previousCount * 0.5) : previousCount;

    if (previousCount > 0 && payloads.length < collapseThreshold) {
      const quarantine = QuarantinedExtractionSchema.parse({
        schemaVersion: 1,
        quarantineId: randomUUID(),
        sourceId: context.sourceId,
        extractorVersion: context.extractorVersion,
        observedAt: context.observedAt,
        payloadHash: hashPayload(payloads),
        rawPayload: payloads,
        issues: [
          {
            code: "record_count_collapse",
            path: [],
            message: `Expected at least ${collapseThreshold} records after a verified batch, received ${payloads.length}`,
          },
        ],
      });
      const result = this.quarantine(quarantine, context, "schema-drift");
      if (enableHealing && this.healingCoordinator && context.collectorId) {
        await this.healingCoordinator.handleDrift(
          context.sourceId,
          context.collectorId,
          "schema-drift",
          `Confirmed result-count collapse: expected at least ${collapseThreshold} football records and received ${payloads.length}. Restore the canonical football extraction.`,
          context.observedAt,
        );
      }
      return [result];
    }

    const results: ProcessingResult[] = [];
    for (const payload of payloads) {
      results.push(this.process(payload, context));
    }
    const acceptedCount = results.filter(
      (result) => result.outcome === "accepted",
    ).length;
    const structuralQuarantines = results
      .filter(
        (
          result,
        ): result is Extract<ProcessingResult, { outcome: "quarantined" }> =>
          result.outcome === "quarantined" &&
          structuralFailureCount(result.quarantine) > 0,
      )
      .map((result) => result.quarantine);
    // Safety invariant: a minority of malformed rows is ordinary noise and
    // must never trigger healing on its own.
    const structuralMajority =
      payloads.length > 0 &&
      structuralQuarantines.length >= Math.ceil(payloads.length / 2);
    const signature = structuralSignature(structuralQuarantines);
    const repeatedSignature =
      structuralMajority &&
      signature !== null &&
      this.#lastStructuralBatchSignatures.get(context.sourceId) === signature;
    // Without a verified baseline, drift requires the same structural failure
    // signature twice before any repair request is sent.
    const confirmedDrift =
      structuralMajority && (previousCount > 0 || repeatedSignature);

    if (structuralMajority && signature !== null) {
      this.#lastStructuralBatchSignatures.set(context.sourceId, signature);
    } else {
      this.#lastStructuralBatchSignatures.delete(context.sourceId);
    }

    if (
      confirmedDrift &&
      enableHealing &&
      this.healingCoordinator &&
      context.collectorId
    ) {
      await this.healingCoordinator.handleDrift(
        context.sourceId,
        context.collectorId,
        "schema-drift",
        `Confirmed batch-level layout drift: ${structuralQuarantines.length} of ${payloads.length} rows failed required structural fields. Signature: ${signature}`,
        context.observedAt,
      );
    }

    if (acceptedCount >= expectedMinCount && !confirmedDrift) {
      this.#lastValidBatchCounts.set(context.sourceId, acceptedCount);
    }
    return results;
  }

  recordCollectionFailure(
    sourceId: string,
    observedAt: string,
    reason: "network-error" | "rate-limited" | "unknown",
    detail: string,
  ): SourceHealth {
    const previousHealth = this.sourceHealth.get(sourceId);
    const health = SourceHealthSchema.parse({
      schemaVersion: 1,
      sourceId,
      state: "degraded",
      checkedAt: observedAt,
      lastSuccessfulAt: previousHealth?.lastSuccessfulAt ?? null,
      consecutiveFailures: (previousHealth?.consecutiveFailures ?? 0) + 1,
      recentFailureRate: this.projectedFailureRate(sourceId, false),
      activeIncident: previousHealth?.activeIncident ?? {
        incidentId: randomUUID(),
        openedAt: observedAt,
        reason,
        detail,
      },
      latestRecoveryEvidence: previousHealth?.latestRecoveryEvidence ?? null,
    });
    this.recordAttempt(sourceId, false);
    this.sourceHealth.set(health);
    return health;
  }

  private quarantine(
    quarantine: QuarantinedExtraction,
    context: PipelineExtractionContext,
    reason: "invalid-extraction" | "schema-drift",
  ): ProcessingResult {
    const previousHealth = this.sourceHealth.get(context.sourceId);
    const activeIncident = previousHealth?.activeIncident ?? {
      incidentId: randomUUID(),
      openedAt: context.observedAt,
      reason,
      detail: quarantine.issues
        .map(
          (issue) => `${issue.path.join(".") || "payload"}: ${issue.message}`,
        )
        .join("; "),
    };
    const health = SourceHealthSchema.parse({
      schemaVersion: 1,
      sourceId: context.sourceId,
      state: "quarantined",
      checkedAt: context.observedAt,
      lastSuccessfulAt: previousHealth?.lastSuccessfulAt ?? null,
      consecutiveFailures: (previousHealth?.consecutiveFailures ?? 0) + 1,
      recentFailureRate: this.projectedFailureRate(context.sourceId, false),
      activeIncident,
      latestRecoveryEvidence: previousHealth?.latestRecoveryEvidence ?? null,
    });

    this.recordAttempt(context.sourceId, false);
    this.quarantines.append(quarantine);
    this.sourceHealth.set(health);

    return { outcome: "quarantined", quarantine, health };
  }

  private buildRecoveryEvidence(
    previousHealth: SourceHealth | null,
    entityId: string,
    payloadHash: string,
    context: PipelineExtractionContext,
  ): RecoveryEvidence | null {
    if (previousHealth?.activeIncident === null || previousHealth === null) {
      return null;
    }

    return RecoveryEvidenceSchema.parse({
      schemaVersion: 1,
      recoveryEvidenceId: randomUUID(),
      incidentId: previousHealth.activeIncident.incidentId,
      sourceId: context.sourceId,
      strategy: "next-poll-revalidation",
      startedAt: previousHealth.activeIncident.openedAt,
      completedAt: context.observedAt,
      outcome: "recovered",
      actions: [
        "Preserved the invalid extraction in quarantine",
        "Accepted a schema-valid payload on the next poll",
      ],
      verification: {
        validRecordCount: 1,
        quarantinedCount: this.quarantines.listBySource(context.sourceId)
          .length,
        sampleEntityIds: [entityId],
        payloadHashes: [payloadHash],
      },
    });
  }

  private recordAttempt(sourceId: string, succeeded: boolean): void {
    const attempts = [...(this.#attempts.get(sourceId) ?? []), succeeded].slice(
      -20,
    );
    this.#attempts.set(sourceId, attempts);
  }

  private projectedFailureRate(sourceId: string, succeeded: boolean): number {
    const attempts = [...(this.#attempts.get(sourceId) ?? []), succeeded].slice(
      -20,
    );
    return (
      attempts.filter((attemptSucceeded) => !attemptSucceeded).length /
      attempts.length
    );
  }
}
