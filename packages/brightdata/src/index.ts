import type { FootballRecord } from "@bidsentinel/contracts";

/**
 * Provider-neutral boundary in front of the Bright Data Scraper Studio HTTP
 * surface. Transport behavior here is domain-neutral; the only domain-facing
 * piece is the row mapper at the bottom of this file.
 */
export interface FootballCollectionRequest {
  sourceId: string;
  targetUrl: string;
  requestedAt: string;
}

export interface FootballCollectionBatch {
  sourceId: string;
  collectorId: string;
  extractorVersion: string;
  receivedAt: string;
  /** Exact dataset rows before any source/generic canonical mapper. */
  rawPayloads?: unknown[];
  payloads: unknown[];
}

export interface FootballCollectionProvider {
  collect(request: FootballCollectionRequest): Promise<FootballCollectionBatch>;
}

/**
 * Source-profile-specific mapping boundary applied to each raw dataset row
 * before payloads enter the pipeline. The default is the domain-neutral
 * generic mapper; named profiles such as StatBunker plug in their own
 * boundary without changing transport behavior. A mapper returns either a
 * canonical record it fully validated or the untouched raw row so the strict
 * pipeline keeps owning quarantine and drift signals.
 */
export type BrightDataRowMapper = (
  row: unknown,
  sourceId: string,
  observedAt: string,
) => unknown;

export interface CanonicalFootballRecordSink {
  accept(record: FootballRecord): Promise<void>;
}

export class ExternalCollectionNotConfiguredError extends Error {
  constructor() {
    super("External collection is intentionally not configured in this MVP");
    this.name = "ExternalCollectionNotConfiguredError";
  }
}

export type BrightDataErrorCode =
  | "authentication"
  | "rate_limited"
  | "not_found"
  | "invalid_input"
  | "timeout"
  | "network"
  | "malformed_response"
  | "api_error";

/** An operational error safe to surface without leaking request credentials. */
export class BrightDataApiError extends Error {
  constructor(
    public readonly code: BrightDataErrorCode,
    message: string,
    public readonly options: {
      status?: number;
      transient?: boolean;
      cause?: unknown;
    } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "BrightDataApiError";
  }

  get status(): number | undefined {
    return this.options.status;
  }

  get transient(): boolean {
    return this.options.transient ?? false;
  }
}

export class UnconfiguredBrightDataProvider implements FootballCollectionProvider {
  collect(
    _request: FootballCollectionRequest,
  ): Promise<FootballCollectionBatch> {
    return Promise.reject(new ExternalCollectionNotConfiguredError());
  }
}

export interface BrightDataCollectionProviderOptions {
  apiToken?: string;
  collectorId?: string;
  /**
   * Allow Bright Data to run a collector whose linked output schema is
   * temporarily incompatible with the extractor output. This is needed for
   * the live StatBunker collector after its same-ID searchable refactor.
   */
  overrideIncompatibleSchema?: boolean;
  /**
   * Optional source-profile row mapper (e.g. StatBunker). Applied to every
   * raw dataset row before generic canonical mapping.
   */
  rowMapper?: BrightDataRowMapper;
  pollingIntervalMs?: number;
  timeoutMs?: number;
  requestTimeoutMs?: number;
  maxRetries?: number;
  retryDelayMs?: number;
  fetchFn?: typeof fetch;
  sleepFn?: (delayMs: number) => Promise<void>;
  nowFn?: () => number;
}

export class BrightDataCollectionProvider implements FootballCollectionProvider {
  private readonly apiToken: string;
  private readonly collectorId: string;
  private readonly overrideIncompatibleSchema: boolean;
  private readonly rowMapper: BrightDataRowMapper | null;
  private readonly pollingIntervalMs: number;
  private readonly timeoutMs: number;
  private readonly requestTimeoutMs: number;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;
  private readonly fetchFn: typeof fetch;
  private readonly sleepFn: (delayMs: number) => Promise<void>;
  private readonly nowFn: () => number;

  constructor(options: BrightDataCollectionProviderOptions = {}) {
    this.apiToken = options.apiToken || process.env.BRIGHT_DATA_API_TOKEN || "";
    this.collectorId =
      options.collectorId || process.env.BRIGHT_DATA_COLLECTOR_ID || "";
    this.overrideIncompatibleSchema =
      options.overrideIncompatibleSchema ?? false;
    this.rowMapper = options.rowMapper ?? null;
    this.pollingIntervalMs = options.pollingIntervalMs ?? 5000;
    this.timeoutMs = options.timeoutMs ?? 120000;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30000;
    this.maxRetries = options.maxRetries ?? 3;
    this.retryDelayMs = options.retryDelayMs ?? 1000;
    this.fetchFn =
      options.fetchFn ??
      // Late-binding wrapper: resolving the global at call time keeps
      // injected-free usage working even when the provider was constructed
      // before a test or runtime replaced the global fetch implementation.
      ((input, init) => globalThis.fetch(input, init));
    this.sleepFn =
      options.sleepFn ??
      ((delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)));
    this.nowFn = options.nowFn ?? Date.now;

    if (!this.apiToken || !this.collectorId) {
      throw new ExternalCollectionNotConfiguredError();
    }
  }

  async collect(
    request: FootballCollectionRequest,
  ): Promise<FootballCollectionBatch> {
    const triggerUrl = new URL("https://api.brightdata.com/dca/trigger");
    triggerUrl.searchParams.set("collector", this.collectorId);
    triggerUrl.searchParams.set("queue_next", "1");
    if (this.overrideIncompatibleSchema) {
      triggerUrl.searchParams.set("override_incompatible_schema", "1");
    }

    const triggerRes = await this.fetchWithRetry(
      triggerUrl.toString(),
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify([{ url: request.targetUrl }]),
      },
      this.maxRetries,
    );

    this.assertSuccessfulResponse(triggerRes, "trigger collector");

    const triggerData = await this.parseObjectResponse(
      triggerRes,
      "trigger collector",
    );
    const collectionId = triggerData.collection_id;
    if (typeof collectionId !== "string" || collectionId.trim() === "") {
      throw new BrightDataApiError(
        "malformed_response",
        "Bright Data trigger response did not contain a valid collection_id",
      );
    }

    const rawRows = await this.pollDataset(collectionId);
    const receivedAt = new Date().toISOString();
    const payloads = rawRows.map((row) => {
      const mapped =
        this.rowMapper === null
          ? row
          : this.rowMapper(row, request.sourceId, receivedAt);
      return mapRawRowToFootballRecord(mapped, request.sourceId, receivedAt);
    });

    return {
      sourceId: request.sourceId,
      collectorId: this.collectorId,
      extractorVersion: `brightdata-${this.collectorId}`,
      receivedAt,
      rawPayloads: rawRows,
      payloads,
    };
  }

  private async pollDataset(collectionId: string): Promise<unknown[]> {
    const startTime = this.nowFn();
    const datasetUrl = new URL("https://api.brightdata.com/dca/dataset");
    datasetUrl.searchParams.set("id", collectionId);

    while (true) {
      if (this.nowFn() - startTime >= this.timeoutMs) {
        throw new BrightDataApiError(
          "timeout",
          "Timed out waiting for Bright Data collection to complete",
          { transient: true },
        );
      }

      const pollRes = await this.fetchWithRetry(
        datasetUrl.toString(),
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${this.apiToken}`,
          },
        },
        this.maxRetries,
      );

      if (pollRes.status === 202) {
        await this.sleepFn(this.pollingIntervalMs);
        continue;
      }

      this.assertSuccessfulResponse(pollRes, "poll dataset");

      const responseText = await pollRes.text();
      let data: unknown;
      try {
        data = JSON.parse(responseText);
      } catch {
        throw new BrightDataApiError(
          "malformed_response",
          "Bright Data dataset response was not valid JSON",
        );
      }

      if (
        data !== null &&
        typeof data === "object" &&
        !Array.isArray(data) &&
        (data as Record<string, unknown>).status === "building"
      ) {
        await this.sleepFn(this.pollingIntervalMs);
        continue;
      }

      if (Array.isArray(data)) {
        return data;
      }

      throw new BrightDataApiError(
        "malformed_response",
        "Bright Data dataset response was neither a building status nor an array",
      );
    }
  }

  private async fetchWithRetry(
    url: string,
    options: RequestInit,
    maxRetries: number,
    initialDelayMs = this.retryDelayMs,
  ): Promise<Response> {
    let attempt = 0;
    while (true) {
      try {
        const response = await this.fetchFn(url, {
          ...options,
          signal: options.signal ?? AbortSignal.timeout(this.requestTimeoutMs),
        });
        const retryableStatus =
          response.status === 429 ||
          (response.status >= 500 && response.status < 600);
        if (retryableStatus && attempt < maxRetries) {
          attempt++;
          const delay = initialDelayMs * Math.pow(2, attempt - 1);
          await this.sleepFn(delay);
          continue;
        }
        return response;
      } catch (error) {
        if (attempt < maxRetries) {
          attempt++;
          const delay = initialDelayMs * Math.pow(2, attempt - 1);
          await this.sleepFn(delay);
          continue;
        }
        if (error instanceof DOMException && error.name === "TimeoutError") {
          throw new BrightDataApiError(
            "timeout",
            "Bright Data request timed out",
            { transient: true, cause: error },
          );
        }
        throw new BrightDataApiError(
          "network",
          "Bright Data request failed before a response was received",
          { transient: true, cause: error },
        );
      }
    }
  }

  private assertSuccessfulResponse(
    response: Response,
    operation: string,
  ): void {
    if (response.ok) return;

    const details = { status: response.status };
    if (response.status === 401 || response.status === 403) {
      throw new BrightDataApiError(
        "authentication",
        `Bright Data authentication failed while attempting to ${operation}`,
        details,
      );
    }
    if (response.status === 404) {
      throw new BrightDataApiError(
        "not_found",
        `Bright Data resource was not found while attempting to ${operation}`,
        details,
      );
    }
    if (response.status === 422) {
      throw new BrightDataApiError(
        "invalid_input",
        `Bright Data rejected the configured collector input while attempting to ${operation}`,
        details,
      );
    }
    if (response.status === 429) {
      throw new BrightDataApiError(
        "rate_limited",
        `Bright Data rate limited the request while attempting to ${operation}`,
        { ...details, transient: true },
      );
    }
    throw new BrightDataApiError(
      "api_error",
      `Bright Data returned HTTP ${response.status} while attempting to ${operation}`,
      {
        ...details,
        transient: response.status >= 500,
      },
    );
  }

  private async parseObjectResponse(
    response: Response,
    operation: string,
  ): Promise<Record<string, unknown>> {
    let data: unknown;
    try {
      data = await response.json();
    } catch (error) {
      throw new BrightDataApiError(
        "malformed_response",
        `Bright Data returned invalid JSON while attempting to ${operation}`,
        { cause: error },
      );
    }
    if (data === null || typeof data !== "object" || Array.isArray(data)) {
      throw new BrightDataApiError(
        "malformed_response",
        `Bright Data returned an invalid object while attempting to ${operation}`,
      );
    }
    return data as Record<string, unknown>;
  }
}

const FOOTBALL_ENTITY_TYPES = new Set(["player", "team", "standing"]);

/**
 * Map one raw Bright Data dataset row into a canonical football record shape
 * (`PlayerCardSchema`, `TeamSummaryRecordSchema`, or `StandingEntrySchema`
 * field names). This is deliberately tolerant: unknown or malformed values are
 * passed through so the strict contract validation downstream quarantines
 * them with their raw payload. Mapping never invents data it did not find.
 */
export function mapRawRowToFootballRecord(
  row: unknown,
  sourceId: string,
  observedAt: string,
): unknown {
  if (row === null || typeof row !== "object" || Array.isArray(row)) {
    return row;
  }

  const getField = (obj: unknown, keys: string[]): unknown => {
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return undefined;
    const record = obj as Record<string, unknown>;
    for (const k of keys) {
      if (k in record && record[k] !== undefined) return record[k];
      const normalizedK = k.toLowerCase().replace(/[^a-z0-9]/g, "");
      for (const rawKey of Object.keys(record)) {
        const normalizedRawKey = rawKey.toLowerCase().replace(/[^a-z0-9]/g, "");
        if (normalizedK === normalizedRawKey && record[rawKey] !== undefined) {
          return record[rawKey];
        }
      }
    }
    return undefined;
  };

  /** Numeric-looking values become numbers; anything else passes through. */
  const num = (value: unknown): unknown => {
    if (value === null || value === undefined || value === "") return value;
    if (typeof value === "number") return value;
    if (typeof value === "string" && value.trim() !== "") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
    return value;
  };

  const explicitType = getField(row, ["entityType", "entity_type"]);
  const entityType =
    typeof explicitType === "string" && FOOTBALL_ENTITY_TYPES.has(explicitType)
      ? explicitType
      : inferEntityType(row, getField);

  const externalId = getField(row, ["externalId", "external_id", "id"]);
  const compositeId =
    externalId === undefined || externalId === null
      ? undefined
      : `${sourceId}:${String(externalId)}`;

  const base = {
    schemaVersion: 1,
    entityType,
    sourceId: getField(row, ["sourceId", "source_id"]) ?? sourceId,
    externalId,
    sourceUrl:
      getField(row, ["sourceUrl", "source_url"]) ??
      getField(row, ["url", "link"]),
    observedAt,
  };

  if (entityType === "player") {
    const rawTeam = getField(row, ["team"]);
    let team: unknown;
    if (rawTeam && typeof rawTeam === "object" && !Array.isArray(rawTeam)) {
      team = {
        teamId: getField(rawTeam, ["teamId", "team_id", "id"]),
        name: getField(rawTeam, ["name", "teamName", "team_name"]),
      };
    } else {
      team = {
        teamId: getField(row, ["teamId", "team_id"]),
        name: getField(row, ["teamName", "team_name", "team"]),
      };
    }

    const rawStats = getField(row, ["stats"]);
    const statField = (keys: string[]): unknown =>
      rawStats && typeof rawStats === "object" && !Array.isArray(rawStats)
        ? num(getField(rawStats, keys))
        : num(getField(row, keys));

    return {
      ...base,
      playerId: getField(row, ["playerId", "player_id"]) ?? compositeId,
      playerName: getField(row, ["playerName", "player_name", "name"]),
      team,
      position: getField(row, [
        "position",
        "playerPosition",
        "player_position",
      ]),
      shirtNumber: num(getField(row, ["shirtNumber", "shirt_number"])) ?? null,
      nationality: getField(row, ["nationality", "nationalityCountry"]) ?? null,
      season: getField(row, ["season", "seasonYear", "season_year"]),
      stats: {
        appearances: statField(["appearances", "apps"]),
        goals: statField(["goals", "goalsScored", "goals_scored"]),
        assists: statField(["assists"]),
        yellowCards: statField(["yellowCards", "yellow_cards", "yellows"]),
        redCards: statField(["redCards", "red_cards", "reds"]),
        minutesPlayed: statField([
          "minutesPlayed",
          "minutes_played",
          "minutes",
        ]),
      },
    };
  }

  if (entityType === "standing") {
    const rawTeam = getField(row, ["team"]);
    const nestedTeamId =
      rawTeam && typeof rawTeam === "object" && !Array.isArray(rawTeam)
        ? getField(rawTeam, ["teamId", "team_id", "id"])
        : undefined;
    const nestedTeamName =
      rawTeam && typeof rawTeam === "object" && !Array.isArray(rawTeam)
        ? getField(rawTeam, ["name"])
        : undefined;
    return {
      ...base,
      competition: getField(row, [
        "competition",
        "competitionName",
        "competition_name",
        "league",
        "leagueName",
        "league_name",
      ]),
      season: getField(row, ["season", "seasonYear", "season_year"]),
      teamId: getField(row, ["teamId", "team_id"]) ?? nestedTeamId,
      teamName: getField(row, ["teamName", "team_name"]) ?? nestedTeamName,
      rank: num(getField(row, ["rank", "position", "placement"])),
      played: num(getField(row, ["played", "matchesPlayed", "matches_played"])),
      won: num(getField(row, ["won", "wins"])),
      drawn: num(getField(row, ["drawn", "draws", "tied"])),
      lost: num(getField(row, ["lost", "losses", "defeats"])),
      goalsFor: num(
        getField(row, ["goalsFor", "goals_for", "scored", "goalsScored"]),
      ),
      goalsAgainst: num(
        getField(row, ["goalsAgainst", "goals_against", "conceded"]),
      ),
      points: num(getField(row, ["points"])),
    };
  }

  return {
    ...base,
    teamId: getField(row, ["teamId", "team_id"]) ?? compositeId,
    name: getField(row, ["name", "teamName", "team_name"]),
    shortName: getField(row, ["shortName", "short_name"]) ?? null,
    country: getField(row, ["country", "countryCode", "country_code"]) ?? null,
    city: getField(row, ["city"]) ?? null,
    stadium: getField(row, ["stadium", "venue"]) ?? null,
    founded:
      num(getField(row, ["founded", "foundingYear", "founding_year"])) ?? null,
    coach:
      getField(row, ["coach", "headCoach", "head_coach", "manager"]) ?? null,
  };
}

/**
 * Best-effort entity-type inference from the row's own field names. An
 * explicit `entityType` field always wins; otherwise standing markers beat
 * player markers, and anything else is treated as a team summary.
 */
function inferEntityType(
  row: unknown,
  getField: (obj: unknown, keys: string[]) => unknown,
): string {
  const hasStandingMarker = [
    ["rank"],
    ["played"],
    ["points"],
    ["goalsAgainst", "goals_against"],
    ["won"],
  ].some((keys) => getField(row, keys) !== undefined);
  if (hasStandingMarker) return "standing";

  const hasPlayerMarker = [
    ["playerName", "player_name"],
    ["position"],
    ["appearances", "apps"],
    ["assists"],
    ["yellowCards", "yellow_cards"],
    ["redCards", "red_cards"],
    ["minutesPlayed", "minutes_played"],
    ["shirtNumber", "shirt_number"],
  ].some((keys) => getField(row, keys) !== undefined);
  if (hasPlayerMarker) return "player";

  return "team";
}

export interface FootballHealingProvider {
  triggerRefactor(collectorId: string, prompt: string): Promise<void>;
  pollRefactorProgress(collectorId: string): Promise<FootballHealingProgress>;
  resumeAutomationJob(
    collectorId: string,
    approve: boolean,
    options?: { autoSave?: boolean },
  ): Promise<void>;
}

export interface FootballHealingProgress {
  status: string;
  step?: string;
  previewResult: unknown[];
}

export class UnconfiguredBrightDataHealingProvider implements FootballHealingProvider {
  async triggerRefactor(_collectorId: string, _prompt: string): Promise<void> {
    throw new ExternalCollectionNotConfiguredError();
  }
  async pollRefactorProgress(
    _collectorId: string,
  ): Promise<FootballHealingProgress> {
    throw new ExternalCollectionNotConfiguredError();
  }
  async resumeAutomationJob(
    _collectorId: string,
    _approve: boolean,
    _options?: { autoSave?: boolean },
  ): Promise<void> {
    throw new ExternalCollectionNotConfiguredError();
  }
}

export class BrightDataHealingProvider implements FootballHealingProvider {
  private readonly apiToken: string;
  private readonly maxRetries: number;
  private readonly requestTimeoutMs: number;
  private readonly retryDelayMs: number;
  private readonly fetchFn: typeof fetch;
  private readonly sleepFn: (delayMs: number) => Promise<void>;

  constructor(
    options: {
      apiToken?: string;
      maxRetries?: number;
      requestTimeoutMs?: number;
      retryDelayMs?: number;
      fetchFn?: typeof fetch;
      sleepFn?: (delayMs: number) => Promise<void>;
    } = {},
  ) {
    this.apiToken = options.apiToken || process.env.BRIGHT_DATA_API_TOKEN || "";
    this.maxRetries = options.maxRetries ?? 3;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30000;
    this.retryDelayMs = options.retryDelayMs ?? 1000;
    this.fetchFn = options.fetchFn ?? fetch;
    this.sleepFn =
      options.sleepFn ??
      ((delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)));

    if (!this.apiToken) {
      throw new ExternalCollectionNotConfiguredError();
    }
  }

  async triggerRefactor(collectorId: string, prompt: string): Promise<void> {
    const normalizedPrompt = prompt.trim();
    if (!normalizedPrompt || normalizedPrompt.length > 1000) {
      throw new BrightDataApiError(
        "invalid_input",
        "Bright Data healing prompt must contain between 1 and 1000 characters",
      );
    }
    const url = this.collectorEndpoint(collectorId, "refactor_template");
    const res = await this.fetchWithRetry(
      url,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ prompt: normalizedPrompt, custom_input: [] }),
      },
      this.maxRetries,
    );

    this.assertSuccessfulResponse(res, "trigger self-healing");
  }

  async pollRefactorProgress(
    collectorId: string,
  ): Promise<FootballHealingProgress> {
    const url = this.collectorEndpoint(
      collectorId,
      "refactor_template/progress",
    );
    const res = await this.fetchWithRetry(
      url,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${this.apiToken}`,
        },
      },
      this.maxRetries,
    );

    this.assertSuccessfulResponse(res, "poll self-healing progress");

    const data = await this.parseProgressResponse(res);
    const status = data?.status;
    if (typeof status !== "string") {
      throw new BrightDataApiError(
        "malformed_response",
        "Bright Data self-healing progress response did not include a status",
      );
    }
    return {
      status,
      ...(typeof data.step === "string" ? { step: data.step } : {}),
      previewResult: Array.isArray(data.preview_result)
        ? data.preview_result
        : [],
    };
  }

  async resumeAutomationJob(
    collectorId: string,
    approve: boolean,
    options: { autoSave?: boolean } = {},
  ): Promise<void> {
    const url = this.collectorEndpoint(collectorId, "resume_automation_job");
    const body =
      approve && options.autoSave
        ? { message: true, auto_save: true }
        : { message: approve };
    const res = await this.fetchWithRetry(
      url,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
      this.maxRetries,
    );

    this.assertSuccessfulResponse(res, "resume self-healing");
  }

  private async fetchWithRetry(
    url: string,
    options: RequestInit,
    maxRetries: number,
    initialDelayMs = this.retryDelayMs,
  ): Promise<Response> {
    let attempt = 0;
    while (true) {
      try {
        const response = await this.fetchFn(url, {
          ...options,
          signal: options.signal ?? AbortSignal.timeout(this.requestTimeoutMs),
        });
        const retryableStatus =
          response.status === 429 ||
          (response.status >= 500 && response.status < 600);
        if (retryableStatus && attempt < maxRetries) {
          attempt++;
          const delay = initialDelayMs * Math.pow(2, attempt - 1);
          await this.sleepFn(delay);
          continue;
        }
        return response;
      } catch (error) {
        if (attempt < maxRetries) {
          attempt++;
          const delay = initialDelayMs * Math.pow(2, attempt - 1);
          await this.sleepFn(delay);
          continue;
        }
        if (error instanceof DOMException && error.name === "TimeoutError") {
          throw new BrightDataApiError(
            "timeout",
            "Bright Data self-healing request timed out",
            { transient: true, cause: error },
          );
        }
        throw new BrightDataApiError(
          "network",
          "Bright Data self-healing request failed before a response was received",
          { transient: true, cause: error },
        );
      }
    }
  }

  private collectorEndpoint(collectorId: string, path: string): string {
    if (!/^c_[a-zA-Z0-9_-]+$/.test(collectorId)) {
      throw new BrightDataApiError(
        "invalid_input",
        "Bright Data collector ID must start with c_",
      );
    }
    return `https://api.brightdata.com/dca/collectors/${encodeURIComponent(collectorId)}/${path}`;
  }

  private assertSuccessfulResponse(
    response: Response,
    operation: string,
  ): void {
    if (response.ok) return;
    const status = response.status;
    if (status === 401 || status === 403) {
      throw new BrightDataApiError(
        "authentication",
        `Bright Data authentication failed while attempting to ${operation}`,
        { status },
      );
    }
    if (status === 404) {
      throw new BrightDataApiError(
        "not_found",
        `Bright Data collector was not found while attempting to ${operation}`,
        { status },
      );
    }
    if (status === 429) {
      throw new BrightDataApiError(
        "rate_limited",
        `Bright Data rate limited the request while attempting to ${operation}`,
        { status, transient: true },
      );
    }
    throw new BrightDataApiError(
      "api_error",
      `Bright Data returned HTTP ${status} while attempting to ${operation}`,
      { status, transient: status >= 500 },
    );
  }

  private async parseProgressResponse(
    response: Response,
  ): Promise<Record<string, unknown>> {
    let data: unknown;
    try {
      data = await response.json();
    } catch (error) {
      throw new BrightDataApiError(
        "malformed_response",
        "Bright Data self-healing progress response was not valid JSON",
        { cause: error },
      );
    }
    if (data === null || typeof data !== "object" || Array.isArray(data)) {
      throw new BrightDataApiError(
        "malformed_response",
        "Bright Data self-healing progress response was not an object",
      );
    }
    return data as Record<string, unknown>;
  }
}

export class MockBrightDataHealingProvider implements FootballHealingProvider {
  private status = "pending_answer";

  constructor(private readonly previewResult: unknown[] = []) {}

  async triggerRefactor(_collectorId: string, _prompt: string): Promise<void> {
    // The deterministic judge demo makes its preview available on the first
    // explicit poll. Dedicated coordinator tests cover longer-running jobs.
    this.status = "pending_answer";
  }

  async pollRefactorProgress(
    _collectorId: string,
  ): Promise<FootballHealingProgress> {
    return {
      status: this.status,
      previewResult:
        this.status === "pending_answer"
          ? structuredClone(this.previewResult)
          : [],
    };
  }

  async resumeAutomationJob(
    _collectorId: string,
    approve: boolean,
    _options?: { autoSave?: boolean },
  ): Promise<void> {
    this.status = approve ? "done" : "rejected";
  }
}

export {
  DEFAULT_STATBUNKER_SOURCE_ID,
  STATBUNKER_SOURCE_ID,
  STATBUNKER_SOURCE_PROFILE,
  StatBunkerRowMapper,
  createStatBunkerPipelineRowMapper,
  externalIdFromStatBunkerUrl,
  mapStatBunkerRowToFootballRecord,
  normalizeStatBunkerCountryCode,
  normalizeStatBunkerPosition,
  normalizeStatBunkerSeason,
  preprocessStatBunkerRow,
  statBunkerExternalId,
  statBunkerSourceAdapter,
  statBunkerSourceIdMatches,
} from "./statbunker.js";
export type {
  StatBunkerMappedBatch,
  StatBunkerMappedRowRejection,
  StatBunkerRowIssue,
  StatBunkerRowIssueCode,
  StatBunkerRowOutcome,
} from "./statbunker.js";
export { StatBunkerMatchRowMapper } from "./statbunker-matches.js";
export type {
  StatBunkerMatchContext,
  StatBunkerMatchIssue,
  StatBunkerMatchOutcome,
} from "./statbunker-matches.js";
export {
  STATBUNKER_PLAYER_MATCHES_BASE_URL,
  STATBUNKER_PLAYER_SEARCH_BASE_URL,
  STATBUNKER_PLAYER_STANDINGS_BASE_URL,
  VERIFIED_STATBUNKER_SEASONS,
  alignStandingsRowToVerifiedSeason,
  isVerifiedStatBunkerSeason,
  latestCompleteVerifiedStatBunkerSeason,
  listVerifiedStatBunkerSeasons,
  resolveVerifiedStatBunkerSeason,
  resolveVerifiedStatBunkerSeasonFromUrl,
  statBunkerPlayerSeasonMatchesUrl,
  statBunkerPlayerSearchResolverUrl,
  statBunkerPlayerStandingsUrl,
} from "./seasons.js";
export type { VerifiedSeasonMetadata } from "@bidsentinel/contracts";
