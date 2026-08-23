import type { FootballRecord } from "@bidsentinel/contracts";

export interface RecordField {
  field: string;
  value: string | number | null;
}

/**
 * Flattens a football record into an ordered list of comparable scalar
 * fields. The field order is deterministic so semantic diff events and
 * change events are stable across runs.
 */
export function recordScalarFields(record: FootballRecord): RecordField[] {
  switch (record.entityType) {
    case "player":
      return [
        { field: "playerName", value: record.playerName },
        { field: "team", value: `${record.team.teamId}·${record.team.name}` },
        { field: "position", value: record.position },
        { field: "shirtNumber", value: record.shirtNumber },
        { field: "nationality", value: record.nationality },
        { field: "stats.appearances", value: record.stats.appearances },
        { field: "stats.goals", value: record.stats.goals },
        { field: "stats.assists", value: record.stats.assists },
        { field: "stats.yellowCards", value: record.stats.yellowCards },
        { field: "stats.redCards", value: record.stats.redCards },
        { field: "stats.minutesPlayed", value: record.stats.minutesPlayed },
      ];
    case "team":
      return [
        { field: "name", value: record.name },
        { field: "shortName", value: record.shortName },
        { field: "country", value: record.country },
        { field: "city", value: record.city },
        { field: "stadium", value: record.stadium },
        { field: "founded", value: record.founded },
        { field: "coach", value: record.coach },
      ];
    case "standing":
      return [
        { field: "rank", value: record.rank },
        { field: "teamName", value: record.teamName },
        { field: "played", value: record.played },
        { field: "won", value: record.won },
        { field: "drawn", value: record.drawn },
        { field: "lost", value: record.lost },
        { field: "goalsFor", value: record.goalsFor },
        { field: "goalsAgainst", value: record.goalsAgainst },
        { field: "points", value: record.points },
      ];
    case "match":
      return [
        { field: "playerName", value: record.playerName },
        { field: "playerTeam", value: record.playerTeam },
        { field: "playedOn", value: record.playedOn },
        { field: "competition", value: record.competition },
        { field: "homeTeam", value: record.homeTeam },
        { field: "awayTeam", value: record.awayTeam },
        { field: "homeGoals", value: record.homeGoals },
        { field: "awayGoals", value: record.awayGoals },
        { field: "venue", value: record.venue },
        { field: "appeared", value: record.appeared ? 1 : 0 },
        { field: "goals", value: record.goals },
        { field: "assists", value: record.assists },
        { field: "minutesPlayed", value: record.minutesPlayed },
        { field: "yellowCards", value: record.yellowCards },
        { field: "redCards", value: record.redCards },
      ];
  }
}

export function changedScalarFields(
  previous: FootballRecord,
  current: FootballRecord,
): Array<{
  field: string;
  before: string | number | null;
  after: string | number | null;
}> {
  const previousFields = new Map(
    recordScalarFields(previous).map((entry) => [entry.field, entry.value]),
  );

  return recordScalarFields(current).flatMap((entry) => {
    const before = previousFields.get(entry.field);
    if (before === undefined || before === entry.value) {
      return [];
    }
    return [{ field: entry.field, before, after: entry.value }];
  });
}
