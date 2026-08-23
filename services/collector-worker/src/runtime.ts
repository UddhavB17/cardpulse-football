import { createHash, timingSafeEqual } from "node:crypto";

import {
  BrightDataApiError,
  BrightDataCollectionProvider,
  BrightDataHealingProvider,
  DEFAULT_STATBUNKER_SOURCE_ID,
  MockBrightDataHealingProvider,
  STATBUNKER_SOURCE_PROFILE,
  createStatBunkerPipelineRowMapper,
  statBunkerSourceIdMatches,
  type FootballCollectionBatch,
  type FootballCollectionProvider,
} from "@bidsentinel/brightdata";
import { CollectorIdSchema, type FootballRecord } from "@bidsentinel/contracts";
import { validPlayerFixture } from "@bidsentinel/contracts/fixtures";
import { hashPayload } from "@bidsentinel/validation";

import {
  SelfHealingCoordinator,
  type RecoveryVerification,
} from "./healing-coordinator.js";
import { CardPulsePipeline } from "./pipeline.js";

export type RuntimeMode = "live" | "mock";

/** Deterministic preview/baseline record used by mock-mode demo flows. */
export function buildMockPreviewRecord(sourceId: string): FootballRecord {
  const playerId = validPlayerFixture.playerId.replace(
    /^openligadb:/,
    `${sourceId}:`,
  );
  return {
    ...structuredClone(validPlayerFixture),
    sourceId,
    playerId,
    team: {
      ...validPlayerFixture.team,
      teamId: validPlayerFixture.team.teamId.replace(
        /^openligadb:/,
        `${sourceId}:`,
      ),
    },
    sourceUrl: validPlayerFixture.sourceUrl.replace(
      /^https:\/\/data\.football-demo\.test\/openligadb/,
      `https://data.football-demo.test/${sourceId}`,
    ),
  };
}

export interface CardPulseRuntime {
  mode: RuntimeMode;
  pipeline: CardPulsePipeline;
  coordinator: SelfHealingCoordinator;
  collectionProvider: FootballCollectionProvider | null;
  sourceId: string;
  collectorId: string | null;
  targetUrl: string | null;
  configurationIssues: string[];
  liveMutationsEnabled: boolean;
  operatorTokenHash: string | null;
}

export interface CollectionRunSummary extends RecoveryVerification {
  sourceId: string;
  collectorId: string;
  outcomes: Array<"accepted" | "quarantined">;
}

export function createRuntimeFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): CardPulseRuntime {
  const apiToken = env.BRIGHT_DATA_API_TOKEN?.trim() ?? "";
  const rawCollectorId = env.BRIGHT_DATA_COLLECTOR_ID?.trim() ?? "";
  const targetUrl = env.BRIGHT_DATA_TARGET_URL?.trim() ?? "";
  // Source profile selects the named mapping boundary applied to dataset
  // rows. Unset/empty keeps the historical generic behavior; "statbunker"
  // routes rows through the StatBunker boundary with its standardized
  // default source ID. Profiles change mapping only, never transport,
  // collector-ID handling, healing, or mock-mode safety.
  const sourceProfile = (env.CARDPULSE_SOURCE_PROFILE ?? "")
    .trim()
    .toLowerCase();
  const profileIssues: string[] = [];
  let profileDefaultSourceId = "openligadb";
  if (sourceProfile === STATBUNKER_SOURCE_PROFILE) {
    profileDefaultSourceId = DEFAULT_STATBUNKER_SOURCE_ID;
  } else if (sourceProfile !== "" && sourceProfile !== "generic") {
    profileIssues.push(
      `CARDPULSE_SOURCE_PROFILE "${sourceProfile}" is not a recognized source profile; using the generic mapper`,
    );
  }
  const sourceId =
    env.CARDPULSE_SOURCE_ID?.trim() ||
    env.BIDSENTINEL_SOURCE_ID?.trim() ||
    profileDefaultSourceId;
  const liveMutationFlag = (
    env.CARDPULSE_ENABLE_LIVE_MUTATIONS ??
    env.BIDSENTINEL_ENABLE_LIVE_MUTATIONS ??
    ""
  )
    .trim()
    .toLowerCase();
  const operatorToken = (
    env.CARDPULSE_OPERATOR_TOKEN ??
    env.BIDSENTINEL_OPERATOR_TOKEN ??
    ""
  ).trim();
  const hasStrongOperatorToken = operatorToken.length >= 32;
  const operatorTokenHash = hasStrongOperatorToken
    ? createHash("sha256").update(operatorToken).digest("hex")
    : null;

  // The collector ID is a first-class c_* value; a malformed ID is reported
  // as a configuration issue instead of being forwarded to Bright Data.
  const collectorIdParsed = CollectorIdSchema.safeParse(rawCollectorId);
  const collectorId = collectorIdParsed.success ? rawCollectorId : "";

  const missing = [
    ["BRIGHT_DATA_API_TOKEN", apiToken],
    ["BRIGHT_DATA_COLLECTOR_ID", rawCollectorId],
    ["BRIGHT_DATA_TARGET_URL", targetUrl],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => `${name} is not configured`);
  if (rawCollectorId !== "" && !collectorIdParsed.success) {
    missing.push(
      "BRIGHT_DATA_COLLECTOR_ID must be a first-class c_* collector ID",
    );
  }

  const pipeline = new CardPulsePipeline();
  if (missing.length > 0) {
    // Deterministic mock mode: clearly labeled as mock, no live calls.
    const mockPreview = buildMockPreviewRecord(sourceId);
    const mockHealing = new MockBrightDataHealingProvider([mockPreview]);
    const coordinator = new SelfHealingCoordinator(mockHealing, {
      pollIntervalMs: 0,
    });
    pipeline.healingCoordinator = coordinator;
    return {
      mode: "mock",
      pipeline,
      coordinator,
      collectionProvider: null,
      sourceId,
      collectorId: collectorId === "" ? null : collectorId,
      targetUrl: null,
      configurationIssues: [...missing, ...profileIssues],
      liveMutationsEnabled: false,
      operatorTokenHash: null,
    };
  }

  // Named source profiles own their row boundary. The StatBunker boundary is
  // selected either explicitly via CARDPULSE_SOURCE_PROFILE=statbunker or
  // implicitly when the resolved source ID is the standardized StatBunker
  // one. Rows it rejects fall back to the raw row so pipeline quarantine and
  // drift signals stay authoritative.
  const useStatBunkerBoundary =
    sourceProfile === STATBUNKER_SOURCE_PROFILE ||
    statBunkerSourceIdMatches(sourceId);
  const collectionProvider = new BrightDataCollectionProvider({
    apiToken,
    collectorId,
    ...(useStatBunkerBoundary
      ? { rowMapper: createStatBunkerPipelineRowMapper() }
      : {}),
  });
  const healingProvider = new BrightDataHealingProvider({ apiToken });
  const coordinator = new SelfHealingCoordinator(healingProvider);
  pipeline.healingCoordinator = coordinator;
  return {
    mode: "live",
    pipeline,
    coordinator,
    collectionProvider,
    sourceId,
    collectorId,
    targetUrl,
    configurationIssues: [
      ...profileIssues,
      ...(liveMutationFlag !== "true"
        ? ["CARDPULSE_ENABLE_LIVE_MUTATIONS is not true"]
        : []),
      ...(!hasStrongOperatorToken
        ? ["CARDPULSE_OPERATOR_TOKEN must contain at least 32 characters"]
        : []),
    ],
    liveMutationsEnabled: liveMutationFlag === "true" && hasStrongOperatorToken,
    operatorTokenHash,
  };
}

export function isAuthorizedOperatorToken(
  runtime: CardPulseRuntime,
  suppliedToken: string | undefined,
): boolean {
  if (!runtime.liveMutationsEnabled || !runtime.operatorTokenHash) return false;
  if (!suppliedToken) return false;
  const suppliedHash = createHash("sha256").update(suppliedToken).digest();
  const expectedHash = Buffer.from(runtime.operatorTokenHash, "hex");
  return timingSafeEqual(expectedHash, suppliedHash);
}

export async function runConfiguredCollection(
  runtime: CardPulseRuntime,
  options: { enableHealing?: boolean } = {},
): Promise<CollectionRunSummary> {
  if (
    runtime.mode !== "live" ||
    !runtime.collectionProvider ||
    !runtime.collectorId ||
    !runtime.targetUrl
  ) {
    throw new Error(
      "Live Bright Data collection is not configured; runtime is explicitly in mock mode",
    );
  }

  const observedAt = new Date().toISOString();
  let batch: FootballCollectionBatch;
  try {
    batch = await runtime.collectionProvider.collect({
      sourceId: runtime.sourceId,
      targetUrl: runtime.targetUrl,
      requestedAt: observedAt,
    });
  } catch (error) {
    const reason =
      error instanceof BrightDataApiError && error.code === "rate_limited"
        ? "rate-limited"
        : error instanceof BrightDataApiError &&
            ["network", "timeout", "api_error"].includes(error.code)
          ? "network-error"
          : "unknown";
    const detail =
      error instanceof Error
        ? error.message
        : "Bright Data collection failed without a structured error";
    runtime.pipeline.recordCollectionFailure(
      runtime.sourceId,
      observedAt,
      reason,
      detail,
    );
    throw error;
  }

  // Same-collector evidence: a batch from any other collector is refused.
  if (batch.collectorId !== runtime.collectorId) {
    throw new Error(
      "Bright Data collection returned an unexpected collector ID; refusing to process the batch",
    );
  }

  const results = await runtime.pipeline.processBatchWithHealing(
    batch.payloads,
    {
      sourceId: batch.sourceId,
      collectorId: batch.collectorId,
      extractorVersion: batch.extractorVersion,
      observedAt: batch.receivedAt,
    },
    1,
    options.enableHealing ?? true,
  );
  const accepted = results.filter((result) => result.outcome === "accepted");
  const quarantinedCount = results.length - accepted.length;
  return {
    sourceId: batch.sourceId,
    collectorId: batch.collectorId,
    outcomes: results.map((result) => result.outcome),
    success: accepted.length > 0 && quarantinedCount === 0,
    validRecordCount: accepted.length,
    quarantinedCount,
    sampleEntityIds: accepted
      .map((result) => (result.outcome === "accepted" ? result.entityId : ""))
      .filter(Boolean)
      .slice(0, 20),
    payloadHashes: accepted
      .map((result) =>
        result.outcome === "accepted" ? hashPayload(result.record) : "",
      )
      .filter(Boolean)
      .slice(0, 20),
  };
}
