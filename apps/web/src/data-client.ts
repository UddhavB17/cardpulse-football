// CardPulse Football browser API client.
//
// This module owns every HTTP concern. Payloads are validated structurally
// *before* they reach the UI: anything that fails normalization throws a
// DataClientError instead of rendering half-truthful data. Endpoints whose
// frozen contracts already exist (/api/runtime, /api/sources) are validated
// with the shared Zod schemas; the newer search/card endpoints are normalized
// tolerantly here until their contracts land, accepting documented shape
// variants but never guessing values that are absent.

import {
  RuntimeStatusResponseSchema,
  SourceHealthListResponseSchema,
  type SourceHealthListResponse,
  type RuntimeStatus,
} from "@bidsentinel/contracts";
import { hashString, mulberry32 } from "./football/util";

export class DataClientError extends Error {
  constructor(
    message: string,
    public readonly status: number | null = null,
  ) {
    super(message);
    this.name = "DataClientError";
  }
}

type FetchLike = typeof fetch;

// ---------------------------------------------------------------------------
// Public payload types (post-normalization)
// ---------------------------------------------------------------------------

export interface SearchHit {
  playerId: string;
  playerName: string;
  clubName: string;
  position: string | null;
  seasons: string[];
}

export interface PlayerSearchResult {
  results: SearchHit[];
  generatedAt: string | null;
}

export interface PlayerSeasonsResult {
  seasons: string[];
}

export interface MatchRecord {
  matchId: string | null;
  date: string | null;
  opponent: string;
  venue: "home" | "away" | null;
  scoreFor: number | null;
  scoreAgainst: number | null;
  goals: number | null;
  assists: number | null;
  minutes: number | null;
}

export interface PlayerMatchesResult {
  matches: MatchRecord[];
  available: boolean;
  reason: string | null;
}

export interface CardRecord {
  playerId: string;
  playerName: string;
  position: string | null;
  shirtNumber: number | null;
  clubName: string;
  season: string;
  mode: "live" | "demo";
  totals: {
    appearances: number | null;
    goals: number | null;
    assists: number | null;
    yellowCards: number | null;
    redCards: number | null;
    minutesPlayed: number | null;
  };
  sourceUrl: string | null;
  sourceId: string | null;
  observedAt: string | null;
  snapshotVersion: number | null;
  snapshotHash: string | null;
  collectorId: string | null;
  scrapeRunId: string | null;
  scrapeStatus: string | null;
  fetchedAt: string | null;
  cacheAgeSeconds: number | null;
}

export type GenerateOutcome =
  | { kind: "card"; card: CardRecord }
  | { kind: "run"; runId: string; status: string | null };

export type ScrapeProgress = "queued" | "running" | "completed" | "failed";

export interface ScrapeSnapshot {
  runId: string;
  status: string;
  progress: ScrapeProgress;
  detail: string | null;
  card: CardRecord | null;
}

export interface PlayerIndexRefreshResult {
  season: string;
  acceptedCount: number;
  quarantinedCount: number;
  indexedPlayerCount: number;
}

export interface SourceHealthSummary {
  state: string;
  lastSuccessfulAt: string | null;
  activeIncidentReason: string | null;
  healingState: string | null;
}

// ---------------------------------------------------------------------------
// Tolerant structural readers
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function firstString(
  record: Record<string, unknown>,
  keys: readonly string[],
): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim() !== "") return value.trim();
    if (typeof value === "number" && Number.isFinite(value))
      return String(value);
  }
  return null;
}

function firstNumber(
  record: Record<string, unknown>,
  keys: readonly string[],
): number | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (
      typeof value === "string" &&
      value.trim() !== "" &&
      Number.isFinite(Number(value))
    ) {
      return Number(value);
    }
  }
  return null;
}

/** Unwraps `{data:[…]}`, `{results:[…]}`, bare arrays and named collections. */
function extractList(value: unknown, names: readonly string[]): unknown[] {
  if (Array.isArray(value)) return value;
  if (!isRecord(value)) return [];
  const container =
    isRecord(value.data) && !("length" in value.data)
      ? // Some envelopes nest one level deeper, e.g. { data: { results: [] } }.
        value.data
      : value;
  for (const name of ["data", ...names]) {
    const candidate = (container as Record<string, unknown>)[name];
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

function envelopeGeneratedAt(value: unknown): string | null {
  if (!isRecord(value)) return null;
  const direct = firstString(value, ["generatedAt"]);
  if (direct !== null) return direct;
  if (isRecord(value.data)) return firstString(value.data, ["generatedAt"]);
  return null;
}

function nestedRecord(
  record: Record<string, unknown>,
  keys: readonly string[],
): Record<string, unknown> {
  for (const key of keys) {
    const value = record[key];
    if (isRecord(value)) return value;
  }
  return {};
}

function seasonStrings(value: unknown[]): string[] {
  const out: string[] = [];
  for (const item of value) {
    if (typeof item === "string" && item.trim() !== "") {
      out.push(item.trim());
      continue;
    }
    if (isRecord(item)) {
      const season = firstString(item, ["season", "key", "id", "label"]);
      if (season !== null) out.push(season);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Normalizers (one per endpoint; exported for contract-handling tests)
// ---------------------------------------------------------------------------

export function normalizeSearchPayload(value: unknown): PlayerSearchResult {
  const list = extractList(value, ["results", "players"]);
  const results: SearchHit[] = [];
  for (const raw of list) {
    if (!isRecord(raw)) continue;
    const playerId = firstString(raw, ["playerId", "id"]);
    const playerName = firstString(raw, ["playerName", "name", "fullName"]);
    if (playerId === null || playerName === null) {
      throw new DataClientError(
        "The search response contained an unidentifiable player entry",
      );
    }
    const team = nestedRecord(raw, ["team"]);
    const clubName =
      firstString(raw, ["clubName", "club"]) ??
      firstString(team, ["name"]) ??
      (typeof raw.team === "string" && raw.team.trim() !== ""
        ? raw.team.trim()
        : null);
    const seasonsValue = raw.seasons;
    results.push({
      playerId,
      playerName,
      clubName: clubName ?? "Club n/a",
      position: firstString(raw, ["position"]),
      seasons: Array.isArray(seasonsValue)
        ? seasonStrings(seasonsValue)
        : typeof raw.season === "string"
          ? [raw.season]
          : [],
    });
  }
  return { results, generatedAt: envelopeGeneratedAt(value) };
}

export function normalizeSeasonsPayload(value: unknown): PlayerSeasonsResult {
  return { seasons: seasonStrings(extractList(value, ["seasons"])) };
}

const TERMINAL_OK = new Set([
  "succeeded",
  "completed",
  "complete",
  "success",
  "ok",
  "done",
  "printed",
]);
const TERMINAL_BAD = new Set([
  "failed",
  "error",
  "quarantined",
  "rejected",
  "invalid",
  "cancelled",
  "canceled",
  "timed_out",
]);
const QUEUED = new Set(["queued", "pending", "accepted", "created"]);

export function scrapeProgressOf(status: string): ScrapeProgress {
  const normalized = status.trim().toLowerCase();
  if (TERMINAL_OK.has(normalized)) return "completed";
  if (TERMINAL_BAD.has(normalized)) return "failed";
  return QUEUED.has(normalized) || normalized === "" ? "queued" : "running";
}

export function normalizeScrapePayload(value: unknown): ScrapeSnapshot {
  const body = isRecord(value) && isRecord(value.data) ? value.data : value;
  if (!isRecord(body)) {
    throw new DataClientError("The scrape status response was not an object");
  }
  const runId = firstString(body, ["runId", "run_id", "id"]);
  const status = firstString(body, ["status", "state"]) ?? "";
  if (runId === null) {
    throw new DataClientError("The scrape status response omitted its run id");
  }
  let card: CardRecord | null = null;
  const embedded = body.card ?? body.result;
  if (embedded !== undefined && embedded !== null) {
    try {
      const normalizedCard = normalizeCardEnvelope(embedded);
      card = {
        ...normalizedCard,
        scrapeRunId: normalizedCard.scrapeRunId ?? runId,
        scrapeStatus: normalizedCard.scrapeStatus ?? status,
      };
    } catch {
      card = null;
    }
  }
  return {
    runId,
    status,
    progress: scrapeProgressOf(status),
    detail: firstString(body, ["error", "detail", "message"]),
    card,
  };
}

export function normalizeCardEnvelope(value: unknown): CardRecord {
  const body =
    isRecord(value) && isRecord(value.data)
      ? value.data
      : isRecord(value) && isRecord(value.card)
        ? value.card
        : value;
  if (!isRecord(body)) {
    throw new DataClientError("The card response was not an object");
  }
  const playerId = firstString(body, ["playerId", "player_id", "id"]);
  const playerName = firstString(body, ["playerName", "player_name", "name"]);
  if (playerId === null || playerName === null) {
    throw new DataClientError(
      "The card response omitted the player identity fields",
    );
  }
  const team = nestedRecord(body, ["team"]);
  const clubName =
    firstString(body, ["clubName", "club_name", "club"]) ??
    firstString(team, ["name"]) ??
    (typeof body.team === "string" && body.team.trim() !== ""
      ? body.team.trim()
      : null);
  if (clubName === null) {
    throw new DataClientError("The card response omitted the player's club");
  }

  const statsSource =
    Object.keys(nestedRecord(body, ["stats"])).length > 0
      ? nestedRecord(body, ["stats"])
      : nestedRecord(body, ["totals"]);
  const totals = {
    appearances: firstNumber(statsSource, ["appearances", "apps"]),
    goals: firstNumber(statsSource, ["goals"]),
    assists: firstNumber(statsSource, ["assists"]),
    yellowCards: firstNumber(statsSource, ["yellowCards", "yellows"]),
    redCards: firstNumber(statsSource, ["redCards", "reds"]),
    minutesPlayed: firstNumber(statsSource, ["minutesPlayed", "minutes"]),
  };

  const provenance = nestedRecord(body, ["provenance"]);
  const freshness = nestedRecord(body, ["freshness"]);
  const snapshot = nestedRecord(
    Object.keys(provenance).length > 0 ? provenance : body,
    ["snapshot"],
  );
  const latestSnapshot = nestedRecord(body, ["latestSnapshot"]);

  const mode = firstString(body, ["mode"]);
  const originLabel = firstString(provenance, ["dataOriginLabel"]);
  return {
    playerId,
    playerName,
    position: firstString(body, ["position"]),
    shirtNumber: firstNumber(body, ["shirtNumber", "shirt"]),
    clubName,
    season: firstString(body, ["season"]) ?? "",
    mode:
      mode === "demo" || originLabel?.toUpperCase() === "DEMO DATA"
        ? "demo"
        : "live",
    totals,
    sourceUrl:
      firstString(provenance, ["sourceUrl", "url", "source"]) ??
      firstString(body, ["sourceUrl"]),
    sourceId:
      firstString(provenance, ["sourceId"]) ?? firstString(body, ["sourceId"]),
    observedAt:
      firstString(provenance, ["observedAt", "verifiedAt"]) ??
      firstString(body, ["observedAt", "verifiedAt"]),
    snapshotVersion:
      firstNumber(snapshot, ["version"]) ??
      firstNumber(latestSnapshot, ["version"]) ??
      firstNumber(provenance, ["snapshotVersion", "version"]) ??
      firstNumber(body, ["snapshotVersion"]),
    snapshotHash:
      firstString(snapshot, ["hash", "snapshotHash"]) ??
      firstString(provenance, ["snapshotHash", "hash", "contentHash"]) ??
      firstString(body, ["snapshotHash", "contentHash"]),
    collectorId:
      firstString(provenance, ["collectorId"]) ??
      firstString(body, ["collectorId"]),
    scrapeRunId:
      firstString(provenance, ["scrapeRunId", "runId"]) ??
      firstString(body, ["scrapeRunId", "runId"]),
    scrapeStatus:
      firstString(provenance, ["scrapeStatus", "status"]) ??
      firstString(body, ["scrapeStatus"]),
    fetchedAt:
      firstString(provenance, ["fetchedAt"]) ??
      firstString(freshness, ["fetchedAt"]) ??
      firstString(body, ["fetchedAt"]) ??
      envelopeGeneratedAt(value),
    cacheAgeSeconds:
      firstNumber(provenance, ["cacheAgeSeconds", "ageSeconds"]) ??
      firstNumber(freshness, ["cacheAgeSeconds", "ageSeconds"]) ??
      firstNumber(body, ["cacheAgeSeconds"]),
  };
}

/**
 * Interprets a POST /api/cards/generate response: either a finished card or an
 * asynchronous run acknowledgement (202 with a run id).
 */
export function normalizeGenerateOutcome(
  status: number,
  value: unknown,
): GenerateOutcome {
  const body =
    isRecord(value) && isRecord(value.data) ? value.data : (value ?? {});
  if (!isRecord(body)) {
    throw new DataClientError("The generate response was not an object");
  }
  const runId = firstString(body, ["runId", "run_id"]);
  if (runId !== null) {
    return { kind: "run", runId, status: firstString(body, ["status"]) };
  }
  if (status >= 200 && status < 300) {
    return { kind: "card", card: normalizeCardEnvelope(value) };
  }
  throw new DataClientError(
    `The generate response (${status}) carried neither a card nor a run id`,
    status,
  );
}

export function normalizeMatchesPayload(value: unknown): PlayerMatchesResult {
  const body = isRecord(value) && isRecord(value.data) ? value.data : value;
  const available =
    isRecord(body) && typeof body.available === "boolean"
      ? body.available
      : true;
  const reason = isRecord(body)
    ? firstString(body, ["reason", "message"])
    : null;
  const list = extractList(value, ["matches", "fixtures", "games", "rows"]);
  const matches: MatchRecord[] = [];
  for (const raw of list) {
    if (!isRecord(raw)) continue;
    const teamName = firstString(raw, ["teamName", "playerTeam"]);
    const homeTeam = firstString(raw, ["homeTeam"]);
    const awayTeam = firstString(raw, ["awayTeam"]);
    const opponent =
      firstString(raw, ["opponent", "opponentName", "opposition"]) ??
      (teamName !== null && homeTeam === teamName ? awayTeam : null) ??
      (teamName !== null && awayTeam === teamName ? homeTeam : null);
    if (opponent === null) continue;
    const venueRaw = firstString(raw, ["homeAway", "venue", "location"]);
    const venueNormalized = venueRaw === null ? "" : venueRaw.toLowerCase();
    const venue: "home" | "away" | null =
      venueNormalized.startsWith("h") ||
      (teamName !== null && homeTeam === teamName)
        ? "home"
        : venueNormalized.startsWith("a") ||
            (teamName !== null && awayTeam === teamName)
          ? "away"
          : null;

    let scoreFor: number | null = null;
    let scoreAgainst: number | null = null;
    const score = raw.score;
    if (isRecord(score)) {
      const forKey = firstNumber(score, ["for", "playerTeam", "team"]);
      const againstKey = firstNumber(score, ["against", "opponent", "other"]);
      const home = firstNumber(score, ["home"]);
      const away = firstNumber(score, ["away"]);
      if (forKey !== null || againstKey !== null) {
        scoreFor = forKey;
        scoreAgainst = againstKey;
      } else if (home !== null || away !== null) {
        scoreFor = venue === "away" ? away : home;
        scoreAgainst = venue === "away" ? home : away;
      }
    } else if (typeof score === "string") {
      // String scores are documented as player-perspective "for–against".
      const parts = /^(\d+)\s*[-–:]\s*(\d+)$/.exec(score.trim());
      const forPart = parts?.[1];
      const againstPart = parts?.[2];
      if (
        parts !== null &&
        forPart !== undefined &&
        againstPart !== undefined
      ) {
        scoreFor = Number(forPart);
        scoreAgainst = Number(againstPart);
      }
    } else {
      const homeGoals = firstNumber(raw, ["homeGoals"]);
      const awayGoals = firstNumber(raw, ["awayGoals"]);
      scoreFor =
        firstNumber(raw, ["goalsFor", "teamScore"]) ??
        (venue === "home" ? homeGoals : venue === "away" ? awayGoals : null);
      scoreAgainst =
        firstNumber(raw, ["goalsAgainst", "opponentScore"]) ??
        (venue === "home" ? awayGoals : venue === "away" ? homeGoals : null);
    }

    matches.push({
      matchId: firstString(raw, ["matchId", "id"]),
      date: firstString(raw, [
        "date",
        "playedOn",
        "playedAt",
        "kickoffAt",
        "matchDate",
      ]),
      opponent,
      venue,
      scoreFor,
      scoreAgainst,
      goals: firstNumber(raw, ["goals", "playerGoals"]),
      assists: firstNumber(raw, ["assists", "playerAssists"]),
      minutes: firstNumber(raw, ["minutes", "minutesPlayed", "playerMinutes"]),
    });
  }
  return { matches, available, reason };
}

// ---------------------------------------------------------------------------
// Shared transport
// ---------------------------------------------------------------------------

async function readJson(response: Response): Promise<unknown> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new DataClientError(
      `API returned non-JSON content (${response.status})`,
      response.status,
    );
  }
  if (!response.ok && response.status !== 202) {
    const message =
      isRecord(body) &&
      isRecord((body as Record<string, unknown>).error) &&
      typeof (
        (body as Record<string, unknown>).error as Record<string, unknown>
      ).message === "string"
        ? (((body as Record<string, unknown>).error as Record<string, unknown>)
            .message as string)
        : `API request failed (${response.status})`;
    throw new DataClientError(message, response.status);
  }
  return body;
}

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/$/, "")}${path}`;
}

export interface GenerateRequest {
  playerId: string;
  season: string;
  mode: "live" | "demo";
}

export interface FootballApiClient {
  searchPlayers(
    query: string,
    season: string | null,
  ): Promise<PlayerSearchResult>;
  getPlayerSeasons(playerId: string): Promise<PlayerSeasonsResult>;
  getPlayerMatches(
    playerId: string,
    season: string,
  ): Promise<PlayerMatchesResult>;
  getCard(playerId: string, season: string): Promise<CardRecord | null>;
  generateCard(request: GenerateRequest): Promise<GenerateOutcome>;
  getScrapeRun(runId: string): Promise<ScrapeSnapshot>;
  getRuntime(): Promise<RuntimeStatus>;
  getSourceHealth(sourceId: string): Promise<SourceHealthSummary | null>;
  refreshPlayerIndex?(season: string): Promise<PlayerIndexRefreshResult>;
}

// ---------------------------------------------------------------------------
// HTTP implementation
// ---------------------------------------------------------------------------

export class HttpFootballApiClient implements FootballApiClient {
  private operatorToken = "";

  constructor(
    private readonly baseUrl = "",
    private readonly fetchFn: FetchLike = (input, init) => fetch(input, init),
  ) {}

  setOperatorToken(value: string): void {
    this.operatorToken = value;
  }

  async searchPlayers(
    query: string,
    season: string | null,
  ): Promise<PlayerSearchResult> {
    const params = new URLSearchParams({ q: query });
    if (season !== null) params.set("season", season);
    const body = await this.get(
      `/api/search/players?${params.toString()}`,
      8_000,
    );
    return normalizeSearchPayload(body);
  }

  async getPlayerSeasons(playerId: string): Promise<PlayerSeasonsResult> {
    const body = await this.get(
      `/api/players/${encodeURIComponent(playerId)}/seasons`,
      8_000,
    );
    return normalizeSeasonsPayload(body);
  }

  async getPlayerMatches(
    playerId: string,
    season: string,
  ): Promise<PlayerMatchesResult> {
    const body = await this.get(
      `/api/players/${encodeURIComponent(playerId)}/matches?season=${encodeURIComponent(season)}`,
      10_000,
    );
    return normalizeMatchesPayload(body);
  }

  /** Returns null on 404 so callers can show "not available yet" honestly. */
  async getCard(playerId: string, season: string): Promise<CardRecord | null> {
    let response: Response;
    try {
      response = await this.fetchFn(
        joinUrl(
          this.baseUrl,
          `/api/cards/${encodeURIComponent(playerId)}?season=${encodeURIComponent(season)}`,
        ),
        {
          headers: { accept: "application/json" },
          signal: AbortSignal.timeout(10_000),
        },
      );
    } catch (error) {
      throw new DataClientError(
        error instanceof Error
          ? `Could not reach the CardPulse API: ${error.message}`
          : "Could not reach the CardPulse API",
      );
    }
    if (response.status === 404) return null;
    const body = await readJson(response);
    return normalizeCardEnvelope(body);
  }

  async generateCard(request: GenerateRequest): Promise<GenerateOutcome> {
    const { status, body } = await this.request("/api/cards/generate", {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        ...(this.operatorToken === ""
          ? {}
          : { "X-CardPulse-Operator-Token": this.operatorToken }),
      },
      body: JSON.stringify(request),
      timeoutMs: 45_000,
    });
    return normalizeGenerateOutcome(status, body);
  }

  async refreshPlayerIndex(season: string): Promise<PlayerIndexRefreshResult> {
    const { body } = await this.request("/api/player-index/refresh", {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        ...(this.operatorToken === ""
          ? {}
          : { "X-CardPulse-Operator-Token": this.operatorToken }),
      },
      body: JSON.stringify({ season }),
      timeoutMs: 150_000,
    });
    const data = isRecord(body) && isRecord(body.data) ? body.data : body;
    if (!isRecord(data)) {
      throw new DataClientError("The index refresh response was not an object");
    }
    const acceptedCount = firstNumber(data, ["acceptedCount"]);
    const quarantinedCount = firstNumber(data, ["quarantinedCount"]);
    const indexedPlayerCount = firstNumber(data, ["indexedPlayerCount"]);
    const refreshedSeason = firstString(data, ["season"]);
    if (
      acceptedCount === null ||
      quarantinedCount === null ||
      indexedPlayerCount === null ||
      refreshedSeason === null
    ) {
      throw new DataClientError(
        "The index refresh response omitted required counters",
      );
    }
    return {
      season: refreshedSeason,
      acceptedCount,
      quarantinedCount,
      indexedPlayerCount,
    };
  }

  async getScrapeRun(runId: string): Promise<ScrapeSnapshot> {
    const body = await this.get(
      `/api/scrapes/${encodeURIComponent(runId)}`,
      8_000,
    );
    return normalizeScrapePayload(body);
  }

  async getRuntime(): Promise<RuntimeStatus> {
    const body = await this.get("/api/runtime", 8_000);
    try {
      return RuntimeStatusResponseSchema.parse(body).data;
    } catch {
      throw new DataClientError(
        "The runtime response failed the frozen contract validation",
      );
    }
  }

  async getSourceHealth(sourceId: string): Promise<SourceHealthSummary | null> {
    const body = await this.get("/api/sources", 8_000);
    let parsed: SourceHealthListResponse;
    try {
      parsed = SourceHealthListResponseSchema.parse(body);
    } catch {
      throw new DataClientError(
        "The sources response failed the frozen contract validation",
      );
    }
    const entry = parsed.data.find((source) => source.sourceId === sourceId);
    if (entry === undefined) return null;
    return {
      state: entry.state,
      lastSuccessfulAt: entry.lastSuccessfulAt,
      activeIncidentReason: entry.activeIncident?.reason ?? null,
      healingState: entry.latestRecoveryEvidence
        ? `recovery evidence recorded${entry.activeIncident ? " · incident open" : ""}`
        : entry.activeIncident
          ? "incident open"
          : null,
    };
  }

  private async get(path: string, timeoutMs: number): Promise<unknown> {
    const { status, body } = await this.request(path, {
      method: "GET",
      headers: { accept: "application/json" },
      timeoutMs,
    });
    if (!(status >= 200 && status < 300) && status !== 202) {
      throw new DataClientError(`API request failed (${status})`, status);
    }
    return body;
  }

  private async request(
    path: string,
    options: {
      method: "GET" | "POST";
      headers: Record<string, string>;
      timeoutMs: number;
      body?: string;
    },
  ): Promise<{ status: number; body: unknown }> {
    const requestInit: RequestInit = {
      method: options.method,
      headers: options.headers,
      signal: AbortSignal.timeout(options.timeoutMs),
    };
    if (options.body !== undefined) requestInit.body = options.body;
    let response: Response;
    try {
      response = await this.fetchFn(joinUrl(this.baseUrl, path), requestInit);
    } catch (error) {
      throw new DataClientError(
        error instanceof Error
          ? `Could not reach the CardPulse API: ${error.message}`
          : "Could not reach the CardPulse API",
      );
    }
    const body = await readJson(response);
    return { status: response.status, body };
  }
}

// ---------------------------------------------------------------------------
// Explicit demo adapter — used ONLY when the visitor presses "Use demo data".
// It serves a deterministic fictional dataset so the experience can be judged
// offline; everything it produces is labelled DEMO DATA downstream.
// ---------------------------------------------------------------------------

interface DemoPlayer {
  playerId: string;
  playerName: string;
  clubName: string;
  position: string;
  shirtNumber: number;
  seasons: string[];
  totalsBySeason: Record<
    string,
    {
      appearances: number | null;
      goals: number | null;
      assists: number | null;
      yellowCards: number | null;
      redCards: number | null;
      minutesPlayed: number | null;
    }
  >;
}

const DEMO_PLAYERS: readonly DemoPlayer[] = [
  {
    playerId: "demo:player:erling-haaland",
    playerName: "Erling Haaland",
    clubName: "Manchester City",
    position: "forward",
    shirtNumber: 9,
    seasons: ["2023", "2024", "2025"],
    totalsBySeason: {
      "2023": {
        appearances: 31,
        goals: 27,
        assists: 5,
        yellowCards: 1,
        redCards: 0,
        minutesPlayed: 2554,
      },
      "2024": {
        appearances: 31,
        goals: 22,
        assists: 3,
        yellowCards: 2,
        redCards: 0,
        minutesPlayed: 2776,
      },
      "2025": {
        appearances: 28,
        goals: 19,
        assists: 6,
        yellowCards: 2,
        redCards: 0,
        minutesPlayed: 2380,
      },
    },
  },
  {
    playerId: "demo:player:taylor-brooks-kingsley",
    playerName: "Taylor Brooks",
    clubName: "Kingsley Rovers FC",
    position: "defender",
    shirtNumber: 4,
    seasons: ["2024", "2025"],
    totalsBySeason: {
      "2024": {
        appearances: 35,
        goals: 2,
        assists: 1,
        yellowCards: 6,
        redCards: 0,
        minutesPlayed: 3060,
      },
      "2025": {
        appearances: 34,
        goals: 3,
        assists: 2,
        yellowCards: 5,
        redCards: 0,
        minutesPlayed: 2940,
      },
    },
  },
  {
    playerId: "demo:player:taylor-brooks-harbour",
    playerName: "Taylor Brooks",
    clubName: "Harbour Athletic FC",
    position: "midfielder",
    shirtNumber: 8,
    seasons: ["2025"],
    totalsBySeason: {
      "2025": {
        appearances: 32,
        goals: 7,
        assists: 9,
        yellowCards: 4,
        redCards: 0,
        minutesPlayed: 2610,
      },
    },
  },
  {
    playerId: "demo:player:marchetti",
    playerName: "Rio Marchetti",
    clubName: "Northgate United",
    position: "midfielder",
    shirtNumber: 8,
    seasons: ["2024", "2025", "2026"],
    totalsBySeason: {
      "2024": {
        appearances: 31,
        goals: 4,
        assists: 7,
        yellowCards: 3,
        redCards: 0,
        minutesPlayed: 2588,
      },
      "2025": {
        appearances: 34,
        goals: 9,
        assists: 11,
        yellowCards: 2,
        redCards: 0,
        minutesPlayed: 2971,
      },
      "2026": {
        appearances: 3,
        goals: 1,
        assists: 2,
        yellowCards: 0,
        redCards: 0,
        minutesPlayed: 262,
      },
    },
  },
  {
    playerId: "demo:player:oduya",
    playerName: "Callum Oduya",
    clubName: "Harbor City FC",
    position: "forward",
    shirtNumber: 9,
    seasons: ["2023", "2024", "2025"],
    totalsBySeason: {
      "2023": {
        appearances: 36,
        goals: 18,
        assists: 5,
        yellowCards: 4,
        redCards: 1,
        minutesPlayed: 3055,
      },
      "2024": {
        appearances: 33,
        goals: 22,
        assists: 6,
        yellowCards: 2,
        redCards: 0,
        minutesPlayed: 2814,
      },
      "2025": {
        appearances: 29,
        goals: 14,
        assists: 4,
        yellowCards: 5,
        redCards: 0,
        minutesPlayed: 2401,
      },
    },
  },
  {
    playerId: "demo:player:vinter",
    playerName: "Elias Vinter",
    clubName: "Redbridge Athletic",
    position: "defender",
    shirtNumber: 4,
    seasons: ["2024", "2025"],
    totalsBySeason: {
      "2024": {
        appearances: 30,
        goals: 2,
        assists: 1,
        yellowCards: 6,
        redCards: 1,
        minutesPlayed: 2640,
      },
      "2025": {
        appearances: 35,
        goals: 3,
        assists: 3,
        yellowCards: 7,
        redCards: 0,
        minutesPlayed: 3122,
      },
    },
  },
  {
    playerId: "demo:player:ferreyra",
    playerName: "Tomás Ferreyra",
    clubName: "Kingsmoor Town",
    position: "forward",
    shirtNumber: 11,
    seasons: ["2023", "2024", "2025", "2026"],
    totalsBySeason: {
      "2023": {
        appearances: 24,
        goals: 8,
        assists: 9,
        yellowCards: 1,
        redCards: 0,
        minutesPlayed: 1877,
      },
      "2024": {
        appearances: 32,
        goals: 12,
        assists: 8,
        yellowCards: 2,
        redCards: 0,
        minutesPlayed: 2604,
      },
      "2025": {
        appearances: 36,
        goals: 19,
        assists: 10,
        yellowCards: 3,
        redCards: 0,
        minutesPlayed: 3108,
      },
      "2026": {
        appearances: 2,
        goals: 2,
        assists: 0,
        yellowCards: 0,
        redCards: 0,
        minutesPlayed: 158,
      },
    },
  },
  {
    playerId: "demo:player:ramanathan",
    playerName: "Dev Ramanathan",
    clubName: "Northgate United",
    position: "goalkeeper",
    shirtNumber: 1,
    seasons: ["2025"],
    totalsBySeason: {
      "2025": {
        appearances: 38,
        goals: 0,
        assists: 0,
        yellowCards: 1,
        redCards: 0,
        minutesPlayed: 3420,
      },
    },
  },
] as const;

const DEMO_OPPONENTS: readonly string[] = [
  "Harbor City FC",
  "Redbridge Athletic",
  "Kingsmoor Town",
  "Sable Rovers",
  "Northgate United",
  "Vale Wanderers",
  "Eastfield Albion",
] as const;

function demoHashHex(seed: string): string {
  let hex = "";
  for (let round = 0; round < 4 && hex.length < 16; round += 1) {
    hex += hashString(`${seed}:${round}`).toString(16).padStart(8, "0");
  }
  return hex.slice(0, 24);
}

function demoObservedAt(season: string): string {
  return `2026-08-${String(10 + (Number.parseInt(season, 10) % 10)).padStart(2, "0")}T12:00:00.000Z`;
}

export class DemoFootballApiClient implements FootballApiClient {
  async searchPlayers(
    query: string,
    season: string | null,
  ): Promise<PlayerSearchResult> {
    const needle = query.trim().toLowerCase();
    const results: SearchHit[] = [];
    for (const player of DEMO_PLAYERS) {
      const haystack = `${player.playerName} ${player.clubName}`.toLowerCase();
      if (!haystack.includes(needle)) continue;
      const seasons =
        season === null
          ? player.seasons
          : player.seasons.filter((entry) => entry === season);
      if (seasons.length === 0) continue;
      results.push({
        playerId: player.playerId,
        playerName: player.playerName,
        clubName: player.clubName,
        position: player.position,
        seasons,
      });
    }
    return { results, generatedAt: new Date().toISOString() };
  }

  async getPlayerSeasons(playerId: string): Promise<PlayerSeasonsResult> {
    const player = this.requirePlayer(playerId);
    return { seasons: [...player.seasons] };
  }

  async getPlayerMatches(
    playerId: string,
    season: string,
  ): Promise<PlayerMatchesResult> {
    const player = this.requirePlayer(playerId);
    if (!player.seasons.includes(season)) {
      return {
        matches: [],
        available: false,
        reason: "Source data not available yet.",
      };
    }
    const startYear = Number.parseInt(season, 10);
    const matches: MatchRecord[] = [];
    for (let index = 0; index < 10; index += 1) {
      const random = mulberry32(hashString(`${playerId}:${season}:${index}`));
      const venueRoll = random();
      const venue: "home" | "away" = venueRoll < 0.5 ? "home" : "away";
      const opponentPool = DEMO_OPPONENTS.filter(
        (club) => club !== player.clubName,
      );
      const opponent =
        opponentPool[
          hashString(`${playerId}:${index}`) % opponentPool.length
        ] ?? "Vale Wanderers";
      const generatedTeamGoals = Math.floor(random() * 4);
      const againstGoals = Math.floor(random() * 3);
      const goalChance = random();
      const goals =
        goalChance < 0.3
          ? 1
          : goalChance < 0.42
            ? 2
            : goalChance < 0.46
              ? 3
              : 0;
      const forGoals = Math.max(generatedTeamGoals, goals);
      const assists = random() < 0.25 ? 1 : 0;
      const played = random() < 0.85;
      const day = 3 + index * 21 + Math.floor(random() * 10);
      const month = ((day - 1) % 12) + 1;
      matches.push({
        matchId: `demo-match-${season}-${index}`,
        date: new Date(
          Date.UTC(startYear, month - 1, ((day - 1) % 27) + 1, 15, 0),
        ).toISOString(),
        opponent,
        venue,
        scoreFor: forGoals,
        scoreAgainst: againstGoals,
        goals: played || goals > 0 ? goals : null,
        assists: played || assists > 0 ? assists : null,
        minutes: played ? 45 + Math.floor(random() * 46) : null,
      });
    }
    return { matches, available: true, reason: null };
  }

  async getCard(playerId: string, season: string): Promise<CardRecord | null> {
    const player = DEMO_PLAYERS.find((entry) => entry.playerId === playerId);
    if (player === undefined || !player.seasons.includes(season)) return null;
    return this.cardFor(player, season, "demo");
  }

  async generateCard(request: GenerateRequest): Promise<GenerateOutcome> {
    const player = this.requirePlayer(request.playerId);
    if (!player.seasons.includes(request.season)) {
      throw new DataClientError(
        "The demo dataset has no verified data for that season",
        404,
      );
    }
    return {
      kind: "card",
      card: this.cardFor(player, request.season, request.mode),
    };
  }

  async getScrapeRun(runId: string): Promise<ScrapeSnapshot> {
    if (!runId.startsWith("demo-run-")) {
      throw new DataClientError("Unknown demo scrape run", 404);
    }
    return {
      runId,
      status: "completed",
      progress: "completed",
      detail: null,
      card: null,
    };
  }

  async getRuntime(): Promise<RuntimeStatus> {
    return {
      schemaVersion: 1,
      service: "cardpulse-api",
      domain: "football",
      mode: "mock",
      sourceId: "demo-local-snapshot",
      collectorConfigured: false,
      targetConfigured: false,
      liveMutationsEnabled: false,
      configurationIssues: [
        "Browser-side demo dataset selected; no provider requests are made.",
      ],
    } as RuntimeStatus;
  }

  async getSourceHealth(sourceId: string): Promise<SourceHealthSummary | null> {
    if (sourceId !== "demo-local-snapshot") return null;
    return {
      state: "healthy",
      lastSuccessfulAt: demoObservedAt("2026"),
      activeIncidentReason: null,
      healingState: null,
    };
  }

  private requirePlayer(playerId: string): DemoPlayer {
    const player = DEMO_PLAYERS.find((entry) => entry.playerId === playerId);
    if (player === undefined) {
      throw new DataClientError("Unknown demo player", 404);
    }
    return player;
  }

  private cardFor(
    player: DemoPlayer,
    season: string,
    mode: "live" | "demo",
  ): CardRecord {
    const totals = player.totalsBySeason[season];
    if (totals === undefined) {
      throw new DataClientError("Demo season missing totals", 404);
    }
    return {
      playerId: player.playerId,
      playerName: player.playerName,
      position: player.position,
      shirtNumber: player.shirtNumber,
      clubName: player.clubName,
      season,
      mode,
      totals: { ...totals },
      sourceUrl: `https://demo.cardpulse.local/snapshots/epl-${season}`,
      sourceId: "demo-local-snapshot",
      observedAt: demoObservedAt(season),
      snapshotVersion: player.seasons.indexOf(season) + 1,
      snapshotHash: demoHashHex(`${player.playerId}:${season}`),
      collectorId: "demo_collector_local_9f3c",
      scrapeRunId: `demo-run-${hashString(`${player.playerId}:${season}`)}`,
      scrapeStatus: "completed",
      fetchedAt: new Date().toISOString(),
      cacheAgeSeconds: 0,
    };
  }
}
