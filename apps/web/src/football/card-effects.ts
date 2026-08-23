import type { GenerationState, RailStep } from "./flow";

export type GlitchTier =
  | "drift"
  | "slice"
  | "validate"
  | "align"
  | "quarantine"
  | "settled";

export type ShellPlate = "frame" | "art" | "rails" | "stats" | "foil";

export const SHELL_PLATES: readonly ShellPlate[] = [
  "frame",
  "art",
  "rails",
  "stats",
  "foil",
];

export const TILT_MAX_Y_DEG = 6;
export const TILT_MAX_X_DEG = 5;
export const REVEAL_ANIMATION_NAME = "cardpulse-press-align";
export const REVEAL_DURATION_MS = 560;

export function glitchTierFor(generation: GenerationState): GlitchTier {
  if (generation.kind === "running") {
    switch (generation.step) {
      case "finding-player":
        return "drift";
      case "starting-collector":
      case "extracting-statistics":
        return "slice";
      case "validating-data":
        return "validate";
      case "printing-card":
        return "align";
    }
  }
  if (generation.kind === "failed") return "quarantine";
  return "settled";
}

export function assembledPlates(
  completed: ReadonlySet<RailStep>,
): Record<ShellPlate, boolean> {
  return {
    frame: true,
    art: completed.has("finding-player"),
    rails: completed.has("starting-collector"),
    stats: completed.has("extracting-statistics"),
    foil: completed.has("validating-data"),
  };
}

export interface PointerSample {
  px: number;
  py: number;
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0.5;
  return Math.min(1, Math.max(0, value));
}

function round2(value: number): number {
  return Number(value.toFixed(2));
}

export function tiltDegrees(sample: PointerSample): { rx: number; ry: number } {
  const px = clamp01(sample.px);
  const py = clamp01(sample.py);
  return {
    ry: round2((px - 0.5) * 2 * TILT_MAX_Y_DEG),
    rx: round2((0.5 - py) * 2 * TILT_MAX_X_DEG),
  };
}

export function holoPercent(sample: PointerSample): { x: number; y: number } {
  const px = clamp01(sample.px);
  const py = clamp01(sample.py);
  return {
    x: round2((0.5 - px) * 100),
    y: round2((0.5 - py) * 100),
  };
}

let revealSequence = 0;

export function printRevealNonce(playerId: string, season: string): string {
  revealSequence += 1;
  return `${playerId}:${season}:${Date.now().toString(36)}:${revealSequence.toString(36)}`;
}

export function revealDecision(
  nonce: string | null,
  lastPlayed: string | null,
  reducedMotion: boolean,
): boolean {
  return !reducedMotion && nonce !== null && nonce !== lastPlayed;
}

let lastRevealedNonce: string | null = null;

export function armPrintReveal(
  card: HTMLElement | null,
  nonce: string | null,
  reducedMotion: boolean,
): void {
  if (card === null || nonce === null) return;
  if (!revealDecision(nonce, lastRevealedNonce, reducedMotion)) return;
  lastRevealedNonce = nonce;
  card.classList.add("reveal-once");
  const settle = (event: AnimationEvent): void => {
    if (event.animationName !== REVEAL_ANIMATION_NAME) return;
    card.classList.remove("reveal-once");
    card.removeEventListener("animationend", settle);
  };
  card.addEventListener("animationend", settle);
}

export function bindPointerEffects(
  card: HTMLElement,
  isReducedMotion: () => boolean,
): () => void {
  let frame = 0;
  let sample: PointerSample | null = null;

  const apply = (): void => {
    if (sample === null) {
      card.style.setProperty("--rx", "0deg");
      card.style.setProperty("--ry", "0deg");
      card.style.setProperty("--holo-x", "0%");
      card.style.setProperty("--holo-y", "0%");
      return;
    }
    const tilt = tiltDegrees(sample);
    const holo = holoPercent(sample);
    card.style.setProperty("--rx", `${tilt.rx}deg`);
    card.style.setProperty("--ry", `${tilt.ry}deg`);
    card.style.setProperty("--holo-x", `${holo.x}%`);
    card.style.setProperty("--holo-y", `${holo.y}%`);
  };

  const flush = (): void => {
    frame = 0;
    apply();
  };

  const schedule = (): void => {
    if (frame !== 0) return;
    frame = window.requestAnimationFrame(flush);
  };

  const readSample = (event: PointerEvent): PointerSample => {
    const rect = card.getBoundingClientRect();
    return {
      px: (event.clientX - rect.left) / Math.max(rect.width, 1),
      py: (event.clientY - rect.top) / Math.max(rect.height, 1),
    };
  };

  const onLeave = (): void => {
    sample = null;
    card.classList.remove("tilting");
    schedule();
  };

  const onMove = (event: PointerEvent): void => {
    if (event.pointerType === "touch") return;
    if (isReducedMotion()) {
      onLeave();
      return;
    }
    sample = readSample(event);
    card.classList.add("tilting");
    schedule();
  };

  card.addEventListener("pointermove", onMove);
  card.addEventListener("pointerleave", onLeave);
  card.addEventListener("pointercancel", onLeave);

  return () => {
    if (frame !== 0) window.cancelAnimationFrame(frame);
    frame = 0;
    sample = null;
    card.removeEventListener("pointermove", onMove);
    card.removeEventListener("pointerleave", onLeave);
    card.removeEventListener("pointercancel", onLeave);
  };
}
