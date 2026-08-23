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
  mode: "live";
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
  if (mode === "demo" || originLabel?.toUpperCase() === "DEMO DATA") {
    throw new DataClientError(
      "The live-only CardPulse interface refused a demo-data card",
    );
  }
  return {
    playerId,
    playerName,
    position: firstString(body, ["position"]),
    shirtNumber: firstNumber(body, ["shirtNumber", "shirt"]),
    clubName,
    season: firstString(body, ["season"]) ?? "",
    mode: "live",
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

function mergeAbortSignals(
  timeoutMs: number,
  external?: AbortSignal,
): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  if (external === undefined) return timeoutSignal;

  const controller = new AbortController();
  const abort = (): void => {
    if (controller.signal.aborted) return;
    controller.abort(external.aborted ? external.reason : timeoutSignal.reason);
  };
  if (external.aborted || timeoutSignal.aborted) {
    abort();
    return controller.signal;
  }
  external.addEventListener("abort", abort, { once: true });
  timeoutSignal.addEventListener("abort", abort, { once: true });
  return controller.signal;
}

export interface GenerateRequest {
  playerId: string;
  season: string;
  mode: "live";
}

export interface FootballApiClient {
  searchPlayers(
    query: string,
    season: string | null,
    signal?: AbortSignal,
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
  constructor(
    private readonly baseUrl = "",
    private readonly fetchFn: FetchLike = (input, init) => fetch(input, init),
  ) {}

  async searchPlayers(
    query: string,
    season: string | null,
    signal?: AbortSignal,
  ): Promise<PlayerSearchResult> {
    const params = new URLSearchParams({ q: query });
    if (season !== null) params.set("season", season);
    const body = await this.get(
      `/api/search/players?${params.toString()}`,
      150_000,
      signal,
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

  private async get(
    path: string,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const { status, body } = await this.request(path, {
      method: "GET",
      headers: { accept: "application/json" },
      timeoutMs,
      ...(signal === undefined ? {} : { signal }),
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
      signal?: AbortSignal;
    },
  ): Promise<{ status: number; body: unknown }> {
    const requestInit: RequestInit = {
      method: options.method,
      headers: options.headers,
      signal: mergeAbortSignals(options.timeoutMs, options.signal),
    };
    if (options.body !== undefined) requestInit.body = options.body;
    if (options.signal?.aborted) {
      throw options.signal.reason instanceof Error
        ? options.signal.reason
        : new DOMException("The operation was aborted.", "AbortError");
    }
    let response: Response;
    try {
      response = await this.fetchFn(joinUrl(this.baseUrl, path), requestInit);
    } catch (error) {
      if (options.signal?.aborted) throw error;
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
