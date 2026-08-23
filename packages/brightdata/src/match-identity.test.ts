import { describe, expect, it } from "vitest";

import {
  resolveStatBunkerMatchIdentity,
  looksLikeStatBunkerMatchRow,
} from "./match-identity.js";
import {
  statBunkerPlayerSearchResolverUrl,
  statBunkerPlayerSeasonMatchesUrl,
} from "./seasons.js";

const COMP_ID = 776;
const PLAYER_NAME = "Erling Haaland";
const PLAYER_ID = "60023";
const MATCH_URL = statBunkerPlayerSeasonMatchesUrl(COMP_ID, PLAYER_ID);
const SEARCH_URL = statBunkerPlayerSearchResolverUrl(COMP_ID, PLAYER_NAME);
const PLAYER_URL = `https://www.statbunker.com/players/getPlayerStats?player_id=${PLAYER_ID}`;

function matchRow(overrides: Record<string, unknown> = {}) {
  return {
    competition: "Premier League 25/26",
    home_team: "Manchester City",
    away_team: "Liverpool",
    score: "2 - 1",
    started: 1,
    substitute: 0,
    minutes_played: 90,
    goals: 2,
    assists: 1,
    yellow_cards: 0,
    second_yellow_cards: 0,
    red_cards: 0,
    played_on: "08 Feb 2026",
    resolved_player_name: PLAYER_NAME,
    resolved_player_id: PLAYER_ID,
    resolved_player_url: PLAYER_URL,
    source_url: MATCH_URL,
    ...overrides,
  };
}

describe("resolveStatBunkerMatchIdentity", () => {
  it("accepts a fully stamped resolver batch", () => {
    expect(
      resolveStatBunkerMatchIdentity([matchRow()], PLAYER_NAME, COMP_ID),
    ).toEqual({ playerExternalId: PLAYER_ID, sourceUrl: MATCH_URL });
  });

  it("derives the canonical match URL when Bright Data keeps the search input as source_url", () => {
    expect(
      resolveStatBunkerMatchIdentity(
        [
          matchRow({ source_url: SEARCH_URL }),
          matchRow({
            source_url: SEARCH_URL,
            input: { url: SEARCH_URL },
          }),
        ],
        PLAYER_NAME,
        COMP_ID,
      ),
    ).toEqual({ playerExternalId: PLAYER_ID, sourceUrl: MATCH_URL });
  });

  it("proves identity from a navigated SeasonMatches url when resolved_* stamps are omitted", () => {
    expect(
      resolveStatBunkerMatchIdentity(
        [
          {
            competition: "Premier League 25/26",
            home_team: "Manchester City",
            away_team: "Liverpool",
            score: "2 - 1",
            url: `${MATCH_URL}&utm=brightdata`,
            input: { url: SEARCH_URL },
          },
        ],
        PLAYER_NAME,
        COMP_ID,
      ),
    ).toEqual({ playerExternalId: PLAYER_ID, sourceUrl: MATCH_URL });
  });

  it("ignores Bright Data envelope rows and match rows that omit identity stamps", () => {
    expect(
      resolveStatBunkerMatchIdentity(
        [
          { error: null, input: { url: SEARCH_URL } },
          {
            competition: "Premier League 25/26",
            home_team: "Manchester City",
            away_team: "Liverpool",
            score: "2 - 1",
            started: 1,
            played_on: "08 Feb 2026",
          },
          matchRow({ resolved_player_id: 60023 }),
        ],
        PLAYER_NAME,
        COMP_ID,
      ),
    ).toEqual({ playerExternalId: PLAYER_ID, sourceUrl: MATCH_URL });
  });

  it("does not treat a Bright Data envelope as a SeasonMatches row", () => {
    expect(
      looksLikeStatBunkerMatchRow({ error: null, input: { url: SEARCH_URL } }),
    ).toBe(false);
    expect(looksLikeStatBunkerMatchRow(matchRow())).toBe(true);
  });

  it("fails closed when no row proves a numeric player ID", () => {
    expect(
      resolveStatBunkerMatchIdentity(
        [
          {
            competition: "Premier League 25/26",
            home_team: "Manchester City",
            input: { url: SEARCH_URL },
          },
        ],
        PLAYER_NAME,
        COMP_ID,
      ),
    ).toBeNull();
  });

  it("fails closed on a mixed or non-canonical identity claim", () => {
    expect(
      resolveStatBunkerMatchIdentity(
        [matchRow(), matchRow({ resolved_player_name: "Another Player" })],
        PLAYER_NAME,
        COMP_ID,
      ),
    ).toBeNull();
    expect(
      resolveStatBunkerMatchIdentity(
        [
          matchRow({
            resolved_player_url: `${PLAYER_URL.replace(PLAYER_ID, "99999")}`,
          }),
        ],
        PLAYER_NAME,
        COMP_ID,
      ),
    ).toBeNull();
    expect(
      resolveStatBunkerMatchIdentity(
        [
          matchRow({
            source_url: statBunkerPlayerSeasonMatchesUrl(791, PLAYER_ID),
          }),
        ],
        PLAYER_NAME,
        COMP_ID,
      ),
    ).toBeNull();
  });
});
