import { describe, expect, it } from "vitest";

import { validPlayerFixture } from "@bidsentinel/contracts/fixtures";

import {
  hashPayload,
  stableStringify,
  validateFootballExtraction,
} from "./index.js";

const context = {
  sourceId: "openligadb",
  extractorVersion: "fixture-v1",
  observedAt: "2026-08-20T14:00:00.000Z",
};

describe("validateFootballExtraction", () => {
  it("returns a canonical player card for valid input", () => {
    const result = validateFootballExtraction(validPlayerFixture, context);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.entityId).toBe(validPlayerFixture.playerId);
      expect(
        result.value.entityType === "player" &&
          result.value.playerName === validPlayerFixture.playerName,
      ).toBe(true);
    }
  });

  it("quarantines invalid extraction with the original payload and issues", () => {
    const invalidPayload = {
      ...validPlayerFixture,
      stats: { ...validPlayerFixture.stats, goals: "eighteen" },
    };
    const result = validateFootballExtraction(invalidPayload, context);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.quarantine.rawPayload).toEqual(invalidPayload);
      expect(result.quarantine.issues[0]?.path).toEqual(["stats", "goals"]);
      expect(result.quarantine.payloadHash).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  it("quarantines a structurally broken row as schema drift evidence", () => {
    const result = validateFootballExtraction(
      { entityType: "player", playerId: "openligadb:player:broken" },
      context,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.quarantine.issues.some((issue) => issue.code === "invalid_type"),
      ).toBe(true);
    }
  });

  it("quarantines a valid payload attributed to the wrong source", () => {
    const result = validateFootballExtraction(validPlayerFixture, {
      ...context,
      sourceId: "kicker-demo",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.quarantine.issues[0]?.code).toBe("source_id_mismatch");
    }
  });
});

describe("stable payload hashing", () => {
  it("is independent of object key order", () => {
    const left = { nested: { second: 2, first: 1 }, name: "player" };
    const right = { name: "player", nested: { first: 1, second: 2 } };

    expect(stableStringify(left)).toBe(stableStringify(right));
    expect(hashPayload(left)).toBe(hashPayload(right));
  });
});
