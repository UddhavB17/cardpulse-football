import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  REVEAL_ANIMATION_NAME,
  SHELL_PLATES,
  TILT_MAX_X_DEG,
  TILT_MAX_Y_DEG,
  assembledPlates,
  glitchTierFor,
  holoPercent,
  printRevealNonce,
  revealDecision,
  tiltDegrees,
} from "./card-effects";
import { initialFlowState, transition, type RailStep } from "./flow";

const css = readFileSync(
  fileURLToPath(new URL("../card-effects.css", import.meta.url)),
  "utf8",
);
const main = readFileSync(
  fileURLToPath(new URL("../main.ts", import.meta.url)),
  "utf8",
);

function runningAt(
  step:
    | "finding-player"
    | "starting-collector"
    | "extracting-statistics"
    | "validating-data"
    | "printing-card",
) {
  let state = initialFlowState();
  state = transition(state, { type: "begin", mode: "live" });
  if (step !== "finding-player") state = transition(state, { type: "player-found" });
  if (step === "extracting-statistics" || step === "validating-data" || step === "printing-card") {
    state = transition(state, { type: "collector-accepted" });
  }
  if (step === "validating-data" || step === "printing-card") {
    state = transition(state, { type: "extraction-complete" });
  }
  if (step === "printing-card") {
    state = transition(state, { type: "validation-passed", cardId: "p1" });
  }
  return state;
}

describe("semantic glitch tiers", () => {
  it("maps player lookup to subtle registration drift", () => {
    expect(glitchTierFor(runningAt("finding-player").generation)).toBe("drift");
  });

  it("maps collection and extraction to sliced chromatic separation", () => {
    expect(glitchTierFor(runningAt("starting-collector").generation)).toBe("slice");
    expect(glitchTierFor(runningAt("extracting-statistics").generation)).toBe("slice");
  });

  it("maps validation to the strongest distortion tier", () => {
    expect(glitchTierFor(runningAt("validating-data").generation)).toBe("validate");
  });

  it("maps printing to plate alignment and success to settled stillness", () => {
    expect(glitchTierFor(runningAt("printing-card").generation)).toBe("align");
    const done = transition(runningAt("printing-card"), {
      type: "card-printed",
      cardId: "p1",
    });
    expect(glitchTierFor(done.generation)).toBe("settled");
  });

  it("maps failure to the quarantine freeze at any step", () => {
    for (const step of [
      "finding-player",
      "starting-collector",
      "extracting-statistics",
      "validating-data",
      "printing-card",
    ] as const) {
      const failed = transition(runningAt(step), {
        type: "failed",
        reason: "boom",
      });
      expect(glitchTierFor(failed.generation)).toBe("quarantine");
    }
  });

  it("never glitches while idle", () => {
    expect(glitchTierFor(initialFlowState().generation)).toBe("settled");
  });
});

describe("press shell plates assemble only from resolved milestones", () => {
  it("starts with just the frame when nothing has resolved", () => {
    const plates = assembledPlates(new Set());
    expect(plates.frame).toBe(true);
    expect(plates.art).toBe(false);
    expect(plates.rails).toBe(false);
    expect(plates.stats).toBe(false);
    expect(plates.foil).toBe(false);
  });

  it("adds one plate per completed pipeline step, in order", () => {
    const done = new Set<RailStep>(["finding-player"]);
    expect(assembledPlates(done)).toMatchObject({ art: true, rails: false });
    done.add("starting-collector");
    expect(assembledPlates(done)).toMatchObject({ rails: true, stats: false });
    done.add("extracting-statistics");
    expect(assembledPlates(done)).toMatchObject({ stats: true, foil: false });
    done.add("validating-data");
    const all = assembledPlates(done);
    expect(SHELL_PLATES.every((plate) => all[plate])).toBe(true);
  });
});

describe("pointer tilt stays bounded and holo runs opposite the tilt", () => {
  it("keeps approximately ±6deg Y and ±5deg X with zero at center", () => {
    expect(TILT_MAX_Y_DEG).toBeLessThanOrEqual(6.5);
    expect(TILT_MAX_X_DEG).toBeLessThanOrEqual(5.5);
    expect(tiltDegrees({ px: 0.5, py: 0.5 })).toEqual({ rx: 0, ry: 0 });
    expect(tiltDegrees({ px: 0, py: 0 })).toEqual({ rx: 5, ry: -6 });
    expect(tiltDegrees({ px: 1, py: 1 })).toEqual({ rx: -5, ry: 6 });
  });

  it("clamps out-of-range pointer samples", () => {
    expect(tiltDegrees({ px: 4, py: -3 })).toEqual({ rx: 5, ry: 6 });
    expect(holoPercent({ px: -2, py: 9 })).toEqual({ x: 50, y: -50 });
  });

  it("mirrors the highlight through center so it opposes the tilt", () => {
    expect(holoPercent({ px: 1, py: 0.5 }).x).toBeLessThan(0);
    expect(holoPercent({ px: 0, py: 0.5 }).x).toBeGreaterThan(0);
    expect(holoPercent({ px: 0.5, py: 0 }).y).toBeGreaterThan(0);
    expect(holoPercent({ px: 0.5, py: 1 }).y).toBeLessThan(0);
  });
});

describe("one-shot print reveal nonce", () => {
  it("plays once for a fresh nonce and never replays it", () => {
    expect(revealDecision("n1", null, false)).toBe(true);
    expect(revealDecision("n1", "n1", false)).toBe(false);
    expect(revealDecision("n2", "n1", false)).toBe(true);
  });

  it("never plays under reduced motion or without a nonce", () => {
    expect(revealDecision("n1", null, true)).toBe(false);
    expect(revealDecision(null, null, false)).toBe(false);
  });

  it("mints unique nonces per print run", () => {
    const a = printRevealNonce("p1", "2026");
    const b = printRevealNonce("p1", "2026");
    expect(a).not.toBe(b);
    expect(a).toContain("p1");
  });
});

describe("card-effects.css contract", () => {
  it("loads after style.css so overrides win the cascade", () => {
    expect(main.indexOf('"./style.css"')).toBeGreaterThan(-1);
    expect(main.indexOf('"./card-effects.css"')).toBeGreaterThan(
      main.indexOf('"./style.css"'),
    );
  });

  it("toggles generated-card layout from real card presence", () => {
    expect(main).toContain(
      'app.classList.toggle("has-card", state.card !== null)',
    );
  });

  it("keeps the provenance drawer collapsed in the judging view", () => {
    expect(main).toMatch(
      /<details class="drawer reveal" id="provenance-drawer">/,
    );
    expect(main).not.toMatch(/id="provenance-drawer"[^>]*\sopen/);
  });

  it("uses a real holo layer element driven by --holo-x/--holo-y", () => {
    expect(css).toContain(".holo-layer");
    expect(css).toContain("--holo-x");
    expect(css).toMatch(/\.holo-layer\s*{[^}]*mix-blend-mode:\s*overlay/);
  });

  it("shapes the generation shell as a semantic 5:7 press frame", () => {
    expect(css).toMatch(/\.gen-shell\s{[^}]*aspect-ratio:\s*5\s*\/\s*7/);
  });

  it("ships every semantic tier including the quarantine freeze", () => {
    for (const tier of ["drift", "slice", "validate", "align", "quarantine"]) {
      expect(css).toContain(`data-tier="${tier}"`);
    }
    expect(css).toMatch(
      /\[data-tier="quarantine"\][^{]*{\s*[^}]*animation:\s*none/,
    );
  });

  it("runs exactly one reveal animation inside the 450–650ms window", () => {
    const block = css.match(
      /\.flip-card\.reveal-once \.card-inner3d \{[\s\S]*?\}/,
    );
    expect(block).not.toBeNull();
    const duration = Number(block?.[0].match(/(\d+)ms/)?.[1]);
    expect(duration).toBeGreaterThanOrEqual(450);
    expect(duration).toBeLessThanOrEqual(650);
    expect(REVEAL_ANIMATION_NAME).toBe("cardpulse-press-align");
    expect(css).toContain("@keyframes cardpulse-press-align");
  });

  it("stamps a preserved verified card and keeps its faces clean while printing", () => {
    expect(main).toContain('class="verified-stamp">Last verified<');
    expect(css).toMatch(/\.regen-hold [^{]*face-front::after[^{]*{[^}]*content:\s*none/);
  });

  it("disables glitch, reveal, tilt movement and foil drift under reduced motion", () => {
    const media = css.match(
      /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*$/,
    );
    expect(media).not.toBeNull();
    const body = media?.[0] ?? "";
    expect(body).toContain(".holo-layer");
    expect(body).toContain("animation: none !important");
    expect(body.match(/background-position:[^;]*50% 44%/)).not.toBeNull();
  });
});
