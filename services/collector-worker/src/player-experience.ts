import { randomUUID } from "node:crypto";

import {
  CardBundleSchema,
  CardProvenanceSchema,
  CacheFreshnessSchema,
  FootballSnapshotSchema,
  GenerateRequestSchema,
  GenerateResultSchema,
  MatchAvailabilitySchema,
  MatchRowSchema,
  PlayerCardSchema,
  PlayerIndexEntrySchema,
  REDACTED_COLLECTOR_ID,
  ScrapeRunSchema,
  SourceIdSchema,
  entityIdOf,
  redactCollectorId,
  type CacheFreshness,
  type CardBundle,
  type FootballRecord,
  type FootballSnapshot,
  type GenerateRequest,
  type GenerateResult,
  type MatchAvailability,
  type MatchRow,
  type PlayerCard,
  type PlayerIndexEntry,
  type PlayerMatchRecord,
  type Position,
  type ScrapeRun,
  type ScrapeStageRecord,
  type TeamRef,
} from "@bidsentinel/contracts";
import {
  STATBUNKER_SOURCE_ID,
  STATBUNKER_PLAYER_SEARCH_BASE_URL,
  StatBunkerMatchRowMapper,
  StatBunkerRowMapper,
  listVerifiedStatBunkerSeasons,
  resolveVerifiedStatBunkerSeason,
  statBunkerPlayerSearchResolverUrl,
  statBunkerPlayerSeasonMatchesUrl,
  type VerifiedSeasonMetadata,
} from "@bidsentinel/brightdata";
import { hashPayload } from "@bidsentinel/validation";

import {
  CardPulsePipeline,
  type PipelineExtractionContext,
  type ProcessingResult,
} from "./pipeline.js";

/** How long a stored card bundle counts as fresh. Configurable for tests. */
export const DEFAULT_FRESHNESS_TTL_SECONDS = 15 * 60;

/**
 * Request passed to the injected collection callback. The URL always comes
 * from the verified season registry; callers can never point a billable run
 * at an unverified target through this service.
 */
export interface PlayerExperienceCollectionRequest {
  readonly sourceId: string;
  readonly targetUrl: string;
  readonly season: string;
}

/** Raw provider output handed back to the service for strict processing. */
export interface PlayerExperienceCollectionBatch {
  /** Real collector identity stays inside the integration layer only. */
  readonly collectorId?: string;
  readonly extractorVersion?: string;
  readonly rawRows: readonly unknown[];
}

export type PlayerExperienceCollector = (
  request: PlayerExperienceCollectionRequest,
) => Promise<PlayerExperienceCollectionBatch>;

export interface PlayerSearchOptions {
  /** Only players holding verified data for this registry season. */
  readonly season?: string;
  /** Case/diacritic-insensitive partial club filter for disambiguation. */
  readonly club?: string;
  readonly position?: Position;
}

export interface PlayerExperienceServiceOptions {
  /** Injected billable collection; invoked at most once per generate. */
  readonly collect: PlayerExperienceCollector;
  /** Injectable clock; never polled by timers, read at decision points. */
  readonly now?: () => Date;
  readonly freshnessTtlSeconds?: number;
  readonly pipeline?: CardPulsePipeline;
  readonly sourceId?: string;
}

export type PlayerExperienceGenerationStart =
  | {
      readonly kind: "immediate";
      readonly result: GenerateResult;
    }
  | {
      readonly kind: "started";
      readonly runId: string;
      readonly completion: Promise<GenerateResult>;
    };

export interface PlayerExperienceIndexRefreshResult {
  readonly season: string;
  readonly sourceUrl: string;
  readonly acceptedCount: number;
  readonly quarantinedCount: number;
  readonly indexedPlayerCount: number;
}

interface IndexedPlayer {
  readonly playerId: string;
  readonly sourceId: string;
  externalId: string;
  playerName: string;
  team: TeamRef;
  position: Position;
  nationality: string | null;
  readonly seasons: Set<string>;
  readonly seasonProfiles: Map<string, IndexedSeasonProfile>;
  lastObservedAtMs: number;
}

interface IndexedSeasonProfile {
  externalId: string;
  readonly playerName: string;
  readonly team: TeamRef;
  readonly position: Position;
  readonly nationality: string | null;
  readonly observedAtMs: number;
}

type RecoveryCollectionContext =
  | {
      readonly kind: "index";
      readonly season: string;
      readonly sourceUrl: string;
    }
  | {
      readonly kind: "match";
      readonly playerId: string;
      playerExternalId: string | null;
      readonly playerName: string;
      readonly playerTeam: string;
      readonly season: string;
      readonly compId: number;
      readonly collectionTargetUrl: string;
      sourceUrl: string | null;
    };

export interface PlayerExperienceRecoveryVerification {
  readonly success: boolean;
  readonly validRecordCount: number;
  readonly quarantinedCount: number;
  readonly sampleEntityIds: string[];
  readonly payloadHashes: string[];
}

interface RunDraft {
  readonly runId: string;
  readonly playerId: string;
  readonly playerName: string;
  readonly season: string;
  readonly sourceUrl: string;
  readonly requestedAt: Date;
  stageHistory: ScrapeStageRecord[];
  currentStage: ScrapeStageRecord["stage"] | null;
  terminalStatus: "succeeded" | "failed" | null;
  failureReason: string | null;
  cardId: string | null;
}

function playerSeasonKey(playerId: string, season: string): string {
  return `${playerId}\u0000${season}`;
}

function normalizeForSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replaceAll(/\s+/g, " ")
    .trim();
}

function matchSourceIdFor(
  baseSourceId: string,
  playerId: string,
  playerExternalId: string,
  season: string,
): string {
  const playerKey = /^\d+$/.test(playerExternalId)
    ? playerExternalId
    : hashPayload({ playerId, season }).slice(0, 16);
  return SourceIdSchema.parse(`${baseSourceId}-matches-${playerKey}-${season}`);
}

function recordStateForHash(
  record: FootballRecord,
): Omit<FootballRecord, "observedAt"> {
  const { observedAt: _observedAt, ...state } = record;
  return state;
}

/** Collector IDs embedded by upstream tooling never reach new surfaces. */
function sanitizeCollectorTokens(value: string): string {
  return value.replace(/c_[A-Za-z0-9_-]+/g, REDACTED_COLLECTOR_ID);
}

function iso(date: Date): string {
  return date.toISOString();
}

function recordOf(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function firstText(
  record: Record<string, unknown>,
  keys: readonly string[],
): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim() !== "") return value.trim();
    if (typeof value === "number" && Number.isSafeInteger(value)) {
      return String(value);
    }
  }
  return null;
}

interface ResolvedMatchIdentity {
  readonly playerExternalId: string;
  readonly sourceUrl: string;
}

/**
 * Resolve a numeric StatBunker player ID only from explicit collector output
 * produced by the public exact-name search page. Every row must repeat the
 * same identity and canonical SeasonMatches URL; mixed/ambiguous output fails.
 */
function resolveMatchIdentityFromRows(
  rows: readonly unknown[],
  playerName: string,
  compId: number,
): ResolvedMatchIdentity | null {
  if (rows.length === 0) return null;
  const identities = rows.map((row) => {
    const record = recordOf(row);
    if (record === null) return null;
    const resolvedName = firstText(record, [
      "resolved_player_name",
      "resolvedPlayerName",
    ]);
    if (
      resolvedName === null ||
      normalizeForSearch(resolvedName) !== normalizeForSearch(playerName)
    ) {
      return null;
    }
    const externalId = firstText(record, [
      "resolved_player_id",
      "resolvedPlayerId",
    ]);
    const playerUrl = firstText(record, [
      "resolved_player_url",
      "resolvedPlayerUrl",
    ]);
    if (
      externalId === null ||
      !/^\d+$/.test(externalId) ||
      playerUrl !==
        `https://www.statbunker.com/players/getPlayerStats?player_id=${externalId}`
    ) {
      return null;
    }
    const sourceUrl = firstText(record, ["source_url", "sourceUrl"]);
    const expectedSourceUrl = statBunkerPlayerSeasonMatchesUrl(
      compId,
      externalId,
    );
    if (sourceUrl !== expectedSourceUrl) return null;
    return { playerExternalId: externalId, sourceUrl: expectedSourceUrl };
  });
  if (identities.some((identity) => identity === null)) return null;
  const first = identities[0];
  if (first === null || first === undefined) return null;
  return identities.every(
    (identity) =>
      identity !== null &&
      identity.playerExternalId === first.playerExternalId &&
      identity.sourceUrl === first.sourceUrl,
  )
    ? first
    : null;
}

/**
 * In-memory backend for the searchable card experience: local index search
 * that never collects, versioned season card bundles with honest cache
 * freshness, and explicit single-collection generation through the existing
 * CardPulse pipeline.
 *
 * Truthfulness rules enforced here:
 * - search reads only the local cached index and can never trigger billing;
 * - generation resolves its target exclusively from the verified StatBunker
 *   season registry — unknown players/seasons fail closed with no run;
 * - a stale or missing cache triggers exactly one injected collection call,
 *   whose raw rows go through the same strict pipeline as every other feed;
 * - failures preserve the last verified bundle and never become demo data;
 * - demo content exists solely after an explicit seed and stays permanently
 *   labelled DEMO DATA;
 * - stage history advances only when real operations resolve — no timers;
 * - public payloads carry only the redacted collector literal.
 */
export class PlayerExperienceService {
  /** Shared strict pipeline; snapshots/quarantines stay observable here. */
  readonly pipeline: CardPulsePipeline;
  readonly #collect: PlayerExperienceCollector;
  readonly #now: () => Date;
  readonly #ttlSeconds: number;
  readonly #sourceId: string;
  readonly #rowMapper: StatBunkerRowMapper;
  readonly #index = new Map<string, IndexedPlayer>();
  readonly #bundles = new Map<string, CardBundle[]>();
  readonly #cardsById = new Map<string, CardBundle>();
  readonly #runs = new Map<string, ScrapeRun>();
  readonly #matches = new Map<string, MatchRow[]>();
  readonly #indexedSeasons = new Set<string>();
  readonly #inFlightGenerations = new Map<
    string,
    { readonly runId: string; readonly completion: Promise<GenerateResult> }
  >();
  readonly #recoveryContexts = new Map<string, RecoveryCollectionContext>();
  #demoSeeded = false;

  constructor(options: PlayerExperienceServiceOptions) {
    this.#collect = options.collect;
    this.#now = options.now ?? (() => new Date());
    this.#ttlSeconds =
      options.freshnessTtlSeconds ?? DEFAULT_FRESHNESS_TTL_SECONDS;
    this.pipeline = options.pipeline ?? new CardPulsePipeline();
    this.#sourceId = options.sourceId ?? STATBUNKER_SOURCE_ID;
    this.#rowMapper = new StatBunkerRowMapper({ sourceId: this.#sourceId });
  }

  /**
   * Index validated player snapshots and merge their available seasons.
   * Re-indexing the same player union-adds seasons and keeps the newest
   * observation; nothing here ever reaches a provider.
   */
  indexPlayers(snapshots: readonly FootballSnapshot[]): void {
    for (const snapshot of snapshots) {
      if (snapshot.record.entityType !== "player") continue;
      const record = snapshot.record;
      this.#indexedSeasons.add(record.season);
      const existing = this.#index.get(record.playerId);
      const observedAtMs = Date.parse(snapshot.observedAt);
      const seasonProfile: IndexedSeasonProfile = {
        externalId: record.externalId,
        playerName: record.playerName,
        team: record.team,
        position: record.position,
        nationality: record.nationality,
        observedAtMs,
      };
      if (existing) {
        existing.seasons.add(record.season);
        const existingSeason = existing.seasonProfiles.get(record.season);
        // A list-page refresh may still lack StatBunker's numeric player ID.
        // Do not throw away an identity already proven by an exact-name
        // resolver + canonical SeasonMatches collection.
        if (
          existingSeason !== undefined &&
          /^\d+$/.test(existingSeason.externalId) &&
          !/^\d+$/.test(seasonProfile.externalId)
        ) {
          seasonProfile.externalId = existingSeason.externalId;
        }
        if (
          existingSeason === undefined ||
          observedAtMs >= existingSeason.observedAtMs
        ) {
          existing.seasonProfiles.set(record.season, seasonProfile);
        }
        if (observedAtMs >= existing.lastObservedAtMs) {
          existing.playerName = record.playerName;
          existing.externalId = record.externalId;
          existing.team = record.team;
          existing.position = record.position;
          existing.nationality = record.nationality;
          existing.lastObservedAtMs = observedAtMs;
        }
        continue;
      }
      this.#index.set(record.playerId, {
        playerId: record.playerId,
        sourceId: record.sourceId,
        externalId: record.externalId,
        playerName: record.playerName,
        team: record.team,
        position: record.position,
        nationality: record.nationality,
        seasons: new Set([record.season]),
        seasonProfiles: new Map([[record.season, seasonProfile]]),
        lastObservedAtMs: observedAtMs,
      });
    }
  }

  /**
   * Deterministic normalized case-insensitive partial search over the local
   * index with optional season/club/position disambiguation. Empty queries
   * match nothing; unknown seasons filter to nothing; no code path here can
   * start a collection.
   */
  searchPlayers(
    query: string,
    options: PlayerSearchOptions = {},
  ): PlayerIndexEntry[] {
    const needle = normalizeForSearch(query);
    if (needle === "") return [];
    const searchTokens = needle
      .split(" ")
      .filter((token) => token !== "player" && token !== "players");
    if (searchTokens.length === 0) return [];

    const clubNeedle =
      options.club === undefined ? null : normalizeForSearch(options.club);
    const hits: PlayerIndexEntry[] = [];
    for (const player of this.#index.values()) {
      if (options.season !== undefined && !player.seasons.has(options.season)) {
        continue;
      }
      const profile =
        options.season === undefined
          ? {
              externalId: player.externalId,
              playerName: player.playerName,
              team: player.team,
              position: player.position,
              nationality: player.nationality,
              observedAtMs: player.lastObservedAtMs,
            }
          : player.seasonProfiles.get(options.season);
      if (profile === undefined) continue;
      const searchText = normalizeForSearch(
        `${profile.playerName} ${profile.team.name}`,
      );
      if (!searchTokens.every((token) => searchText.includes(token))) continue;
      if (
        clubNeedle !== null &&
        !normalizeForSearch(profile.team.name).includes(clubNeedle)
      ) {
        continue;
      }
      if (
        options.position !== undefined &&
        profile.position !== options.position
      ) {
        continue;
      }
      hits.push(
        PlayerIndexEntrySchema.parse({
          schemaVersion: 1,
          playerId: player.playerId,
          sourceId: player.sourceId,
          playerName: profile.playerName,
          team: profile.team,
          position: profile.position,
          nationality: profile.nationality,
          seasons: [...player.seasons].sort(),
          lastObservedAt: iso(new Date(profile.observedAtMs)),
        }),
      );
    }

    return hits.sort(
      (left, right) =>
        left.playerName.localeCompare(right.playerName) ||
        left.playerId.localeCompare(right.playerId),
    );
  }

  /** Seasons one indexed player holds verified data for, ascending. */
  getPlayerSeasons(playerId: string): string[] {
    return [...(this.#index.get(playerId)?.seasons ?? [])].sort();
  }

  /** Whether one verified season has already populated the live index. */
  hasIndexedSeason(season: string): boolean {
    return this.#indexedSeasons.has(season);
  }

  /** Number of unique player identities currently held in memory. */
  getIndexedPlayerCount(): number {
    return this.#index.size;
  }

  /**
   * Resolve a player selected in one season to the same unambiguous exact
   * name in another indexed season. This supports transfers without guessing
   * between duplicate names.
   */
  resolvePlayerIdForSeason(playerId: string, season: string): string | null {
    const selected = this.#index.get(playerId);
    if (selected === undefined) return null;
    if (selected.seasons.has(season)) return selected.playerId;

    const exactName = normalizeForSearch(selected.playerName);
    const candidates = [...this.#index.values()].filter((candidate) => {
      const profile = candidate.seasonProfiles.get(season);
      return (
        profile !== undefined &&
        normalizeForSearch(profile.playerName) === exactName
      );
    });
    return candidates.length === 1 ? (candidates[0]?.playerId ?? null) : null;
  }

  /** The frozen verified season registry (745 / 596 / 776 / 791). */
  listSeasons(): readonly VerifiedSeasonMetadata[] {
    return listVerifiedStatBunkerSeasons();
  }

  /**
   * Explicit, billable index refresh for one verified season. HTTP callers
   * apply the live-mutation switch, deduplication, and public rate limit before
   * invoking it. The whole batch passes through the existing
   * majority-drift/healing gate once, then
   * accepted player snapshots seed both autocomplete and fresh card bundles.
   */
  async refreshIndex(
    season: string,
  ): Promise<PlayerExperienceIndexRefreshResult> {
    const seasonMeta = resolveVerifiedStatBunkerSeason(season);
    if (seasonMeta === null) {
      throw new Error(
        `Season "${season}" is not in the verified StatBunker registry; refusing to guess a collection target.`,
      );
    }
    const batch = await this.#collect({
      sourceId: this.#sourceId,
      targetUrl: seasonMeta.sourceUrl,
      season: seasonMeta.season,
    });
    this.#recoveryContexts.set(this.#sourceId, {
      kind: "index",
      season: seasonMeta.season,
      sourceUrl: seasonMeta.sourceUrl,
    });
    const observedAt = iso(this.#now());
    const mappedRows = batch.rawRows.map((rawRow) => {
      const mapped = this.#rowMapper.map(rawRow, observedAt);
      return mapped.ok &&
        mapped.record.entityType === "player" &&
        mapped.record.season === seasonMeta.season
        ? mapped.record
        : rawRow;
    });
    const results = await this.pipeline.processBatchWithHealing(
      mappedRows,
      {
        sourceId: this.#sourceId,
        ...(batch.collectorId === undefined
          ? {}
          : { collectorId: batch.collectorId }),
        extractorVersion: sanitizeCollectorTokens(
          batch.extractorVersion ?? "statbunker-player-index",
        ),
        observedAt,
      },
      1,
      true,
    );
    const playerRecords = results.flatMap((result) =>
      result.outcome === "accepted" && result.record.entityType === "player"
        ? [result.record]
        : [],
    );
    const snapshots = playerRecords.flatMap((record) => {
      const snapshot = this.pipeline.snapshots.latest(entityIdOf(record));
      return snapshot === null ? [] : [snapshot];
    });
    this.indexPlayers(snapshots);
    for (const record of playerRecords) {
      this.#storeBundle(record, batch, observedAt);
    }
    return {
      season: seasonMeta.season,
      sourceUrl: seasonMeta.sourceUrl,
      acceptedCount: playerRecords.length,
      quarantinedCount: results.length - playerRecords.length,
      indexedPlayerCount: this.#index.size,
    };
  }

  /**
   * Explicit generation for one player + registry season.
   *
   * Fresh cache -> served without any collection. Stale or missing ->
   * exactly ONE injected collection call against the registry source URL;
   * player match rows flow through the shared CardPulse pipeline for strict
   * validation, accepted season rows derive the requested player's totals,
   * and a versioned bundle replaces the old one. Any failure preserves the
   * last verified bundle untouched and reports the failing stage truthfully.
   */
  startGenerate(input: GenerateRequest): PlayerExperienceGenerationStart {
    const request = GenerateRequestSchema.parse(input);

    const closedFailure = (reason: string): GenerateResult =>
      GenerateResultSchema.parse({
        schemaVersion: 1,
        outcome: "failed",
        playerId: request.playerId,
        season: request.season,
        runId: null,
        cardBundle: this.getLatestCard(request.playerId, request.season),
        failureReason: reason,
      });

    // Gate 1: the registry. Unknown seasons never produce a URL or a run.
    const seasonMeta = resolveVerifiedStatBunkerSeason(request.season);
    if (seasonMeta === null) {
      return {
        kind: "immediate",
        result: closedFailure(
          `Season "${request.season}" is not in the verified StatBunker registry; refusing to guess a collection target.`,
        ),
      };
    }

    // Gate 2: the local index. Nothing is billed for unindexed players.
    const player = this.#index.get(request.playerId);
    if (player === undefined) {
      return {
        kind: "immediate",
        result: closedFailure(
          "Player is not present in the cached index; index a verified snapshot first.",
        ),
      };
    }
    if (!player.seasons.has(request.season)) {
      return {
        kind: "immediate",
        result: closedFailure(
          `Source data not available yet for ${player.playerName} in ${seasonMeta.label}.`,
        ),
      };
    }
    const seasonProfile = player.seasonProfiles.get(request.season);
    if (seasonProfile === undefined) {
      return {
        kind: "immediate",
        result: closedFailure(
          `Verified player identity is missing for ${seasonMeta.label}; refusing to reuse another season's club data.`,
        ),
      };
    }

    // Gate 3: freshness. A fresh bundle serves without any collection.
    const cached = this.getLatestCard(request.playerId, request.season);
    const matchKey = playerSeasonKey(request.playerId, request.season);
    if (
      cached !== null &&
      cached.freshness.state === "fresh" &&
      this.#matches.has(matchKey)
    ) {
      return {
        kind: "immediate",
        result: GenerateResultSchema.parse({
          schemaVersion: 1,
          outcome: "cache-hit",
          playerId: request.playerId,
          season: request.season,
          runId: null,
          cardBundle: cached,
          failureReason: null,
        }),
      };
    }

    const inFlight = this.#inFlightGenerations.get(matchKey);
    if (inFlight !== undefined) {
      return {
        kind: "started",
        runId: inFlight.runId,
        completion: inFlight.completion,
      };
    }

    let targetUrl: string;
    let collectionSourceId: string;
    try {
      targetUrl = /^\d+$/.test(seasonProfile.externalId)
        ? statBunkerPlayerSeasonMatchesUrl(
            seasonMeta.compId,
            seasonProfile.externalId,
          )
        : statBunkerPlayerSearchResolverUrl(
            seasonMeta.compId,
            seasonProfile.playerName,
          );
      collectionSourceId = matchSourceIdFor(
        this.#sourceId,
        player.playerId,
        seasonProfile.externalId,
        seasonMeta.season,
      );
    } catch (error) {
      return {
        kind: "immediate",
        result: closedFailure(
          error instanceof Error
            ? error.message
            : "A verified StatBunker player ID is required before collection.",
        ),
      };
    }

    this.#recoveryContexts.set(collectionSourceId, {
      kind: "match",
      playerId: player.playerId,
      playerExternalId: /^\d+$/.test(seasonProfile.externalId)
        ? seasonProfile.externalId
        : null,
      playerName: seasonProfile.playerName,
      playerTeam: seasonProfile.team.name,
      season: seasonMeta.season,
      compId: seasonMeta.compId,
      collectionTargetUrl: targetUrl,
      sourceUrl: /^\d+$/.test(seasonProfile.externalId) ? targetUrl : null,
    });

    const run = this.#startRun(player, seasonMeta, targetUrl);

    // Exactly one billable attempt per generate.
    this.#enterStage(
      run,
      "finding_player",
      `Matched "${player.playerName}" in the cached index.`,
    );
    this.#completeLastStage(
      run,
      `Indexed seasons: ${[...player.seasons].sort().join(", ")}.`,
    );
    this.#enterStage(
      run,
      "starting_collector",
      `Collection authorized against ${targetUrl}`,
    );
    this.#saveRun(run);

    const completion = this.#completeGeneration(
      request,
      player,
      seasonProfile,
      seasonMeta,
      run,
      cached,
      targetUrl,
      collectionSourceId,
    ).finally(() => {
      this.#inFlightGenerations.delete(matchKey);
    });
    this.#inFlightGenerations.set(matchKey, {
      runId: run.runId,
      completion,
    });
    return {
      kind: "started",
      runId: run.runId,
      completion,
    };
  }

  async generate(input: GenerateRequest): Promise<GenerateResult> {
    const start = this.startGenerate(input);
    return start.kind === "immediate" ? start.result : start.completion;
  }

  async #completeGeneration(
    request: GenerateRequest,
    player: IndexedPlayer,
    seasonProfile: IndexedSeasonProfile,
    seasonMeta: VerifiedSeasonMetadata,
    run: RunDraft,
    preservedBeforeRun: CardBundle | null,
    targetUrl: string,
    collectionSourceId: string,
  ): Promise<GenerateResult> {
    let batch: PlayerExperienceCollectionBatch;
    try {
      batch = await this.#collect({
        sourceId: collectionSourceId,
        targetUrl,
        season: seasonMeta.season,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.#completeLastStage(run, "The collector rejected or failed the run.");
      return this.#failRun(
        run,
        preservedBeforeRun,
        `Live collection failed while starting the collector: ${message}`,
      );
    }
    this.#completeLastStage(run, "Trigger accepted; dataset received.");

    // Every raw SeasonMatches row is first mapped to the frozen canonical
    // match contract, then the whole batch goes through the existing strict
    // pipeline. A minority of malformed rows is quarantined without healing;
    // majority/repeated drift and result-count collapse keep the established
    // same-collector guarded lifecycle.
    this.#enterStage(run, "extracting_statistics", null);
    const observedAt = iso(this.#now());
    const matchContext: PipelineExtractionContext = {
      sourceId: collectionSourceId,
      extractorVersion: sanitizeCollectorTokens(
        batch.extractorVersion ?? "statbunker-player-matches",
      ),
      observedAt,
      ...(batch.collectorId === undefined
        ? {}
        : { collectorId: batch.collectorId }),
    };
    const resolverTarget = targetUrl.startsWith(
      `${STATBUNKER_PLAYER_SEARCH_BASE_URL}?`,
    );
    const matchIdentity = resolverTarget
      ? resolveMatchIdentityFromRows(
          batch.rawRows,
          seasonProfile.playerName,
          seasonMeta.compId,
        )
      : /^\d+$/.test(seasonProfile.externalId)
        ? {
            playerExternalId: seasonProfile.externalId,
            sourceUrl: statBunkerPlayerSeasonMatchesUrl(
              seasonMeta.compId,
              seasonProfile.externalId,
            ),
          }
        : null;
    if (matchIdentity !== null) {
      seasonProfile.externalId = matchIdentity.playerExternalId;
      const recoveryContext = this.#recoveryContexts.get(collectionSourceId);
      if (recoveryContext?.kind === "match") {
        recoveryContext.playerExternalId = matchIdentity.playerExternalId;
        recoveryContext.sourceUrl = matchIdentity.sourceUrl;
      }
    }
    const matchMapper = new StatBunkerMatchRowMapper(collectionSourceId);
    const mappedMatches = batch.rawRows.map((rawRow) => ({
      rawRow,
      outcome:
        matchIdentity === null
          ? {
              ok: false as const,
              issues: [
                {
                  path: ["playerExternalId"],
                  message:
                    "Collector did not prove one exact numeric player identity and canonical match source URL",
                },
              ],
            }
          : matchMapper.map(rawRow, {
              playerId: player.playerId,
              playerExternalId: matchIdentity.playerExternalId,
              playerName: seasonProfile.playerName,
              playerTeam: seasonProfile.team.name,
              season: seasonMeta.season,
              sourceUrl: matchIdentity.sourceUrl,
              observedAt,
            }),
    }));
    const validMatchCount = mappedMatches.filter(
      ({ outcome }) => outcome.ok,
    ).length;
    const invalidMatchCount = mappedMatches.length - validMatchCount;
    const matchPayloads = mappedMatches.map(({ rawRow, outcome }) =>
      outcome.ok ? outcome.record : rawRow,
    );
    let results: ProcessingResult[];
    if (matchPayloads.length === 1 && validMatchCount === 0) {
      // A lone malformed row is quarantined but can never trigger healing.
      results = [this.pipeline.process(matchPayloads[0], matchContext)];
    } else {
      results = await this.pipeline.processBatchWithHealing(
        matchPayloads,
        matchContext,
        1,
        true,
      );
    }
    const acceptedMatchRows = results.flatMap((result) =>
      result.outcome === "accepted" &&
      result.record.entityType === "match" &&
      result.record.playerId === request.playerId &&
      result.record.season === seasonMeta.season
        ? [result.record]
        : [],
    );
    const acceptedMatches = [
      ...new Map(
        acceptedMatchRows.map((record) => [record.matchId, record]),
      ).values(),
    ];
    const structuralMajority =
      mappedMatches.length > 1 &&
      invalidMatchCount >= Math.ceil(mappedMatches.length / 2);

    let selected: PlayerCard | undefined;
    if (acceptedMatches.length > 0 && !structuralMajority) {
      const derived = this.#derivePlayerFromMatches(
        player.playerId,
        seasonProfile,
        seasonMeta,
        acceptedMatches,
        matchIdentity?.sourceUrl ?? targetUrl,
        observedAt,
      );
      const aggregateResult = this.pipeline.process(derived, {
        sourceId: this.#sourceId,
        extractorVersion: matchContext.extractorVersion,
        observedAt,
      });
      results.push(aggregateResult);
      if (
        aggregateResult.outcome === "accepted" &&
        aggregateResult.record.entityType === "player"
      ) {
        selected = aggregateResult.record;
      }
    }
    const accepted = results.filter(
      (result) => result.outcome === "accepted",
    ).length;
    const quarantined = results.length - accepted;
    this.#completeLastStage(
      run,
      `${accepted} row(s) validated, ${quarantined} quarantined.`,
    );

    this.#enterStage(run, "validating_data", null);
    this.#saveRun(run);
    if (selected === undefined) {
      return this.#failRun(
        run,
        preservedBeforeRun,
        matchIdentity === null
          ? "The collector could not prove one exact StatBunker player ID and season-match URL; preserving the last verified card."
          : structuralMajority
            ? "Most player-match rows failed the frozen contract; preserving the last verified card while guarded recovery handles the drift."
            : accepted === 0
              ? "No rows survived strict validation; preserving the last verified card."
              : `No validated match history produced statistics for ${seasonProfile.playerName} in ${seasonMeta.label}; preserving the last verified card.`,
      );
    }
    this.#completeLastStage(
      run,
      `Selected verified statistics for ${selected.playerName} (${seasonMeta.label}).`,
    );

    this.#enterStage(run, "printing_card", null);
    this.#matches.set(
      playerSeasonKey(request.playerId, seasonMeta.season),
      [...acceptedMatches]
        .sort((a, b) => b.playedOn.localeCompare(a.playedOn))
        .map((match) => this.#publicMatchRow(match)),
    );
    const bundle = this.#storeBundle(
      selected,
      batch,
      observedAt,
      collectionSourceId,
    );
    this.#completeLastStage(run, `Card ${bundle.cardId} ready.`);
    run.cardId = bundle.cardId;
    run.terminalStatus = "succeeded";
    run.currentStage = null;
    this.#saveRun(run);

    return GenerateResultSchema.parse({
      schemaVersion: 1,
      outcome: "collected",
      playerId: request.playerId,
      season: request.season,
      runId: run.runId,
      cardBundle: bundle,
      failureReason: null,
    });
  }

  #derivePlayerFromMatches(
    playerId: string,
    player: IndexedSeasonProfile,
    seasonMeta: VerifiedSeasonMetadata,
    matches: readonly PlayerMatchRecord[],
    sourceUrl: string,
    observedAt: string,
  ): PlayerCard {
    const appearances = matches.filter((match) => match.appeared);
    const minutesPlayed = appearances.every(
      (match) => match.minutesPlayed !== null,
    )
      ? appearances.reduce(
          (total, match) => total + (match.minutesPlayed ?? 0),
          0,
        )
      : null;
    return PlayerCardSchema.parse({
      schemaVersion: 1,
      entityType: "player",
      playerId,
      sourceId: this.#sourceId,
      externalId: player.externalId,
      playerName: player.playerName,
      team: player.team,
      position: player.position,
      shirtNumber: null,
      nationality: player.nationality,
      season: seasonMeta.season,
      stats: {
        appearances: appearances.length,
        goals: matches.reduce((total, match) => total + match.goals, 0),
        assists: matches.reduce((total, match) => total + match.assists, 0),
        yellowCards: matches.reduce(
          (total, match) => total + match.yellowCards,
          0,
        ),
        redCards: matches.reduce((total, match) => total + match.redCards, 0),
        minutesPlayed,
      },
      sourceUrl,
      observedAt,
    });
  }

  #publicMatchRow(record: PlayerMatchRecord): MatchRow {
    const opponent =
      record.venue === "home" ? record.awayTeam : record.homeTeam;
    return MatchRowSchema.parse({
      schemaVersion: 1,
      matchId: record.matchId,
      season: record.season,
      playedOn: record.playedOn,
      competition: record.competition,
      homeTeam: record.homeTeam,
      awayTeam: record.awayTeam,
      homeGoals: record.homeGoals,
      awayGoals: record.awayGoals,
      playerTeam: record.playerTeam,
      opponent,
      venue: record.venue,
      playerGoals: record.goals,
      playerAssists: record.assists,
      playerMinutes: record.minutesPlayed,
      sourceUrl: record.sourceUrl,
    });
  }

  /** True when this process remembers the exact target that opened an incident. */
  hasRecoveryTarget(sourceId: string): boolean {
    return this.#recoveryContexts.has(sourceId);
  }

  /**
   * Canonicalize an approval preview with the same verified player/season
   * identity that the failing collection used. Raw preview rows that do not
   * map cleanly are left raw so the coordinator's frozen schema gate rejects
   * the whole preview; nothing is guessed or silently dropped.
   */
  canonicalizeHealingPreview(
    sourceId: string,
    previewPayloads: readonly unknown[],
    observedAt = iso(this.#now()),
  ): unknown[] {
    const context = this.#recoveryContexts.get(sourceId);
    if (context === undefined) return [...previewPayloads];
    if (context.kind === "index") {
      return previewPayloads.map((payload) => {
        const mapped = this.#rowMapper.map(payload, observedAt);
        return mapped.ok &&
          mapped.record.entityType === "player" &&
          mapped.record.season === context.season
          ? mapped.record
          : payload;
      });
    }

    const identity =
      context.playerExternalId !== null && context.sourceUrl !== null
        ? {
            playerExternalId: context.playerExternalId,
            sourceUrl: context.sourceUrl,
          }
        : resolveMatchIdentityFromRows(
            previewPayloads,
            context.playerName,
            context.compId,
          );
    if (identity === null) return [...previewPayloads];
    context.playerExternalId = identity.playerExternalId;
    context.sourceUrl = identity.sourceUrl;

    const mapper = new StatBunkerMatchRowMapper(sourceId);
    return previewPayloads.map((payload) => {
      const mapped = mapper.map(payload, {
        playerId: context.playerId,
        playerExternalId: identity.playerExternalId,
        playerName: context.playerName,
        playerTeam: context.playerTeam,
        season: context.season,
        sourceUrl: identity.sourceUrl,
        observedAt,
      });
      return mapped.ok ? mapped.record : payload;
    });
  }

  /**
   * Rerun the exact target that opened a player-index or player-match drift
   * incident after the existing preview and human-approval gates pass.
   */
  async verifyRecovery(
    sourceId: string,
  ): Promise<PlayerExperienceRecoveryVerification> {
    const context = this.#recoveryContexts.get(sourceId);
    if (context === undefined) {
      throw new Error(`No remembered player-experience target for ${sourceId}`);
    }
    const quarantinesBefore =
      this.pipeline.quarantines.listBySource(sourceId).length;

    if (context.kind === "index") {
      const refreshed = await this.refreshIndex(context.season);
      const quarantinedCount =
        this.pipeline.quarantines.listBySource(sourceId).length -
        quarantinesBefore;
      const snapshots = this.pipeline.snapshots
        .listUniqueEntityIds()
        .flatMap((entityId) => {
          const snapshot = this.pipeline.snapshots.latest(entityId);
          return snapshot !== null &&
            snapshot.sourceId === sourceId &&
            snapshot.record.entityType === "player" &&
            snapshot.record.season === context.season
            ? [snapshot]
            : [];
        });
      return {
        success:
          refreshed.acceptedCount > 0 &&
          refreshed.quarantinedCount === 0 &&
          quarantinedCount === 0,
        validRecordCount: refreshed.acceptedCount,
        quarantinedCount,
        sampleEntityIds: snapshots
          .map((snapshot) => snapshot.entityId)
          .slice(0, 20),
        payloadHashes: snapshots
          .map((snapshot) => snapshot.payloadHash)
          .slice(0, 20),
      };
    }

    const player = this.#index.get(context.playerId);
    const seasonMeta = resolveVerifiedStatBunkerSeason(context.season);
    const seasonProfile = player?.seasonProfiles.get(context.season);
    if (
      player === undefined ||
      seasonMeta === null ||
      seasonProfile === undefined
    ) {
      throw new Error(
        `Remembered recovery target ${sourceId} no longer has its verified player-season index context`,
      );
    }
    const request = GenerateRequestSchema.parse({
      schemaVersion: 1,
      playerId: context.playerId,
      season: context.season,
    });
    const run = this.#startRun(player, seasonMeta, context.collectionTargetUrl);
    this.#enterStage(
      run,
      "finding_player",
      `Recovery matched "${player.playerName}" in the cached index.`,
    );
    this.#completeLastStage(
      run,
      `Reusing the exact incident target for ${seasonMeta.label}.`,
    );
    this.#enterStage(
      run,
      "starting_collector",
      `Recovery collection authorized against ${context.collectionTargetUrl}`,
    );
    this.#saveRun(run);
    const result = await this.#completeGeneration(
      request,
      player,
      seasonProfile,
      seasonMeta,
      run,
      this.getLatestCard(context.playerId, context.season),
      context.collectionTargetUrl,
      sourceId,
    );
    const quarantinedCount =
      this.pipeline.quarantines.listBySource(sourceId).length -
      quarantinesBefore;
    const matches = this.getMatches(context.playerId, context.season).rows;
    const matchSnapshots = matches.flatMap((match) => {
      const snapshot = this.pipeline.snapshots.latest(match.matchId);
      return snapshot === null ? [] : [snapshot];
    });
    const card = result.cardBundle;
    return {
      success:
        result.outcome === "collected" &&
        matches.length > 0 &&
        quarantinedCount === 0,
      validRecordCount: matches.length + (card === null ? 0 : 1),
      quarantinedCount,
      sampleEntityIds: [
        ...matches.map((match) => match.matchId),
        ...(card === null ? [] : [card.playerId]),
      ].slice(0, 20),
      payloadHashes: [
        ...matchSnapshots.map((snapshot) => snapshot.payloadHash),
        ...(card === null ? [] : [card.provenance.snapshotHash]),
      ].slice(0, 20),
    };
  }

  /** Resolved run status with its truthful stage history. */
  getRun(runId: string): ScrapeRun | null {
    return this.#runs.get(runId) ?? null;
  }

  /** Stored card by id, with freshness evaluated against the current clock. */
  getCard(cardId: string): CardBundle | null {
    const stored = this.#cardsById.get(cardId);
    return stored === undefined ? null : this.#withCurrentFreshness(stored);
  }

  /** Newest stored bundle for a player+season, or null. Never collects. */
  getLatestCard(playerId: string, season: string): CardBundle | null {
    const versions = this.#bundles.get(playerSeasonKey(playerId, season));
    const latest = versions?.at(-1);
    return latest === undefined ? null : this.#withCurrentFreshness(latest);
  }

  /**
   * Season-bound honest match availability. Missing or incomplete data is
   * explained, never zero-filled; rows can only ever be served for the
   * season they were bound to.
   */
  getMatches(playerId: string, season: string): MatchAvailability {
    const seasonMeta = resolveVerifiedStatBunkerSeason(season);
    if (seasonMeta === null) {
      throw new Error(
        `Season "${season}" is not in the verified StatBunker registry.`,
      );
    }
    const rows =
      this.#matches.get(playerSeasonKey(playerId, seasonMeta.season)) ?? [];
    if (rows.length > 0) {
      return MatchAvailabilitySchema.parse({
        schemaVersion: 1,
        playerId,
        season: seasonMeta.season,
        available: true,
        reason: null,
        rows,
      });
    }
    return MatchAvailabilitySchema.parse({
      schemaVersion: 1,
      playerId,
      season: seasonMeta.season,
      available: false,
      reason: seasonMeta.complete
        ? `No verified match rows are stored for ${seasonMeta.label}; availability is reported honestly rather than zero-filled.`
        : `${seasonMeta.label} is registered as incomplete (season in progress), so match data is not available yet.`,
      rows: [],
    });
  }

  /**
   * Bind match rows to one verified season. Rows carrying a different
   * season are rejected outright — availability stays season-bound.
   */
  addMatchRows(
    playerId: string,
    season: string,
    rows: readonly unknown[],
  ): void {
    const seasonMeta = resolveVerifiedStatBunkerSeason(season);
    if (seasonMeta === null) {
      throw new Error(
        `Season "${season}" is not in the verified StatBunker registry; refusing to bind matches.`,
      );
    }
    const parsed = rows.map((row) => {
      const match = MatchRowSchema.parse(row);
      if (match.season !== seasonMeta.season) {
        throw new Error(
          `Match row declares season ${match.season}, cannot bind it to ${seasonMeta.season}.`,
        );
      }
      return match;
    });
    const key = playerSeasonKey(playerId, seasonMeta.season);
    this.#matches.set(key, [...(this.#matches.get(key) ?? []), ...parsed]);
  }

  /**
   * EXPLICIT demo seeding. This is the only way demo content enters the
   * service; live failures can never fabricate or relabel it. Every demo
   * bundle carries the permanent DEMO DATA origin label. Includes Erling
   * Haaland across several seasons plus duplicate-name players so search
   * disambiguation is demonstrable without touching a provider.
   */
  seedDemoData(): void {
    if (this.#demoSeeded) return;
    this.#demoSeeded = true;

    const observedAt = iso(this.#now());
    const demoSourceId = "cardpulse-demo-seed";
    const demoStats = {
      appearances: 31,
      goals: 27,
      assists: 5,
      yellowCards: 4,
      redCards: 0,
      minutesPlayed: 2554,
    };

    const demoPlayers: Array<{
      playerId: string;
      playerName: string;
      team: TeamRef;
      position: Position;
      nationality: string | null;
      seasons: string[];
      goalsBySeason: Record<
        string,
        { goals: number; assists: number; minutesPlayed: number | null }
      >;
    }> = [
      {
        playerId: "demo:erling-haaland",
        playerName: "Erling Haaland",
        team: { teamId: "demo:manchester-city", name: "Manchester City" },
        position: "forward",
        nationality: "Norway",
        seasons: ["2023", "2024", "2025"],
        goalsBySeason: {
          "2023": { goals: 27, assists: 5, minutesPlayed: 2554 },
          "2024": { goals: 22, assists: 3, minutesPlayed: 2802 },
          "2025": { goals: 19, assists: 6, minutesPlayed: 2380 },
        },
      },
      {
        playerId: "demo:taylor-brooks-kingsley",
        playerName: "Taylor Brooks",
        team: { teamId: "demo:kingsley-rovers-fc", name: "Kingsley Rovers FC" },
        position: "defender",
        nationality: "England",
        seasons: ["2024", "2025"],
        goalsBySeason: {
          "2024": { goals: 2, assists: 1, minutesPlayed: 3060 },
          "2025": { goals: 3, assists: 2, minutesPlayed: 2940 },
        },
      },
      {
        playerId: "demo:taylor-brooks-harbour",
        playerName: "Taylor Brooks",
        team: {
          teamId: "demo:harbour-athletic-fc",
          name: "Harbour Athletic FC",
        },
        position: "midfielder",
        nationality: "Wales",
        seasons: ["2025"],
        goalsBySeason: {
          "2025": { goals: 7, assists: 9, minutesPlayed: 2610 },
        },
      },
    ];

    for (const demo of demoPlayers) {
      for (const season of demo.seasons) {
        const seasonMeta = resolveVerifiedStatBunkerSeason(season);
        if (seasonMeta === null) continue;
        const statLine = demo.goalsBySeason[season];
        if (statLine === undefined) continue;
        const record = PlayerCardSchema.parse({
          schemaVersion: 1,
          entityType: "player",
          playerId: demo.playerId,
          sourceId: demoSourceId,
          externalId: demo.playerId.replace(/^demo:/, ""),
          playerName: demo.playerName,
          team: demo.team,
          position: demo.position,
          shirtNumber: demo.position === "forward" ? 9 : null,
          nationality: demo.nationality,
          season,
          stats: { ...demoStats, ...statLine },
          sourceUrl: seasonMeta.sourceUrl,
          observedAt,
        });
        this.indexPlayers([buildVerifiedSnapshot(record, observedAt)]);
        const bundle = CardBundleSchema.parse({
          schemaVersion: 1,
          cardId: `${record.playerId}:${record.season}:v1`,
          bundleVersion: 1,
          playerId: record.playerId,
          playerName: record.playerName,
          season: record.season,
          stats: record.stats,
          team: record.team,
          position: record.position,
          shirtNumber: record.shirtNumber,
          nationality: record.nationality,
          observedAt,
          provenance: {
            schemaVersion: 1,
            dataOriginLabel: "DEMO DATA",
            sourceId: demoSourceId,
            sourceUrl: seasonMeta.sourceUrl,
            snapshotHash: hashPayload(recordStateForHash(record)),
            snapshotVersion: 1,
            collectedAt: observedAt,
            collectorId: REDACTED_COLLECTOR_ID,
          },
          freshness: this.#evaluateFreshness(Date.parse(observedAt)),
        });
        this.#appendBundle(bundle);
      }
    }

    const season2024 = resolveVerifiedStatBunkerSeason("2024");
    const season2025 = resolveVerifiedStatBunkerSeason("2025");
    if (season2024 === null || season2025 === null) {
      throw new Error("Verified StatBunker registry is missing seeded seasons");
    }

    this.addMatchRows("demo:erling-haaland", "2024", [
      {
        schemaVersion: 1,
        matchId: "demo-match-2024-01",
        season: "2024",
        playedOn: "2025-02-08",
        competition: "Premier League",
        homeTeam: "Manchester City",
        awayTeam: "Arsenal",
        homeGoals: 3,
        awayGoals: 1,
        playerTeam: "Manchester City",
        opponent: "Arsenal",
        venue: "home",
        playerGoals: 2,
        playerAssists: 0,
        playerMinutes: 90,
        sourceUrl: season2024.sourceUrl,
      },
    ]);
    this.addMatchRows("demo:erling-haaland", "2025", [
      {
        schemaVersion: 1,
        matchId: "demo-match-2025-01",
        season: "2025",
        playedOn: "2025-12-14",
        competition: "Premier League",
        homeTeam: "Liverpool",
        awayTeam: "Manchester City",
        homeGoals: 1,
        awayGoals: 2,
        playerTeam: "Manchester City",
        opponent: "Liverpool",
        venue: "away",
        playerGoals: 1,
        playerAssists: 0,
        playerMinutes: 90,
        sourceUrl: season2025.sourceUrl,
      },
      {
        schemaVersion: 1,
        matchId: "demo-match-2025-02",
        season: "2025",
        playedOn: "2026-01-11",
        competition: "Premier League",
        homeTeam: "Manchester City",
        awayTeam: "Chelsea",
        homeGoals: 2,
        awayGoals: 2,
        playerTeam: "Manchester City",
        opponent: "Chelsea",
        venue: "home",
        playerGoals: 1,
        playerAssists: 1,
        playerMinutes: 90,
        sourceUrl: season2025.sourceUrl,
      },
    ]);
    // Deliberately NO match rows for 2023 (none stored) and 2026 (incomplete):
    // both must report honest unavailability.
  }

  #startRun(
    player: IndexedPlayer,
    seasonMeta: VerifiedSeasonMetadata,
    sourceUrl: string,
  ): RunDraft {
    const draft: RunDraft = {
      runId: randomUUID(),
      playerId: player.playerId,
      playerName: player.playerName,
      season: seasonMeta.season,
      sourceUrl,
      requestedAt: this.#now(),
      stageHistory: [],
      currentStage: null,
      terminalStatus: null,
      failureReason: null,
      cardId: null,
    };
    return draft;
  }

  #enterStage(
    run: RunDraft,
    stage: ScrapeStageRecord["stage"],
    detail: string | null,
  ): void {
    run.currentStage = stage;
    run.stageHistory.push({
      stage,
      enteredAt: iso(this.#now()),
      completedAt: null,
      detail,
    });
  }

  #completeLastStage(run: RunDraft, detail: string): void {
    const last = run.stageHistory.at(-1);
    if (last === undefined || last.completedAt !== null) return;
    last.completedAt = iso(this.#now());
    last.detail = detail;
  }

  #failRun(
    run: RunDraft,
    preserved: CardBundle | null,
    reason: string,
  ): GenerateResult {
    this.#completeLastStage(run, reason);
    run.failureReason = reason;
    run.terminalStatus = "failed";
    run.currentStage = null;
    run.cardId = null;
    this.#saveRun(run);
    return GenerateResultSchema.parse({
      schemaVersion: 1,
      outcome: "failed",
      playerId: run.playerId,
      season: run.season,
      runId: run.runId,
      cardBundle: preserved,
      failureReason: reason,
    });
  }

  #saveRun(run: RunDraft): void {
    this.#runs.set(
      run.runId,
      ScrapeRunSchema.parse({
        schemaVersion: 1,
        runId: run.runId,
        playerId: run.playerId,
        playerName: run.playerName,
        season: run.season,
        sourceUrl: run.sourceUrl,
        requestedAt: iso(run.requestedAt),
        stageHistory: run.stageHistory,
        currentStage: run.currentStage,
        terminalStatus: run.terminalStatus,
        failureReason: run.failureReason,
        cardId: run.cardId,
      }),
    );
  }

  #storeBundle(
    record: PlayerCard,
    batch: PlayerExperienceCollectionBatch,
    observedAt: string,
    provenanceSourceId = record.sourceId,
  ): CardBundle {
    const key = playerSeasonKey(record.playerId, record.season);
    const bundleVersion = (this.#bundles.get(key)?.length ?? 0) + 1;
    const snapshot = this.pipeline.snapshots.latest(entityIdOf(record));
    const bundle = CardBundleSchema.parse({
      schemaVersion: 1,
      cardId: `${record.playerId}:${record.season}:v${bundleVersion}`,
      bundleVersion,
      playerId: record.playerId,
      playerName: record.playerName,
      season: record.season,
      stats: record.stats,
      team: record.team,
      position: record.position,
      shirtNumber: record.shirtNumber,
      nationality: record.nationality,
      observedAt,
      provenance: CardProvenanceSchema.parse({
        schemaVersion: 1,
        dataOriginLabel: "LIVE PROVIDER",
        sourceId: provenanceSourceId,
        sourceUrl: record.sourceUrl,
        snapshotHash:
          snapshot?.payloadHash ?? hashPayload(recordStateForHash(record)),
        snapshotVersion: snapshot?.version ?? 1,
        collectedAt: observedAt,
        collectorId: redactCollectorId(batch.collectorId),
      }),
      freshness: this.#evaluateFreshness(Date.parse(observedAt)),
    });
    this.#appendBundle(bundle);
    return bundle;
  }

  #appendBundle(bundle: CardBundle): void {
    const key = playerSeasonKey(bundle.playerId, bundle.season);
    this.#bundles.set(key, [...(this.#bundles.get(key) ?? []), bundle]);
    this.#cardsById.set(bundle.cardId, bundle);
  }

  #withCurrentFreshness(stored: CardBundle): CardBundle {
    return CardBundleSchema.parse({
      ...stored,
      freshness: this.#evaluateFreshness(
        Date.parse(stored.freshness.fetchedAt),
      ),
    });
  }

  #evaluateFreshness(fetchedAtMs: number): CacheFreshness {
    const now = this.#now();
    const ageSeconds = Math.max(
      0,
      Math.floor((now.getTime() - fetchedAtMs) / 1000),
    );
    return CacheFreshnessSchema.parse({
      schemaVersion: 1,
      state: ageSeconds < this.#ttlSeconds ? "fresh" : "stale",
      fetchedAt: iso(new Date(fetchedAtMs)),
      ttlSeconds: this.#ttlSeconds,
      ageSeconds,
      evaluatedAt: iso(now),
    });
  }
}

/** Wrap one validated record into a contract-valid football snapshot. */
export function buildVerifiedSnapshot(
  record: FootballRecord,
  observedAt: string,
): FootballSnapshot {
  return FootballSnapshotSchema.parse({
    schemaVersion: 1,
    snapshotId: randomUUID(),
    entityId: entityIdOf(record),
    entityType: record.entityType,
    sourceId: record.sourceId,
    version: 1,
    observedAt,
    payloadHash: hashPayload(recordStateForHash(record)),
    record,
  });
}
