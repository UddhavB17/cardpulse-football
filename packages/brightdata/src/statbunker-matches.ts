import {
  PlayerMatchRecordSchema,
  SourceIdSchema,
  type PlayerMatchRecord,
} from "@bidsentinel/contracts";

export interface StatBunkerMatchContext {
  readonly playerId: string;
  readonly playerExternalId: string;
  readonly playerName: string;
  readonly playerTeam: string;
  readonly season: string;
  readonly sourceUrl: string;
  readonly observedAt: string;
}

export interface StatBunkerMatchIssue {
  readonly path: string[];
  readonly message: string;
}

export type StatBunkerMatchOutcome =
  | { readonly ok: true; readonly record: PlayerMatchRecord }
  | { readonly ok: false; readonly issues: StatBunkerMatchIssue[] };

const MONTHS: Readonly<Record<string, number>> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

const EMPTY = new Set(["", "-", "--", "–", "—", "n/a", "na"]);

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function normalizedRow(row: Record<string, unknown>): Map<string, unknown> {
  return new Map(
    Object.entries(row).map(([key, value]) => [normalizeKey(key), value]),
  );
}

function lookup(
  row: Map<string, unknown>,
  aliases: readonly string[],
): unknown {
  for (const alias of aliases) {
    const key = normalizeKey(alias);
    if (row.has(key)) return row.get(key);
  }
  return undefined;
}

function textOf(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim().replace(/\s+/g, " ");
  return EMPTY.has(text.toLowerCase()) ? null : text;
}

function countOf(value: unknown, dashMeansZero = true): number | null {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  }
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (EMPTY.has(text.toLowerCase())) return dashMeansZero ? 0 : null;
  if (!/^\d+$/.test(text)) return null;
  const parsed = Number(text);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function isoDateOf(value: unknown): string | null {
  const text = textOf(value);
  if (text === null) return null;
  let year: number;
  let month: number;
  let day: number;
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (iso !== null) {
    year = Number(iso[1]);
    month = Number(iso[2]);
    day = Number(iso[3]);
  } else {
    const display = /^(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})$/.exec(text);
    if (display === null) return null;
    day = Number(display[1]);
    month = MONTHS[display[2]?.slice(0, 3).toLowerCase() ?? ""] ?? 0;
    year = Number(display[3]);
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function scoreOf(
  row: Map<string, unknown>,
): { homeGoals: number; awayGoals: number } | null {
  const home = countOf(lookup(row, ["home_goals", "homeGoals"]), false);
  const away = countOf(lookup(row, ["away_goals", "awayGoals"]), false);
  if (home !== null && away !== null)
    return { homeGoals: home, awayGoals: away };
  const score = textOf(lookup(row, ["score", "result"]));
  const match = score === null ? null : /^(\d+)\s*[-–—]\s*(\d+)$/.exec(score);
  if (match === null) return null;
  return { homeGoals: Number(match[1]), awayGoals: Number(match[2]) };
}

function slug(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function belongsToPremierLeagueSeason(
  competition: string,
  playedOn: string,
  season: string,
): boolean {
  if (!/^\d{4}$/.test(season)) return false;
  const startYear = Number(season);
  const endYear = startYear + 1;
  const expectedLabel = `premier league ${String(startYear).slice(-2)}/${String(endYear).slice(-2)}`;
  return (
    competition.trim().toLowerCase() === expectedLabel &&
    playedOn >= `${startYear}-07-01` &&
    playedOn <= `${endYear}-06-30`
  );
}

/**
 * Strict mapper for StatBunker's player SeasonMatches table. In this table a
 * dash in a count column means zero; a dash in minutes remains null. Player
 * identity, season, and source URL come from the already-verified request,
 * never from an untrusted row or a guessed URL.
 */
export class StatBunkerMatchRowMapper {
  readonly #sourceId: string;

  constructor(sourceId: string) {
    this.#sourceId = SourceIdSchema.parse(sourceId);
  }

  map(row: unknown, context: StatBunkerMatchContext): StatBunkerMatchOutcome {
    const canonical = PlayerMatchRecordSchema.safeParse(row);
    if (canonical.success) {
      return canonical.data.sourceId === this.#sourceId &&
        canonical.data.playerId === context.playerId &&
        canonical.data.playerExternalId === context.playerExternalId &&
        canonical.data.playerName === context.playerName &&
        canonical.data.playerTeam === context.playerTeam &&
        canonical.data.season === context.season &&
        canonical.data.sourceUrl === context.sourceUrl &&
        canonical.data.observedAt === context.observedAt &&
        belongsToPremierLeagueSeason(
          canonical.data.competition,
          canonical.data.playedOn,
          context.season,
        )
        ? { ok: true, record: canonical.data }
        : {
            ok: false,
            issues: [
              {
                path: [],
                message:
                  "Canonical match row does not match the requested source, player, and season",
              },
            ],
          };
    }
    if (row === null || typeof row !== "object" || Array.isArray(row)) {
      return {
        ok: false,
        issues: [{ path: [], message: "Match row must be an object" }],
      };
    }

    const normalized = normalizedRow(row as Record<string, unknown>);
    const issues: StatBunkerMatchIssue[] = [];
    const requiredText = (aliases: readonly string[], path: string): string => {
      const value = textOf(lookup(normalized, aliases));
      if (value !== null) return value;
      issues.push({ path: [path], message: `Missing or invalid ${path}` });
      return "";
    };
    const requiredCount = (
      aliases: readonly string[],
      path: string,
      dashMeansZero = true,
    ): number => {
      const value = countOf(lookup(normalized, aliases), dashMeansZero);
      if (value !== null) return value;
      issues.push({ path: [path], message: `Missing or invalid ${path}` });
      return 0;
    };

    const competition = requiredText(["competition"], "competition");
    const homeTeam = requiredText(
      ["home_team", "home_club", "homeTeam", "homeClub"],
      "homeTeam",
    );
    const awayTeam = requiredText(
      ["away_team", "away_club", "awayTeam", "awayClub"],
      "awayTeam",
    );
    const playedOn = isoDateOf(
      lookup(normalized, ["played_on", "match_date", "date"]),
    );
    if (playedOn === null) {
      issues.push({
        path: ["playedOn"],
        message: "Missing or invalid match date",
      });
    }
    if (
      playedOn !== null &&
      competition !== "" &&
      !belongsToPremierLeagueSeason(competition, playedOn, context.season)
    ) {
      issues.push({
        path: ["season"],
        message:
          "Match competition or date does not belong to the requested Premier League season",
      });
    }
    const score = scoreOf(normalized);
    if (score === null) {
      issues.push({ path: ["score"], message: "Missing or invalid score" });
    }
    const started = requiredCount(["started", "start"], "started");
    const substitute = requiredCount(
      ["substitute", "sub", "started_as_sub"],
      "substitute",
    );
    const goals = requiredCount(["goals"], "goals");
    const assists = requiredCount(["assists", "a"], "assists");
    const yellowCards = requiredCount(
      ["yellow_cards", "yellowCard", "yc"],
      "yellowCards",
    );
    const secondYellowCards = requiredCount(
      ["second_yellow_cards", "red_yellow_cards", "secondYellowCards"],
      "secondYellowCards",
    );
    const straightRedCards = requiredCount(
      ["red_cards", "redCard", "rc"],
      "redCards",
    );
    const minutesPlayed = countOf(
      lookup(normalized, ["minutes_played", "minutes", "mp"]),
      false,
    );

    const venue =
      homeTeam === context.playerTeam
        ? "home"
        : awayTeam === context.playerTeam
          ? "away"
          : null;
    if (venue === null) {
      issues.push({
        path: ["playerTeam"],
        message: "Neither home nor away club matches the indexed player team",
      });
    }
    if (
      issues.length > 0 ||
      playedOn === null ||
      score === null ||
      venue === null
    ) {
      return { ok: false, issues };
    }

    const externalId = `${context.playerExternalId}:${playedOn}:${slug(homeTeam)}:${slug(awayTeam)}`;
    const parsed = PlayerMatchRecordSchema.safeParse({
      schemaVersion: 1,
      entityType: "match",
      matchId: `${this.#sourceId}:match:${externalId}`,
      sourceId: this.#sourceId,
      externalId,
      playerId: context.playerId,
      playerExternalId: context.playerExternalId,
      playerName: context.playerName,
      playerTeam: context.playerTeam,
      season: context.season,
      playedOn,
      competition,
      homeTeam,
      awayTeam,
      homeGoals: score.homeGoals,
      awayGoals: score.awayGoals,
      venue,
      appeared: started > 0 || substitute > 0,
      goals,
      assists,
      minutesPlayed,
      yellowCards,
      redCards: secondYellowCards + straightRedCards,
      sourceUrl: context.sourceUrl,
      observedAt: context.observedAt,
    });
    return parsed.success
      ? { ok: true, record: parsed.data }
      : {
          ok: false,
          issues: parsed.error.issues.map((issue) => ({
            path: issue.path.map(String),
            message: issue.message,
          })),
        };
  }
}
