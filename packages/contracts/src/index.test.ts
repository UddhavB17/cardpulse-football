import { describe, expect, it } from "vitest";

import {
  CollectorIdSchema,
  FootballRecordSchema,
  FootballSnapshotSchema,
  QuarantinedExtractionSchema,
  RecoveryEvidenceSchema,
  SemanticDiffResultSchema,
  SnapshotSourceHealthSchema,
  SourceHealthSchema,
} from "./index.js";
import {
  recoveryEvidenceFixture,
  validPlayerFixture,
  validPlayerSnapshotFixture,
  validSourceHealthFixture,
} from "./fixtures.js";

describe("FootballRecordSchema", () => {
  it("accepts the canonical player fixture", () => {
    expect(FootballRecordSchema.parse(validPlayerFixture)).toEqual(
      validPlayerFixture,
    );
  });

  it("accepts explicit null minutes when the source does not publish them", () => {
    const result = FootballRecordSchema.safeParse({
      ...validPlayerFixture,
      stats: { ...validPlayerFixture.stats, minutesPlayed: null },
    });

    expect(result.success).toBe(true);
  });

  it("rejects unknown extraction fields on a player card", () => {
    const result = FootballRecordSchema.safeParse({
      ...validPlayerFixture,
      scoutingNote: "undocumented",
    });

    expect(result.success).toBe(false);
  });

  it("rejects a player card without an explicit timezone in observedAt", () => {
    const result = FootballRecordSchema.safeParse({
      ...validPlayerFixture,
      observedAt: "2026-08-20T14:00:00",
    });

    expect(result.success).toBe(false);
  });

  it("rejects a standing whose results do not add up", () => {
    const result = FootballRecordSchema.safeParse({
      schemaVersion: 1,
      entityType: "standing",
      sourceId: "openligadb",
      externalId: "bl1-demo:2025:rheinland-fc-04",
      competition: "bl1-demo",
      season: "2025",
      teamId: "openligadb:rheinland-fc-04",
      teamName: "Rheinland FC 04",
      rank: 1,
      played: 34,
      won: 25,
      drawn: 7,
      lost: 3,
      goalsFor: 71,
      goalsAgainst: 32,
      points: 79,
      sourceUrl: "https://data.football-demo.test/table",
      observedAt: "2026-08-20T14:00:00.000Z",
    });

    expect(result.success).toBe(false);
  });
});

describe("CollectorIdSchema", () => {
  it("accepts Bright Data c_* collector IDs only", () => {
    expect(CollectorIdSchema.safeParse("c_ab12cd34").success).toBe(true);
    expect(CollectorIdSchema.safeParse("collector_ab12").success).toBe(false);
    expect(CollectorIdSchema.safeParse("").success).toBe(false);
  });
});

describe("FootballSnapshotSchema", () => {
  it("accepts a versioned snapshot", () => {
    expect(
      FootballSnapshotSchema.safeParse(validPlayerSnapshotFixture).success,
    ).toBe(true);
  });

  it("rejects a snapshot whose source does not match its record", () => {
    const result = FootballSnapshotSchema.safeParse({
      ...validPlayerSnapshotFixture,
      sourceId: "another-source",
    });

    expect(result.success).toBe(false);
  });

  it("rejects a snapshot whose entity ID does not match its record", () => {
    const result = FootballSnapshotSchema.safeParse({
      ...validPlayerSnapshotFixture,
      entityId: "openligadb:player:someone-else",
    });

    expect(result.success).toBe(false);
  });
});

describe("source health and recovery contracts", () => {
  it("accepts recovery evidence and a recovered healthy source", () => {
    expect(
      RecoveryEvidenceSchema.safeParse(recoveryEvidenceFixture).success,
    ).toBe(true);
    expect(SourceHealthSchema.safeParse(validSourceHealthFixture).success).toBe(
      true,
    );
  });

  it("rejects a healthy source with an active incident", () => {
    const result = SourceHealthSchema.safeParse({
      ...validSourceHealthFixture,
      activeIncident: {
        incidentId: "ec1ef7d9-f67c-45ab-b4a9-dfcf406564d2",
        openedAt: "2026-08-21T14:05:00.000Z",
        reason: "invalid-extraction",
        detail: "Invalid stat value",
      },
    });

    expect(result.success).toBe(false);
  });

  it("requires quarantine records to include validation issues", () => {
    const result = QuarantinedExtractionSchema.safeParse({
      schemaVersion: 1,
      quarantineId: "0db38b22-1595-4e1d-b66c-58aebf5ca387",
      sourceId: "openligadb",
      extractorVersion: "fixture-v1",
      observedAt: "2026-08-20T14:00:00.000Z",
      payloadHash: "c".repeat(64),
      rawPayload: {},
      issues: [],
    });

    expect(result.success).toBe(false);
  });
});

describe("semantic diff contracts", () => {
  it("accepts source-health metadata used by snapshot decisions", () => {
    expect(
      SnapshotSourceHealthSchema.safeParse({
        schemaVersion: 1,
        sourceId: "openligadb",
        state: "healthy",
        checkedAt: "2026-08-21T14:00:00.000Z",
        previousRecordCount: 100,
        currentRecordCount: 99,
        consecutiveEmptyResults: 0,
        consecutiveAbsences: 1,
      }).success,
    ).toBe(true);
  });

  it("forbids accepting a snapshot that emitted invalid_snapshot", () => {
    const result = SemanticDiffResultSchema.safeParse({
      decision: "accept_current",
      lastVerifiedSnapshot: validPlayerSnapshotFixture,
      events: [
        {
          kind: "invalid_snapshot",
          entityId: validPlayerSnapshotFixture.entityId,
          issues: [
            {
              code: "snapshot_time_regression",
              path: ["current", "observedAt"],
              message: "Current snapshot cannot predate the previous snapshot",
            },
          ],
          evidence: {
            engineVersion: "semantic-diff-v1",
            rule: "snapshot_rejected",
            sourceId: "openligadb",
            observedAt: "2026-08-21T14:00:00.000Z",
            previousSnapshotId: validPlayerSnapshotFixture.snapshotId,
            currentSnapshotId: null,
            facts: { reasonCodes: ["snapshot_time_regression"] },
          },
        },
      ],
    });

    expect(result.success).toBe(false);
  });
});
