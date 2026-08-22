import { describe, expect, it } from "vitest";

import {
  ApiErrorResponseSchema,
  ApiHealthResponseSchema,
  ChangeEventListResponseSchema,
  PlayerDetailResponseSchema,
  PlayerListResponseSchema,
  PlayerSummarySchema,
  QuarantineListResponseSchema,
  RecoveryEvidenceResponseSchema,
  SourceHealthListResponseSchema,
  StandingsListResponseSchema,
  TeamListResponseSchema,
} from "./index.js";
import {
  emptyChangeEventListResponseFixture,
  emptyPlayerListResponseFixture,
  emptyQuarantineListResponseFixture,
  emptySourceHealthListResponseFixture,
  emptyStandingsListResponseFixture,
  emptyTeamListResponseFixture,
  validApiErrorResponseFixture,
  validApiHealthResponseFixture,
  validChangeEventListResponseFixture,
  validPlayerDetailResponseFixture,
  validPlayerListResponseFixture,
  validPlayerSummaryFixture,
  validQuarantineListResponseFixture,
  validQuarantinedExtractionFixture,
  validRecoveryEvidenceResponseFixture,
  validSourceHealthFixture,
  validSourceHealthListResponseFixture,
  validStandingsListResponseFixture,
  validTeamListResponseFixture,
} from "./fixtures.js";

describe("API contract acceptance", () => {
  it.each([
    ["health", ApiHealthResponseSchema, validApiHealthResponseFixture],
    ["player list", PlayerListResponseSchema, validPlayerListResponseFixture],
    [
      "player detail",
      PlayerDetailResponseSchema,
      validPlayerDetailResponseFixture,
    ],
    ["team list", TeamListResponseSchema, validTeamListResponseFixture],
    [
      "standings",
      StandingsListResponseSchema,
      validStandingsListResponseFixture,
    ],
    [
      "change-event list",
      ChangeEventListResponseSchema,
      validChangeEventListResponseFixture,
    ],
    [
      "source-health list",
      SourceHealthListResponseSchema,
      validSourceHealthListResponseFixture,
    ],
    [
      "quarantine list",
      QuarantineListResponseSchema,
      validQuarantineListResponseFixture,
    ],
    [
      "recovery evidence",
      RecoveryEvidenceResponseSchema,
      validRecoveryEvidenceResponseFixture,
    ],
    ["API error", ApiErrorResponseSchema, validApiErrorResponseFixture],
  ])("accepts the %s fixture", (_name, schema, fixture) => {
    expect(schema.safeParse(fixture).success).toBe(true);
  });

  it.each([
    ["players", PlayerListResponseSchema, emptyPlayerListResponseFixture],
    ["teams", TeamListResponseSchema, emptyTeamListResponseFixture],
    [
      "standings",
      StandingsListResponseSchema,
      emptyStandingsListResponseFixture,
    ],
    [
      "change events",
      ChangeEventListResponseSchema,
      emptyChangeEventListResponseFixture,
    ],
    [
      "source health",
      SourceHealthListResponseSchema,
      emptySourceHealthListResponseFixture,
    ],
    [
      "quarantines",
      QuarantineListResponseSchema,
      emptyQuarantineListResponseFixture,
    ],
  ])("accepts an empty %s page", (_name, schema, fixture) => {
    expect(schema.safeParse(fixture).success).toBe(true);
  });
});

describe("API contract rejection", () => {
  it("rejects negative player summary stats", () => {
    expect(
      PlayerSummarySchema.safeParse({
        ...validPlayerSummaryFixture,
        stats: { ...validPlayerSummaryFixture.stats, goals: -1 },
      }).success,
    ).toBe(false);
  });

  it("rejects malformed player detail snapshot hashes", () => {
    expect(
      PlayerDetailResponseSchema.safeParse({
        ...validPlayerDetailResponseFixture,
        data: {
          ...validPlayerDetailResponseFixture.data,
          latestSnapshot: {
            ...validPlayerDetailResponseFixture.data.latestSnapshot,
            payloadHash: "not-a-sha256-hash",
          },
        },
      }).success,
    ).toBe(false);
  });

  it("rejects list metadata that claims another page after the total", () => {
    expect(
      PlayerListResponseSchema.safeParse({
        ...validPlayerListResponseFixture,
        pagination: {
          ...validPlayerListResponseFixture.pagination,
          hasMore: true,
        },
      }).success,
    ).toBe(false);
  });

  it("rejects change events with timezone-free detection timestamps", () => {
    expect(
      ChangeEventListResponseSchema.safeParse({
        ...validChangeEventListResponseFixture,
        data: [
          {
            ...(validChangeEventListResponseFixture.data[0] as object),
            detectedAt: "2026-08-21T14:00:00",
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("rejects a healthy source with an active incident", () => {
    expect(
      SourceHealthListResponseSchema.safeParse({
        ...validSourceHealthListResponseFixture,
        data: [
          {
            ...validSourceHealthFixture,
            activeIncident: {
              incidentId: "ec1ef7d9-f67c-45ab-b4a9-dfcf406564d2",
              openedAt: "2026-08-21T14:05:00.000Z",
              reason: "invalid-extraction",
              detail: "Invalid stat value",
            },
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("rejects quarantine records without validation issues", () => {
    expect(
      QuarantineListResponseSchema.safeParse({
        ...validQuarantineListResponseFixture,
        data: [
          {
            ...validQuarantinedExtractionFixture,
            issues: [],
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("rejects recovery evidence completed before it started", () => {
    expect(
      RecoveryEvidenceResponseSchema.safeParse({
        ...validRecoveryEvidenceResponseFixture,
        data: {
          ...validRecoveryEvidenceResponseFixture.data,
          completedAt: "2026-08-21T14:00:00.000Z",
        },
      }).success,
    ).toBe(false);
  });

  it("rejects API error status and code mismatches", () => {
    expect(
      ApiErrorResponseSchema.safeParse({
        ...validApiErrorResponseFixture,
        error: {
          ...validApiErrorResponseFixture.error,
          status: 500,
        },
      }).success,
    ).toBe(false);
  });

  it("rejects generated timestamps without an explicit timezone", () => {
    expect(
      ApiHealthResponseSchema.safeParse({
        ...validApiHealthResponseFixture,
        generatedAt: "2026-08-21T14:15:00",
      }).success,
    ).toBe(false);
  });
});
