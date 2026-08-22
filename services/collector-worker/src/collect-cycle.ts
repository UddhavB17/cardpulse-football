import {
  validPlayerFixture,
  demoRecordsFor,
} from "@bidsentinel/contracts/fixtures";
import { mapRawRowToFootballRecord } from "@bidsentinel/brightdata";

import { createRuntimeFromEnv, runConfiguredCollection } from "./runtime.js";

async function main() {
  const runtime = createRuntimeFromEnv();
  if (runtime.mode === "live") {
    const summary = await runConfiguredCollection(runtime);
    console.log(JSON.stringify({ mode: "live", ...summary }, null, 2));
    return;
  }

  const receivedAt = new Date().toISOString();
  const rawRows = [
    ...demoRecordsFor("valid").map((record) => ({
      ...record,
      sourceId: runtime.sourceId,
      observedAt: receivedAt,
    })),
    {
      entityType: "player",
      playerId: `${runtime.sourceId}:player:broken-row`,
      status: "open",
      url: "https://data.football-demo.test/players/broken-row",
    },
    {
      ...validPlayerFixture,
      playerId: `${runtime.sourceId}:player:bad-goals`,
      sourceId: runtime.sourceId,
      observedAt: receivedAt,
      stats: { ...validPlayerFixture.stats, goals: "eighteen" },
    },
  ];
  const payloads = rawRows.map((row) =>
    mapRawRowToFootballRecord(row, runtime.sourceId, receivedAt),
  );
  const results = await runtime.pipeline.processBatchWithHealing(
    payloads,
    {
      sourceId: runtime.sourceId,
      extractorVersion: "mock-collector",
      observedAt: receivedAt,
    },
    1,
    false,
  );

  console.log(
    JSON.stringify(
      {
        mode: "mock",
        configurationIssues: runtime.configurationIssues,
        outcomes: results.map((result) => result.outcome),
        quarantinedExtractions: runtime.pipeline.quarantines.listBySource(
          runtime.sourceId,
        ).length,
        sourceState: runtime.pipeline.sourceHealth.get(runtime.sourceId)?.state,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[CardPulse] Collection cycle failed: ${message}`);
  process.exitCode = 1;
});
