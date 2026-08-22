// Pure state machine for the two observable CardPulse flows:
//
// 1. Generate live card:
//    idle -> connecting -> extracting -> validating -> materializing -> verified
// 2. Failure / recovery (drift):
//    verified --drift--> compromised -> repair-requested -> preview-pending
//      -> preview-valid|preview-invalid -> recovered|recovery-failed
//
// The UI may only advance through these transitions; every other event is
// ignored so out-of-order clicks can never fake progress. Phase changes are
// driven exclusively by resolved async work in the orchestrator.

export type GenerationPhase =
  | "idle"
  | "connecting"
  | "extracting"
  | "validating"
  | "materializing"
  | "verified"
  | "blocked";

export type RecoveryPhase =
  | "none"
  | "compromised"
  | "repair-requested"
  | "preview-pending"
  | "preview-valid"
  | "preview-invalid"
  | "approved"
  | "recovered"
  | "recovery-failed";

export type PersistedHealingState =
  | "healthy"
  | "quarantined"
  | "healing_requested"
  | "awaiting_approval"
  | "preview_valid"
  | "preview_invalid"
  | "approved"
  | "rejected"
  | "recovered"
  | "recovery_failed";

export interface FlowState {
  phase: GenerationPhase;
  recovery: RecoveryPhase;
  /** Id of the last verified card that must survive drift untouched. */
  preservedCardId: string | null;
  error: string | null;
}

export type FlowEvent =
  | { type: "generate-start" }
  | { type: "connection-established" }
  | { type: "connection-failed"; reason: string }
  | { type: "extraction-complete" }
  | { type: "validation-passed"; cardId: string }
  | {
      type: "validation-failed";
      reason: string;
      preservedCardId: string | null;
    }
  | { type: "card-materialized" }
  | { type: "drift-confirmed"; preservedCardId: string | null }
  | { type: "repair-requested" }
  | { type: "preview-resolved"; valid: boolean }
  | { type: "repair-approved"; outcome: "recovered" | "failed" }
  | { type: "reset" };

export function initialFlowState(): FlowState {
  return {
    phase: "idle",
    recovery: "none",
    preservedCardId: null,
    error: null,
  };
}

/** Rebuild the visual state after a page reload without mutating the API. */
export function hydrateFlowState(
  healingState: PersistedHealingState,
  preservedCardId: string,
): FlowState {
  const recoveryByState: Record<PersistedHealingState, RecoveryPhase> = {
    healthy: "none",
    quarantined: "compromised",
    healing_requested: "compromised",
    awaiting_approval: "repair-requested",
    preview_valid: "preview-valid",
    preview_invalid: "preview-invalid",
    approved: "approved",
    rejected: "recovery-failed",
    recovered: "recovered",
    recovery_failed: "recovery-failed",
  };
  return {
    phase: "verified",
    recovery: recoveryByState[healingState],
    preservedCardId,
    error: null,
  };
}

/** Chrome-level glitch is active while the pipeline is not clean. */
export function isChromeGlitched(state: FlowState): boolean {
  return state.recovery !== "none" && state.recovery !== "recovered";
}

const GENERATION_ORDER: readonly GenerationPhase[] = [
  "idle",
  "connecting",
  "extracting",
  "validating",
  "materializing",
  "verified",
] as const;

/** Ordered steps for the status rail; blocked renders as a failed step. */
export function railStepIndex(phase: GenerationPhase): number {
  const index = GENERATION_ORDER.indexOf(phase);
  return index < 0 ? GENERATION_ORDER.length : index;
}

export function transition(state: FlowState, event: FlowEvent): FlowState {
  switch (event.type) {
    case "generate-start": {
      if (
        state.phase === "idle" ||
        state.phase === "verified" ||
        state.phase === "blocked"
      ) {
        return {
          ...state,
          phase: "connecting",
          error: null,
        };
      }
      return withRejection(state, "Generation already in progress");
    }

    case "connection-established": {
      if (state.phase !== "connecting") {
        return withRejection(state, "Connection confirmed out of order");
      }
      return { ...state, phase: "extracting", error: null };
    }

    case "connection-failed": {
      if (state.phase !== "connecting") {
        return withRejection(state, "Connection failure reported out of order");
      }
      return { ...state, phase: "blocked", error: event.reason };
    }

    case "extraction-complete": {
      if (state.phase !== "extracting") {
        return withRejection(state, "Extraction finished out of order");
      }
      return { ...state, phase: "validating", error: null };
    }

    case "validation-passed": {
      if (state.phase !== "validating") {
        return withRejection(state, "Validation passed out of order");
      }
      return {
        ...state,
        phase: "materializing",
        recovery: state.recovery === "none" ? "none" : state.recovery,
        preservedCardId: event.cardId,
        error: null,
      };
    }

    case "validation-failed": {
      if (state.phase !== "validating") {
        return withRejection(state, "Validation failed out of order");
      }
      return {
        ...state,
        phase: "blocked",
        recovery: "compromised",
        preservedCardId: event.preservedCardId ?? state.preservedCardId,
        error: event.reason,
      };
    }

    case "card-materialized": {
      if (state.phase !== "materializing") {
        return withRejection(state, "Materialization finished out of order");
      }
      // A clean materialization heals any lingering chrome glitch.
      return { ...state, phase: "verified", recovery: "none", error: null };
    }

    case "drift-confirmed": {
      if (state.phase !== "verified") {
        return withRejection(
          state,
          "Drift can only be confirmed on a verified card",
        );
      }
      return {
        ...state,
        recovery: "compromised",
        preservedCardId: event.preservedCardId ?? state.preservedCardId,
        error: null,
      };
    }

    case "repair-requested": {
      if (state.recovery !== "compromised") {
        return withRejection(state, "No active compromise to repair");
      }
      return { ...state, recovery: "repair-requested", error: null };
    }

    case "preview-resolved": {
      if (state.recovery !== "repair-requested") {
        return withRejection(state, "No repair preview pending validation");
      }
      return {
        ...state,
        recovery: event.valid ? "preview-valid" : "preview-invalid",
        error: null,
      };
    }

    case "repair-approved": {
      if (
        state.recovery !== "preview-valid" &&
        state.recovery !== "preview-invalid"
      ) {
        return withRejection(
          state,
          "Approval requires a validated preview first",
        );
      }
      if (event.outcome === "failed") {
        return { ...state, recovery: "recovery-failed", error: null };
      }
      return { ...state, recovery: "recovered", error: null };
    }

    case "reset":
      return initialFlowState();

    default:
      return withRejection(state, "Unknown flow event");
  }
}

function withRejection(state: FlowState, message: string): FlowState {
  return { ...state, error: message };
}
