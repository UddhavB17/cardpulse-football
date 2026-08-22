// Original, fictional football content for the CardPulse fallback table.
// No real players, clubs, crests or competitions are referenced.

import { hashString, intBetween, mulberry32 } from "./util";

export interface ClubIdentity {
  code: string;
  name: string;
  city: string;
}

export const CLUBS: readonly ClubIdentity[] = [
  { code: "RHE", name: "Rhein Athletic", city: "Rheinstadt" },
  { code: "SPU", name: "Spree United", city: "Spreeberg" },
  { code: "ELB", name: "Elbe 04", city: "Elbhafen" },
  { code: "HAV", name: "Havel Sport", city: "Havelpark" },
  { code: "MOS", name: "Mosel Wanderers", city: "Moseltal" },
  { code: "DON", name: "Donau 09", city: "Donaubrück" },
  { code: "FIC", name: "Fichtel City", city: "Fichtelberg" },
  { code: "NOR", name: "Nordsee KV", city: "Nordhafen" },
  { code: "ALP", name: "Alpenwald SV", city: "Alpendorf" },
  { code: "TAU", name: "Taunus Town", city: "Taunusheim" },
] as const;

/** A simulated league row; distinct from provider-backed StandingRowView. */
export interface SimStandingRow {
  clubCode: string;
  clubName: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  points: number;
  isHeroClub: boolean;
}

export function clubByCode(code: string): ClubIdentity {
  return (
    CLUBS.find((club) => club.code === code) ?? {
      code,
      name: `Club ${code}`,
      city: "Unknown",
    }
  );
}

/** Stable pseudo-random club assignment for a source or record id. */
export function clubForId(id: string): ClubIdentity {
  const fallback = CLUBS[0];
  if (fallback === undefined)
    throw new Error("The club pool must not be empty");
  return CLUBS[hashString(`club:${id}`) % CLUBS.length] ?? fallback;
}

/**
 * Deterministic single round-robin season between the ten fictional clubs.
 * `bonus` points are added to the hero club so real pipeline milestones
 * (verified baseline, recovered card) visibly reorder the animated table.
 */
export function buildSeasonTable(
  seasonSeed: string,
  heroClubCode: string | null,
  bonusPoints: number,
): SimStandingRow[] {
  const rows = new Map<string, SimStandingRow>();
  for (const club of CLUBS) {
    rows.set(club.code, {
      clubCode: club.code,
      clubName: club.name,
      played: 0,
      won: 0,
      drawn: 0,
      lost: 0,
      goalsFor: 0,
      goalsAgainst: 0,
      points: 0,
      isHeroClub: club.code === heroClubCode,
    });
  }

  for (let homeIndex = 0; homeIndex < CLUBS.length; homeIndex += 1) {
    for (
      let awayIndex = homeIndex + 1;
      awayIndex < CLUBS.length;
      awayIndex += 1
    ) {
      const home = CLUBS[homeIndex];
      const away = CLUBS[awayIndex];
      if (home === undefined || away === undefined) continue;
      const random = mulberry32(
        hashString(`${seasonSeed}:${home.code}:${away.code}`),
      );
      const homeGoals = intBetween(random, 0, 4);
      const awayGoals = intBetween(random, 0, 4);
      applyResult(rows, home.code, homeGoals, away.code, awayGoals);
    }
  }

  const table = [...rows.values()];
  if (heroClubCode !== null && bonusPoints > 0) {
    const heroRow = table.find((row) => row.clubCode === heroClubCode);
    if (heroRow) heroRow.points += bonusPoints;
  }

  return table.sort(compareRows);
}

function applyResult(
  rows: Map<string, SimStandingRow>,
  homeCode: string,
  homeGoals: number,
  awayCode: string,
  awayGoals: number,
): void {
  const home = rows.get(homeCode);
  const away = rows.get(awayCode);
  if (!home || !away) return;
  home.played += 1;
  away.played += 1;
  home.goalsFor += homeGoals;
  home.goalsAgainst += awayGoals;
  away.goalsFor += awayGoals;
  away.goalsAgainst += homeGoals;
  if (homeGoals > awayGoals) {
    home.won += 1;
    home.points += 3;
    away.lost += 1;
  } else if (homeGoals < awayGoals) {
    away.won += 1;
    away.points += 3;
    home.lost += 1;
  } else {
    home.drawn += 1;
    away.drawn += 1;
    home.points += 1;
    away.points += 1;
  }
}

function compareRows(a: SimStandingRow, b: SimStandingRow): number {
  if (b.points !== a.points) return b.points - a.points;
  const aDiff = a.goalsFor - a.goalsAgainst;
  const bDiff = b.goalsFor - b.goalsAgainst;
  if (bDiff !== aDiff) return bDiff - aDiff;
  if (b.goalsFor !== a.goalsFor) return b.goalsFor - a.goalsFor;
  return a.clubName.localeCompare(b.clubName);
}
