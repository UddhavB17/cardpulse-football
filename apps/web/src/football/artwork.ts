// Original vector artwork for CardPulse Football.
// Every path below is hand-authored for this project: a stylised athlete
// heading a ball, a shield crest built from club initials, the pulse mark,
// and small stroke icons. No external images, fonts or licensed artwork.
//
// The archetype section at the bottom renders VisualArchetype identities as
// deterministic procedural SVG: motif geometry, an abstract featureless
// figure silhouette and per-card unique def ids. Markup stays small enough
// for repeated rendering; ink uses currentColor and accents are exposed as
// --cp-a1/--cp-a2 CSS custom properties.

import type { ArchetypePattern, VisualArchetype } from "./archetypes";
import { resolveArchetype } from "./archetypes";
import { hashString, mulberry32 } from "./util";

/** Halftone dot pattern defs; pass a unique id per SVG instance. */
function halftoneDef(id: string, dotColor: string): string {
  return `<pattern id="${id}" width="7" height="7" patternUnits="userSpaceOnUse">
    <circle cx="2" cy="2" r="1.35" fill="${dotColor}"/>
  </pattern>`;
}

/**
 * Stylised geometric athlete heading a ball. Ink shapes use currentColor so
 * CSS themes them; chromatic ghost plates sit behind for print misregistration.
 */
export function athleteSvg(
  options: {
    halftoneId?: string;
    ghosts?: boolean;
    accentColor?: string;
  } = {},
): string {
  const halftoneId = options.halftoneId ?? "cp-ht";
  const accent = options.accentColor ?? "var(--accent-red)";
  const ghosts = options.ghosts ?? true;

  const figure = `
    <ellipse cx="110" cy="284" rx="66" ry="8" opacity="0.16"/>
    <g>
      <circle cx="110" cy="40" r="21" fill="var(--card-paper,#f5efe2)" stroke="currentColor" stroke-width="6"/>
      <path d="M110 30 l10 7 -4 12 -12 0 -4 -12 z" fill="currentColor"/>
    </g>
    <circle cx="110" cy="86" r="18"/>
    <path d="M85 108 L135 108 L141 172 L79 172 Z"/>
    <path d="M85 112 L47 72 L39 86 L77 126 Z"/>
    <path d="M135 112 L173 72 L181 86 L143 126 Z"/>
    <path d="M79 172 L141 172 L145 200 L115 200 L110 188 L105 200 L75 200 Z"/>
    <path d="M81 200 L97 200 L93 248 L104 262 L86 270 L75 252 Z"/>
    <path d="M123 200 L139 200 L145 252 L134 270 L116 262 L127 248 Z"/>
    <path d="M79 136 L141 120 L141 133 L79 149 Z" fill="var(--card-paper,#f5efe2)"/>
  `;

  const shards = `
    <path d="M26 46 L54 60 L28 74 Z" fill="${accent}"/>
    <path d="M194 52 L170 64 L194 80 Z" fill="${accent}"/>
    <path d="M58 16 L76 22 L60 36 Z" fill="${accent}"/>
    <path d="M168 96 L186 102 L172 116 Z" fill="${accent}"/>
  `;

  return `<svg viewBox="0 0 220 300" role="img" aria-hidden="true" focusable="false" class="athlete-svg">
    <defs>${halftoneDef(halftoneId, "currentColor")}</defs>
    ${
      ghosts
        ? `<g transform="translate(-5 -3)" fill="var(--chroma-cyan,#0aa8c2)" opacity="0.4">${figure}</g>
           <g transform="translate(5 3)" fill="var(--chroma-magenta,#e33fa1)" opacity="0.38">${figure}</g>`
        : ""
    }
    <g fill="currentColor">${figure}</g>
    ${shards}
    <rect x="24" y="238" width="172" height="34" fill="url(#${halftoneId})" opacity="0.55"/>
  </svg>`;
}

/** Shield crest carrying fictional club initials plus a halftone band. */
export function crestSvg(options: {
  initials: string;
  halftoneId?: string;
}): string {
  const halftoneId = options.halftoneId ?? "cp-crest-ht";
  return `<svg viewBox="0 0 120 132" role="img" aria-hidden="true" focusable="false" class="crest-svg">
    <defs>${halftoneDef(halftoneId, "var(--ink)")}</defs>
    <path d="M14 10 H106 V72 L60 122 L14 72 Z" fill="var(--card-paper,#f5efe2)" stroke="currentColor" stroke-width="7" stroke-linejoin="miter"/>
    <path d="M17.5 13.5 H102.5 V40 H17.5 Z" fill="url(#${halftoneId})" opacity="0.8"/>
    <circle cx="60" cy="56" r="6" fill="var(--accent-red,#d92b2b)"/>
    <text x="60" y="94" text-anchor="middle" font-size="30" font-weight="900"
      letter-spacing="1" fill="currentColor" font-family="inherit">${options.initials}</text>
  </svg>`;
}

/** Wordmark badge: pitch-green plate with an ECG pulse line. */
export function pulseMarkSvg(): string {
  return `<svg viewBox="0 0 44 44" role="img" aria-hidden="true" focusable="false" class="pulse-mark">
    <rect x="1.5" y="1.5" width="41" height="41" rx="9" fill="var(--pitch,#1e5c3a)"
      stroke="var(--ink,#171310)" stroke-width="3"/>
    <polyline points="7,25 15,25 19,13 25,33 29,21 37,21" fill="none"
      stroke="var(--paper,#f5efe2)" stroke-width="3.4" stroke-linecap="square"/>
  </svg>`;
}

export function boltIcon(): string {
  return `<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false" class="icon">
    <path d="M11 1 L4 12 H9.4 L8 19 L16 7 H10.4 Z" fill="currentColor"/>
  </svg>`;
}

export function refreshIcon(): string {
  return `<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false" class="icon">
    <path d="M17 10 A7 7 0 1 1 14.5 4.6" fill="none" stroke="currentColor" stroke-width="2.6"/>
    <path d="M15.4 1.6 L15.4 6 L11 6" fill="none" stroke="currentColor" stroke-width="2.6"/>
  </svg>`;
}

export function checkIcon(): string {
  return `<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false" class="icon">
    <path d="M3.5 11 L8 15.5 L16.5 5" fill="none" stroke="currentColor" stroke-width="3"/>
  </svg>`;
}

export function warningIcon(): string {
  return `<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false" class="icon">
    <path d="M10 2 L19 18 H1 Z" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"/>
    <line x1="10" y1="8" x2="10" y2="12.4" stroke="currentColor" stroke-width="2.4"/>
    <circle cx="10" cy="15.2" r="1.3" fill="currentColor"/>
  </svg>`;
}

// ---------------------------------------------------------------------------
// Archetype artwork — deterministic procedural identities
// ---------------------------------------------------------------------------

/** XML-escapes interpolated text so generated markup can never break out. */
function escXml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

/** One-decimal fixed-point formatting keeps path data compact and stable. */
function f1(value: number): string {
  return String(Math.round(value * 10) / 10);
}

type Rand = () => number;

interface MotifContext {
  readonly rand: Rand;
  readonly pattern: ArchetypePattern;
  /** Resolved primary accent, as a var() reference with literal fallback. */
  readonly a1: string;
  /** Resolved secondary accent, as a var() reference with literal fallback. */
  readonly a2: string;
}

const CARD_W = 220;
const CARD_H = 300;
const CX = 110;
const CY = 150;

function polar(
  cx: number,
  cy: number,
  radius: number,
  angleRad: number,
): [number, number] {
  return [cx + radius * Math.cos(angleRad), cy + radius * Math.sin(angleRad)];
}

function polygon(points: ReadonlyArray<readonly [number, number]>, attrs: string): string {
  const data = points.map(([x, y]) => `${f1(x)},${f1(y)}`).join(" ");
  return `<polygon points="${data}" ${attrs}/>`;
}

// --- frost-monolith: monumental column + aurora ribbons + shards ----------

function renderFrostMonolith({ rand, pattern, a1, a2 }: MotifContext): string {
  const parts: string[] = [];

  // Aurora-style curved bands behind the monument.
  for (let index = 0; index < 3; index += 1) {
    const y = 64 + index * 48 + rand() * 16;
    const amp = (0.5 + pattern.bandCurve / 30) * (12 + rand() * 14);
    const d = `M-14 ${f1(y)} C ${f1(52)} ${f1(y - amp)}, ${f1(150)} ${f1(y + amp)}, 234 ${f1(y - amp * 0.6)}`;
    parts.push(
      `<path d="${d}" fill="none" stroke="${index % 2 === 0 ? a2 : a1}" stroke-width="${f1(7 + rand() * 8)}" stroke-linecap="round" opacity="${f1(0.24 + rand() * 0.2)}"/>`,
    );
  }

  // Frost shards along both flanks.
  const shardCount = Math.round(6 + pattern.density * 8);
  for (let index = 0; index < shardCount; index += 1) {
    const side = index % 2 === 0 ? 1 : -1;
    const y = 44 + rand() * 214;
    const len = 12 + rand() * 20;
    const bx = CX + side * (34 + rand() * 6);
    parts.push(
      polygon(
        [
          [bx, y],
          [bx + side * len, y - len * 0.42],
          [bx + side * len * 0.45, y + len * 0.5],
        ],
        `fill="${index % 3 === 0 ? a2 : a1}" opacity="0.9"`,
      ),
    );
  }

  // The monolith itself: a tapered faceted tower of original angular geometry.
  parts.push(
    `<path d="M110 14 L121 26 L137 62 L141 132 L135 284 L85 284 L79 132 L83 62 L99 26 Z" fill="${a1}" opacity="0.92"/>`,
  );
  parts.push(
    `<path d="M110 14 L99 26 L83 62 L79 132 L85 284 L110 284 Z" fill="#ffffff" opacity="0.18"/>`,
  );
  parts.push(
    `<path d="M137 62 L141 132 L135 284 L124 284 L129 132 L127 66 Z" fill="currentColor" opacity="0.2"/>`,
  );
  const crest: string[] = [];
  for (let y = 40; y <= 268; y += 28) {
    crest.push(`${CX + ((y / 28) % 2 === 0 ? -7 : 7)} ${y}`);
  }
  parts.push(
    `<polyline points="${crest.join(" ")}" fill="none" stroke="${a2}" stroke-width="3" opacity="0.9"/>`,
  );

  return parts.join("");
}

// --- orbital-compass: concentric tactical geometry -------------------------

function renderOrbitalCompass({ rand, pattern, a1, a2 }: MotifContext): string {
  const parts: string[] = [];
  const rings = [94, 76, 58, 42, 28];
  rings.forEach((radius, index) => {
    const dash = index === 1 ? ' stroke-dasharray="5 8"' : "";
    parts.push(
      `<circle cx="110" cy="138" r="${radius}" fill="none" stroke="${index % 2 === 0 ? "currentColor" : a1}" stroke-width="${index === 0 ? 2 : 1.4}" opacity="${index % 2 === 0 ? 0.5 : 0.9}"${dash}/>`,
    );
  });

  const tickCount = pattern.density > 0.66 ? 36 : pattern.density > 0.33 ? 24 : 12;
  for (let index = 0; index < tickCount; index += 1) {
    const angle = (Math.PI * 2 * index) / tickCount;
    const major = index % (tickCount / 4) === 0;
    const inner = polar(CX, 138, 88, angle);
    const outer = polar(CX, 138, major ? 100 : 94, angle);
    parts.push(
      `<line x1="${f1(inner[0] ?? 0)}" y1="${f1(inner[1] ?? 0)}" x2="${f1(outer[0] ?? 0)}" y2="${f1(outer[1] ?? 0)}" stroke="currentColor" stroke-width="${major ? 2.4 : 1.2}" opacity="0.7"/>`,
    );
  }

  const nodeCount = Math.round(4 + pattern.density * 5);
  for (let index = 0; index < nodeCount; index += 1) {
    const ringRadius = rings[Math.floor(rand() * rings.length)] ?? 58;
    const angle = rand() * Math.PI * 2;
    const [nx, ny] = polar(CX, 138, ringRadius, angle);
    parts.push(
      `<line x1="110" y1="138" x2="${f1(nx)}" y2="${f1(ny)}" stroke="${a1}" stroke-width="1.1" opacity="0.45"/>`,
    );
    parts.push(`<circle cx="${f1(nx)}" cy="${f1(ny)}" r="3.2" fill="${a2}"/>`);
  }

  // Fixed compass needle pointing up-right; timing cue, not a direction claim.
  parts.push(polygon([[112, 136], [152, 100], [124, 122]], `fill="${a1}"`));
  parts.push(polygon([[108, 140], [84, 162], [98, 142]], `fill="currentColor" opacity="0.5"`));
  parts.push(`<circle cx="110" cy="138" r="9" fill="none" stroke="${a2}" stroke-width="2"/>`);
  parts.push(`<circle cx="110" cy="138" r="4.4" fill="currentColor"/>`);

  return parts.join("");
}

// --- diagonal-burst: explosive forward streaks ------------------------------

function renderDiagonalBurst({ rand, pattern, a1, a2 }: MotifContext): string {
  const parts: string[] = [];
  const originX = 34;
  const originY = 268;
  const rayCount = Math.max(2, Math.round(5 + pattern.density * 5));

  interface Ray { ux: number; uy: number; nx: number; ny: number; length: number }
  const rays: Ray[] = [];
  for (let index = 0; index < rayCount; index += 1) {
    const degrees = 24 + (44 * index) / Math.max(1, rayCount - 1) + (rand() - 0.5) * 4;
    const radians = (degrees * Math.PI) / 180;
    const ux = Math.cos(radians);
    const uy = -Math.sin(radians);
    rays.push({ ux, uy, nx: -uy, ny: ux, length: 190 + rand() * 70 });
  }
  rays.sort((a, b) => b.length - a.length);

  rays.forEach((ray, index) => {
    const w0 = 4 + rand() * 3;
    const w1 = 9 + rand() * 6;
    const tipX = originX - ray.ux * (ray.length + 16);
    const tipY = originY - ray.uy * (ray.length + 16);
    const shoulderX = originX - ray.ux * ray.length;
    const shoulderY = originY - ray.uy * ray.length;
    parts.push(
      polygon(
        [
          [originX + ray.nx * w0, originY + ray.ny * w0],
          [originX - ray.nx * w0, originY - ray.ny * w0],
          [shoulderX - ray.nx * w1, shoulderY - ray.ny * w1],
          [tipX, tipY],
          [shoulderX + ray.nx * w1, shoulderY + ray.ny * w1],
        ],
        `fill="${index % 2 === 0 ? a1 : a2}" opacity="0.85"`,
      ),
    );
  });

  // Chevrons riding the central ray.
  const middle = rays[Math.floor(rays.length / 2)];
  if (middle != null) {
    for (const t of [0.55, 0.7, 0.85]) {
      const qx = originX - middle.ux * middle.length * t;
      const qy = originY - middle.uy * middle.length * t;
      parts.push(
        `<polyline points="${f1(qx - middle.ux * 10 - middle.nx * 12)},${f1(qy - middle.uy * 10 - middle.ny * 12)} ${f1(qx + middle.ux * 4)},${f1(qy + middle.uy * 4)} ${f1(qx - middle.ux * 10 + middle.nx * 12)},${f1(qy - middle.uy * 10 + middle.ny * 12)}" fill="none" stroke="currentColor" stroke-width="4" opacity="0.8"/>`,
      );
    }
  }

  parts.push(
    `<circle cx="${originX}" cy="${originY}" r="7" fill="${a2}" stroke="var(--card-paper,#f5efe2)" stroke-width="2"/>`,
  );
  return parts.join("");
}

// --- engine-orbit: interlocking midfield orbits -----------------------------

function renderEngineOrbit({ rand, pattern, a1, a2 }: MotifContext): string {
  const parts: string[] = [];
  const cx = CX;
  const cy = 137;

  for (let index = 0; index < 8; index += 1) {
    const angle = (Math.PI * 2 * index) / 8;
    const outer = polar(cx, cy, 92, angle);
    parts.push(
      `<line x1="${cx}" y1="${cy}" x2="${f1(outer[0] ?? 0)}" y2="${f1(outer[1] ?? 0)}" stroke="currentColor" stroke-width="1" opacity="0.22"/>`,
    );
  }
  for (let index = 0; index < 18; index += 1) {
    const angle = (Math.PI * 2 * index) / 18;
    const inner = polar(cx, cy, 90, angle);
    const outer = polar(cx, cy, 97, angle);
    parts.push(
      `<line x1="${f1(inner[0] ?? 0)}" y1="${f1(inner[1] ?? 0)}" x2="${f1(outer[0] ?? 0)}" y2="${f1(outer[1] ?? 0)}" stroke="${a1}" stroke-width="2" opacity="0.8"/>`,
    );
  }

  parts.push(
    `<ellipse cx="110" cy="137" rx="88" ry="50" fill="none" stroke="${a2}" stroke-width="1.6" stroke-dasharray="9 7" transform="rotate(-18 110 137)" opacity="0.8"/>`,
  );
  parts.push(`<circle cx="82" cy="158" r="40" fill="none" stroke="${a1}" stroke-width="2"/>`);
  parts.push(
    `<circle cx="138" cy="116" r="40" fill="none" stroke="currentColor" stroke-width="1.6" stroke-dasharray="3 6" opacity="0.8"/>`,
  );

  const rodCount = Math.round(4 + pattern.density * 4);
  let prev: [number, number] | null = null;
  for (let index = 0; index <= rodCount; index += 1) {
    const hubA = index % 2 === 0;
    const centre: [number, number] = hubA ? [82, 158] : [138, 116];
    const angle = rand() * Math.PI * 2;
    const point = polar(centre[0] ?? 0, centre[1] ?? 0, 40, angle) as [number, number];
    if (prev !== null) {
      parts.push(
        `<line x1="${f1(prev[0])}" y1="${f1(prev[1])}" x2="${f1(point[0])}" y2="${f1(point[1])}" stroke="currentColor" stroke-width="1.2" opacity="0.5"/>`,
      );
    }
    parts.push(`<circle cx="${f1(point[0])}" cy="${f1(point[1])}" r="3" fill="${a2}"/>`);
    prev = point;
  }

  parts.push(`<circle cx="82" cy="158" r="5" fill="${a1}"/>`);
  parts.push(`<circle cx="138" cy="116" r="5" fill="${a1}"/>`);
  parts.push(`<circle cx="110" cy="137" r="3.4" fill="currentColor"/>`);
  return parts.join("");
}

// --- stacked-wall: structural defensive forms --------------------------------

function renderStackedWall({ rand, pattern, a1, a2 }: MotifContext): string {
  const parts: string[] = [];
  const rowCount = Math.round(5 + pattern.density * 3);
  const rowHeight = 22;
  const rowGap = 6;

  for (let row = 0; row < rowCount; row += 1) {
    const width = Math.max(96, 196 - row * 14);
    const left = CX - width / 2;
    const top = 274 - row * (rowHeight + rowGap);
    const brickWidth = 46;
    const offset = (row % 2) * (brickWidth / 2);
    let brickIndex = 0;
    for (let bx = left + offset; bx + brickWidth <= left + width + 0.1; bx += brickWidth) {
      const fill = (row + brickIndex) % 2 === 0 ? a1 : a2;
      parts.push(
        `<rect x="${f1(bx)}" y="${top}" width="${f1(brickWidth - 3)}" height="${rowHeight}" rx="2" fill="${fill}" fill-opacity="0.82" stroke="currentColor" stroke-width="0.8"/>`,
      );
      if (rand() < 0.2) {
        parts.push(
          `<rect x="${f1(bx)}" y="${top}" width="${f1(brickWidth - 3)}" height="${rowHeight}" rx="2" fill="currentColor" opacity="0.16"/>`,
        );
      }
      brickIndex += 1;
    }
    if (row === rowCount - 1) {
      // Crenellation merlons crown the wall.
      for (const fraction of [0.08, 0.36, 0.64, 0.92]) {
        parts.push(
          `<rect x="${f1(left + width * fraction - 6)}" y="${top - 11}" width="13" height="11" rx="1.5" fill="${a1}" opacity="0.85"/>`,
        );
      }
    }
  }

  parts.push(
    `<rect x="60" y="280" width="100" height="6" rx="2" fill="currentColor" opacity="0.35"/>`,
  );
  return parts.join("");
}

// --- radar-target: last-line sweep from the goal line ------------------------

function renderRadarTarget({ rand, pattern, a1, a2 }: MotifContext): string {
  const parts: string[] = [];
  const cx = CX;
  const cy = 290;
  const rings = [46, 88, 130, 172, 214];
  rings.forEach((radius, index) => {
    const dash = index === 1 ? ' stroke-dasharray="6 8"' : "";
    parts.push(
      `<circle cx="${cx}" cy="${cy}" r="${radius}" fill="none" stroke="${index % 2 === 0 ? a1 : "currentColor"}" stroke-width="${index === rings.length - 1 ? 1 : 1.8}" opacity="${index % 2 === 0 ? 0.85 : 0.45}"${dash}/>`,
    );
  });

  const spread = 0.32 + rand() * 0.3;
  const startAngle = -Math.PI / 2 - spread;
  const endAngle = -Math.PI / 2 + spread;
  const radius = 232;
  const [sx, sy] = polar(cx, cy, radius, startAngle);
  const [ex, ey] = polar(cx, cy, radius, endAngle);
  parts.push(
    `<path d="M${cx} ${cy} L${f1(sx)} ${f1(sy)} A${radius} ${radius} 0 0 1 ${f1(ex)} ${f1(ey)} Z" fill="${a1}" opacity="0.16"/>`,
  );

  parts.push(
    `<line x1="${cx}" y1="92" x2="${cx}" y2="300" stroke="currentColor" stroke-width="1.2" opacity="0.4"/>`,
  );
  parts.push(
    `<line x1="-10" y1="${cy}" x2="230" y2="${cy}" stroke="currentColor" stroke-width="1.2" opacity="0.4"/>`,
  );
  for (let y = 120; y < 280; y += 30) {
    parts.push(
      `<line x1="${cx - 5}" y1="${y}" x2="${cx + 5}" y2="${y}" stroke="currentColor" stroke-width="1.2" opacity="0.4"/>`,
    );
  }

  const blipCount = Math.round(3 + pattern.density * 4);
  for (let index = 0; index < blipCount; index += 1) {
    const ring = rings[Math.floor(rand() * (rings.length - 1))] ?? 46;
    const angle = -Math.PI + rand() * Math.PI;
    const [bx, by] = polar(cx, cy, ring, angle);
    parts.push(`<circle cx="${f1(bx)}" cy="${f1(by)}" r="3" fill="${a2}"/>`);
    parts.push(
      `<circle cx="${f1(bx)}" cy="${f1(by)}" r="7" fill="none" stroke="${a2}" stroke-width="1" opacity="0.5"/>`,
    );
  }

  parts.push(`<circle cx="${cx}" cy="${cy}" r="11" fill="none" stroke="${a1}" stroke-width="2"/>`);
  parts.push(`<circle cx="${cx}" cy="${cy}" r="5" fill="${a2}"/>`);
  return parts.join("");
}

// --- neutral-edition: the quiet CardPulse house style ------------------------

function renderNeutralEdition({ a1, a2 }: MotifContext): string {
  const parts: string[] = [];
  for (let d = -320; d < 340; d += 16) {
    parts.push(
      `<line x1="${d}" y1="310" x2="${d + 310}" y2="0" stroke="currentColor" stroke-width="1" opacity="0.07"/>`,
    );
  }
  parts.push(`<rect x="44" y="112" width="132" height="56" fill="${a1}" opacity="0.1"/>`);
  parts.push(
    `<polyline points="80,235 121,235 139,180 167,272 185,217 222,217" fill="none" stroke="${a2}" stroke-width="4" stroke-linecap="square"/>`,
  );
  for (const [x, y, dx, dy] of [
    [16, 30, 1, 1],
    [204, 30, -1, 1],
    [16, 270, 1, -1],
    [204, 270, -1, -1],
  ] as const) {
    parts.push(
      `<path d="M${x + dx * 14} ${y} H${x} V${y + dy * 14}" fill="none" stroke="currentColor" stroke-width="2" opacity="0.6"/>`,
    );
  }
  parts.push(`<rect x="14" y="258" width="192" height="6" fill="${a1}" opacity="0.75"/>`);
  return parts.join("");
}

const MOTIF_RENDERERS: Readonly<
  Record<ArchetypePattern["motif"], (context: MotifContext) => string>
> = {
  "frost-monolith": renderFrostMonolith,
  "orbital-compass": renderOrbitalCompass,
  "diagonal-burst": renderDiagonalBurst,
  "engine-orbit": renderEngineOrbit,
  "stacked-wall": renderStackedWall,
  "radar-target": renderRadarTarget,
  "neutral-edition": renderNeutralEdition,
};

/** Abstract angular bust — deliberately faceless, shared across archetypes. */
function figureGroup(scale: number, accent: string): string {
  return (
    `<g class="arch-figure" transform="translate(${CX} ${CARD_H}) scale(${scale}) translate(${-CX} ${-CARD_H})">` +
    `<ellipse cx="110" cy="293" rx="56" ry="6" opacity="0.13"/>` +
    `<circle cx="110" cy="216" r="16" fill="var(--card-paper,#f5efe2)" stroke="currentColor" stroke-width="5"/>` +
    `<path d="M88 242 L132 242 L146 300 L74 300 Z" fill="currentColor" opacity="0.93"/>` +
    `<path d="M90 252 L110 264 L130 252" fill="none" stroke="${accent}" stroke-width="5" opacity="0.95"/>` +
    `</g>`
  );
}

export interface ArchetypeSvgOptions {
  /**
   * Prefix for every def id in this instance. Must be unique per mounted
   * card so repeated renders never collide; athleteArtworkPlan derives it
   * automatically.
   */
  idPrefix?: string;
}

/** Low-level renderer: turns an explicit archetype into standalone SVG. */
export function archetypeSvg(
  archetype: VisualArchetype,
  options: ArchetypeSvgOptions = {},
): string {
  const idPrefix = options.idPrefix ?? "cp-arch";
  const halftoneId = `${idPrefix}-ht`;
  const pattern = archetype.pattern;
  const rand = mulberry32(pattern.seed >>> 0);
  const context: MotifContext = {
    rand,
    pattern,
    a1: `var(--cp-a1,${archetype.primaryAccent})`,
    a2: `var(--cp-a2,${archetype.secondaryAccent})`,
  };
  const motifInner = MOTIF_RENDERERS[pattern.motif](context);
  const label = `${archetype.editorialTitle} — ${archetype.description}`;
  const motifTransform =
    `translate(${CX} ${CY}) rotate(${pattern.rotation}) scale(${pattern.scale}) translate(${-CX} ${-CY})`;

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CARD_W} ${CARD_H}" role="img" class="athlete-svg archetype-svg archetype-${pattern.motif}"` +
    ` aria-label="${escXml(label)}"` +
    ` style="--cp-a1:${archetype.primaryAccent};--cp-a2:${archetype.secondaryAccent}">` +
    `<title>${escXml(label)}</title>` +
    `<defs>${halftoneDef(halftoneId, "currentColor")}</defs>` +
    `<rect width="${CARD_W}" height="${CARD_H}" fill="var(--card-paper,#f5efe2)"/>` +
    `<g class="motif motif-${pattern.motif}" transform="${motifTransform}">${motifInner}</g>` +
    (pattern.halftone
      ? `<rect x="14" y="252" width="192" height="34" fill="url(#${halftoneId})" opacity="0.45"/>`
      : "") +
    figureGroup(pattern.figureScale, context.a1) +
    `<rect x="7" y="7" width="206" height="286" fill="none" stroke="currentColor" stroke-width="2" opacity="0.5"/>` +
    `</svg>`
  );
}

// ---------------------------------------------------------------------------
// Integration API — minimal surface for main.ts
// ---------------------------------------------------------------------------

export interface AthleteArtworkInput {
  playerId: string;
  playerName: string;
  /** Raw source position ("forward", "GK", …). Falls back gracefully. */
  position?: string | null | undefined;
  /** Optional disambiguator (e.g. season) so the same player on two cards gets unique def ids. */
  uniqueKey?: string | null | undefined;
}

export interface AthleteArtworkPlan {
  /** Ready-to-mount SVG for the card art area. */
  svg: string;
  /** The resolved identity — use editorialTitle/description in HTML chrome. */
  archetype: VisualArchetype;
  /** Def-id prefix actually used; reuse it if you add more defs per card. */
  idPrefix: string;
}

function sanitizeIdToken(raw: string, max: number): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_-]/g, "");
  return cleaned.slice(0, max);
}

function archetypeIdPrefix(input: AthleteArtworkInput): string {
  const base = sanitizeIdToken(input.playerId, 24) || "card";
  const key = sanitizeIdToken(input.uniqueKey ?? "", 12);
  const signature = hashString(
    `${input.playerId}\u0000${input.playerName}\u0000${input.position ?? ""}\u0000${input.uniqueKey ?? ""}`,
  ).toString(36);
  return `cp-${key.length > 0 ? `${base}-${key}` : base}-${signature}`;
}

/**
 * Resolves and renders a player's archetype artwork in one call.
 * Deterministic: identical inputs produce byte-identical markup.
 */
export function athleteArtworkPlan(input: AthleteArtworkInput): AthleteArtworkPlan {
  const archetype = resolveArchetype(input);
  const idPrefix = archetypeIdPrefix(input);
  return { svg: archetypeSvg(archetype, { idPrefix }), archetype, idPrefix };
}

/** Drop-in string-only variant for existing template slots. */
export function athleteArchetypeSvg(input: AthleteArtworkInput): string {
  return athleteArtworkPlan(input).svg;
}
