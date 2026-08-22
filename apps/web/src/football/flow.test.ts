import { describe, expect, it } from "vitest";

import {
  hydrateFlowState,
  initialFlowState,
  isChromeGlitched,
  railStepIndex,
  transition,
  type FlowEvent,
  type FlowState,
} from "./flow";

function run(state: FlowState, events: FlowEvent[]): FlowState {
  return events.reduce((current, event) => transition(current, event), state);
}

describe("generate flow", () => {
  it("advances idle -> connecting -> extracting -> validating -> materializing -> verified", () => {
    const final = run(initialFlowState(), [
      { type: "generate-start" },
      { type: "connection-established" },
      { type: "extraction-complete" },
      { type: "validation-passed", cardId: "player-1" },
      { type: "card-materialized" },
    ]);

    expect(final.phase).toBe("verified");
    expect(final.recovery).toBe("none");
    expect(final.preservedCardId).toBe("player-1");
    expect(final.error).toBeNull();
  });

  it("rejects out-of-order steps without corrupting state", () => {
    const rejected = transition(initialFlowState(), {
      type: "extraction-complete",
    });

    expect(rejected.phase).toBe("idle");
    expect(rejected.error).toContain("out of order");
  });

  it("blocks the pipeline when connection fails and records the reason", () => {
    const blocked = run(initialFlowState(), [
      { type: "generate-start" },
      { type: "connection-failed", reason: "API unreachable" },
    ]);

    expect(blocked.phase).toBe("blocked");
    expect(blocked.error).toBe("API unreachable");

    // A retry from blocked restarts the generation chain cleanly.
    const retried = transition(blocked, { type: "generate-start" });
    expect(retried.phase).toBe("connecting");
    expect(retried.error).toBeNull();
  });

  it("a failed validation preserves the previously verified card id", () => {
    const verified = run(initialFlowState(), [
      { type: "generate-start" },
      { type: "connection-established" },
      { type: "extraction-complete" },
      { type: "validation-passed", cardId: "hero-v1" },
      { type: "card-materialized" },
    ]);

    const regenerating = transition(verified, { type: "generate-start" });
    const failed = run(regenerating, [
      { type: "connection-established" },
      { type: "extraction-complete" },
      {
        type: "validation-failed",
        reason: "Contract drift",
        preservedCardId: null,
      },
    ]);

    expect(failed.phase).toBe("blocked");
    expect(failed.recovery).toBe("compromised");
    // The preserved card survives even though no new one was passed in.
    expect(failed.preservedCardId).toBe("hero-v1");
    expect(failed.error).toBe("Contract drift");
  });
});

describe("drift recovery flow", () => {
  function verifiedState(): FlowState {
    return run(initialFlowState(), [
      { type: "generate-start" },
      { type: "connection-established" },
      { type: "extraction-complete" },
      { type: "validation-passed", cardId: "hero-v1" },
      { type: "card-materialized" },
    ]);
  }

  it("walks compromised -> repair-requested -> preview-valid -> recovered", () => {
    const recovered = run(verifiedState(), [
      { type: "drift-confirmed", preservedCardId: "hero-v1" },
      { type: "repair-requested" },
      { type: "preview-resolved", valid: true },
      { type: "repair-approved", outcome: "recovered" },
    ]);

    expect(recovered.recovery).toBe("recovered");
    expect(recovered.phase).toBe("verified");
    expect(recovered.preservedCardId).toBe("hero-v1");
    expect(isChromeGlitched(recovered)).toBe(false);
  });

  it("glitches chrome through every recovery phase until recovery lands", () => {
    let current = verifiedState();
    for (const event of [
      { type: "drift-confirmed", preservedCardId: "hero-v1" },
      { type: "repair-requested" },
      { type: "preview-resolved", valid: true },
    ] as const) {
      current = transition(current, event);
      expect(isChromeGlitched(current)).toBe(true);
    }
  });

  it("refuses approval before a preview resolves", () => {
    const guarded = transition(
      run(verifiedState(), [
        { type: "drift-confirmed", preservedCardId: "hero-v1" },
        { type: "repair-requested" },
      ]),
      { type: "repair-approved", outcome: "recovered" },
    );

    expect(guarded.recovery).toBe("repair-requested");
    expect(guarded.error).toContain("validated preview");
  });

  it("records a safe failure outcome without losing the preserved card", () => {
    const failed = run(verifiedState(), [
      { type: "drift-confirmed", preservedCardId: "hero-v1" },
      { type: "repair-requested" },
      { type: "preview-resolved", valid: true },
      { type: "repair-approved", outcome: "failed" },
    ]);

    expect(failed.recovery).toBe("recovery-failed");
    expect(failed.preservedCardId).toBe("hero-v1");
  });

  it("ignores drift confirmation unless a card is verified", () => {
    const rejected = transition(initialFlowState(), {
      type: "drift-confirmed",
      preservedCardId: null,
    });

    expect(rejected.recovery).toBe("none");
    expect(rejected.error).toContain("verified");
  });

  it("hydrates an interrupted recovery without restarting collection", () => {
    expect(hydrateFlowState("healing_requested", "hero-v1")).toMatchObject({
      phase: "verified",
      recovery: "compromised",
      preservedCardId: "hero-v1",
    });
    expect(hydrateFlowState("preview_valid", "hero-v1").recovery).toBe(
      "preview-valid",
    );
    expect(hydrateFlowState("approved", "hero-v1").recovery).toBe("approved");
    expect(hydrateFlowState("recovered", "hero-v1").recovery).toBe("recovered");
  });
});

describe("rail mapping", () => {
  it("maps phases onto ordered rail steps with blocked last", () => {
    expect(railStepIndex("idle")).toBe(0);
    expect(railStepIndex("extracting")).toBe(2);
    expect(railStepIndex("verified")).toBe(5);
    expect(railStepIndex("blocked")).toBe(6);
  });
});
