import { describe, expect, it } from "vitest";

import {
  hashString,
  mulberry32,
  redactCollectorId,
  serialNumberFrom,
  signatureFrom,
  clamp,
} from "./util";

describe("deterministic primitives", () => {
  it("hashes stably and within the uint32 range", () => {
    expect(hashString("cardpulse")).toBe(hashString("cardpulse"));
    expect(hashString("cardpulse")).not.toBe(hashString("football"));
    expect(hashString("")).toBe(0x811c9dc5);
  });

  it("produces identical sequences for identical seeds", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const sequenceA = [a(), a(), a()];
    const sequenceB = [b(), b(), b()];
    expect(sequenceB).toEqual(sequenceA);
    for (const value of sequenceA) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it("derives stable signatures and serial numbers", () => {
    expect(signatureFrom("player:1")).toBe(signatureFrom("player:1"));
    expect(serialNumberFrom("player:1", "25")).toMatch(/^CP-\d{4}\/25$/);
  });

  it("clamps values into range", () => {
    expect(clamp(-2, 0, 100)).toBe(0);
    expect(clamp(140, 0, 100)).toBe(100);
    expect(clamp(42, 0, 100)).toBe(42);
  });
});

describe("collector redaction", () => {
  it("masks the middle of realistic collector ids", () => {
    expect(redactCollectorId("c_abcdef1234567890")).toBe("c_ab••••7890");
  });

  it("handles short, empty and missing ids without leaking", () => {
    expect(redactCollectorId("c_12")).toBe("c_••••");
    expect(redactCollectorId("abc123")).toBe("ab••••");
    expect(redactCollectorId("")).toBe("unassigned");
    expect(redactCollectorId(null)).toBe("unassigned");
    expect(redactCollectorId(undefined)).toBe("unassigned");
  });
});
