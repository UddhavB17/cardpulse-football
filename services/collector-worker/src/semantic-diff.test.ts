import { describe, expect, it } from "vitest";

import {
  FootballSnapshotSchema,
  SnapshotSourceHealthSchema,
  type FootballRecord,
  type FootballSnapshot,
  type SnapshotSourceHealth,
} from "@bidsentinel/contracts";
import {
  amendedPlayerFixture,
  validPlayerFixture,
  validStandingFixtures,
} from "@bidsentinel/contracts/fixtures";

import { diffFootballSnapshots } from "./semantic-diff.js";

interface SnapshotOptions {
  version?: number;
  observedAt?: string;
  goals?: number;
  rank?: number;
}

function makePlayerSnapshot(options: SnapshotOptions = {}): FootballSnapshot {
  const version = options.version ?? 1;
  const observedAt =
    options.observedAt ??
    (version === 1 ? "2026-08-20T14:00:00.000Z" : "2026-08-21T14:00:00.000Z");
  const suffix = String(version).padStart(12, "0");
  const record: FootballRecord = {
    ...validPlayerFixture,
    stats: {
      ...validPlayerFixture.stats,
      goals: options.goals ?? validPlayerFixture.stats.goals,
    },
    observedAt,
  };

  return FootballSnapshotSchema.parse({
    schemaVersion: 1,
    snapshotId: `00000000-0000-4000-8000-${suffix}`,
    entityId: record.playerId,
    entityType: record.entityType,
    sourceId: record.sourceId,
    version,
    observedAt,
    payloadHash: (version % 10).toString().repeat(64),
    record,
  });
}

function makeStandingSnapshot(options: SnapshotOptions = {}): FootballSnapshot {
  const version = options.version ?? 1;
  const suffix = String(version + 100).padStart(12, "0");
  const base = validStandingFixtures[0];
  if (!base) throw new Error("Standing fixture missing");
  const record: FootballRecord = {
    ...base,
    rank: options.rank ?? base.rank,
  };

  return FootballSnapshotSchema.parse({
    schemaVersion: 1,
    snapshotId: `00000000-0000-4000-8000-${suffix}`,
    entityId: `${record.competition}:${record.season}:${record.teamId}`,
    entityType: record.entityType,
    sourceId: record.sourceId,
    version,
    observedAt: "2026-08-21T14:00:00.000Z",
    payloadHash: (version % 10).toString().repeat(64),
    record,
  });
}

function makeHealth(
  overrides: Partial<SnapshotSourceHealth> = {},
): SnapshotSourceHealth {
  return SnapshotSourceHealthSchema.parse({
    schemaVersion: 1,
    sourceId: "openligadb",
    state: "healthy",
    checkedAt: "2026-08-21T14:00:00.000Z",
    previousRecordCount: 100,
    currentRecordCount: 100,
    consecutiveEmptyResults: 0,
    consecutiveAbsences: 0,
    ...overrides,
  });
}

function kinds(result: ReturnType<typeof diffFootballSnapshots>): string[] {
  return result.events.map((event) => event.kind);
}

describe("diffFootballSnapshots", () => {
  it("emits new_record for the first verified snapshot", () => {
    const current = makePlayerSnapshot();
    const result = diffFootballSnapshots({
      previous: null,
      current,
      sourceHealth: makeHealth({
        previousRecordCount: 0,
        currentRecordCount: 1,
      }),
    });

    expect(kinds(result)).toEqual(["new_record"]);
    expect(result.decision).toBe("accept_current");
    expect(result.lastVerifiedSnapshot?.snapshotId).toBe(current.snapshotId);
  });

  it("treats identical restatements as semantic_state_unchanged", () => {
    const previous = makePlayerSnapshot();
    const current = makePlayerSnapshot({ version: 2 });
    const result = diffFootballSnapshots({
      previous,
      current,
      sourceHealth: makeHealth(),
    });

    expect(kinds(result)).toEqual(["no_change"]);
    expect(result.decision).toBe("accept_current");
    expect(result.lastVerifiedSnapshot?.snapshotId).toBe(current.snapshotId);
  });

  it("emits field_changed with before/after evidence when a stat moves", () => {
    const amendedGoals = amendedPlayerFixture.stats.goals;
    const result = diffFootballSnapshots({
      previous: makePlayerSnapshot(),
      current: makePlayerSnapshot({ version: 2, goals: amendedGoals }),
      sourceHealth: makeHealth(),
    });

    expect(kinds(result)).toEqual(["field_changed"]);
    expect(result.events[0]).toMatchObject({
      kind: "field_changed",
      field: "stats.goals",
      before: validPlayerFixture.stats.goals,
      after: amendedGoals,
      evidence: expect.objectContaining({
        rule: "field_value_changed",
        facts: expect.objectContaining({
          field: "stats.goals",
          beforeValue: validPlayerFixture.stats.goals,
          afterValue: amendedGoals,
        }),
      }),
    });
  });

  it("emits a standing change when the table position moves", () => {
    const result = diffFootballSnapshots({
      previous: makeStandingSnapshot({ version: 1 }),
      current: makeStandingSnapshot({ version: 2, rank: 2 }),
      sourceHealth: makeHealth(),
    });

    expect(kinds(result)).toEqual(["field_changed"]);
    expect(result.events[0]).toMatchObject({
      kind: "field_changed",
      field: "rank",
      before: 1,
      after: 2,
    });
  });

  it("rejects a record-count collapse without replacing the baseline", () => {
    const previous = makePlayerSnapshot();
    const result = diffFootballSnapshots({
      previous,
      current: makePlayerSnapshot({ version: 2, goals: 19 }),
      sourceHealth: makeHealth({
        previousRecordCount: 200,
        currentRecordCount: 20,
      }),
    });

    expect(kinds(result)).toEqual(["invalid_snapshot"]);
    expect(result.lastVerifiedSnapshot?.snapshotId).toBe(previous.snapshotId);
    expect(result.events[0]).toMatchObject({
      issues: [expect.objectContaining({ code: "record_count_collapse" })],
      evidence: {
        facts: expect.objectContaining({
          previousRecordCount: 200,
          currentRecordCount: 20,
        }),
      },
    });
  });

  it("rejects a temporary empty result instead of removing the card", () => {
    const previous = makePlayerSnapshot();
    const result = diffFootballSnapshots({
      previous,
      current: null,
      sourceHealth: makeHealth({
        currentRecordCount: 0,
        consecutiveEmptyResults: 1,
        consecutiveAbsences: 1,
      }),
    });

    expect(kinds(result)).toEqual(["invalid_snapshot"]);
    expect(result.lastVerifiedSnapshot?.snapshotId).toBe(previous.snapshotId);
    expect(result.events[0]).toMatchObject({
      issues: [expect.objectContaining({ code: "temporary_empty_result" })],
    });
  });

  it("rejects snapshots from an unhealthy source", () => {
    const previous = makePlayerSnapshot();
    const result = diffFootballSnapshots({
      previous,
      current: makePlayerSnapshot({ version: 2, goals: 19 }),
      sourceHealth: makeHealth({ state: "degraded" }),
    });

    expect(kinds(result)).toEqual(["invalid_snapshot"]);
    expect(result.lastVerifiedSnapshot?.snapshotId).toBe(previous.snapshotId);
    expect(result.events[0]).toMatchObject({
      issues: [expect.objectContaining({ code: "source_not_healthy" })],
    });
  });

  it("rejects time-regressed snapshots without replacing the verified card", () => {
    const previous = makePlayerSnapshot();
    const result = diffFootballSnapshots({
      previous,
      current: makePlayerSnapshot({
        version: 2,
        goals: 19,
        observedAt: "2026-08-19T14:00:00.000Z",
      }),
      sourceHealth: makeHealth(),
    });

    expect(kinds(result)).toEqual(["invalid_snapshot"]);
    expect(result.decision).toBe("retain_previous");
    expect(result.events[0]).toMatchObject({
      issues: [expect.objectContaining({ code: "snapshot_time_regression" })],
      evidence: { rule: "snapshot_rejected" },
    });
  });

  it("emits entity_removed only after confirmed absence on a healthy result", () => {
    const previous = makePlayerSnapshot();
    const result = diffFootballSnapshots({
      previous,
      current: null,
      sourceHealth: makeHealth({
        currentRecordCount: 99,
        consecutiveAbsences: 2,
      }),
    });

    expect(kinds(result)).toEqual(["entity_removed"]);
    expect(result.decision).toBe("mark_removed");
    expect(result.lastVerifiedSnapshot?.snapshotId).toBe(previous.snapshotId);
    expect(result.events[0]?.evidence.facts).toMatchObject({
      absenceConfirmations: 2,
      requiredConfirmations: 2,
    });
  });

  it("retains the card while a non-empty absence is unconfirmed", () => {
    const previous = makePlayerSnapshot();
    const result = diffFootballSnapshots({
      previous,
      current: null,
      sourceHealth: makeHealth({
        currentRecordCount: 99,
        consecutiveAbsences: 1,
      }),
    });

    expect(kinds(result)).toEqual(["no_change"]);
    expect(result.decision).toBe("retain_previous");
    expect(result.lastVerifiedSnapshot?.snapshotId).toBe(previous.snapshotId);
  });
});
