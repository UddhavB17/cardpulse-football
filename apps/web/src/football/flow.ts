// Pure state machine for the card generation rail.
//
// The UI shows exactly five operations, in this order:
//   Finding player -> Starting collector -> Extracting statistics
//     -> Validating data -> Printing card
//
// Every transition is driven by a resolved network milestone (request sent,
// response parsed, poll settled). Nothing advances on a timer, so a stage can
// never appear complete before the async work that backs it has resolved.
// While any real request or poll is pending the chrome glitches; it stops
// instantly when the machine settles into done/failed.

export const RAIL_STEPS = [
  "finding-player",
  "starting-collector",
  "extracting-statistics",
  "validating-data",
  "printing-card",
] as const;

export type RailStep = (typeof RAIL_STEPS)[number];

export const RAIL_LABELS: Record<RailStep, string> = {
  "finding-player": "Finding player",
  "starting-collector": "Starting collector",
  "extracting-statistics": "Extracting statistics",
  "validating-data": "Validating data",
  "printing-card": "Printing card",
};

export type GenerationMode = "live" | "demo";

export type GenerationState =
  | { kind: "idle" }
  | { kind: "running"; step: RailStep; mode: GenerationMode }
  | { kind: "done"; mode: GenerationMode }
  | {
      kind: "failed";
      step: RailStep | null;
      reason: string;
      mode: GenerationMode;
    };

export interface FlowState {
  generation: GenerationState;
  /** Id of the last successfully printed card. Survives every failure. */
  preservedCardId: string | null;
}

export type FlowEvent =
  | { type: "begin"; mode: GenerationMode }
  | { type: "player-found" }
  | { type: "collector-accepted" }
  | { type: "extraction-complete" }
  | { type: "validation-passed"; cardId: string }
  | { type: "card-printed"; cardId: string }
  | { type: "failed"; reason: string }
  | { type: "reset" };

export function initialFlowState(): FlowState {
  return { generation: { kind: "idle" }, preservedCardId: null };
}

export function transition(state: FlowState, event: FlowEvent): FlowState {
  const generation = state.generation;

  switch (event.type) {
    case "begin": {
      if (generation.kind === "running") return state;
      return {
        ...state,
        generation: {
          kind: "running",
          step: "finding-player",
          mode: event.mode,
        },
      };
    }

    case "player-found": {
      if (
        generation.kind !== "running" ||
        generation.step !== "finding-player"
      ) {
        return state;
      }
      return {
        ...state,
        generation: { ...generation, step: "starting-collector" },
      };
    }

    case "collector-accepted": {
      // A synchronous generate response may resolve both the player lookup and
      // the collector start at once; accept it from either pending step.
      if (
        generation.kind !== "running" ||
        (generation.step !== "starting-collector" &&
          generation.step !== "finding-player")
      ) {
        return state;
      }
      return {
        ...state,
        generation: { ...generation, step: "extracting-statistics" },
      };
    }

    case "extraction-complete": {
      if (
        generation.kind !== "running" ||
        generation.step !== "extracting-statistics"
      ) {
        return state;
      }
      return {
        ...state,
        generation: { ...generation, step: "validating-data" },
      };
    }

    case "validation-passed": {
      if (
        generation.kind !== "running" ||
        generation.step !== "validating-data"
      ) {
        return state;
      }
      return { ...state, generation: { ...generation, step: "printing-card" } };
    }

    case "card-printed": {
      if (generation.kind !== "running") return state;
      return {
        generation: { kind: "done", mode: generation.mode },
        preservedCardId: event.cardId,
      };
    }

    case "failed": {
      if (generation.kind !== "running") return state;
      return {
        ...state,
        generation: {
          kind: "failed",
          step: generation.step,
          reason: event.reason,
          mode: generation.mode,
        },
      };
    }

    case "reset":
      return initialFlowState();

    default:
      return state;
  }
}

/** Steps strictly before the current one count as completed. */
export function completedSteps(state: FlowState): ReadonlySet<RailStep> {
  const done = new Set<RailStep>();
  if (state.generation.kind === "running") {
    for (const step of RAIL_STEPS) {
      if (step === state.generation.step) break;
      done.add(step);
    }
  } else if (state.generation.kind === "done") {
    for (const step of RAIL_STEPS) done.add(step);
  }
  return done;
}

/** True only while a real request/poll is in flight — drives the glitch. */
export function isWorkPending(state: FlowState): boolean {
  return state.generation.kind === "running";
}
