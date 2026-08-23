import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const css = readFileSync(
  fileURLToPath(new URL("./style.css", import.meta.url)),
  "utf8",
);

function blockFor(mediaQuery: string): string {
  const index = css.indexOf(mediaQuery);
  if (index < 0) return "";
  const open = css.indexOf("{", index);
  let depth = 0;
  for (let cursor = open; cursor < css.length; cursor += 1) {
    if (css[cursor] === "{") depth += 1;
    if (css[cursor] === "}") {
      depth -= 1;
      if (depth === 0) return css.slice(index, cursor + 1);
    }
  }
  return "";
}

describe("reduced-motion CSS signal", () => {
  it("ships a prefers-reduced-motion block", () => {
    expect(css).toContain("prefers-reduced-motion");
  });

  it("disables glitch/jitter animations and pending-plate effects", () => {
    const block = blockFor("@media (prefers-reduced-motion: reduce)");
    expect(block).toContain("animation: none !important");
    expect(block).toContain("chrome-jitter");
    expect(block).toContain("plate-glitch");
  });

  it("removes tilt transforms and makes the flip an instant swap", () => {
    const block = blockFor("@media (prefers-reduced-motion: reduce)");
    expect(block).toContain(".flip-card");
    expect(block).toContain("transform: none !important");
    // Global transition kill covers the 3D rotation timing.
    expect(block).toContain("transition-duration: 0.001ms !important");
  });
});

describe("320px viewport support", () => {
  it("keeps the page at least 320px wide with no forced wider floor", () => {
    expect(css).toContain("min-width: 320px");
    expect(css).not.toContain("min-width: 360px");
  });

  it("guards against horizontal page overflow", () => {
    expect(css).toContain("overflow-x: hidden");
    expect(css).toContain("max-width: 100vw");
  });

  it("keeps interactive targets comfortably large for touch", () => {
    expect(css).toMatch(/\.search-input[\s\S]{0,200}min-height:\s*4[2-9]px/);
    expect(css).toMatch(/\.btn\s{0,2}{[\s\S]{0,300}min-height:\s*4[2-9]px/);
    expect(css).toMatch(/\.season-pill[\s\S]{0,300}min-height:\s*4[2-9]px/);
  });
});

describe("archetype presentation hooks", () => {
  it("styles the editorial title and gold special tier", () => {
    expect(css).toContain(".archetype-title");
    expect(css).toContain(".archetype-special");
    expect(css).toContain('[data-archetype="special"] .archetype-title');
    expect(css).toContain(".athlete-svg.archetype-svg");
  });
});
