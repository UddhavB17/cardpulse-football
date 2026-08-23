#!/usr/bin/env node
/**
 * Same-ID searchable-card refactor: heal → approve → verify row count.
 * Loads BRIGHT_DATA_* from repo .env (never printed). Billable Bright Data ops.
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const envPath = resolve(root, ".env");

function loadEnv() {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && value !== "") env[key] = value;
  }
  try {
    const text = readFileSync(envPath, "utf8");
    for (const line of text.split("\n")) {
      let t = line.trim();
      if (!t || t.startsWith("#")) continue;
      if (t.startsWith("export ")) t = t.slice(7).trim();
      const i = t.indexOf("=");
      if (i === -1) continue;
      const key = t.slice(0, i).trim();
      let value = t.slice(i + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (value !== "") env[key] = value;
    }
  } catch {
    // .env optional when shell already exported vars
  }
  return env;
}

const SEASON_URLS = {
  2023: "https://www.statbunker.com/competitions/PlayerStandings?comp_id=745",
  2024: "https://www.statbunker.com/competitions/PlayerStandings?comp_id=596",
  2025: "https://www.statbunker.com/competitions/PlayerStandings?comp_id=776",
  2026: "https://www.statbunker.com/competitions/PlayerStandings?comp_id=791",
};

function collectorUrl(collectorId, path) {
  return `https://api.brightdata.com/dca/collectors/${encodeURIComponent(collectorId)}/${path}`;
}

async function bdFetch(token, url, init = {}) {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
    signal: AbortSignal.timeout(120_000),
  });
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { ok: res.ok, status: res.status, body };
}

async function pollProgress(token, collectorId, label) {
  for (let attempt = 1; attempt <= 600; attempt++) {
    const { ok, status, body } = await bdFetch(
      token,
      collectorUrl(collectorId, "refactor_template/progress"),
    );
    if (!ok) {
      console.log(`${label}: progress HTTP ${status}`, body);
      await sleep(3000);
      continue;
    }
    const st = body?.status ?? "unknown";
    const step = body?.step ?? "";
    process.stdout.write(`\r${label}: ${st}${step ? ` (${step})` : ""} [${attempt}]`);
    if (st === "awaiting_approval" || st === "pending_answer") {
      console.log("");
      return body;
    }
    if (
      st === "done" ||
      st === "failed" ||
      st === "rejected" ||
      st === "error" ||
      st === "cancelled" ||
      st === "canceled"
    ) {
      console.log("");
      return body;
    }
    await sleep(3000);
  }
  throw new Error(`${label}: poll timeout`);
}

async function resumeJob(token, collectorId, approve, autoSave) {
  const payload =
    approve && autoSave
      ? { message: true, auto_save: true }
      : { message: approve };
  return bdFetch(token, collectorUrl(collectorId, "resume_automation_job"), {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

async function triggerRefactor(token, collectorId, prompt) {
  return bdFetch(token, collectorUrl(collectorId, "refactor_template"), {
    method: "POST",
    body: JSON.stringify({ prompt, custom_input: [] }),
  });
}

async function triggerCollection(token, collectorId, targetUrl) {
  const trigger = await bdFetch(
    token,
    `https://api.brightdata.com/dca/trigger?collector=${encodeURIComponent(collectorId)}&queue_next=1`,
    {
      method: "POST",
      body: JSON.stringify([{ url: targetUrl }]),
    },
  );
  if (!trigger.ok) {
    throw new Error(`trigger failed: ${trigger.status} ${JSON.stringify(trigger.body)}`);
  }
  const collectionId =
    trigger.body?.collection_id ?? trigger.body?.collectionId ?? trigger.body?.id;
  if (!collectionId) throw new Error("no collection_id in trigger response");

  for (let i = 0; i < 120; i++) {
    await sleep(5000);
    const poll = await bdFetch(
      token,
      `https://api.brightdata.com/dca/dataset?id=${encodeURIComponent(collectionId)}`,
    );
    if (!poll.ok) continue;
    if (Array.isArray(poll.body) && poll.body.length > 0) return poll.body;
    if (poll.body?.status === "running") continue;
  }
  throw new Error("collection poll timeout");
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function validatePreview(preview) {
  if (!Array.isArray(preview) || preview.length === 0) return false;
  const first = preview[0];
  return (
    first?.player_name === "Jarrod Bowen" &&
    first?.appearances === 38 &&
    first?.goals === 9 &&
    first?.assists === 11
  );
}

async function main() {
  const env = loadEnv();
  const token = env.BRIGHT_DATA_API_TOKEN;
  const collectorId = env.BRIGHT_DATA_COLLECTOR_ID;
  if (!token || !collectorId) {
    console.error(
      "Missing BRIGHT_DATA_API_TOKEN or BRIGHT_DATA_COLLECTOR_ID.",
    );
    console.error(
      "Add your Bright Data API token to .env (Account Settings → API Tokens), then rerun.",
    );
    console.error(
      "Collector ID is already set locally; Render has the token if local .env is blank.",
    );
    process.exit(1);
  }

  const promptPath = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "searchable-card-refactor-prompt.txt",
  );
  const prompt = readFileSync(promptPath, "utf8").trim();
  const verifyUrl = SEASON_URLS[2025];

  console.log("1) Checking refactor progress…");
  let progress = await pollProgress(token, collectorId, "progress");

  if (
    progress?.status !== "awaiting_approval" &&
    progress?.status !== "pending_answer"
  ) {
    console.log("2) Starting fresh searchable-card refactor…");
    const trig = await triggerRefactor(token, collectorId, prompt);
    if (!trig.ok) {
      console.error("refactor_template failed:", trig.status, trig.body);
      process.exit(1);
    }
    progress = await pollProgress(token, collectorId, "heal");
  }

  if (
    progress?.status !== "awaiting_approval" &&
    progress?.status !== "pending_answer"
  ) {
    console.error("Not awaiting approval:", progress?.status, progress);
    process.exit(1);
  }

  if (!validatePreview(progress.preview_result)) {
    console.error("Preview failed Jarrod Bowen sentinel — not approving.");
    process.exit(1);
  }
  console.log("3) Preview OK. Trying approve (auto_save)…");

  for (const [label, approve, autoSave] of [
    ["approve+auto_save", true, true],
    ["approve only", true, false],
  ]) {
    const res = await resumeJob(token, collectorId, approve, autoSave);
    console.log(`   ${label}: HTTP ${res.status}`, typeof res.body === "object" ? res.body?.status ?? res.body : res.body);
    if (res.ok) break;
  }

  console.log("4) Post-approve progress…");
  progress = await pollProgress(token, collectorId, "post-approve");

  console.log("5) Running collection on 2025/26 standings…");
  const rows = await triggerCollection(token, collectorId, verifyUrl);
  console.log(`   Row count (776 / 2025): ${rows.length}`);
  if (rows.length > 0) {
    console.log(`   First player: ${rows[0]?.player_name ?? "?"}`);
  }

  if (rows.length <= 10) {
    console.error("Still capped at ~10 rows — approve may not have saved. Open:");
    console.error(`   https://brightdata.com/cp/scrapers/${collectorId}`);
    process.exit(1);
  }

  if (env.APPLY_ALL_SEASONS === "1") {
    console.log("6) Spot-check other seasons (billable)…");
    for (const [season, url] of Object.entries(SEASON_URLS)) {
      if (season === "2025") continue;
      const sample = await triggerCollection(token, collectorId, url);
      console.log(`   ${season}: ${sample.length} rows`);
    }
  } else {
    console.log("6) Skipping other seasons (set APPLY_ALL_SEASONS=1 to include).");
  }

  console.log("Done. Full standings extractor is live on same collector ID.");
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
