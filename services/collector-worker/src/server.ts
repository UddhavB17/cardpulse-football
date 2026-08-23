import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { randomUUID } from "node:crypto";
import type { ZodTypeAny } from "zod";
import { BrightDataApiError } from "@bidsentinel/brightdata";
import {
  ApiHealthResponseSchema,
  PlayerListResponseSchema,
  PlayerDetailResponseSchema,
  TeamListResponseSchema,
  StandingsListResponseSchema,
  ChangeEventListResponseSchema,
  SourceHealthListResponseSchema,
  QuarantineListResponseSchema,
  RuntimeStatusResponseSchema,
  GenerateRequestSchema,
  SourceIdSchema,
  redactCollectorId,
  type FootballRecord,
  type FootballSnapshot,
  type PlayerSummary,
} from "@bidsentinel/contracts";
import { demoRecordsFor } from "@bidsentinel/contracts/fixtures";
import { hashPayload } from "@bidsentinel/validation";
import type { CardPulsePipeline } from "./pipeline.js";
import type { SelfHealingCoordinator } from "./healing-coordinator.js";
import { PlayerExperienceService } from "./player-experience.js";
import {
  createRuntimeFromEnv,
  isAuthorizedOperatorToken,
  runConfiguredCollection,
  type CardPulseRuntime,
} from "./runtime.js";

const MOCK_DEV_COLLECTOR_ID = "c_mock_cardpulse";
const OPERATOR_HEADERS = ["x-cardpulse-operator-token"] as const;

class HttpError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
    public readonly details: unknown[] = [],
  ) {
    super(message);
    this.name = "HttpError";
  }
}

class BadRequestError extends HttpError {
  constructor(message: string) {
    super("invalid_request", 400, message);
  }
}

class NotFoundError extends HttpError {
  constructor(message: string) {
    super("not_found", 404, message);
  }
}

class MethodNotAllowedError extends HttpError {
  constructor(message: string) {
    super("method_not_allowed", 405, message);
  }
}

class ConflictError extends HttpError {
  constructor(message: string) {
    super("conflict", 409, message);
  }
}

class ForbiddenError extends HttpError {
  constructor(message: string) {
    super("forbidden", 403, message);
  }
}

function decodePathSegment(value: string): string {
  try {
    const decoded = decodeURIComponent(value);
    if (decoded.trim() === "") throw new Error("empty");
    return decoded;
  } catch {
    throw new BadRequestError("Route contains an invalid encoded identifier");
  }
}

/** Structurally breaks a demo batch to emulate page-layout drift. */
function driftRecords(sourceId: string): unknown[] {
  return demoRecordsFor("valid").map((record): unknown => {
    const broken: Record<string, unknown> = reattribute(record, sourceId);
    if (record.entityType === "player") {
      delete broken.playerName;
      delete broken.stats;
    } else if (record.entityType === "team") {
      delete broken.name;
    } else {
      delete broken.rank;
    }
    return broken;
  });
}

export function createRequestHandler(
  pipelineInstance: CardPulsePipeline,
  coordinatorInstance: SelfHealingCoordinator,
  runtimeInstance?: CardPulseRuntime,
) {
  const activeRuntime: CardPulseRuntime =
    runtimeInstance ??
    (() => {
      const runtime = createRuntimeFromEnv({});
      return {
        ...runtime,
        pipeline: pipelineInstance,
        coordinator: coordinatorInstance,
        configurationIssues: [
          "Live runtime was not supplied to the request handler",
        ],
      };
    })();
  const playerExperience = new PlayerExperienceService({
    pipeline: activeRuntime.pipeline,
    sourceId: activeRuntime.sourceId,
    collect: async (request) => {
      if (
        activeRuntime.mode !== "live" ||
        activeRuntime.collectionProvider === null ||
        activeRuntime.collectorId === null
      ) {
        throw new Error(
          "Live Bright Data collection is not configured; runtime is explicitly in mock mode",
        );
      }
      try {
        const batch = await activeRuntime.collectionProvider.collect({
          sourceId: request.sourceId,
          targetUrl: request.targetUrl,
          requestedAt: new Date().toISOString(),
        });
        if (batch.collectorId !== activeRuntime.collectorId) {
          throw new Error(
            "Bright Data collection returned an unexpected collector ID; refusing to process the batch",
          );
        }
        return {
          collectorId: batch.collectorId,
          extractorVersion: batch.extractorVersion,
          rawRows: batch.rawPayloads ?? batch.payloads,
        };
      } catch (error) {
        const reason =
          error instanceof BrightDataApiError && error.code === "rate_limited"
            ? "rate-limited"
            : error instanceof BrightDataApiError &&
                ["network", "timeout", "api_error"].includes(error.code)
              ? "network-error"
              : "unknown";
        activeRuntime.pipeline.recordCollectionFailure(
          activeRuntime.sourceId,
          new Date().toISOString(),
          reason,
          error instanceof Error
            ? error.message
            : "Bright Data collection failed without a structured error",
        );
        throw error;
      }
    },
  });
  playerExperience.indexPlayers(
    latestSnapshotsOfType(activeRuntime.pipeline, "player"),
  );
  const requestedHealingSourceId = (url: URL): string => {
    const requested = url.searchParams.get("sourceId")?.trim();
    if (requested === undefined || requested === "") {
      return activeRuntime.sourceId;
    }
    const parsed = SourceIdSchema.safeParse(requested);
    if (!parsed.success) {
      throw new BadRequestError("sourceId must be a valid CardPulse source ID");
    }
    return parsed.data;
  };
  return async (req: IncomingMessage, res: ServerResponse) => {
    const generatedAt = new Date().toISOString();
    const requestId = `req-${randomUUID().replace(/-/g, "").substring(0, 15)}`;

    const origin = req.headers.origin;
    const allowedOrigins = [
      "http://localhost:4173",
      "http://127.0.0.1:4173",
      "http://localhost:3000",
      "http://localhost:5173",
      "http://127.0.0.1:5173",
    ];
    if (origin && allowedOrigins.includes(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type, X-CardPulse-Operator-Token",
      );
    } else if (!origin) {
      res.setHeader("Access-Control-Allow-Origin", "*");
    }

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const sendJson = (status: number, body: unknown) => {
      res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
      });
      res.end(JSON.stringify(body, null, 2));
    };

    const sendError = (error: HttpError) => {
      sendJson(error.status, {
        error: {
          code: error.code,
          status: error.status,
          message: error.message,
          requestId,
          details: error.details,
        },
        generatedAt,
      });
    };

    try {
      const url = new URL(
        req.url ?? "/",
        `http://${req.headers.host || "localhost"}`,
      );
      const path = url.pathname;
      const operatorTokenFrom = (): string | undefined => {
        for (const header of OPERATOR_HEADERS) {
          const value = req.headers[header];
          if (typeof value === "string" && value !== "") return value;
        }
        return undefined;
      };
      const requireLiveMutationAuthorization = () => {
        if (activeRuntime.mode !== "live") return;
        if (!activeRuntime.liveMutationsEnabled) {
          throw new ForbiddenError("Live mutations are disabled");
        }
        if (!isAuthorizedOperatorToken(activeRuntime, operatorTokenFrom())) {
          throw new ForbiddenError("Valid operator authorization is required");
        }
      };

      if (path === "/health") {
        if (req.method !== "GET")
          throw new MethodNotAllowedError("Method not allowed");
        const body = ApiHealthResponseSchema.parse({
          data: {
            schemaVersion: 1,
            service: "cardpulse-api",
            status: "ok",
          },
          generatedAt,
        });
        sendJson(200, body);
        return;
      }

      if (path === "/api/runtime") {
        if (req.method !== "GET") {
          throw new MethodNotAllowedError("Method not allowed");
        }
        const body = RuntimeStatusResponseSchema.parse({
          data: {
            schemaVersion: 1,
            service: "cardpulse-api",
            domain: "football",
            mode: activeRuntime.mode,
            sourceId: activeRuntime.sourceId,
            collectorConfigured: activeRuntime.collectorId !== null,
            targetConfigured: activeRuntime.targetUrl !== null,
            liveMutationsEnabled: activeRuntime.liveMutationsEnabled,
            configurationIssues: activeRuntime.configurationIssues,
          },
          generatedAt,
        });
        sendJson(200, body);
        return;
      }

      if (path === "/api/seasons") {
        if (req.method !== "GET") {
          throw new MethodNotAllowedError("Method not allowed");
        }
        sendJson(200, { data: playerExperience.listSeasons(), generatedAt });
        return;
      }

      if (path === "/api/search/players") {
        if (req.method !== "GET") {
          throw new MethodNotAllowedError("Method not allowed");
        }
        for (const key of url.searchParams.keys()) {
          if (key !== "q" && key !== "season") {
            throw new BadRequestError(`Unknown query parameter: ${key}`);
          }
        }
        const query = url.searchParams.get("q") ?? "";
        const season = url.searchParams.get("season")?.trim();
        if (
          season !== undefined &&
          !playerExperience
            .listSeasons()
            .some((entry) => entry.season === season)
        ) {
          throw new BadRequestError(
            `Season "${season}" is not in the verified StatBunker registry`,
          );
        }
        sendJson(200, {
          data: playerExperience.searchPlayers(query, {
            ...(season === undefined ? {} : { season }),
          }),
          generatedAt,
        });
        return;
      }

      if (path === "/api/player-index/refresh") {
        if (req.method !== "POST") {
          throw new MethodNotAllowedError("Method not allowed");
        }
        if (activeRuntime.mode !== "live") {
          throw new ConflictError(
            "Live player-index refresh is unavailable in explicit mock mode",
          );
        }
        requireLiveMutationAuthorization();
        const raw = await parseJsonBody(req);
        if (
          raw === null ||
          typeof raw !== "object" ||
          Array.isArray(raw) ||
          typeof (raw as { season?: unknown }).season !== "string"
        ) {
          throw new BadRequestError(
            "Request body must include a verified string season",
          );
        }
        const season = (raw as { season: string }).season.trim();
        if (
          !playerExperience
            .listSeasons()
            .some((entry) => entry.season === season)
        ) {
          throw new BadRequestError(
            `Season "${season}" is not in the verified StatBunker registry`,
          );
        }
        const refreshed = await playerExperience.refreshIndex(season);
        sendJson(200, { data: refreshed, generatedAt });
        return;
      }

      if (path === "/api/cards/generate") {
        if (req.method !== "POST") {
          throw new MethodNotAllowedError("Method not allowed");
        }
        if (activeRuntime.mode !== "live") {
          throw new ConflictError(
            "Live card generation is unavailable in explicit mock mode; use the clearly labelled browser demo action instead",
          );
        }
        requireLiveMutationAuthorization();
        const raw = await parseJsonBody(req);
        if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
          throw new BadRequestError("Request body must be a JSON object");
        }
        const requestObject = raw as Record<string, unknown>;
        for (const key of Object.keys(requestObject)) {
          if (!["schemaVersion", "playerId", "season", "mode"].includes(key)) {
            throw new BadRequestError(`Unknown request field: ${key}`);
          }
        }
        if (requestObject.mode !== undefined && requestObject.mode !== "live") {
          throw new BadRequestError(
            "The HTTP generation route accepts live mode only; demo data is an explicit browser-side action",
          );
        }
        const parsed = GenerateRequestSchema.safeParse({
          schemaVersion: 1,
          playerId: requestObject.playerId,
          season: requestObject.season,
        });
        if (!parsed.success) {
          throw new BadRequestError("Invalid player card generation request");
        }
        const start = playerExperience.startGenerate(parsed.data);
        if (start.kind === "immediate") {
          if (start.result.outcome === "failed") {
            throw new BadRequestError(
              start.result.failureReason ?? "Card generation failed closed",
            );
          }
          sendJson(200, { data: start.result.cardBundle, generatedAt });
          return;
        }
        void start.completion.catch(() => undefined);
        sendJson(202, {
          data: { runId: start.runId, status: "starting_collector" },
          generatedAt,
        });
        return;
      }

      const scrapeMatch = /^\/api\/scrapes\/([^/]+)$/.exec(path);
      if (scrapeMatch !== null) {
        if (req.method !== "GET") {
          throw new MethodNotAllowedError("Method not allowed");
        }
        const run = playerExperience.getRun(
          decodePathSegment(scrapeMatch[1] ?? ""),
        );
        if (run === null) throw new NotFoundError("Scrape run not found");
        const card =
          run.cardId === null ? null : playerExperience.getCard(run.cardId);
        sendJson(200, {
          data: {
            ...run,
            status: run.terminalStatus ?? run.currentStage ?? "running",
            detail: run.failureReason,
            card,
          },
          generatedAt,
        });
        return;
      }

      const cardMatch = /^\/api\/cards\/([^/]+)$/.exec(path);
      if (cardMatch !== null) {
        if (req.method !== "GET") {
          throw new MethodNotAllowedError("Method not allowed");
        }
        for (const key of url.searchParams.keys()) {
          if (key !== "season") {
            throw new BadRequestError(`Unknown query parameter: ${key}`);
          }
        }
        const playerId = decodePathSegment(cardMatch[1] ?? "");
        const season = url.searchParams.get("season")?.trim();
        if (season === undefined || season === "") {
          throw new BadRequestError("season query parameter is required");
        }
        const card = playerExperience.getLatestCard(playerId, season);
        if (card === null) throw new NotFoundError("Player card not found");
        sendJson(200, { data: card, generatedAt });
        return;
      }

      const seasonsMatch = /^\/api\/players\/([^/]+)\/seasons$/.exec(path);
      if (seasonsMatch !== null) {
        if (req.method !== "GET") {
          throw new MethodNotAllowedError("Method not allowed");
        }
        const playerId = decodePathSegment(seasonsMatch[1] ?? "");
        const seasons = playerExperience.getPlayerSeasons(playerId);
        if (seasons.length === 0) throw new NotFoundError("Player not found");
        sendJson(200, { data: seasons, generatedAt });
        return;
      }

      const matchesMatch = /^\/api\/players\/([^/]+)\/matches$/.exec(path);
      if (matchesMatch !== null) {
        if (req.method !== "GET") {
          throw new MethodNotAllowedError("Method not allowed");
        }
        for (const key of url.searchParams.keys()) {
          if (key !== "season") {
            throw new BadRequestError(`Unknown query parameter: ${key}`);
          }
        }
        const playerId = decodePathSegment(matchesMatch[1] ?? "");
        if (playerExperience.getPlayerSeasons(playerId).length === 0) {
          throw new NotFoundError("Player not found");
        }
        const season = url.searchParams.get("season")?.trim();
        if (season === undefined || season === "") {
          throw new BadRequestError("season query parameter is required");
        }
        let availability;
        try {
          availability = playerExperience.getMatches(playerId, season);
        } catch (error) {
          throw new BadRequestError(
            error instanceof Error ? error.message : "Invalid season",
          );
        }
        const card = playerExperience.getLatestCard(playerId, season);
        const teamName = card?.team.name ?? null;
        sendJson(200, {
          data: {
            ...availability,
            rows: availability.rows.map((row) => ({
              ...row,
              teamName: row.playerTeam ?? teamName,
              opponent:
                row.opponent ??
                (teamName !== null && row.homeTeam === teamName
                  ? row.awayTeam
                  : teamName !== null && row.awayTeam === teamName
                    ? row.homeTeam
                    : null),
              venue:
                row.venue ??
                (teamName !== null && row.homeTeam === teamName
                  ? "home"
                  : teamName !== null && row.awayTeam === teamName
                    ? "away"
                    : null),
              playerGoals: row.playerGoals ?? null,
              playerAssists: row.playerAssists ?? null,
              playerMinutes: row.playerMinutes ?? null,
            })),
          },
          generatedAt,
        });
        return;
      }

      if (path.startsWith("/api/healing/")) {
        if (req.method !== "GET") {
          throw new MethodNotAllowedError("Method not allowed");
        }
        const sourceId = decodeURIComponent(
          path.substring("/api/healing/".length),
        );
        const incident = coordinatorInstance.getIncident(sourceId);
        sendJson(200, {
          data: {
            mode: activeRuntime.mode,
            sourceId,
            state: coordinatorInstance.getHealingState(sourceId),
            incident:
              incident === undefined
                ? null
                : {
                    incidentId: incident.incidentId,
                    collectorId: redactCollectorId(incident.collectorId),
                    state: incident.state,
                    openedAt: incident.openedAt,
                    updatedAt: incident.updatedAt,
                    reason: incident.reason,
                    prompt: incident.prompt ?? null,
                    previewCount: incident.previewPayloads?.length ?? 0,
                    previewValidated:
                      incident.state === "preview_valid" ||
                      incident.state === "approved" ||
                      incident.state === "recovered",
                    evidence: incident.evidence ?? null,
                  },
          },
          generatedAt,
        });
        return;
      }

      if (path === "/api/players") {
        if (req.method !== "GET")
          throw new MethodNotAllowedError("Method not allowed");

        const players = playerSummaries(pipelineInstance);

        const paginated = paginate(
          players,
          url,
          PlayerListResponseSchema,
          generatedAt,
        );
        sendJson(200, paginated);
        return;
      }

      if (path.startsWith("/api/players/")) {
        if (req.method !== "GET")
          throw new MethodNotAllowedError("Method not allowed");
        const entityId = decodeURIComponent(
          path.substring("/api/players/".length),
        );

        const snaps = pipelineInstance.snapshots.list(entityId);
        const latest = snaps[snaps.length - 1];
        if (!latest || latest.record.entityType !== "player") {
          throw new NotFoundError(`Player ${entityId} was not found`);
        }

        const body = PlayerDetailResponseSchema.parse({
          data: {
            ...latest.record,
            latestSnapshot: {
              snapshotId: latest.snapshotId,
              version: latest.version,
              payloadHash: latest.payloadHash,
            },
          },
          generatedAt,
        });
        sendJson(200, body);
        return;
      }

      if (path === "/api/teams") {
        if (req.method !== "GET")
          throw new MethodNotAllowedError("Method not allowed");

        const teams = latestSnapshotsOfType(pipelineInstance, "team")
          .map((latest) => ({
            ...latest.record,
            latestSnapshot: {
              snapshotId: latest.snapshotId,
              version: latest.version,
            },
          }))
          .sort((a, b) => a.name.localeCompare(b.name));

        const paginated = paginate(
          teams,
          url,
          TeamListResponseSchema,
          generatedAt,
        );
        sendJson(200, paginated);
        return;
      }

      if (path === "/api/standings") {
        if (req.method !== "GET")
          throw new MethodNotAllowedError("Method not allowed");

        const standings = latestSnapshotsOfType(pipelineInstance, "standing")
          .map((latest) => ({
            ...latest.record,
            latestSnapshot: {
              snapshotId: latest.snapshotId,
              version: latest.version,
            },
          }))
          .sort(
            (a, b) => a.rank - b.rank || a.teamName.localeCompare(b.teamName),
          );

        const paginated = paginate(
          standings,
          url,
          StandingsListResponseSchema,
          generatedAt,
        );
        sendJson(200, paginated);
        return;
      }

      if (path === "/api/changes") {
        if (req.method !== "GET")
          throw new MethodNotAllowedError("Method not allowed");
        const changes = pipelineInstance.changeEvents.list();

        changes.sort((a, b) => {
          const timeA = Date.parse(a.detectedAt);
          const timeB = Date.parse(b.detectedAt);
          if (timeA !== timeB) return timeB - timeA;
          return a.changeEventId.localeCompare(b.changeEventId);
        });

        const paginated = paginate(
          changes,
          url,
          ChangeEventListResponseSchema,
          generatedAt,
        );
        sendJson(200, paginated);
        return;
      }

      if (path === "/api/sources") {
        if (req.method !== "GET")
          throw new MethodNotAllowedError("Method not allowed");

        const sourceIds = pipelineInstance.sourceHealth.listSourceIds();
        const sources = sourceIds.map((sid: string) => {
          const rawHealth = pipelineInstance.sourceHealth.get(sid);
          if (!rawHealth) throw new Error("Health record not found");

          const healingState = coordinatorInstance.getHealingState(sid);
          let state = rawHealth.state;
          let activeIncident = rawHealth.activeIncident;
          const recoveringStates = [
            "healing_requested",
            "awaiting_approval",
            "preview_valid",
            "preview_invalid",
            "approved",
          ];
          if (recoveringStates.includes(healingState)) {
            state = "recovering";
            const incident = coordinatorInstance.getIncident(sid);
            if (activeIncident === null && incident !== undefined) {
              activeIncident = {
                incidentId: incident.incidentId,
                openedAt: incident.openedAt,
                reason: "schema-drift",
                detail: incident.prompt ?? incident.reason,
              };
            }
          } else if (healingState === "recovered") {
            state = "healthy";
            activeIncident = null;
          } else if (
            healingState === "recovery_failed" ||
            healingState === "rejected"
          ) {
            state = "quarantined";
            const incident = coordinatorInstance.getIncident(sid);
            if (activeIncident === null && incident !== undefined) {
              activeIncident = {
                incidentId: incident.incidentId,
                openedAt: incident.openedAt,
                reason: "schema-drift",
                detail: incident.prompt ?? incident.reason,
              };
            }
          }

          const incident = coordinatorInstance.getIncident(sid);
          const latestRecoveryEvidence =
            incident?.evidence ?? rawHealth.latestRecoveryEvidence;

          return {
            ...rawHealth,
            state,
            activeIncident,
            latestRecoveryEvidence,
          };
        });

        sources.sort((a: { sourceId: string }, b: { sourceId: string }) =>
          a.sourceId.localeCompare(b.sourceId),
        );

        const paginated = paginate(
          sources,
          url,
          SourceHealthListResponseSchema,
          generatedAt,
        );
        sendJson(200, paginated);
        return;
      }

      if (path === "/api/quarantines") {
        if (req.method !== "GET")
          throw new MethodNotAllowedError("Method not allowed");
        const quarantines = pipelineInstance.quarantines.list();

        quarantines.sort(
          (
            a: { observedAt: string; quarantineId: string },
            b: { observedAt: string; quarantineId: string },
          ) => {
            const timeA = Date.parse(a.observedAt);
            const timeB = Date.parse(b.observedAt);
            if (timeA !== timeB) return timeB - timeA;
            return a.quarantineId.localeCompare(b.quarantineId);
          },
        );

        const paginated = paginate(
          quarantines,
          url,
          QuarantineListResponseSchema,
          generatedAt,
        );
        sendJson(200, paginated);
        return;
      }

      if (path === "/api/dev/collect") {
        if (req.method !== "POST")
          throw new MethodNotAllowedError("Method not allowed");

        const mode = url.searchParams.get("mode") ?? "valid";
        if (mode === "live") {
          requireLiveMutationAuthorization();
          if (activeRuntime.mode !== "live") {
            throw new ConflictError(
              "Live collection requested while the server is explicitly in mock mode",
            );
          }
          const summary = await runConfiguredCollection(activeRuntime);
          sendJson(200, {
            success: summary.success,
            mode: "live",
            outcomes: summary.outcomes,
            collectorId: redactCollectorId(summary.collectorId),
          });
          return;
        }
        if (activeRuntime.mode === "live") {
          throw new ConflictError(
            "Fixture collection modes are disabled while the server is in live mode",
          );
        }

        if (!["valid", "drift", "amended"].includes(mode)) {
          throw new BadRequestError(`Unsupported collect mode: ${mode}`);
        }

        const sourceId = activeRuntime.sourceId;
        const observedAt = new Date().toISOString();
        const payloads =
          mode === "drift"
            ? driftRecords(sourceId)
            : mode === "amended"
              ? amendBatchForSource(sourceId)
              : validBatchForSource(sourceId);

        const results = await pipelineInstance.processBatchWithHealing(
          payloads,
          {
            sourceId,
            collectorId: MOCK_DEV_COLLECTOR_ID,
            extractorVersion: "dev-collector",
            observedAt,
          },
          1,
        );

        const accepted = results.filter(
          (result) => result.outcome === "accepted",
        ).length;
        sendJson(200, {
          success: accepted > 0 && accepted === results.length,
          mode,
          outcomes: results.map((result) => result.outcome),
          collectorId: redactCollectorId(MOCK_DEV_COLLECTOR_ID),
          healingState: coordinatorInstance.getHealingState(sourceId),
        });
        return;
      }

      if (path === "/api/dev/heal-progress") {
        if (req.method !== "POST")
          throw new MethodNotAllowedError("Method not allowed");
        requireLiveMutationAuthorization();
        const healingSourceId = requestedHealingSourceId(url);
        const state = coordinatorInstance.getHealingState(healingSourceId);
        if (state !== "healing_requested" && state !== "approved") {
          throw new ConflictError(
            `Cannot poll self-healing progress from state ${state}`,
          );
        }
        const progress = await coordinatorInstance.pollProgress(
          healingSourceId,
          new Date().toISOString(),
        );
        sendJson(200, {
          success: true,
          status: progress.status,
          previewCount: progress.previewResult.length,
          sourceId: healingSourceId,
          healingState: coordinatorInstance.getHealingState(healingSourceId),
        });
        return;
      }

      if (path === "/api/dev/validate-preview") {
        if (req.method !== "POST") {
          throw new MethodNotAllowedError("Method not allowed");
        }
        requireLiveMutationAuthorization();
        const healingSourceId = requestedHealingSourceId(url);
        const state = coordinatorInstance.getHealingState(healingSourceId);
        if (state !== "awaiting_approval" && state !== "preview_invalid") {
          throw new ConflictError(
            `Cannot validate a healing preview from state ${state}`,
          );
        }
        const incident = coordinatorInstance.getIncident(healingSourceId);
        if (!incident) {
          throw new ConflictError(
            "No self-healing incident has a preview to validate",
          );
        }
        const observedAt = new Date().toISOString();
        const previewPayloads = playerExperience.canonicalizeHealingPreview(
          healingSourceId,
          incident.previewPayloads ?? [],
          observedAt,
        );
        const valid = coordinatorInstance.handlePreview(
          healingSourceId,
          previewPayloads,
          1,
          observedAt,
        );
        sendJson(200, {
          success: valid,
          sourceId: healingSourceId,
          previewCount: previewPayloads.length,
          healingState: coordinatorInstance.getHealingState(healingSourceId),
        });
        return;
      }

      if (path === "/api/dev/approve") {
        if (req.method !== "POST")
          throw new MethodNotAllowedError("Method not allowed");
        requireLiveMutationAuthorization();

        const bodyText = await readBodyText(req);
        let body: unknown;
        try {
          body = JSON.parse(bodyText);
        } catch {
          throw new BadRequestError("Request body must be valid JSON");
        }
        if (
          body === null ||
          typeof body !== "object" ||
          !("approve" in body) ||
          typeof (body as { approve?: unknown }).approve !== "boolean"
        ) {
          throw new BadRequestError(
            "Request body must include boolean approve",
          );
        }
        const approve = (body as { approve: boolean }).approve;
        const healingSourceId = requestedHealingSourceId(url);
        const state = coordinatorInstance.getHealingState(healingSourceId);
        if (approve && state !== "preview_valid") {
          throw new ConflictError(
            `Cannot approve self-healing from state ${state}; a schema-valid preview is required`,
          );
        }
        if (
          !approve &&
          !["awaiting_approval", "preview_valid", "preview_invalid"].includes(
            state,
          )
        ) {
          throw new ConflictError(
            `Cannot reject self-healing from state ${state}`,
          );
        }

        const rerunFn = async () => {
          if (activeRuntime.mode === "live") {
            if (playerExperience.hasRecoveryTarget(healingSourceId)) {
              return playerExperience.verifyRecovery(healingSourceId);
            }
            return runConfiguredCollection(activeRuntime, {
              enableHealing: false,
            });
          }
          // A mock rerun emulates a full collection cycle against the
          // deterministic healed roster, matching the verified batch size.
          const results = await pipelineInstance.processBatchWithHealing(
            amendBatchForSource(activeRuntime.sourceId),
            {
              sourceId: activeRuntime.sourceId,
              collectorId: MOCK_DEV_COLLECTOR_ID,
              extractorVersion: "dev-collector",
              observedAt: new Date().toISOString(),
            },
            1,
            false,
          );
          const acceptedResults = results.filter(
            (result) => result.outcome === "accepted",
          );
          return {
            success:
              results.length > 0 && acceptedResults.length === results.length,
            validRecordCount: acceptedResults.length,
            quarantinedCount: results.length - acceptedResults.length,
            sampleEntityIds: acceptedResults
              .map((result) =>
                result.outcome === "accepted" ? result.entityId : "",
              )
              .filter(Boolean)
              .slice(0, 20),
            payloadHashes: acceptedResults.map((result) =>
              result.outcome === "accepted" ? hashPayload(result.record) : "",
            ),
          };
        };

        await coordinatorInstance.approveOrReject(
          healingSourceId,
          approve,
          rerunFn,
          new Date().toISOString(),
        );
        sendJson(200, {
          success:
            coordinatorInstance.getHealingState(healingSourceId) ===
            "recovered",
          sourceId: healingSourceId,
          healingState: coordinatorInstance.getHealingState(healingSourceId),
        });
        return;
      }

      throw new NotFoundError(`Route ${path} not found`);
    } catch (err) {
      if (err instanceof HttpError) {
        sendError(err);
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        sendJson(500, {
          error: {
            code: "internal_error",
            status: 500,
            message: msg,
            requestId,
            details: [],
          },
          generatedAt,
        });
      }
    }
  };
}

function validBatchForSource(sourceId: string): unknown[] {
  return demoRecordsFor("valid").map((record) => reattribute(record, sourceId));
}

function amendBatchForSource(sourceId: string): unknown[] {
  return demoRecordsFor("amended").map((record) =>
    reattribute(record, sourceId),
  );
}

/** Dev batches always carry the runtime source so validation can attribute them. */
function reattribute(
  record: Record<string, unknown>,
  sourceId: string,
): Record<string, unknown> {
  const copy: Record<string, unknown> = structuredClone(record);
  copy.sourceId = sourceId;
  return copy;
}

type EntityType = FootballRecord["entityType"];

function latestSnapshotsOfType<K extends EntityType>(
  pipeline: CardPulsePipeline,
  entityType: K,
): Array<
  FootballSnapshot & { record: Extract<FootballRecord, { entityType: K }> }
> {
  const matches: Array<
    FootballSnapshot & { record: Extract<FootballRecord, { entityType: K }> }
  > = [];
  for (const entityId of pipeline.snapshots.listUniqueEntityIds()) {
    const snaps = pipeline.snapshots.list(entityId);
    const latest = snaps[snaps.length - 1];
    if (latest !== undefined && latest.record.entityType === entityType) {
      matches.push(
        latest as FootballSnapshot & {
          record: Extract<FootballRecord, { entityType: K }>;
        },
      );
    }
  }
  return matches;
}

function playerSummaries(pipeline: CardPulsePipeline): PlayerSummary[] {
  return latestSnapshotsOfType(pipeline, "player")
    .map((latest) => ({
      schemaVersion: 1 as const,
      playerId: latest.record.playerId,
      sourceId: latest.record.sourceId,
      playerName: latest.record.playerName,
      team: latest.record.team,
      position: latest.record.position,
      shirtNumber: latest.record.shirtNumber,
      season: latest.record.season,
      stats: latest.record.stats,
      observedAt: latest.record.observedAt,
      latestSnapshot: {
        snapshotId: latest.snapshotId,
        version: latest.version,
      },
    }))
    .sort(
      (a, b) =>
        b.stats.goals - a.stats.goals ||
        a.playerName.localeCompare(b.playerName),
    );
}

function paginate(
  items: unknown[],
  url: URL,
  responseSchema: ZodTypeAny,
  generatedAt: string,
): unknown {
  const limitParam = url.searchParams.get("limit") ?? "50";
  const offsetParam = url.searchParams.get("offset") ?? "0";

  const limit = parseInt(limitParam, 10);
  const offset = parseInt(offsetParam, 10);

  if (isNaN(limit) || limit < 1 || limit > 100 || isNaN(offset) || offset < 0) {
    throw new BadRequestError("Invalid pagination parameters");
  }

  for (const key of url.searchParams.keys()) {
    if (key !== "limit" && key !== "offset") {
      throw new BadRequestError(`Unknown query parameter: ${key}`);
    }
  }

  const paginatedItems = items.slice(offset, offset + limit);
  const total = items.length;
  const hasMore = offset + paginatedItems.length < total;

  const body = {
    data: paginatedItems,
    pagination: {
      limit,
      offset,
      total,
      hasMore,
    },
    generatedAt,
  };

  return responseSchema.parse(body);
}

async function readBodyText(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString();
    });
    req.on("end", () => {
      resolve(body);
    });
    req.on("error", (err) => {
      reject(err);
    });
  });
}

async function parseJsonBody(req: IncomingMessage): Promise<unknown> {
  const bodyText = await readBodyText(req);
  if (bodyText.trim() === "") {
    throw new BadRequestError("Request body must be valid JSON");
  }
  try {
    return JSON.parse(bodyText) as unknown;
  } catch {
    throw new BadRequestError("Request body must be valid JSON");
  }
}

if (process.env.NODE_ENV !== "test") {
  const parsedPort = Number.parseInt(process.env.PORT ?? "4321", 10);
  const port = Number.isFinite(parsedPort) ? parsedPort : 4321;
  const runtime = createRuntimeFromEnv();
  const server = createServer(
    createRequestHandler(runtime.pipeline, runtime.coordinator, runtime),
  );

  server.listen(port, "127.0.0.1", () => {
    console.warn(
      `CardPulse Football backend API listening on http://127.0.0.1:${port} (${runtime.mode} mode)`,
    );
  });
}
