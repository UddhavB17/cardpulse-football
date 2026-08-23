import {
  PlayerCardSchema,
  SourceIdSchema,
  type FootballRecord,
  type Position,
} from "@bidsentinel/contracts";

/**
 * Adapter-layer named boundary shape owned by this module: normalizes raw
 * rows for a named source before canonical mapping. Kept here because the
 * provider surface settles on the stricter `rowMapper` hook.
 */
export interface StatBunkerSourceAdapter {
  /** Canonical source id this adapter is named for. */
  readonly sourceId: string;
  /** Whether this adapter should normalize rows for a configured source. */
  matchesSourceId(candidateId: string): boolean;
  adaptRow(row: unknown): unknown;
}

/**
 * Named StatBunker source mapping boundary.
 *
 * This is the single place where raw Bright Data Scraper Studio rows for the
 * StatBunker Premier League collector (comp_id=776) are translated into the
 * canonical CardPulse football contracts. The generic
 * `mapRawRowToFootballRecord` stays domain-neutral; everything StatBunker
 * specific lives here so its semantics are documented and tested in one spot.
 *
 * Expected Scraper Studio output fields (snake_case; case/punctuation
 * variants are tolerated):
 *   player_name, player_url, team_name, position, appearances, goals,
 *   assists, yellow_cards, second_yellow_cards, red_cards, minutes_played,
 *   nationality, season, source_url
 *
 * Canonical discipline meaning (deliberate and tested): the canonical
 * `PlayerStatsSchema.redCards` field has no second-yellow variant, so for this
 * source it is DEFINED as total dismissals = straight red cards
 * (`red_cards`) plus sendings-off via a second yellow (`second_yellow_cards`).
 * Both components must be explicitly present numeric values; an unavailable
 * component fails the row closed instead of being assumed to be zero.
 *
 * Stable ID rule: every StatBunker detail link shares the pathname
 * `/players/getPlayerStats`, so the last path segment can NEVER identify a
 * player. Derivation order is: explicit `player_id` cell value, then the
 * `player_id` query parameter of player_url, then a slug of the last
 * non-endpoint path segment, then a slug of "<player_name> <team_name>".
 * Same input always yields the same ID; no timestamps or randomness.
 *
 * Fail-closed policy: core fields (player name, team, position, season,
 * source URL) and every required stat must be present and usable. Missing
 * keys, dash/blank cells, and malformed values reject the row with structured
 * issues; nothing is fabricated. This is what contains a partially failed
 * generated selector (for example a broken detail-page `#show` selector that
 * drops minutes/nationality enrichment): affected rows are quarantined with
 * their raw payload while complete rows in the same batch still land. The
 * only nullable passthroughs are `nationality` (dash/blank maps to
 * contract-null) and `shirtNumber` (not part of the expected output).
 */
export const STATBUNKER_SOURCE_PROFILE = "statbunker";

/**
 * Canonical CardPulse source ID for the StatBunker EPL 25/26 collector.
 * Configuration, not a secret: operators may override it per environment via
 * CARDPULSE_SOURCE_ID.
 */
export const STATBUNKER_SOURCE_ID = "statbunker-epl-2025-26";

/** Alias of {@link STATBUNKER_SOURCE_ID} kept for runtime wiring imports. */
export const DEFAULT_STATBUNKER_SOURCE_ID = STATBUNKER_SOURCE_ID;

/**
 * True for the StatBunker source-ID family: the bare profile name or any
 * "statbunker" ID followed by a separator ("statbunker-epl-2025-26",
 * "statbunker_football_public"). Lets the runtime route StatBunker-named
 * sources through this boundary even when no explicit profile is set, while
 * loose substrings ("statbunkerparsing") and other sources never match.
 */
export function statBunkerSourceIdMatches(sourceId: string): boolean {
  return /^statbunker([._-].+)?$/.test(sourceId.trim().toLowerCase());
}

export type StatBunkerRowIssueCode =
  | "row_not_object"
  | "missing_field"
  | "unavailable_field"
  | "invalid_field"
  | "unsupported_position"
  | "unsupported_season"
  | "schema_mismatch";

export interface StatBunkerRowIssue {
  readonly code: StatBunkerRowIssueCode;
  readonly path: string[];
  readonly message: string;
}

export type StatBunkerRowOutcome =
  | { readonly ok: true; readonly record: FootballRecord }
  | { readonly ok: false; readonly issues: StatBunkerRowIssue[] };

export interface StatBunkerMappedRowRejection {
  readonly row: unknown;
  readonly issues: StatBunkerRowIssue[];
}

export interface StatBunkerMappedBatch {
  readonly records: FootballRecord[];
  readonly rejectedRows: StatBunkerMappedRowRejection[];
}

/**
 * Alias groups per canonical field. Keys are stored already normalized
 * (lowercase alphanumerics), so `player_name`, `playerName`, and
 * `Player Name` all resolve through the same entry.
 */
const FIELD_ALIASES = {
  playerIdCell: ["playerid"],
  playerName: ["playername", "name"],
  playerUrl: ["playerurl", "playerlink", "moredetail"],
  sourceUrl: ["sourceurl", "pageurl", "url", "link"],
  teamName: ["teamname", "club", "clubname", "team"],
  position: ["position", "playerposition", "pos"],
  appearances: ["appearances", "apps"],
  goals: ["goals", "goalsscored"],
  assists: ["assists"],
  yellowCards: ["yellowcards", "yellows"],
  secondYellowCards: ["secondyellowcards", "secondyellows", "yellowredcards"],
  redCards: ["redcards", "reds"],
  minutesPlayed: ["minutesplayed", "minutes", "mins"],
  nationality: ["nationality", "nationalitycountry"],
  season: ["season", "seasonyear"],
} as const satisfies Record<string, readonly string[]>;

const POSITION_ALIASES: Record<string, Position> = {
  goalkeeper: "goalkeeper",
  gk: "goalkeeper",
  defender: "defender",
  df: "defender",
  midfielder: "midfielder",
  mf: "midfielder",
  forward: "forward",
  fw: "forward",
};

/** Cell markers that mean "the site shows no value here". Never coerced. */
const UNAVAILABLE_CELL_MARKERS = new Set([
  "",
  "-",
  "--",
  "–",
  "—",
  "n/a",
  "na",
  "none",
  "null",
]);

/**
 * Path segments that identify a StatBunker endpoint rather than a player.
 * Every detail link reuses these, so they must never become an external ID.
 */
const NON_IDENTIFYING_PATH_SEGMENTS = new Set(["getplayerstats"]);

type TextParseResult =
  | { kind: "text"; value: string }
  | { kind: "unavailable" }
  | { kind: "invalid" };

type NumberParseResult =
  | { kind: "number"; value: number }
  | { kind: "unavailable" }
  | { kind: "invalid" };

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function lookupField(
  normalized: Map<string, unknown>,
  aliases: readonly string[],
): unknown {
  for (const alias of aliases) {
    if (normalized.has(alias)) return normalized.get(alias);
  }
  return undefined;
}

function parseTextField(value: unknown): TextParseResult {
  if (value === undefined || value === null) return { kind: "unavailable" };
  if (typeof value !== "string") return { kind: "invalid" };
  const trimmed = value.trim();
  if (UNAVAILABLE_CELL_MARKERS.has(trimmed.toLowerCase())) {
    return { kind: "unavailable" };
  }
  return trimmed === ""
    ? { kind: "unavailable" }
    : { kind: "text", value: trimmed };
}

function parseStatNumber(value: unknown): NumberParseResult {
  if (value === undefined || value === null) return { kind: "unavailable" };
  if (typeof value === "number") {
    return Number.isInteger(value)
      ? { kind: "number", value }
      : { kind: "invalid" };
  }
  if (typeof value !== "string") return { kind: "invalid" };
  const trimmed = value.trim();
  if (trimmed === "" || UNAVAILABLE_CELL_MARKERS.has(trimmed.toLowerCase())) {
    return { kind: "unavailable" };
  }
  const compact = trimmed.replace(/[,\s]/g, "");
  if (!/^\d+$/.test(compact)) return { kind: "invalid" };
  const parsed = Number(compact);
  return Number.isSafeInteger(parsed)
    ? { kind: "number", value: parsed }
    : { kind: "invalid" };
}

/**
 * Normalize a StatBunker season label to the canonical four-digit starting
 * year. "2025" and "2025/26" both map deterministically to "2025"; ambiguous
 * two-digit-first labels such as "25/26" are rejected rather than guessed.
 */
export function normalizeStatBunkerSeason(raw: string): string | null {
  const match = /^(\d{4})(?:\s*\/\s*\d{2,4})?$/.exec(raw.trim());
  return match?.[1] ?? null;
}

/**
 * Normalize a StatBunker position cell to the canonical contract enum.
 * Accepts the four StatBunker headings (case-insensitive) and their common
 * abbreviations; unavailable or unusable input and anything else returns null
 * so callers can fail closed.
 */
export function normalizeStatBunkerPosition(raw: unknown): Position | null {
  const text = parseTextField(raw);
  if (text.kind !== "text") return null;
  return POSITION_ALIASES[text.value.toLowerCase()] ?? null;
}

/**
 * Clean a StatBunker nationality cell for the nullable contract field.
 * StatBunker publishes display names ("England"), not ISO codes, so no code
 * translation is attempted; unavailable cells become null. Returns null for
 * unusable input so callers treating null as "absent" stay honest.
 */
export function normalizeStatBunkerCountryCode(raw: unknown): string | null {
  const text = parseTextField(raw);
  return text.kind === "text" ? text.value.replace(/\s+/g, " ") : null;
}

function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function decodeUriSegmentSafe(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function parseHttpUrl(raw: unknown): URL | null {
  const candidate = raw instanceof URL ? raw.href : raw;
  const text = parseTextField(candidate);
  if (text.kind !== "text") return null;
  try {
    const parsed = new URL(text.value);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed
      : null;
  } catch {
    return null;
  }
}

/**
 * Derive a stable external ID from a StatBunker player URL alone.
 * Preference: the `player_id` query parameter (the only per-player
 * discriminator on `/players/getPlayerStats` links), then the last path
 * segment unless it is a known shared endpoint segment. Returns null when
 * nothing identifying is available; callers decide the fallback.
 */
export function externalIdFromStatBunkerUrl(url: unknown): string | null {
  const parsed = parseHttpUrl(url);
  if (!parsed) return null;

  const playerIdQuery = parsed.searchParams.get("player_id");
  if (playerIdQuery !== null) {
    const fromQuery = slugify(playerIdQuery.trim());
    if (fromQuery !== "") return fromQuery;
  }

  const segments = parsed.pathname.split("/").filter(Boolean);
  const lastSegment = segments.at(-1);
  if (!lastSegment) return null;
  const decoded = decodeUriSegmentSafe(lastSegment);
  if (NON_IDENTIFYING_PATH_SEGMENTS.has(normalizeKey(decoded))) return null;
  return slugify(decoded) || null;
}

function sanitizedIdCellValue(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const slug = slugify(String(value).trim());
  return slug === "" ? null : slug;
}

/**
 * Deterministic stable external ID for one row, resolving in order:
 * explicit `player_id` cell value, player_url (query param first, see
 * {@link externalIdFromStatBunkerUrl}), then a "<player_name> <team_name>"
 * slug. Returns null only when nothing usable exists; callers fail closed.
 */
export function statBunkerExternalId(input: {
  playerIdCell?: unknown;
  playerUrl: URL | null;
  playerName: string;
  teamName: string;
}): string | null {
  const fromCell = sanitizedIdCellValue(input.playerIdCell);
  if (fromCell !== null) return fromCell;

  const fromUrl = input.playerUrl
    ? externalIdFromStatBunkerUrl(input.playerUrl)
    : null;
  if (fromUrl !== null) return fromUrl;

  return slugify(`${input.playerName} ${input.teamName}`) || null;
}

/**
 * Canonical snake_case keys the neutral pipeline understands, mapped from the
 * tolerated alias groups. Used by the preprocessing adapter layer; values are
 * normalized without ever being invented.
 */
const CANONICAL_ROW_KEYS: ReadonlyArray<readonly [string, readonly string[]]> =
  [
    ["player_id", FIELD_ALIASES.playerIdCell],
    ["player_name", FIELD_ALIASES.playerName],
    ["team_name", FIELD_ALIASES.teamName],
    ["position", FIELD_ALIASES.position],
    ["season", FIELD_ALIASES.season],
    ["appearances", FIELD_ALIASES.appearances],
    ["goals", FIELD_ALIASES.goals],
    ["assists", FIELD_ALIASES.assists],
    ["yellow_cards", FIELD_ALIASES.yellowCards],
    ["second_yellow_cards", FIELD_ALIASES.secondYellowCards],
    ["red_cards", FIELD_ALIASES.redCards],
    ["minutes_played", FIELD_ALIASES.minutesPlayed],
    ["nationality", FIELD_ALIASES.nationality],
    ["player_url", FIELD_ALIASES.playerUrl],
    ["source_url", FIELD_ALIASES.sourceUrl],
  ];

/**
 * Preprocessing adapter transform: rename tolerated header variants onto the
 * canonical snake_case keys, compact "2025/26"-style seasons to their
 * four-digit starting year, lowercase positions, and clean thousands
 * separators from numeric cells. Original keys and unknown keys are
 * preserved, unavailable markers ("-") are left untouched, and no value is
 * ever fabricated. Non-object rows pass through unchanged.
 */
export function preprocessStatBunkerRow(row: unknown): unknown {
  if (row === null || typeof row !== "object" || Array.isArray(row)) {
    return row;
  }

  const normalized = new Map<string, unknown>();
  for (const [key, value] of Object.entries(row as Record<string, unknown>)) {
    normalized.set(normalizeKey(key), value);
  }

  const adapted: Record<string, unknown> = {
    ...(row as Record<string, unknown>),
  };
  for (const [canonicalKey, aliases] of CANONICAL_ROW_KEYS) {
    const value = lookupField(normalized, aliases);
    if (value === undefined) continue;

    if (canonicalKey === "season") {
      const text = parseTextField(value);
      const compacted =
        text.kind === "text" ? normalizeStatBunkerSeason(text.value) : null;
      adapted[canonicalKey] = compacted ?? value;
      continue;
    }
    if (canonicalKey === "position") {
      const text = parseTextField(value);
      adapted[canonicalKey] =
        text.kind === "text" ? text.value.toLowerCase() : value;
      continue;
    }
    const numeric = parseStatNumber(value);
    adapted[canonicalKey] = numeric.kind === "number" ? numeric.value : value;
  }
  return adapted;
}

/**
 * Adapter-layer named boundary for the generic row-adapter hook. Normalizes
 * StatBunker rows so tolerant consumers see canonical headers. Note that
 * normalization alone cannot satisfy the canonical player contract (stable
 * IDs, required stats, combined dismissals); pair it with
 * {@link StatBunkerRowMapper} via the provider `rowMapper` hook for full
 * contract-ready payloads.
 */
export function statBunkerSourceAdapter(
  sourceId: string = STATBUNKER_SOURCE_ID,
): StatBunkerSourceAdapter {
  const parsedSourceId = SourceIdSchema.safeParse(sourceId);
  if (!parsedSourceId.success) {
    throw new Error(
      `StatBunker adapter requires a canonical source ID, received: ${JSON.stringify(sourceId)}`,
    );
  }
  return {
    sourceId: parsedSourceId.data,
    matchesSourceId(candidateId: string): boolean {
      return candidateId === parsedSourceId.data;
    },
    adaptRow: preprocessStatBunkerRow,
  };
}

export interface StatBunkerRowMapperOptions {
  /** Canonical source ID stamped onto every mapped record. */
  sourceId: string;
}

/**
 * Row-level mapper for the named StatBunker boundary. One instance per
 * source; mapping never throws and never invents values. See the module doc
 * block for the documented discipline meaning, stable-ID rule, and
 * fail-closed policy.
 */
export class StatBunkerRowMapper {
  readonly #sourceId: string;

  constructor(options: StatBunkerRowMapperOptions) {
    const parsedSourceId = SourceIdSchema.safeParse(options.sourceId);
    if (!parsedSourceId.success) {
      throw new Error(
        `StatBunker mapper requires a canonical source ID, received: ${JSON.stringify(options.sourceId)}`,
      );
    }
    this.#sourceId = parsedSourceId.data;
  }

  get sourceId(): string {
    return this.#sourceId;
  }

  /**
   * Map one raw row into a schema-valid canonical player record, or fail
   * closed with structured row-level issues that callers can quarantine.
   */
  map(row: unknown, observedAt: string): StatBunkerRowOutcome {
    const issues: StatBunkerRowIssue[] = [];

    if (row === null || typeof row !== "object" || Array.isArray(row)) {
      return {
        ok: false,
        issues: [
          {
            code: "row_not_object",
            path: [],
            message:
              "StatBunker dataset row is not an object; refusing to guess an entity shape",
          },
        ],
      };
    }

    const normalized = new Map<string, unknown>();
    for (const [key, value] of Object.entries(row as Record<string, unknown>)) {
      normalized.set(normalizeKey(key), value);
    }

    /** Required text field; records an issue and returns null when unusable. */
    const requireText = (
      aliases: readonly string[],
      path: string[],
      label: string,
    ): string | null => {
      const parsed = parseTextField(lookupField(normalized, aliases));
      if (parsed.kind === "text") return parsed.value;
      if (parsed.kind === "unavailable") {
        issues.push({
          code: "missing_field",
          path,
          message: `StatBunker row has no usable ${label}`,
        });
      } else {
        issues.push({
          code: "invalid_field",
          path,
          message: `${label} must be text`,
        });
      }
      return null;
    };

    const playerName = requireText(
      FIELD_ALIASES.playerName,
      ["playerName"],
      "player_name",
    );
    const teamName = requireText(FIELD_ALIASES.teamName, ["team"], "team_name");

    const position = normalizeStatBunkerPosition(
      lookupField(normalized, FIELD_ALIASES.position),
    );
    if (position === null) {
      const rawPosition = lookupField(normalized, FIELD_ALIASES.position);
      const availability = parseTextField(rawPosition);
      issues.push({
        code:
          availability.kind === "unavailable"
            ? "missing_field"
            : availability.kind === "invalid"
              ? "invalid_field"
              : "unsupported_position",
        path: ["position"],
        message:
          availability.kind === "text"
            ? `Position ${JSON.stringify(availability.value)} does not map to goalkeeper/defender/midfielder/forward`
            : "StatBunker row has no usable position",
      });
    }

    let season: string | null = null;
    const seasonText = parseTextField(
      lookupField(normalized, FIELD_ALIASES.season),
    );
    if (seasonText.kind === "unavailable") {
      issues.push({
        code: "missing_field",
        path: ["season"],
        message: "StatBunker row has no season",
      });
    } else if (seasonText.kind === "invalid") {
      issues.push({
        code: "invalid_field",
        path: ["season"],
        message: "season must be text",
      });
    } else {
      const normalizedSeason = normalizeStatBunkerSeason(seasonText.value);
      if (normalizedSeason !== null) {
        season = normalizedSeason;
      } else {
        issues.push({
          code: "unsupported_season",
          path: ["season"],
          message: `Season ${JSON.stringify(seasonText.value)} cannot be reduced to a four-digit starting year without guessing`,
        });
      }
    }

    // Source URL preference: per-player page first (most specific
    // provenance), then the batch-level source_url/url/link fields.
    const playerUrl = parseHttpUrl(
      lookupField(normalized, FIELD_ALIASES.playerUrl),
    );
    let sourceUrl: string | null = playerUrl?.toString() ?? null;
    if (sourceUrl === null) {
      const fallbackUrl = parseHttpUrl(
        lookupField(normalized, FIELD_ALIASES.sourceUrl),
      );
      sourceUrl = fallbackUrl?.toString() ?? null;
    }
    if (sourceUrl === null) {
      const sawAnyUrlField = [
        ...FIELD_ALIASES.playerUrl,
        ...FIELD_ALIASES.sourceUrl,
      ].some((alias) => parseTextField(normalized.get(alias)).kind === "text");
      issues.push({
        code: sawAnyUrlField ? "invalid_field" : "missing_field",
        path: ["sourceUrl"],
        message: sawAnyUrlField
          ? "StatBunker row URL fields did not contain a usable http(s) URL"
          : "StatBunker row has neither player_url nor source_url",
      });
    }

    const statsInput: Record<string, number> = {};
    const statFields = [
      { key: "appearances", aliases: FIELD_ALIASES.appearances },
      { key: "goals", aliases: FIELD_ALIASES.goals },
      { key: "assists", aliases: FIELD_ALIASES.assists },
      { key: "yellowCards", aliases: FIELD_ALIASES.yellowCards },
      { key: "minutesPlayed", aliases: FIELD_ALIASES.minutesPlayed },
    ] as const;
    for (const field of statFields) {
      const parsed = parseStatNumber(lookupField(normalized, field.aliases));
      if (parsed.kind === "number") {
        statsInput[field.key] = parsed.value;
      } else if (parsed.kind === "unavailable") {
        issues.push({
          code: "unavailable_field",
          path: ["stats", field.key],
          message: `StatBunker cell for ${field.key} is unavailable (dash/blank); refusing to substitute a value`,
        });
      } else {
        issues.push({
          code: "invalid_field",
          path: ["stats", field.key],
          message: `StatBunker cell for ${field.key} is not a usable integer`,
        });
      }
    }

    const straightReds = parseStatNumber(
      lookupField(normalized, FIELD_ALIASES.redCards),
    );
    const secondYellows = parseStatNumber(
      lookupField(normalized, FIELD_ALIASES.secondYellowCards),
    );
    if (straightReds.kind === "number" && secondYellows.kind === "number") {
      // Canonical meaning documented on this module: total dismissals.
      statsInput.redCards = straightReds.value + secondYellows.value;
    } else if (
      straightReds.kind === "unavailable" ||
      secondYellows.kind === "unavailable"
    ) {
      issues.push({
        code: "unavailable_field",
        path: ["stats", "redCards"],
        message:
          "Both red_cards and second_yellow_cards must be present to compute total dismissals; refusing to assume zero",
      });
    } else {
      issues.push({
        code: "invalid_field",
        path: ["stats", "redCards"],
        message:
          "red_cards and second_yellow_cards must both be usable integers",
      });
    }

    const nationality = normalizeStatBunkerCountryCode(
      lookupField(normalized, FIELD_ALIASES.nationality),
    );

    if (issues.length > 0 || playerName === null || teamName === null) {
      return { ok: false, issues };
    }

    const externalId = statBunkerExternalId({
      playerIdCell: lookupField(normalized, FIELD_ALIASES.playerIdCell),
      playerUrl,
      playerName,
      teamName,
    });
    if (externalId === null) {
      return {
        ok: false,
        issues: [
          {
            code: "invalid_field",
            path: ["externalId"],
            message:
              "Could not derive a deterministic stable external ID from player_id, player_url, or names",
          },
        ],
      };
    }

    const candidate = {
      schemaVersion: 1,
      entityType: "player",
      playerId: `${this.#sourceId}:${externalId}`,
      sourceId: this.#sourceId,
      externalId,
      playerName,
      team: {
        teamId: `${this.#sourceId}:${slugify(teamName) || "club"}`,
        name: teamName,
      },
      position: position as Position,
      shirtNumber: null,
      nationality,
      season: season as string,
      stats: { ...statsInput },
      sourceUrl: sourceUrl as string,
      observedAt,
    };

    // Hard fail-closed gate: nothing leaves this boundary unless it already
    // satisfies the frozen canonical player contract.
    const validated = PlayerCardSchema.safeParse(candidate);
    if (!validated.success) {
      return {
        ok: false,
        issues: validated.error.issues.map((issue) => ({
          code: "schema_mismatch" as const,
          path: issue.path.map(String),
          message: issue.message,
        })),
      };
    }

    return { ok: true, record: validated.data };
  }

  /**
   * Map a whole dataset batch, splitting accepted records from rejected rows.
   * Rejections keep the original raw row so callers can quarantine them with
   * their exact Bright Data payload attached.
   */
  mapRows(rows: readonly unknown[], observedAt: string): StatBunkerMappedBatch {
    const records: FootballRecord[] = [];
    const rejectedRows: StatBunkerMappedRowRejection[] = [];
    for (const row of rows) {
      const outcome = this.map(row, observedAt);
      if (outcome.ok) {
        records.push(outcome.record);
      } else {
        rejectedRows.push({ row, issues: outcome.issues });
      }
    }
    return { records, rejectedRows };
  }
}

/**
 * Convenience single-row boundary matching the generic mapper's signature.
 * Accepted rows return a schema-valid canonical record; anything else
 * returns the original raw row untouched so downstream strict validation can
 * quarantine it. Never throws, including for invalid source IDs.
 */
export function mapStatBunkerRowToFootballRecord(
  row: unknown,
  sourceId: string,
  observedAt: string,
): unknown {
  try {
    const outcome = new StatBunkerRowMapper({ sourceId }).map(row, observedAt);
    return outcome.ok ? outcome.record : row;
  } catch {
    return row;
  }
}

/**
 * Cached row-mapper hook for the collection provider. Accepted rows become
 * canonical records; rejected rows pass through unmapped so the strict
 * pipeline quarantines them and the structural drift/healing signals keep
 * working unchanged. This function never throws: unexpected failures degrade
 * to raw-row quarantine.
 */
export function createStatBunkerPipelineRowMapper(): (
  row: unknown,
  sourceId: string,
  observedAt: string,
) => unknown {
  const mappers = new Map<string, StatBunkerRowMapper>();
  return (row, sourceId, observedAt) => {
    try {
      let mapper = mappers.get(sourceId);
      if (!mapper) {
        mapper = new StatBunkerRowMapper({ sourceId });
        mappers.set(sourceId, mapper);
      }
      const outcome = mapper.map(row, observedAt);
      return outcome.ok ? outcome.record : row;
    } catch {
      return row;
    }
  };
}
