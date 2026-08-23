// Deterministic helpers shared by the CardPulse Football presentation layer.
// Everything here is pure so it can be unit tested without a DOM.

/** FNV-1a 32-bit hash. Stable across sessions for a given string. */
export function hashString(input: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Mulberry32 seeded PRNG. Deterministic for a given seed. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Redact a collector ID so demos never leak the full identifier or any
 * operator credentials. Keeps the first 4 and last 4 characters of anything
 * long enough to be meaningful; shorter IDs keep their first two characters.
 */
export function redactCollectorId(id: string | null | undefined): string {
  if (!id) return "unassigned";
  const trimmed = id.trim();
  if (trimmed.length === 0) return "unassigned";
  if (trimmed.length <= 6) {
    return `${trimmed.slice(0, 2)}••••`;
  }
  return `${trimmed.slice(0, 4)}••••${trimmed.slice(-4)}`;
}

/** Short display signature derived from a stable id. Not a security hash. */
export function signatureFrom(id: string): string {
  const high = hashString(`${id}:hi`)
    .toString(16)
    .toUpperCase()
    .padStart(8, "0");
  const low = hashString(`${id}:lo`)
    .toString(16)
    .toUpperCase()
    .padStart(8, "0");
  return `${high.slice(0, 4)}-${high.slice(4)}·${low.slice(0, 4)}`;
}

export function serialNumberFrom(id: string, seasonSuffix = "26"): string {
  const serial = (hashString(`serial:${id}`) % 9000) + 1000;
  return `CP-${serial}/${seasonSuffix}`;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
