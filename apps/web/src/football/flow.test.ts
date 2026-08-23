import { describe, expect, it } from "vitest";

import {
  RAIL_LABELS,
  RAIL_STEPS,
  completedSteps,
  initialFlowState,
  isWorkPending,
  transition,
  type FlowEvent,
  type FlowState,
} from "./flow";

function run(state: FlowState, events: FlowEvent[]): FlowState {
  return events.reduce((current, event) => transition(current, event), state);
}

function liveRun(): FlowState {
  return run(initialFlowState(), [
    { type: "begin", mode: "live" },
    { type: "player-found" },
    { type: "collector-accepted" },
    { type: "extraction-complete" },
    { type: "validation-passed", cardId: "player-1" },
    { type: "card-printed", cardId: "player-1" },
  ]);
}

describe("rail vocabulary", () => {
  it("exposes exactly the five truthful operations in order", () => {
    expect([...RAIL_STEPS]).toEqual([
      "finding-player",
      "starting-collector",
      "extracting-statistics",
      "validating-data",
      "printing-card",
    ]);
    expect(RAIL_LABELS["finding-player"]).toBe("Finding player");
    expect(RAIL_LABELS["starting-collector"]).toBe("Starting collector");
    expect(RAIL_LABELS["extracting-statistics"]).toBe("Extracting statistics");
    expect(RAIL_LABELS["validating-data"]).toBe("Validating data");
    expect(RAIL_LABELS["printing-card"]).toBe("Printing card");
  });
});

describe("generation flow", () => {
  it("advances through all five steps only as async milestones resolve", () => {
    let state = initialFlowState();
    expect(isWorkPending(state)).toBe(false);

    state = transition(state, { type: "begin", mode: "live" });
    expect(state.generation).toMatchObject({
      kind: "running",
      step: "finding-player",
      mode: "live",
    });
    // No step is complete before its request resolves.
    expect(completedSteps(state).size).toBe(0);

    state = transition(state, { type: "player-found" });
    expect(state.generation).toMatchObject({ step: "starting-collector" });
    expect(completedSteps(state)).toContain("finding-player");

    state = transition(state, { type: "collector-accepted" });
    expect(state.generation).toMatchObject({ step: "extracting-statistics" });

    state = transition(state, { type: "extraction-complete" });
    expect(state.generation).toMatchObject({ step: "validating-data" });

    state = transition(state, { type: "validation-passed", cardId: "p1" });
    expect(state.generation).toMatchObject({ step: "printing-card" });

    state = transition(state, { type: "card-printed", cardId: "p1" });
    expect(state.generation.kind).toBe("done");
    expect(isWorkPending(state)).toBe(false);
    expect(completedSteps(state).size).toBe(5);
    expect(state.preservedCardId).toBe("p1");
  });

  it("ignores out-of-order milestones instead of faking progress", () => {
    const rejected = run(initialFlowState(), [
      { type: "begin", mode: "live" },
      { type: "extraction-complete" },
    ]);
    expect(rejected.generation).toMatchObject({
      kind: "running",
      step: "finding-player",
    });

    const idleRejected = transition(initialFlowState(), {
      type: "card-printed",
      cardId: "x",
    });
    expect(idleRejected.generation.kind).toBe("idle");

    const doubleBegin = run(initialFlowState(), [
      { type: "begin", mode: "live" },
      { type: "begin", mode: "live" },
    ]);
    expect(doubleBegin.generation).toMatchObject({
      kind: "running",
      step: "finding-player",
    });
  });

  it("lets a synchronous generate response skip the poll wait truthfully", () => {
    const syncCard = run(initialFlowState(), [
      { type: "begin", mode: "live" },
      { type: "collector-accepted" },
      { type: "extraction-complete" },
      { type: "validation-passed", cardId: "cached-1" },
      { type: "card-printed", cardId: "cached-1" },
    ]);
    expect(syncCard.generation.kind).toBe("done");
    expect(syncCard.preservedCardId).toBe("cached-1");
  });

  it("fails into the pending step and preserves the last printed card", () => {
    const verified = liveRun();
    const regenerating = transition(verified, { type: "begin", mode: "live" });
    const failed = run(regenerating, [
      { type: "player-found" },
      { type: "failed", reason: "Collector returned 503" },
    ]);

    expect(failed.generation).toMatchObject({
      kind: "failed",
      reason: "Collector returned 503",
    });
    if (failed.generation.kind === "failed") {
      expect(failed.generation.step).toBe("starting-collector");
    }
    // The previously verified card survives untouched.
    expect(failed.preservedCardId).toBe("player-1");
    expect(isWorkPending(failed)).toBe(false);
  });

  it("stops glitching instantly on success or failure", () => {
    const running = transition(initialFlowState(), {
      type: "begin",
      mode: "live",
    });
    const polling = transition(running, { type: "player-found" });
    expect(isWorkPending(polling)).toBe(true);
    const settled = transition(polling, {
      type: "failed",
      reason: "poll timeout",
    });
    expect(isWorkPending(settled)).toBe(false);

    const done = transition(
      run(initialFlowState(), [
        { type: "begin", mode: "live" },
        { type: "player-found" },
        { type: "collector-accepted" },
        { type: "extraction-complete" },
        { type: "validation-passed", cardId: "d1" },
      ]),
      { type: "card-printed", cardId: "d1" },
    );
    expect(isWorkPending(done)).toBe(false);
  });

  it("reset returns to a clean machine without a preserved id", () => {
    expect(transition(liveRun(), { type: "reset" })).toEqual(
      initialFlowState(),
    );
  });
});
