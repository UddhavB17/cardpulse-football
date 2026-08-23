// CardPulse Football — deterministic player-archetype identity system.
//
// Every card gets an original visual identity built purely from procedural
// geometry (see artwork.ts). No player photography, facial likenesses, club
// crests, external assets or runtime AI generation is involved. Curated
// archetypes exist for a small set of players; everyone else resolves to a
// position-based edition, and anything unknown falls back to the neutral
// CardPulse edition.
//
// All resolution is deterministic: the same player/position inputs always
// produce the exact same archetype, including its jitter seed, so repeated
// renders never change what is printed.

import { hashString } from "./util";

// ---------------------------------------------------------------------------
// Public contract
// ---------------------------------------------------------------------------

/** Renderer keys consumed by the procedural artwork layer in artwork.ts. */
export type ArchetypeMotif =
  | "frost-monolith"
  | "orbital-compass"
  | "diagonal-burst"
  | "engine-orbit"
  | "stacked-wall"
  | "radar-target"
  | "neutral-edition";

export type ArchetypeId =
  | "nordic-no-9"
  | "midfield-architect"
  | "forward-signal"
  | "midfield-engine"
  | "defensive-wall"
  | "last-line"
  | "cardpulse-edition";

/**
 * Parameters handed to the procedural motif renderer. Fixed values express
 * the composition's character; `seed` is derived per player so repeated
 * calls stay byte-identical while different players get varied detail.
 */
export interface ArchetypePattern {
  readonly motif: ArchetypeMotif;
  /** Element-count hint in the inclusive range 0..1. */
  readonly density: number;
  /** Base rotation of the whole motif group, in degrees. */
  readonly rotation: number;
  /** Scale multiplier applied to the motif group around the card centre. */
  readonly scale: number;
  /** Curvature driver for ribbon/band geometry, roughly in pixels. */
  readonly bandCurve: number;
  /** Whether the halftone overlay layer is rendered. */
  readonly halftone: boolean;
  /** Scale multiplier for the shared abstract figure silhouette. */
  readonly figureScale: number;
  /** Per-player deterministic jitter seed (resolved by resolveArchetype). */
  readonly seed: number;
}

/** Typed identity contract for a card's procedural artwork. */
export interface VisualArchetype {
  readonly id: ArchetypeId;
  /** Editorial cover title. Original CardPulse phrasing, never an official nickname. */
  readonly editorialTitle: string;
  /** Short machine-readable motif key shared with the artwork renderer. */
  readonly motif: ArchetypeMotif;
  /** Primary chromatic accent (CSS colour value). */
  readonly primaryAccent: string;
  /** Secondary chromatic accent (CSS colour value). */
  readonly secondaryAccent: string;
  readonly pattern: ArchetypePattern;
  /**
   * Accessible description of what the artwork depicts, for AT users and
   * card metadata. Describes abstract geometry only.
   */
  readonly description: string;
}

/** Inputs for archetype resolution. All matching is deterministic. */
export interface ArchetypeInput {
  playerName: string;
  /** Raw source position (e.g. "forward", "GK"); null/unknown falls back gracefully. */
  position?: string | null | undefined;
  /** Stable player id; when present it drives the jitter seed. */
  playerId?: string | null | undefined;
}

// ---------------------------------------------------------------------------
// Normalisation helpers
// ---------------------------------------------------------------------------

/** Lowercase, de-accent, collapse punctuation/whitespace for stable keys. */
export function normalizePlayerName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export type NormalizedPosition =
  | "goalkeeper"
  | "defender"
  | "midfielder"
  | "forward"
  | "unknown";

const POSITION_ALIASES: Readonly<
  Record<Exclude<NormalizedPosition, "unknown">, readonly string[]>
> = {
  goalkeeper: ["goalkeeper", "gk", "keeper", "goalie"],
  defender: ["defender", "def", "centre back", "center back", "cb", "lb", "rb"],
  midfielder: ["midfielder", "mid", "cm", "dm", "am", "cdm", "cam"],
  forward: ["forward", "fwd", "striker", "st", "attacker", "winger", "lw", "rw", "cf"],
};

/** Maps raw source position strings onto the five canonical buckets. */
export function normalizePosition(
  position: string | null | undefined,
): NormalizedPosition {
  if (position == null) return "unknown";
  const key = position.trim().toLowerCase();
  if (key.length === 0) return "unknown";
  for (const [canonical, aliases] of Object.entries(POSITION_ALIASES)) {
    if (aliases.includes(key)) return canonical as NormalizedPosition;
  }
  return "unknown";
}

// ---------------------------------------------------------------------------
// Curated templates (seed resolved later)
// ---------------------------------------------------------------------------

type ArchetypeTemplate = Omit<VisualArchetype, "pattern"> & {
  readonly pattern: Omit<ArchetypePattern, "seed">;
};

// Erling Haaland — original editorial framing ("Nordic No. 9" is our own
// cover title, not a claimed official nickname). Monumental vertical
// composition, frost shards, steel blue + icy cyan, aurora-style curved
// bands, angular geometry. No helmet, no weapon, no likeness.
const HAALAND: ArchetypeTemplate = {
  id: "nordic-no-9",
  editorialTitle: "Nordic No. 9",
  motif: "frost-monolith",
  primaryAccent: "#4a7ba6",
  secondaryAccent: "#aee6f2",
  pattern: {
    motif: "frost-monolith",
    density: 0.72,
    rotation: 0,
    scale: 1.04,
    bandCurve: 26,
    halftone: true,
    figureScale: 1.05,
  },
  description:
    "Procedural artwork: a monumental faceted column rises through curved aurora ribbons, flanked by angular frost shards in steel blue and icy cyan. Original abstract geometry with no player likeness.",
};

// Rodri — original editorial framing ("Midfield Architect" is our own cover
// title, not a claimed official nickname). Concentric/orbital tactical
// geometry, measured central composition, restrained gold + near-black,
// compass/timing/structure cues.
const RODRI: ArchetypeTemplate = {
  id: "midfield-architect",
  editorialTitle: "Midfield Architect",
  motif: "orbital-compass",
  primaryAccent: "#c9a227",
  secondaryAccent: "#17171c",
  pattern: {
    motif: "orbital-compass",
    density: 0.55,
    rotation: 0,
    scale: 1,
    bandCurve: 0,
    halftone: true,
    figureScale: 0.97,
  },
  description:
    "Procedural artwork: measured concentric orbits with compass ticks, timing nodes and a fixed needle in restrained gold and near-black. Original abstract geometry with no player likeness.",
};

// Generic positional editions -------------------------------------------------

const FORWARD_SIGNAL: ArchetypeTemplate = {
  id: "forward-signal",
  editorialTitle: "Forward Signal",
  motif: "diagonal-burst",
  primaryAccent: "#d94f2b",
  secondaryAccent: "#f5c33b",
  pattern: {
    motif: "diagonal-burst",
    density: 0.8,
    rotation: -14,
    scale: 1.02,
    bandCurve: 0,
    halftone: true,
    figureScale: 1,
  },
  description:
    "Procedural artwork: explosive diagonal streaks and chevrons bursting up-field in signal vermilion and flare yellow. Original abstract geometry, no likeness.",
};

const MIDFIELD_ENGINE: ArchetypeTemplate = {
  id: "midfield-engine",
  editorialTitle: "Midfield Engine",
  motif: "engine-orbit",
  primaryAccent: "#1f8a5a",
  secondaryAccent: "#3d4855",
  pattern: {
    motif: "engine-orbit",
    density: 0.6,
    rotation: 0,
    scale: 1,
    bandCurve: 0,
    halftone: true,
    figureScale: 0.98,
  },
  description:
    "Procedural artwork: interlocking orbital rings, transfer ellipses and ticking gear marks in pitch emerald and slate. Original abstract geometry, no likeness.",
};

const DEFENSIVE_WALL: ArchetypeTemplate = {
  id: "defensive-wall",
  editorialTitle: "Defensive Wall",
  motif: "stacked-wall",
  primaryAccent: "#31547a",
  secondaryAccent: "#b0532f",
  pattern: {
    motif: "stacked-wall",
    density: 0.66,
    rotation: 0,
    scale: 1,
    bandCurve: 0,
    halftone: true,
    figureScale: 0.95,
  },
  description:
    "Procedural artwork: stacked structural blocks rise like a rampart in deep navy and brick red. Original abstract geometry, no likeness.",
};

const LAST_LINE: ArchetypeTemplate = {
  id: "last-line",
  editorialTitle: "Last Line",
  motif: "radar-target",
  primaryAccent: "#8fe63d",
  secondaryAccent: "#20242b",
  pattern: {
    motif: "radar-target",
    density: 0.5,
    rotation: 0,
    scale: 1,
    bandCurve: 0,
    halftone: true,
    figureScale: 0.92,
  },
  description:
    "Procedural artwork: a radar sweep expands from the goal line with concentric range rings, crosshair ticks and contact blips in volt green and charcoal. Original abstract geometry, no likeness.",
};

const CARDPULSE_EDITION: ArchetypeTemplate = {
  id: "cardpulse-edition",
  editorialTitle: "CardPulse Edition",
  motif: "neutral-edition",
  primaryAccent: "#5b564c",
  secondaryAccent: "#d92b2b",
  pattern: {
    motif: "neutral-edition",
    density: 0.4,
    rotation: 0,
    scale: 1,
    bandCurve: 0,
    halftone: true,
    figureScale: 1,
  },
  description:
    "Procedural artwork: the neutral CardPulse edition — a quiet hatch field, corner registration marks and the house pulse line in warm ink and press red. Original abstract geometry, no likeness.",
};

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/** Alias tables for curated players. Keys are normalised display-name variants. */
const CURATED_ALIASES: ReadonlyArray<readonly [ArchetypeTemplate, readonly string[]]> = [
  [
    HAALAND,
    [
      "erling haaland",
      "erling braut haaland",
      "erling inge haaland",
      "erling haland",
      "haaland",
    ],
  ],
  [
    RODRI,
    ["rodri", "rodri hernandez", "rodrigo hernandez", "rodrigo hernandez cascante"],
  ],
];

const POSITION_TEMPLATES: Readonly<
  Record<Exclude<NormalizedPosition, "unknown">, ArchetypeTemplate>
> = {
  forward: FORWARD_SIGNAL,
  midfielder: MIDFIELD_ENGINE,
  defender: DEFENSIVE_WALL,
  goalkeeper: LAST_LINE,
};

export const ARCHETYPE_IDS: readonly ArchetypeId[] = [
  "nordic-no-9",
  "midfield-architect",
  "forward-signal",
  "midfield-engine",
  "defensive-wall",
  "last-line",
  "cardpulse-edition",
];

function materialize(
  template: ArchetypeTemplate,
  seedSource: string,
): VisualArchetype {
  const pattern: ArchetypePattern = Object.freeze({
    ...template.pattern,
    seed: hashString(`${seedSource}\u0000archetype-v1`),
  });
  return Object.freeze({ ...template, pattern });
}

/**
 * Resolves the VisualArchetype for a player deterministically.
 *
 * Order: curated player match (name-based, position-independent) → position
 * edition → neutral CardPulse edition. Identical inputs always yield an
 * identical, frozen archetype including its jitter seed.
 */
export function resolveArchetype(input: ArchetypeInput): VisualArchetype {
  const normalizedName = normalizePlayerName(input.playerName ?? "");
  const playerId = (input.playerId ?? "").trim();
  // Seed prefers the stable player id; names are the fallback so ad-hoc
  // inputs stay deterministic too.
  const seedSource = playerId.length > 0 ? `id:${playerId}` : `name:${normalizedName}`;

  for (const [template, aliases] of CURATED_ALIASES) {
    if (aliases.includes(normalizedName)) {
      return materialize(template, seedSource);
    }
  }

  const position = normalizePosition(input.position);
  const template =
    position === "unknown" ? CARDPULSE_EDITION : POSITION_TEMPLATES[position];
  return materialize(template, seedSource);
}
