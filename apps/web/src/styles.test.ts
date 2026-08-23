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

function ruleBody(selector: string): string {
  const index = css.indexOf(`${selector} {`);
  if (index < 0) return "";
  const open = css.indexOf("{", index);
  let depth = 0;
  for (let cursor = open; cursor < css.length; cursor += 1) {
    if (css[cursor] === "{") depth += 1;
    if (css[cursor] === "}") {
      depth -= 1;
      if (depth === 0) return css.slice(open, cursor + 1);
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

  it("collapses press-shell, holo foil and print-celebration motion", () => {
    const block = blockFor("@media (prefers-reduced-motion: reduce)");
    expect(block).toContain(".generation-card-shell");
    expect(block).toContain(".holo-layer");
    expect(block).toContain(".just-printed");
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

  it("scrolls the operation rail inside its own strip, never the page", () => {
    expect(ruleBody(".rail")).toContain("overflow-x: auto");
  });
});

describe("design tokens and art-direction guards", () => {
  it("defines the Miles-inspired palette roles as tokens", () => {
    expect(css).toContain("--accent-red:");
    expect(css).toContain("--chroma-cyan:");
    expect(css).toContain("--chroma-magenta:");
    expect(css).toContain("--pitch:");
    expect(css).toContain("--gold:");
    expect(css).toContain("--paper:");
    expect(css).toContain("--ink:");
  });

  it("reserves chromatic separation for display faces only", () => {
    // Exactly two carriers: the .chromatic display-face effect and the
    // decorative (aria-hidden) card numeral. Body copy, controls and tiny
    // labels must never gain chromatic shadows.
    const shadowCarriers = css.match(/text-shadow:/g)?.length ?? 0;
    expect(shadowCarriers).toBe(2);
    expect(ruleBody(".chromatic")).toContain("text-shadow");
    expect(ruleBody(".thesis-note")).not.toContain("text-shadow");
    expect(ruleBody(".search-input")).not.toContain("text-shadow");
    expect(ruleBody(".btn")).not.toContain("text-shadow");
    expect(ruleBody(".season-pill")).not.toContain("text-shadow");
  });

  it("keeps focus indicators loud", () => {
    expect(css).toMatch(/:focus-visible[\s\S]{0,120}outline:[^;]*3px/);
  });

  it("never applies expensive page-wide filters or backdrop blur", () => {
    expect(css).not.toContain("backdrop-filter");
  });
});

describe("card hierarchy", () => {
  it("promotes three hero statistics over a quiet secondary ledger", () => {
    const trio = css.match(
      /\.stat-grid:not\(\.compact\) \.stat-cell:nth-child\(-n\+3\)[^{]*dd\s*{[^}]*font-size/,
    );
    expect(trio).not.toBeNull();
    const ledger = css.match(
      /\.stat-grid:not\(\.compact\) \.stat-cell:nth-child\(n\+4\)\s*{[^}]*grid-column:\s*1 \/ -1/,
    );
    expect(ledger).not.toBeNull();
  });

  it("renders verification as a physical health-green stamp", () => {
    const stamp = ruleBody(".verified-line,\n.last-verified");
    expect(stamp).toContain("var(--pitch)");
    expect(stamp).toMatch(/rotate\(-?\d/);
    expect(stamp).toContain("border: 2.5px solid");
  });

  it("provides archetype title hooks with a gold special tier", () => {
    expect(ruleBody(".archetype-title")).toBeTruthy();
    expect(css).toContain(".archetype-special");
  });
});

describe("generated-card mode (.has-card)", () => {
  const start = css.indexOf("GENERATED-CARD MODE");
  const end = css.indexOf("MOTION SUPPORT");
  const section = start >= 0 && end > start ? css.slice(start, end) : "";

  it("ships one contiguous .has-card override section", () => {
    expect(section).toContain(".has-card .hero-copy");
    expect(section).toContain(".has-card .finder");
    expect(section).toContain(".has-card .stage-section");
  });

  it("compresses hero copy instead of hiding content", () => {
    expect(section).toMatch(/font-size:\s*clamp\(22px/);
    expect(section).not.toContain("display: none");
  });

  it("flattens the finder into secondary chrome without shrinking controls", () => {
    const finderRule = section.match(/\.has-card \.finder\s*{[^}]*}/)?.[0] ?? "";
    expect(finderRule).toContain("box-shadow: none");
    expect(css).not.toMatch(
      /\.has-card [\s\S]{0,400}\.search-input[^{]*{\s*[^}]*min-height:\s*(4[01]|[123]?\d)px/,
    );
  });
});

describe("motion support surfaces", () => {
  it("shapes the generation press shell as a card-proportioned monument", () => {
    const shell = ruleBody(".generation-card-shell");
    expect(shell).toContain("aspect-ratio: 5 / 7");
    expect(shell).toContain("max-width: 430px");
  });

  it("keeps the holographic layer non-interactive and text-safe", () => {
    const holo = ruleBody(".holo-layer");
    expect(holo).toContain("pointer-events: none");
    expect(holo.trim()).toMatch(/opacity:\s*0;/);
    expect(holo).toMatch(/rgb\(\d+ \d+ \d+ \/ 0?\.1[0-9]?\)/);
  });

  it("restricts holo visibility and sheen sweeps to busy/print states", () => {
    expect(css).toContain(".is-busy .holo-layer");
    expect(css).toContain(".just-printed .holo-layer");
    expect(css).toContain(".is-busy .generation-card-shell::after");
  });

  it("runs the print celebration once, never looping", () => {
    expect(css).toMatch(/\.just-printed \.flip-card\s*{[^}]*animation:[^;]*1 both/);
    const celebrateBlock = css.slice(
      css.indexOf(".just-printed .flip-card"),
      css.indexOf(".just-printed .flip-card") + 400,
    );
    expect(celebrateBlock).not.toContain("infinite");
  });
});

describe("operator drawer", () => {
  it("keeps the collapsed summary discoverable yet quiet", () => {
    const summary = ruleBody(".drawer > summary");
    expect(summary).toMatch(/min-height:\s*4[2-9]px/);
    expect(summary).toContain("color: var(--ink)");
    expect(summary).not.toContain("background: var(--ink)");
    const openSummary = css.match(/\.drawer\[open\] > summary\s*{[^}]*}/)?.[0];
    expect(openSummary).toContain("background: var(--ink)");
  });
});

describe("print stability", () => {
  it("prints only card evidence at fixed trading-card size", () => {
    const block = blockFor("@media print");
    expect(block).toContain(".finder");
    expect(block).toContain(".pipeline");
    expect(block).toMatch(/width:\s*\d+mm/);
    expect(block).toContain(".face-back");
  });
});
