import { describe, expect, it } from "vitest";

import {
  athleteArchetypeSvg,
  athleteArtworkPlan,
  archetypeSvg,
} from "./artwork";
import { resolveArchetype } from "./archetypes";

const haalandInput = {
  playerId: "statbunker:player:haaland",
  playerName: "Erling Haaland",
  position: "forward",
};

const rodriInput = {
  playerId: "statbunker:player:rodri",
  playerName: "Rodri",
  position: "midfielder",
};

describe("archetype svg rendering", () => {
  it("renders the curated frost-monolith composition for Haaland", () => {
    const { svg, archetype } = athleteArtworkPlan(haalandInput);
    expect(archetype.id).toBe("nordic-no-9");
    expect(svg).toContain('class="motif motif-frost-monolith"');
    expect(svg).toContain("--cp-a1:#4a7ba6");
    expect(svg).toContain("--cp-a2:#aee6f2");
    expect(svg).toContain("Nordic No. 9");
  });

  it("renders the orbital-compass composition for Rodri", () => {
    const { svg } = athleteArtworkPlan(rodriInput);
    expect(svg).toContain('class="motif motif-orbital-compass"');
    expect(svg).toContain("--cp-a1:#c9a227");
    expect(svg).toContain("--cp-a2:#17171c");
    expect(svg).toContain("Midfield Architect");
  });

  it("renders every positional motif distinctly", () => {
    const cases: ReadonlyArray<readonly [string, string, string]> = [
      ["forward", "diagonal-burst", "Forward Signal"],
      ["midfielder", "engine-orbit", "Midfield Engine"],
      ["defender", "stacked-wall", "Defensive Wall"],
      ["goalkeeper", "radar-target", "Last Line"],
      [null as unknown as string, "neutral-edition", "CardPulse Edition"],
    ];
    for (const [position, motifClass, title] of cases) {
      const svg = athleteArchetypeSvg({
        playerId: `p:${String(title)}`,
        playerName: "Unknown Player",
        position,
      });
      expect(svg).toContain(`motif-${motifClass}`);
      expect(svg).toContain(title);
    }
  });

  it("keeps the shared faceless figure and card chrome", () => {
    const svg = athleteArchetypeSvg({
      ...haalandInput,
      uniqueKey: "2025/26",
    });
    expect(svg).toContain('class="arch-figure"');
    expect(svg).toContain('viewBox="0 0 220 300"');
    expect(svg).toContain('role="img"');
  });
});

describe("deterministic rendering", () => {
  it("produces byte-identical markup for identical inputs", () => {
    const a = athleteArchetypeSvg(haalandInput);
    const b = athleteArchetypeSvg(haalandInput);
    expect(a).toBe(b);
  });

  it("produces unique def ids per player and per unique key", () => {
    const seasonA = athleteArchetypeSvg({ ...haalandInput, uniqueKey: "2024/25" });
    const seasonB = athleteArchetypeSvg({ ...haalandInput, uniqueKey: "2025/26" });
    expect(seasonA).not.toBe(seasonB);

    const idA = seasonA.match(/id="([^"]+)"/)?.[1];
    const idB = seasonB.match(/id="([^"]+)"/)?.[1];
    expect(idA).toBeTruthy();
    expect(idB).toBeTruthy();
    expect(idA).not.toBe(idB);
    // Each instance references exactly its own def id.
    expect(seasonA).toContain(`url(#${idA})`);
    expect(seasonA).not.toContain(`url(#${idB})`);
    expect(seasonB).toContain(`url(#${idB})`);
  });
});

describe("safe output", () => {
  it("neutralizes hostile content in ids and interpolated text", () => {
    const hostile = {
      playerId: '<img src=x onerror=alert(1)>',
      playerName: '"><script>alert("pwned")</script>',
      position: "forward",
    };
    const svg = athleteArchetypeSvg(hostile);
    // No element injection: hostile markup never survives into tags.
    expect(svg).not.toContain("<img");
    expect(svg).not.toContain("<script>");
    expect(svg).not.toContain("onerror=");
    // Def ids are reduced to inert token characters only.
    for (const id of [...svg.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1])) {
      expect(id).toMatch(/^[-a-zA-Z0-9_]*$/);
    }
  });

  it("escapes accessible labels so text nodes cannot break out", () => {
    const archetype = {
      ...resolveArchetype({ playerName: "Safe Player" }),
      editorialTitle: 'Quote "The & <Escape>',
      description: "Angles & curves <test> \"edge\" 'cases'",
    };
    const svg = archetypeSvg(archetype, { idPrefix: "x" });
    expect(svg).toContain("&amp;");
    expect(svg).toContain("&lt;test&gt;");
    expect(svg).toContain("&quot;edge&quot;");
    expect(svg).not.toMatch(/[^&]<(test)/);
  });

  it("never embeds the raw player name in markup", () => {
    const svg = athleteArchetypeSvg({
      playerId: "p1",
      playerName: "Evil <b>Name</b>",
    });
    expect(svg).not.toContain("Evil <b>Name</b>");
    expect(svg).not.toContain("<b>");
  });
});

describe("markup budget", () => {
  it("stays small enough for repeated rendering", () => {
    for (const position of ["forward", "midfielder", "defender", "goalkeeper"]) {
      const svg = athleteArchetypeSvg({
        playerId: `budget:${position}`,
        playerName: "Budget Player",
        position,
      });
      expect(svg.length).toBeLessThan(9000);
      expect(svg.length).toBeGreaterThan(500);
    }
  });

  it("uses CSS custom properties and currentColor instead of hardcoded ink", () => {
    const svg = athleteArchetypeSvg(rodriInput);
    expect(svg).toContain("currentColor");
    expect(svg).toContain("--card-paper,#f5efe2");
  });
});
