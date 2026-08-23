import { describe, expect, it } from "vitest";

import { VerifiedSeasonMetadataSchema } from "@bidsentinel/contracts";

import {
  STATBUNKER_PLAYER_MATCHES_BASE_URL,
  STATBUNKER_PLAYER_SEARCH_BASE_URL,
  STATBUNKER_PLAYER_STANDINGS_BASE_URL,
  VERIFIED_STATBUNKER_SEASONS,
  isVerifiedStatBunkerSeason,
  latestCompleteVerifiedStatBunkerSeason,
  listVerifiedStatBunkerSeasons,
  resolveVerifiedStatBunkerSeason,
  resolveVerifiedStatBunkerSeasonFromUrl,
  alignStandingsRowToVerifiedSeason,
  statBunkerPlayerSeasonMatchesUrl,
  statBunkerPlayerSearchResolverUrl,
  statBunkerPlayerStandingsUrl,
} from "./seasons.js";

describe("verified StatBunker season registry", () => {
  it("maps every canonical season to its verified comp_id and label", () => {
    expect(
      Object.fromEntries(
        VERIFIED_STATBUNKER_SEASONS.map((entry) => [
          entry.season,
          { label: entry.label, compId: entry.compId },
        ]),
      ),
    ).toEqual({
      "2023": { label: "2023/24", compId: 745 },
      "2024": { label: "2024/25", compId: 596 },
      "2025": { label: "2025/26", compId: 776 },
      "2026": { label: "2026/27", compId: 791 },
    });
  });

  it("marks 2026/27 incomplete and every completed season complete", () => {
    const bySeason = new Map(
      VERIFIED_STATBUNKER_SEASONS.map((entry) => [entry.season, entry]),
    );
    expect(bySeason.get("2023")?.complete).toBe(true);
    expect(bySeason.get("2024")?.complete).toBe(true);
    expect(bySeason.get("2025")?.complete).toBe(true);
    expect(bySeason.get("2026")?.complete).toBe(false);
  });

  it("builds PlayerStandings URLs from the verified base only", () => {
    expect(STATBUNKER_PLAYER_STANDINGS_BASE_URL).toBe(
      "https://www.statbunker.com/competitions/PlayerStandings",
    );
    expect(statBunkerPlayerStandingsUrl(776)).toBe(
      "https://www.statbunker.com/competitions/PlayerStandings?comp_id=776",
    );
    expect(statBunkerPlayerStandingsUrl(791)).toBe(
      "https://www.statbunker.com/competitions/PlayerStandings?comp_id=791",
    );
  });

  it("builds a verified player-season match URL without guessing IDs", () => {
    expect(STATBUNKER_PLAYER_MATCHES_BASE_URL).toBe(
      "https://www.statbunker.com/players/SeasonMatches",
    );
    expect(statBunkerPlayerSeasonMatchesUrl(776, "60023")).toBe(
      "https://www.statbunker.com/players/SeasonMatches?comps_id=776&comps_type=EPL&player_id=60023",
    );
    expect(() => statBunkerPlayerSeasonMatchesUrl(776, "haaland")).toThrow(
      /numeric player ID/,
    );
    expect(() => statBunkerPlayerSeasonMatchesUrl(0, "60023")).toThrow(
      /positive competition ID/,
    );
  });

  it("builds a public exact-name resolver URL when standings omit the numeric ID", () => {
    expect(STATBUNKER_PLAYER_SEARCH_BASE_URL).toBe(
      "https://www.statbunker.com/usual/search",
    );
    expect(statBunkerPlayerSearchResolverUrl(776, " Erling   Haaland ")).toBe(
      "https://www.statbunker.com/usual/search?action=Find&search=Erling+Haaland&comps_id=776&comps_type=EPL",
    );
    expect(() => statBunkerPlayerSearchResolverUrl(0, "Haaland")).toThrow(
      /positive competition ID/,
    );
    expect(() => statBunkerPlayerSearchResolverUrl(776, "   ")).toThrow(
      /usable player name/,
    );
  });

  it("carries the registry URL on each entry", () => {
    for (const entry of VERIFIED_STATBUNKER_SEASONS) {
      expect(entry.sourceUrl).toBe(statBunkerPlayerStandingsUrl(entry.compId));
      expect(VerifiedSeasonMetadataSchema.safeParse(entry).success).toBe(true);
    }
  });

  it("lists seasons in ascending registry order", () => {
    expect(
      listVerifiedStatBunkerSeasons().map((entry) => entry.season),
    ).toEqual(["2023", "2024", "2025", "2026"]);
  });
});

describe("resolveVerifiedStatBunkerSeason fails closed", () => {
  it("resolves trimmed registry season keys", () => {
    expect(resolveVerifiedStatBunkerSeason(" 2025 ")?.compId).toBe(776);
    expect(resolveVerifiedStatBunkerSeason("2026")?.complete).toBe(false);
  });

  it.each(["2019", "1998", "2027", "25/26", "bundesliga", "", "2025/26-extra"])(
    "returns null for unknown season %s instead of guessing",
    (raw) => {
      expect(resolveVerifiedStatBunkerSeason(raw)).toBeNull();
      expect(isVerifiedStatBunkerSeason(raw)).toBe(false);
    },
  );
});

describe("verified competition URLs identify a registry season", () => {
  it("maps PlayerStandings and SeasonMatches competition IDs", () => {
    expect(
      resolveVerifiedStatBunkerSeasonFromUrl(
        "https://www.statbunker.com/competitions/PlayerStandings?comp_id=791",
      )?.season,
    ).toBe("2026");
    expect(
      resolveVerifiedStatBunkerSeasonFromUrl(
        "https://www.statbunker.com/players/SeasonMatches?comps_id=776&comps_type=EPL&player_id=60023",
      )?.season,
    ).toBe("2025");
    expect(latestCompleteVerifiedStatBunkerSeason()?.season).toBe("2025");
  });

  it("fails closed for unknown hosts or unlisted competition IDs", () => {
    expect(
      resolveVerifiedStatBunkerSeasonFromUrl(
        "https://example.test/competitions/PlayerStandings?comp_id=791",
      ),
    ).toBeNull();
    expect(
      resolveVerifiedStatBunkerSeasonFromUrl(
        "https://www.statbunker.com/competitions/PlayerStandings?comp_id=1",
      ),
    ).toBeNull();
  });

  it("replaces a stale hardcoded 2025 label when the row URL is 2026/27", () => {
    const season2026 = resolveVerifiedStatBunkerSeason("2026");
    expect(season2026).not.toBeNull();
    if (season2026 === null) throw new Error("expected 2026 registry entry");
    const aligned = alignStandingsRowToVerifiedSeason(
      {
        player_name: "Bukayo Saka",
        season: "2025",
        source_url:
          "https://www.statbunker.com/competitions/PlayerStandings?comp_id=791",
      },
      season2026,
    );
    expect(aligned).toMatchObject({
      season: "2026",
      source_url: season2026.sourceUrl,
    });
  });

  it("does not retarget a row whose URL is a different verified competition", () => {
    const season2026 = resolveVerifiedStatBunkerSeason("2026");
    expect(season2026).not.toBeNull();
    if (season2026 === null) throw new Error("expected 2026 registry entry");
    const row = {
      season: "2025",
      source_url:
        "https://www.statbunker.com/competitions/PlayerStandings?comp_id=776",
    };
    expect(alignStandingsRowToVerifiedSeason(row, season2026)).toEqual(row);
  });
});
