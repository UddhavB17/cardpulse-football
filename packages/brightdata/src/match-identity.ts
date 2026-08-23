import {
  STATBUNKER_PLAYER_MATCHES_BASE_URL,
  STATBUNKER_PLAYER_SEARCH_BASE_URL,
  STATBUNKER_PLAYER_STANDINGS_BASE_URL,
  statBunkerPlayerSeasonMatchesUrl,
} from "./seasons.js";

export interface ResolvedMatchIdentity {
  readonly playerExternalId: string;
  readonly sourceUrl: string;
}

const PLAYER_ID_KEYS = [
  "resolved_player_id",
  "resolvedPlayerId",
  "player_id",
  "playerId",
] as const;

const PLAYER_NAME_KEYS = [
  "resolved_player_name",
  "resolvedPlayerName",
] as const;

const PLAYER_URL_KEYS = [
  "resolved_player_url",
  "resolvedPlayerUrl",
  "player_url",
  "playerUrl",
] as const;

const PAGE_URL_KEYS = [
  "source_url",
  "sourceUrl",
  "page_url",
  "pageUrl",
  "url",
  "link",
] as const;

function normalizeForSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replaceAll(/\s+/g, " ")
    .trim();
}

function recordOf(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function firstText(
  record: Record<string, unknown>,
  keys: readonly string[],
): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim() !== "") return value.trim();
    if (typeof value === "number" && Number.isSafeInteger(value)) {
      return String(value);
    }
  }
  return null;
}

function parseHttpUrl(raw: unknown): URL | null {
  const text =
    raw instanceof URL ? raw.href : typeof raw === "string" ? raw.trim() : null;
  if (text === null || text === "") return null;
  try {
    const parsed = text.startsWith("/")
      ? new URL(text, "https://www.statbunker.com")
      : new URL(text);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function isStatBunkerHost(url: URL): boolean {
  return /(^|\.)statbunker\.com$/i.test(url.hostname);
}

function numericPlayerId(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  return /^\d+$/.test(trimmed) ? trimmed : null;
}

function playerIdFromUrl(url: URL): string | null {
  return isStatBunkerHost(url)
    ? numericPlayerId(url.searchParams.get("player_id"))
    : null;
}

function isSearchUrl(url: URL): boolean {
  return (
    isStatBunkerHost(url) &&
    url.pathname.replace(/\/+$/, "") ===
      new URL(STATBUNKER_PLAYER_SEARCH_BASE_URL).pathname
  );
}

function isStandingsUrl(url: URL): boolean {
  return (
    isStatBunkerHost(url) &&
    url.pathname.replace(/\/+$/, "") ===
      new URL(STATBUNKER_PLAYER_STANDINGS_BASE_URL).pathname
  );
}

function isGetPlayerStatsUrl(url: URL, playerId?: string): boolean {
  if (
    !isStatBunkerHost(url) ||
    url.pathname.replace(/\/+$/, "") !== "/players/getPlayerStats"
  ) {
    return false;
  }
  const fromUrl = playerIdFromUrl(url);
  return fromUrl !== null && (playerId === undefined || fromUrl === playerId);
}

function isSeasonMatchesUrl(
  url: URL,
  compId: number,
  playerId?: string,
): boolean {
  if (
    !isStatBunkerHost(url) ||
    url.pathname.replace(/\/+$/, "") !==
      new URL(STATBUNKER_PLAYER_MATCHES_BASE_URL).pathname
  ) {
    return false;
  }
  const fromUrl = playerIdFromUrl(url);
  const compsId = Number(url.searchParams.get("comps_id"));
  const compsType = url.searchParams.get("comps_type");
  return (
    fromUrl !== null &&
    compsId === compId &&
    (compsType === null || compsType === "EPL") &&
    (playerId === undefined || fromUrl === playerId)
  );
}

function collectPageUrls(row: Record<string, unknown>): URL[] {
  const urls: URL[] = [];
  const seen = new Set<string>();
  const push = (value: unknown): void => {
    const parsed = parseHttpUrl(value);
    if (parsed === null) return;
    const href = parsed.toString();
    if (seen.has(href)) return;
    seen.add(href);
    urls.push(parsed);
  };
  for (const key of PAGE_URL_KEYS) push(row[key]);
  for (const key of PLAYER_URL_KEYS) push(row[key]);
  const input = recordOf(row.input);
  if (input !== null) {
    push(input.url);
    push(input.source_url);
    push(input.sourceUrl);
  }
  return urls;
}

type RowScan =
  | { readonly kind: "empty" }
  | { readonly kind: "invalid" }
  | { readonly kind: "proven"; readonly playerExternalId: string };

/**
 * Read one collector row for a numeric StatBunker player identity. Bright Data
 * wrapping (`input.url`, omitted null keys, `url` instead of `source_url`) is
 * tolerated. Mixed IDs, a name that is not the indexed player, or a
 * SeasonMatches URL for another competition still fail closed.
 */
function scanRow(row: unknown, playerName: string, compId: number): RowScan {
  const record = recordOf(row);
  if (record === null) return { kind: "empty" };

  const resolvedName = firstText(record, PLAYER_NAME_KEYS);
  if (
    resolvedName !== null &&
    normalizeForSearch(resolvedName) !== normalizeForSearch(playerName)
  ) {
    return { kind: "invalid" };
  }

  const urls = collectPageUrls(record);
  const claimedId = numericPlayerId(firstText(record, PLAYER_ID_KEYS));
  const ids = new Set<string>();
  if (claimedId !== null) ids.add(claimedId);

  for (const url of urls) {
    if (isSearchUrl(url) || isStandingsUrl(url)) continue;
    if (url.pathname.replace(/\/+$/, "") === "/players/SeasonMatches") {
      if (!isSeasonMatchesUrl(url, compId)) return { kind: "invalid" };
      const fromUrl = playerIdFromUrl(url);
      if (fromUrl !== null) ids.add(fromUrl);
      continue;
    }
    if (url.pathname.replace(/\/+$/, "") === "/players/getPlayerStats") {
      if (!isGetPlayerStatsUrl(url)) return { kind: "invalid" };
      const fromUrl = playerIdFromUrl(url);
      if (fromUrl !== null) ids.add(fromUrl);
    }
  }

  if (ids.size > 1) return { kind: "invalid" };
  const playerExternalId = [...ids][0];
  if (playerExternalId === undefined) return { kind: "empty" };

  const corroboratingName = firstText(record, [
    ...PLAYER_NAME_KEYS,
    "player_name",
    "playerName",
  ]);
  if (
    corroboratingName !== null &&
    normalizeForSearch(corroboratingName) !== normalizeForSearch(playerName)
  ) {
    return { kind: "invalid" };
  }

  return { kind: "proven", playerExternalId };
}

/**
 * Resolve a numeric StatBunker player ID only from explicit collector output
 * produced by the public exact-name search page. Identity-bearing rows must
 * all repeat the same ID; Bright Data envelope rows and match rows that omit
 * identity stamps are ignored. The canonical SeasonMatches URL is derived
 * from the proven ID and verified competition, so a search-input `source_url`
 * does not fail a run that already proved the player.
 */
export function resolveStatBunkerMatchIdentity(
  rows: readonly unknown[],
  playerName: string,
  compId: number,
): ResolvedMatchIdentity | null {
  if (rows.length === 0) return null;
  const proven = new Set<string>();
  for (const row of rows) {
    const scan = scanRow(row, playerName, compId);
    if (scan.kind === "invalid") return null;
    if (scan.kind === "proven") proven.add(scan.playerExternalId);
  }
  if (proven.size !== 1) return null;
  const playerExternalId = [...proven][0];
  if (playerExternalId === undefined) return null;
  return {
    playerExternalId,
    sourceUrl: statBunkerPlayerSeasonMatchesUrl(compId, playerExternalId),
  };
}

const MATCH_SHAPE_KEYS = new Set([
  "competition",
  "hometeam",
  "homeclub",
  "awayteam",
  "awayclub",
  "playedon",
  "matchdate",
]);

/**
 * True when a dataset row looks like SeasonMatches output rather than a
 * Bright Data envelope, standings row, or search-result wrapper.
 */
export function looksLikeStatBunkerMatchRow(row: unknown): boolean {
  const record = recordOf(row);
  if (record === null) return false;
  if (record.entityType === "match") return true;
  return Object.keys(record).some((key) =>
    MATCH_SHAPE_KEYS.has(key.toLowerCase().replace(/[^a-z0-9]/g, "")),
  );
}
