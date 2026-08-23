import { describe, expect, it } from "vitest";

import {
  ARCHETYPE_IDS,
  normalizePlayerName,
  normalizePosition,
  resolveArchetype,
  type VisualArchetype,
} from "./archetypes";

function resolve(
  playerName: string,
  position?: string | null,
  playerId?: string | null,
): VisualArchetype {
  return resolveArchetype({ playerName, position, playerId });
}

describe("curated archetypes", () => {
  it("maps Erling Haaland to the Nordic No. 9 edition", () => {
    const archetype = resolve("Erling Haaland", "forward", "statbunker:player:haaland");
    expect(archetype.id).toBe("nordic-no-9");
    expect(archetype.editorialTitle).toBe("Nordic No. 9");
    expect(archetype.motif).toBe("frost-monolith");
    expect(archetype.primaryAccent).toMatch(/^#[0-9a-f]{6}$/i);
    expect(archetype.secondaryAccent).toMatch(/^#[0-9a-f]{6}$/i);
    // Monumental vertical composition cues without claimed nicknames or props.
    expect(archetype.description.toLowerCase()).not.toMatch(/helmet|weapon|official nickname/);
  });

  it("maps Rodri to the Midfield Architect edition across name variants", () => {
    for (const name of ["Rodri", "RODRI", "Rodri Hernández", "Rodrigo Hernandez"]) {
      const archetype = resolve(name, "midfielder");
      expect(archetype.id).toBe("midfield-architect");
      expect(archetype.editorialTitle).toBe("Midfield Architect");
      expect(archetype.motif).toBe("orbital-compass");
    }
    const rodri = resolve("Rodri", "midfielder");
    expect(rodri.primaryAccent).toMatch(/^#[0-9a-f]{6}$/i);
    expect(rodri.description.toLowerCase()).not.toContain("official nickname");
  });

  it("keeps curated matching independent of the supplied position", () => {
    expect(resolve("Erling Haaland", null).id).toBe("nordic-no-9");
    expect(resolve("Rodri", "goalkeeper").id).toBe("midfield-architect");
  });
});

describe("positional fallback editions", () => {
  it("resolves forwards to Forward Signal with explosive diagonals", () => {
    const archetype = resolve("Academy Striker", "forward");
    expect(archetype.id).toBe("forward-signal");
    expect(archetype.editorialTitle).toBe("Forward Signal");
    expect(archetype.motif).toBe("diagonal-burst");
  });

  it("resolves midfielders to Midfield Engine with orbital forms", () => {
    const archetype = resolve("Academy Engine", "MID");
    expect(archetype.id).toBe("midfield-engine");
    expect(archetype.editorialTitle).toBe("Midfield Engine");
    expect(archetype.motif).toBe("engine-orbit");
  });

  it("resolves defenders to Defensive Wall with stacked structures", () => {
    const archetype = resolve("Academy Wall", "Centre Back");
    expect(archetype.id).toBe("defensive-wall");
    expect(archetype.editorialTitle).toBe("Defensive Wall");
    expect(archetype.motif).toBe("stacked-wall");
  });

  it("resolves goalkeepers to Last Line with radar expansion", () => {
    const archetype = resolve("Academy Keeper", "gk");
    expect(archetype.id).toBe("last-line");
    expect(archetype.editorialTitle).toBe("Last Line");
    expect(archetype.motif).toBe("radar-target");
  });
});

describe("unknown-player and unknown-position fallbacks", () => {
  it("falls back to the neutral CardPulse edition when nothing matches", () => {
    const archetype = resolve("Zalt Ibbara", null);
    expect(archetype.id).toBe("cardpulse-edition");
    expect(archetype.editorialTitle).toBe("CardPulse Edition");
    expect(archetype.motif).toBe("neutral-edition");
  });

  it("falls back to neutral for unrecognized position strings", () => {
    expect(resolve("Someone Else", "band director").id).toBe("cardpulse-edition");
    expect(resolve("Someone Else", "").id).toBe("cardpulse-edition");
    expect(resolve("Someone Else").id).toBe("cardpulse-edition");
  });
});

describe("determinism", () => {
  it("returns identical archetypes for identical inputs", () => {
    const a = resolve("Test Player", "forward", "statbunker:player:t1");
    const b = resolve("Test Player", "forward", "statbunker:player:t1");
    expect(a).toEqual(b);
    expect(a.pattern.seed).toBe(b.pattern.seed);
  });

  it("is insensitive to case, accents and punctuation in names", () => {
    expect(normalizePlayerName("Érling Håland")).toBe(
      normalizePlayerName("erling haland"),
    );
    expect(resolve("Erling Håland").id).toBe("nordic-no-9");
  });

  it("varies only the seed across players sharing an edition", () => {
    const a = resolve("One Player", "defender", "p-a");
    const b = resolve("Another Player", "defender", "p-b");
    expect(a.id).toBe(b.id);
    expect({ ...a.pattern, seed: 0 }).toEqual({ ...b.pattern, seed: 0 });
    expect(a.pattern.seed).not.toBe(b.pattern.seed);
  });

  it("derives the seed from playerId when available", () => {
    const withId = resolve("Test Player", "forward", "stable-id");
    const again = resolve("Totally Different Name", "forward", "stable-id");
    expect(withId.pattern.seed).toBe(again.pattern.seed);
  });
});

describe("contract integrity", () => {
  const editions = [
    resolve("Erling Haaland"),
    resolve("Rodri"),
    resolve("A", "forward"),
    resolve("B", "midfielder"),
    resolve("C", "defender"),
    resolve("D", "goalkeeper"),
    resolve("E", "unknown"),
  ];

  it("covers exactly the documented archetype ids", () => {
    expect(new Set(editions.map((e) => e.id))).toEqual(new Set(ARCHETYPE_IDS));
  });

  it("always provides complete, safe identity data", () => {
    for (const edition of editions) {
      expect(edition.editorialTitle.length).toBeGreaterThan(0);
      expect(edition.description.length).toBeGreaterThan(20);
      expect(edition.primaryAccent).toMatch(/^#[0-9a-f]{6}$/i);
      expect(edition.secondaryAccent).toMatch(/^#[0-9a-f]{6}$/i);
      expect(edition.pattern.density).toBeGreaterThanOrEqual(0);
      expect(edition.pattern.density).toBeLessThanOrEqual(1);
      expect(Number.isInteger(edition.pattern.seed)).toBe(true);
      // Descriptions describe geometry; they must not contain markup.
      expect(edition.description).not.toMatch(/[<>]/);
      expect(edition.editorialTitle).not.toMatch(/[<>]/);
    }
  });

  it("normalizes positions into the five canonical buckets", () => {
    expect(normalizePosition("Goalkeeper")).toBe("goalkeeper");
    expect(normalizePosition(" rb ")).toBe("defender");
    expect(normalizePosition("CAM")).toBe("midfielder");
    expect(normalizePosition("Winger")).toBe("forward");
    expect(normalizePosition(null)).toBe("unknown");
    expect(normalizePosition(undefined)).toBe("unknown");
    expect(normalizePosition("water carrier")).toBe("unknown");
  });
});
