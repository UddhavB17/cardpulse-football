// Original vector artwork for CardPulse Football.
// Every path below is hand-authored for this project: a stylised athlete
// heading a ball, a shield crest built from club initials, the pulse mark,
// and small stroke icons. No external images, fonts or licensed artwork.

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
