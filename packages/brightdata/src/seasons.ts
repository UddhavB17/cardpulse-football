import {
  VerifiedSeasonMetadataSchema,
  type VerifiedSeasonMetadata,
} from "@bidsentinel/contracts";

/**
 * Verified StatBunker Premier League season registry.
 *
 * This is the ONLY place a collection target for the player experience is
 * ever derived from. Every entry was verified against the public StatBunker
 * competition pages; anything outside this table fails closed — no URL is
 * guessed and no collection starts. The 2026/27 campaign is still being
 * played, so it is registered as incomplete and downstream surfaces must
 * report match data honestly unavailable instead of zero-filling.
 */
export const STATBUNKER_PLAYER_STANDINGS_BASE_URL =
  "https://www.statbunker.com/competitions/PlayerStandings";
export const STATBUNKER_PLAYER_MATCHES_BASE_URL =
  "https://www.statbunker.com/players/SeasonMatches";
export const STATBUNKER_PLAYER_SEARCH_BASE_URL =
  "https://www.statbunker.com/usual/search";

interface VerifiedSeasonSeed {
  readonly season: "2023" | "2024" | "2025" | "2026";
  readonly label: "2023/24" | "2024/25" | "2025/26" | "2026/27";
  readonly compId: 745 | 596 | 776 | 791;
  readonly complete: boolean;
}

const VERIFIED_SEASON_SEEDS: readonly VerifiedSeasonSeed[] = [
  { season: "2023", label: "2023/24", compId: 745, complete: true },
  { season: "2024", label: "2024/25", compId: 596, complete: true },
  { season: "2025", label: "2025/26", compId: 776, complete: true },
  // Current campaign: partially published, never treated as complete.
  { season: "2026", label: "2026/27", compId: 791, complete: false },
];

/** Canonical PlayerStandings URL for one verified comp_id. */
export function statBunkerPlayerStandingsUrl(compId: number): string {
  return `${STATBUNKER_PLAYER_STANDINGS_BASE_URL}?comp_id=${compId}`;
}

/**
 * Canonical player-season match URL. Player IDs must be the numeric IDs
 * verified in StatBunker's own player links; slugs and guessed identifiers
 * fail closed before any collection target is produced.
 */
export function statBunkerPlayerSeasonMatchesUrl(
  compId: number,
  playerExternalId: string,
): string {
  if (!Number.isSafeInteger(compId) || compId <= 0) {
    throw new Error("StatBunker match URL requires a positive competition ID");
  }
  const playerId = playerExternalId.trim();
  if (!/^\d+$/.test(playerId)) {
    throw new Error(
      "StatBunker match URL requires a verified numeric player ID",
    );
  }
  const url = new URL(STATBUNKER_PLAYER_MATCHES_BASE_URL);
  url.searchParams.set("comps_id", String(compId));
  url.searchParams.set("comps_type", "EPL");
  url.searchParams.set("player_id", playerId);
  return url.toString();
}

/**
 * Verified public search form used only when a standings row does not expose
 * StatBunker's numeric player ID. The competition parameters are carried for
 * the collector's one-run exact-name resolution into SeasonMatches; the site
 * ignores them while preserving the normal search result page.
 */
export function statBunkerPlayerSearchResolverUrl(
  compId: number,
  playerName: string,
): string {
  if (!Number.isSafeInteger(compId) || compId <= 0) {
    throw new Error(
      "StatBunker player search requires a positive competition ID",
    );
  }
  const name = playerName.trim().replace(/\s+/g, " ");
  if (name === "" || name.length > 200) {
    throw new Error("StatBunker player search requires a usable player name");
  }
  const url = new URL(STATBUNKER_PLAYER_SEARCH_BASE_URL);
  url.searchParams.set("action", "Find");
  url.searchParams.set("search", name);
  url.searchParams.set("comps_id", String(compId));
  url.searchParams.set("comps_type", "EPL");
  return url.toString();
}

/** The frozen registry, contract-validated at module load, ascending by season. */
export const VERIFIED_STATBUNKER_SEASONS: readonly VerifiedSeasonMetadata[] =
  VERIFIED_SEASON_SEEDS.map((seed) =>
    VerifiedSeasonMetadataSchema.parse({
      schemaVersion: 1,
      season: seed.season,
      label: seed.label,
      compId: seed.compId,
      sourceUrl: statBunkerPlayerStandingsUrl(seed.compId),
      complete: seed.complete,
    }),
  );

const SEASONS_BY_KEY = new Map(
  VERIFIED_STATBUNKER_SEASONS.map((entry) => [entry.season, entry]),
);

/** True only for registry seasons; everything else fails closed. */
export function isVerifiedStatBunkerSeason(season: string): boolean {
  return SEASONS_BY_KEY.has(season.trim());
}

/**
 * Resolve a season key ("2023".."2026") to its verified registry entry.
 * Unknown or malformed seasons return null — callers must fail closed and
 * never guess a comp_id or URL from an unlisted season.
 */
export function resolveVerifiedStatBunkerSeason(
  season: string,
): VerifiedSeasonMetadata | null {
  return SEASONS_BY_KEY.get(season.trim()) ?? null;
}

/** Registry listing in canonical ascending season order. */
export function listVerifiedStatBunkerSeasons(): readonly VerifiedSeasonMetadata[] {
  return VERIFIED_STATBUNKER_SEASONS;
}
