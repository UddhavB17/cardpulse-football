import {
  SemanticDiffResultSchema,
  SnapshotSourceHealthSchema,
  FootballSnapshotSchema,
  type FootballRecord,
  type SemanticDiffEvidence,
  type SemanticDiffIssue,
  type SemanticDiffResult,
  type SnapshotSourceHealth,
  type FootballSnapshot,
} from "@bidsentinel/contracts";
import { stableStringify } from "@bidsentinel/validation";

import { recordScalarFields } from "./record-fields.js";

export interface SnapshotDiffInput {
  previous: unknown;
  current: unknown;
  sourceHealth: unknown;
}

export interface SemanticDiffPolicy {
  minimumAbsenceConfirmations: number;
  minimumRecordCountForCollapseCheck: number;
  maximumRecordCountDropRatio: number;
}

export const DEFAULT_SEMANTIC_DIFF_POLICY = {
  minimumAbsenceConfirmations: 2,
  minimumRecordCountForCollapseCheck: 10,
  maximumRecordCountDropRatio: 0.5,
} as const satisfies SemanticDiffPolicy;

type EvidenceRule = SemanticDiffEvidence["rule"];
type EvidenceFacts = SemanticDiffEvidence["facts"];

interface SnapshotCheck {
  candidate: FootballSnapshot | null;
  issues: SemanticDiffIssue[];
}

function prefixIssues(
  prefix: string,
  issues: ReadonlyArray<{
    code: string;
    path: Array<string | number>;
    message: string;
  }>,
): SemanticDiffIssue[] {
  return issues.map((issue) => ({
    code: issue.code,
    path: [prefix, ...issue.path],
    message: issue.message,
  }));
}

function validateSnapshot(
  value: unknown,
  prefix: "previous" | "current",
): SnapshotCheck {
  if (value === null) {
    return { candidate: null, issues: [] };
  }

  const parsed = FootballSnapshotSchema.safeParse(value);
  if (!parsed.success) {
    return {
      candidate: null,
      issues: prefixIssues(prefix, parsed.error.issues),
    };
  }

  return { candidate: parsed.data, issues: [] };
}

function fallbackSourceId(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return "unknown";
  }

  const candidate = Reflect.get(value, "sourceId");
  return typeof candidate === "string" &&
    /^[a-z0-9][a-z0-9._-]*$/.test(candidate)
    ? candidate
    : "unknown";
}

function evidenceContext(
  sourceHealth: SnapshotSourceHealth | null,
  rawSourceHealth: unknown,
  previous: FootballSnapshot | null,
  current: FootballSnapshot | null,
): { sourceId: string; observedAt: string } {
  return {
    sourceId:
      sourceHealth?.sourceId ??
      current?.sourceId ??
      previous?.sourceId ??
      fallbackSourceId(rawSourceHealth),
    observedAt:
      sourceHealth?.checkedAt ??
      current?.observedAt ??
      previous?.observedAt ??
      "1970-01-01T00:00:00.000Z",
  };
}

function createEvidence(
  rule: EvidenceRule,
  context: { sourceId: string; observedAt: string },
  previous: FootballSnapshot | null,
  current: FootballSnapshot | null,
  facts: EvidenceFacts,
): SemanticDiffEvidence {
  return {
    engineVersion: "semantic-diff-v1",
    rule,
    sourceId: context.sourceId,
    observedAt: context.observedAt,
    previousSnapshotId: previous?.snapshotId ?? null,
    currentSnapshotId: current?.snapshotId ?? null,
    facts,
  };
}

function invalidResult(
  issues: SemanticDiffIssue[],
  previous: FootballSnapshot | null,
  current: FootballSnapshot | null,
  context: { sourceId: string; observedAt: string },
  health: SnapshotSourceHealth | null,
): SemanticDiffResult {
  const reasonCodes = [...new Set(issues.map((issue) => issue.code))];
  const facts: EvidenceFacts = { reasonCodes };
  if (health !== null) {
    Object.assign(facts, {
      sourceState: health.state,
      previousRecordCount: health.previousRecordCount,
      currentRecordCount: health.currentRecordCount,
      consecutiveEmptyResults: health.consecutiveEmptyResults,
      consecutiveAbsences: health.consecutiveAbsences,
    });
  }

  return SemanticDiffResultSchema.parse({
    decision: "retain_previous",
    lastVerifiedSnapshot: previous,
    events: [
      {
        kind: "invalid_snapshot",
        entityId: current?.entityId ?? previous?.entityId ?? null,
        issues,
        evidence: createEvidence(
          "snapshot_rejected",
          context,
          previous,
          current,
          facts,
        ),
      },
    ],
  });
}

function sourceHealthIssues(
  health: SnapshotSourceHealth,
  previous: FootballSnapshot | null,
  current: FootballSnapshot | null,
  policy: SemanticDiffPolicy,
): SemanticDiffIssue[] {
  const issues: SemanticDiffIssue[] = [];

  if (health.state !== "healthy") {
    issues.push({
      code: "source_not_healthy",
      path: ["sourceHealth", "state"],
      message: `Source state ${health.state} is not trusted for snapshot replacement`,
    });
  }

  for (const [label, snapshot] of [
    ["previous", previous],
    ["current", current],
  ] as const) {
    if (snapshot !== null && snapshot.sourceId !== health.sourceId) {
      issues.push({
        code: "source_id_mismatch",
        path: [label, "sourceId"],
        message: `Snapshot source ${snapshot.sourceId} does not match health source ${health.sourceId}`,
      });
    }
  }

  if (previous !== null && health.previousRecordCount === 0) {
    issues.push({
      code: "record_count_snapshot_mismatch",
      path: ["sourceHealth", "previousRecordCount"],
      message: "A previous snapshot cannot belong to a zero-record result",
    });
  }

  if (current !== null && health.currentRecordCount === 0) {
    issues.push({
      code: "record_count_snapshot_mismatch",
      path: ["sourceHealth", "currentRecordCount"],
      message: "A current snapshot cannot belong to a zero-record result",
    });
  }

  if (
    previous !== null &&
    current === null &&
    health.previousRecordCount > 0 &&
    health.currentRecordCount === 0
  ) {
    issues.push({
      code: "temporary_empty_result",
      path: ["sourceHealth", "currentRecordCount"],
      message: "An empty collection result cannot prove entity removal",
    });
  } else if (
    health.previousRecordCount >= policy.minimumRecordCountForCollapseCheck &&
    health.currentRecordCount > 0
  ) {
    const dropRatio =
      (health.previousRecordCount - health.currentRecordCount) /
      health.previousRecordCount;
    if (dropRatio > policy.maximumRecordCountDropRatio) {
      issues.push({
        code: "record_count_collapse",
        path: ["sourceHealth", "currentRecordCount"],
        message: `Record count dropped by ${(dropRatio * 100).toFixed(2)}%, above the ${(policy.maximumRecordCountDropRatio * 100).toFixed(2)}% limit`,
      });
    }
  }

  return issues;
}

function identityAndChronologyIssues(
  previous: FootballSnapshot | null,
  current: FootballSnapshot | null,
): SemanticDiffIssue[] {
  if (previous === null || current === null) {
    return [];
  }

  const issues: SemanticDiffIssue[] = [];
  if (previous.entityId !== current.entityId) {
    issues.push({
      code: "entity_id_mismatch",
      path: ["current", "entityId"],
      message: "Cannot diff snapshots for different entities",
    });
  }

  if (previous.entityType !== current.entityType) {
    issues.push({
      code: "entity_type_mismatch",
      path: ["current", "entityType"],
      message: "Cannot diff snapshots across different entity types",
    });
  }

  if (current.version <= previous.version) {
    issues.push({
      code: "non_monotonic_snapshot_version",
      path: ["current", "version"],
      message:
        "Current snapshot version must be greater than the previous version",
    });
  }

  if (Date.parse(current.observedAt) < Date.parse(previous.observedAt)) {
    issues.push({
      code: "snapshot_time_regression",
      path: ["current", "observedAt"],
      message: "Current snapshot cannot predate the previous snapshot",
    });
  }

  return issues;
}

function fieldChangedEvents(
  previous: FootballSnapshot,
  current: FootballSnapshot,
  context: { sourceId: string; observedAt: string },
): Extract<SemanticDiffResult["events"][number], { kind: "field_changed" }>[] {
  const previousFields = new Map(
    recordScalarFields(previous.record as FootballRecord).map((entry) => [
      entry.field,
      entry.value,
    ]),
  );

  const events: Extract<
    SemanticDiffResult["events"][number],
    { kind: "field_changed" }
  >[] = [];
  for (const entry of recordScalarFields(current.record as FootballRecord)) {
    const before = previousFields.get(entry.field);
    if (before === undefined || before === entry.value) {
      continue;
    }

    events.push({
      kind: "field_changed",
      entityId: current.entityId,
      entityType: current.entityType,
      field: entry.field,
      before,
      after: entry.value,
      evidence: createEvidence(
        "field_value_changed",
        context,
        previous,
        current,
        {
          field: entry.field,
          beforeValue: before,
          afterValue: entry.value,
        },
      ),
    });
  }
  return events;
}

export function diffFootballSnapshots(
  input: SnapshotDiffInput,
  policy: SemanticDiffPolicy = DEFAULT_SEMANTIC_DIFF_POLICY,
): SemanticDiffResult {
  const previousCheck = validateSnapshot(input.previous, "previous");
  const currentCheck = validateSnapshot(input.current, "current");
  const healthCheck = SnapshotSourceHealthSchema.safeParse(input.sourceHealth);
  const healthIssues = healthCheck.success
    ? []
    : prefixIssues("sourceHealth", healthCheck.error.issues);
  const previous =
    previousCheck.issues.length === 0 ? previousCheck.candidate : null;
  const current =
    currentCheck.issues.length === 0 ? currentCheck.candidate : null;
  const health = healthCheck.success ? healthCheck.data : null;
  const context = evidenceContext(
    health,
    input.sourceHealth,
    previousCheck.candidate,
    currentCheck.candidate,
  );

  const issues = [
    ...previousCheck.issues,
    ...currentCheck.issues,
    ...healthIssues,
  ];
  if (issues.length > 0 || health === null) {
    return invalidResult(
      issues,
      previous,
      currentCheck.candidate,
      context,
      health,
    );
  }

  issues.push(
    ...sourceHealthIssues(health, previous, current, policy),
    ...identityAndChronologyIssues(previous, current),
  );
  if (issues.length > 0) {
    return invalidResult(issues, previous, current, context, health);
  }

  if (previous === null && current === null) {
    return SemanticDiffResultSchema.parse({
      decision: "retain_previous",
      lastVerifiedSnapshot: null,
      events: [
        {
          kind: "no_change",
          entityId: null,
          reason: "no_baseline_or_current",
          evidence: createEvidence(
            "no_baseline_or_current",
            context,
            null,
            null,
            {
              previousRecordCount: health.previousRecordCount,
              currentRecordCount: health.currentRecordCount,
            },
          ),
        },
      ],
    });
  }

  if (previous === null && current !== null) {
    return SemanticDiffResultSchema.parse({
      decision: "accept_current",
      lastVerifiedSnapshot: current,
      events: [
        {
          kind: "new_record",
          entityId: current.entityId,
          entityType: current.entityType,
          evidence: createEvidence(
            "first_verified_snapshot",
            context,
            null,
            current,
            {
              currentVersion: current.version,
              externalId: stableStringify(
                (current.record as FootballRecord).externalId ?? null,
              ),
            },
          ),
        },
      ],
    });
  }

  if (previous !== null && current === null) {
    if (health.consecutiveAbsences >= policy.minimumAbsenceConfirmations) {
      return SemanticDiffResultSchema.parse({
        decision: "mark_removed",
        lastVerifiedSnapshot: previous,
        events: [
          {
            kind: "entity_removed",
            entityId: previous.entityId,
            entityType: previous.entityType,
            evidence: createEvidence(
              "confirmed_entity_absence",
              context,
              previous,
              null,
              {
                absenceConfirmations: health.consecutiveAbsences,
                requiredConfirmations: policy.minimumAbsenceConfirmations,
                previousRecordCount: health.previousRecordCount,
                currentRecordCount: health.currentRecordCount,
              },
            ),
          },
        ],
      });
    }

    return SemanticDiffResultSchema.parse({
      decision: "retain_previous",
      lastVerifiedSnapshot: previous,
      events: [
        {
          kind: "no_change",
          entityId: previous.entityId,
          reason: "absence_unconfirmed",
          evidence: createEvidence(
            "absence_unconfirmed",
            context,
            previous,
            null,
            {
              absenceConfirmations: health.consecutiveAbsences,
              requiredConfirmations: policy.minimumAbsenceConfirmations,
            },
          ),
        },
      ],
    });
  }

  if (previous === null || current === null) {
    throw new Error("Unreachable snapshot state");
  }

  const events = fieldChangedEvents(previous, current, context);

  if (events.length === 0) {
    return SemanticDiffResultSchema.parse({
      decision: "accept_current",
      lastVerifiedSnapshot: current,
      events: [
        {
          kind: "no_change",
          entityId: current.entityId,
          reason: "semantic_state_unchanged",
          evidence: createEvidence(
            "semantic_state_unchanged",
            context,
            previous,
            current,
            {},
          ),
        },
      ],
    });
  }

  return SemanticDiffResultSchema.parse({
    decision: "accept_current",
    lastVerifiedSnapshot: current,
    events,
  });
}
