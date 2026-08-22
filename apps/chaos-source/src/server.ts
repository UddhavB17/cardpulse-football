import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";

import {
  buildRecordsForMode,
  chaosModes,
  fixtureEnvelope,
  isChaosMode,
  type AvailableChaosMode,
  type ChaosMode,
} from "./fixtures.js";

const securityHeaders = {
  "cache-control": "no-store",
  "content-security-policy":
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "x-robots-tag": "noindex, nofollow",
} as const;

function sendJson(
  response: ServerResponse,
  statusCode: number,
  body: unknown,
): void {
  response.writeHead(statusCode, {
    ...securityHeaders,
    "content-type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(body, null, 2));
}

function sendHtml(
  response: ServerResponse,
  statusCode: number,
  body: string,
): void {
  response.writeHead(statusCode, {
    ...securityHeaders,
    "content-type": "text/html; charset=utf-8",
  });
  response.end(body);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

const pageShell = (title: string, content: string): string =>
  `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(title)}</title>
    <style>
      :root { color: #10233f; background: #f4f7fb; font-family: Inter, system-ui, sans-serif; }
      * { box-sizing: border-box; }
      body { margin: 0; }
      main { width: min(1040px, calc(100% - 32px)); margin: 0 auto; padding: 48px 0 72px; }
      header { border-bottom: 1px solid #c9d6e8; margin-bottom: 30px; padding-bottom: 22px; }
      h1 { letter-spacing: -.04em; margin: 0 0 10px; font-size: clamp(2rem, 5vw, 3.25rem); }
      h2, h3, p { margin-top: 0; }
      .eyebrow { color: #0b5c3b; font-size: .75rem; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; }
      .muted { color: #55677e; }
      table { background: #fff; border-collapse: collapse; width: 100%; }
      th, td { border: 1px solid #c3d0e0; padding: 14px 16px; text-align: left; }
      th { background: #eaf1f9; color: #40546c; }
      .player-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 18px; }
      .player-card { border: 1px solid #c3d0e0; border-radius: 16px; background: #fff; box-shadow: 0 14px 38px rgb(16 35 63 / 7%); padding: 22px; }
      .player-card h2 { margin-bottom: 4px; }
      .player-card .club { color: #55677e; margin-top: 0; }
      .statline { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin: 18px 0 0; }
      .stat { border-radius: 10px; background: #eef4fb; padding: 10px 12px; }
      .stat dt { color: #40546c; font-size: .7rem; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
      .stat dd { font-size: 1.45rem; font-weight: 800; margin: 0; }
      .table-card { border: 1px solid #c3d0e0; border-radius: 16px; background: #fff; padding: 22px; margin-top: 26px; }
      button { width: 100%; border: 1px solid #0b5c3b; border-radius: 9px; padding: 12px 16px; color: #fff; background: #0b5c3b; cursor: pointer; font: inherit; font-weight: 750; text-align: left; }
      code { border-radius: 5px; padding: 2px 6px; background: #e4ebf4; }
      .control-list { display: grid; gap: 10px; max-width: 520px; }
      @media (max-width: 680px) { .player-grid { grid-template-columns: 1fr; } th, td { display: block; width: 100%; } }
    </style>
  </head>
  <body>${content}</body>
</html>`;

interface PlayerView {
  playerId: string;
  playerName: string;
  teamName: string;
  position: string;
  goals: number;
  assists: number;
  appearances: number;
}

function playerViews(records: ReturnType<typeof buildRecordsForMode>): {
  players: PlayerView[];
  standings: Array<{
    rank: number;
    teamName: string;
    played: number;
    points: number;
    goalsFor: number;
    goalsAgainst: number;
  }>;
} {
  const players = records
    .filter((record) => record.entityType === "player")
    .map((record) => ({
      playerId: record.playerId,
      playerName: record.playerName,
      teamName: record.team.name,
      position: record.position,
      goals: record.stats.goals,
      assists: record.stats.assists,
      appearances: record.stats.appearances,
    }))
    .sort(
      (left, right) =>
        right.goals - left.goals ||
        left.playerName.localeCompare(right.playerName),
    );

  const standings = records
    .filter((record) => record.entityType === "standing")
    .sort((left, right) => left.rank - right.rank)
    .map((record) => ({
      rank: record.rank,
      teamName: record.teamName,
      played: record.played,
      points: record.points,
      goalsFor: record.goalsFor,
      goalsAgainst: record.goalsAgainst,
    }));

  return { players, standings };
}

function renderTablePage(mode: AvailableChaosMode): string {
  const { players, standings } = playerViews(buildRecordsForMode(mode));
  const playerRows = players
    .map(
      (player) => `<tr data-player-id="${escapeHtml(player.playerId)}">
            <td class="player-name">${escapeHtml(player.playerName)}</td>
            <td class="team-name">${escapeHtml(player.teamName)}</td>
            <td class="position">${escapeHtml(player.position)}</td>
            <td class="stat-goals">${player.goals}</td>
            <td class="stat-assists">${player.assists}</td>
            <td class="stat-appearances">${player.appearances}</td>
          </tr>`,
    )
    .join("\n");
  const standingRows = standings
    .map(
      (entry) => `<tr data-rank="${entry.rank}">
            <td class="rank">${entry.rank}</td>
            <td class="team-name">${escapeHtml(entry.teamName)}</td>
            <td class="played">${entry.played}</td>
            <td class="goals-for">${entry.goalsFor}</td>
            <td class="goals-against">${entry.goalsAgainst}</td>
            <td class="points">${entry.points}</td>
          </tr>`,
    )
    .join("\n");

  return pageShell(
    "Demo league centre",
    `<main data-layout="table"><header>
        <p class="eyebrow">Public demo source</p>
        <h1>Demo league centre</h1>
        <p class="muted">Deterministic OpenLigaDB-inspired demo statistics. Demo data only — no crests or photos.</p>
      </header>
      <section>
        <h2>Player statistics</h2>
        <table aria-label="Player statistics" data-table="players">
          <thead>
            <tr><th>Player</th><th>Team</th><th>Position</th><th>Goals</th><th>Assists</th><th>Appearances</th></tr>
          </thead>
          <tbody>
          ${playerRows}
          </tbody>
        </table>
      </section>
      <section>
        <h2>League table</h2>
        <table aria-label="League table" data-table="standings">
          <thead>
            <tr><th>Rank</th><th>Team</th><th>Played</th><th>GF</th><th>GA</th><th>Points</th></tr>
          </thead>
          <tbody>
          ${standingRows}
          </tbody>
        </table>
      </section>
    </main>`,
  );
}

function renderCardsPage(mode: AvailableChaosMode): string {
  const { players, standings } = playerViews(buildRecordsForMode(mode));
  const cards = players
    .map(
      (
        player,
      ) => `<article class="player-card" data-player-id="${escapeHtml(player.playerId)}">
          <p class="eyebrow">${escapeHtml(player.position)}</p>
          <h2 class="player-name">${escapeHtml(player.playerName)}</h2>
          <p class="club team-name">${escapeHtml(player.teamName)}</p>
          <dl class="statline">
            <div class="stat"><dt>Goals</dt><dd class="stat-goals">${player.goals}</dd></div>
            <div class="stat"><dt>Assists</dt><dd class="stat-assists">${player.assists}</dd></div>
            <div class="stat"><dt>Apps</dt><dd class="stat-appearances">${player.appearances}</dd></div>
          </dl>
        </article>`,
    )
    .join("\n");
  const tableRows = standings
    .map(
      (entry) => `<li class="table-row" data-rank="${entry.rank}">
          <span class="rank">${entry.rank}</span>
          <span class="team-name">${escapeHtml(entry.teamName)}</span>
          <span class="points">${entry.points} pts</span>
          <span class="goals-for">${entry.goalsFor}:${entry.goalsAgainst}</span>
        </li>`,
    )
    .join("\n");

  return pageShell(
    "Demo league centre",
    `<main data-layout="cards"><header>
        <p class="eyebrow">Public demo source</p>
        <h1>Demo league centre</h1>
        <p class="muted">Deterministic OpenLigaDB-inspired demo statistics. Demo data only — no crests or photos.</p>
      </header>
      <section class="player-grid" aria-label="Player statistics">
      ${cards}
      </section>
      <section class="table-card">
        <h2>League table</h2>
        <ol class="league-list" aria-label="League table">
        ${tableRows}
        </ol>
      </section>
    </main>`,
  );
}

function renderUnavailablePage(): string {
  return pageShell(
    "Football portal temporarily unavailable",
    `<main><header>
        <p class="eyebrow">Service notice</p>
        <h1>Temporarily unavailable</h1>
        <p class="muted">The football portal could not serve this request. Please retry later.</p>
      </header></main>`,
  );
}

function renderControlPage(mode: ChaosMode): string {
  const controls = chaosModes
    .map(
      (candidate) => `<form method="post" action="/__control">
        <input type="hidden" name="mode" value="${candidate}">
        <button type="submit"${candidate === mode ? ' aria-current="true"' : ""}>${candidate}${candidate === mode ? " — current" : ""}</button>
      </form>`,
    )
    .join("\n");
  return pageShell(
    "Chaos source controls",
    `<main><header>
        <p class="eyebrow">Development controls</p>
        <h1>Source layout state</h1>
        <p class="muted">The public scraper target remains <code>/players</code>. This control route is for local demonstrations only.</p>
      </header><div class="control-list">${controls}</div></main>`,
  );
}

async function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => {
      body += chunk;
      if (body.length > 10_000) reject(new Error("Request body too large"));
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

async function requestedControlMode(request: IncomingMessage): Promise<string> {
  const body = await readBody(request);
  if ((request.headers["content-type"] ?? "").includes("application/json")) {
    const parsed: unknown = JSON.parse(body);
    return typeof parsed === "object" && parsed !== null && "mode" in parsed
      ? String((parsed as { mode: unknown }).mode)
      : "";
  }
  return new URLSearchParams(body).get("mode") ?? "";
}

function sendMethodNotAllowed(
  response: ServerResponse,
  allowedMethods: readonly string[],
): void {
  response.writeHead(405, {
    ...securityHeaders,
    allow: allowedMethods.join(", "),
    "content-type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify({ error: "method_not_allowed" }, null, 2));
}

export function createChaosServer(initialMode: ChaosMode = "baseline-table") {
  let mode = initialMode;

  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://localhost");

      if (request.method === "GET" && url.pathname === "/health") {
        sendJson(response, 200, {
          status: "ok",
          service: "chaos-source",
          mode,
        });
        return;
      }

      if (request.method === "GET" && url.pathname === "/players") {
        if (mode === "unavailable") {
          sendHtml(response, 503, renderUnavailablePage());
          return;
        }
        sendHtml(response, 200, renderCardsOrTablePage(mode));
        return;
      }

      if (
        request.method === "GET" &&
        (url.pathname === "/fixtures/records" ||
          url.pathname === "/records.json")
      ) {
        const requestedMode = url.searchParams.get("mode") ?? mode;
        if (!isChaosMode(requestedMode)) {
          sendJson(response, 400, {
            error: "unsupported_mode",
            supportedModes: chaosModes,
          });
          return;
        }
        if (requestedMode === "unavailable") {
          sendJson(response, 503, {
            error: "source_unavailable",
            mode: requestedMode,
          });
          return;
        }
        sendJson(response, 200, fixtureEnvelope(requestedMode));
        return;
      }

      if (request.method === "GET" && url.pathname === "/__control") {
        sendHtml(response, 200, renderControlPage(mode));
        return;
      }

      if (request.method === "POST" && url.pathname === "/__control") {
        const nextMode = await requestedControlMode(request);
        if (!isChaosMode(nextMode)) {
          sendJson(response, 400, {
            error: "unsupported_mode",
            supportedModes: chaosModes,
          });
          return;
        }
        mode = nextMode;
        if ((request.headers.accept ?? "").includes("application/json")) {
          sendJson(response, 200, { mode, publicTarget: "/players" });
          return;
        }
        response.writeHead(303, {
          ...securityHeaders,
          location: "/__control",
        });
        response.end();
        return;
      }

      if (url.pathname === "/__control") {
        sendMethodNotAllowed(response, ["GET", "POST"]);
        return;
      }

      if (
        url.pathname === "/health" ||
        url.pathname === "/players" ||
        url.pathname === "/fixtures/records" ||
        url.pathname === "/records.json"
      ) {
        sendMethodNotAllowed(response, ["GET"]);
        return;
      }

      sendJson(response, 404, { error: "not_found" });
    } catch (error) {
      sendJson(response, 400, {
        error: "invalid_request",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });
}

function renderCardsOrTablePage(mode: AvailableChaosMode): string {
  return mode === "baseline-table"
    ? renderTablePage(mode)
    : renderCardsPage(mode);
}

if (process.env.NODE_ENV !== "test") {
  const parsedPort = Number.parseInt(process.env.PORT ?? "4311", 10);
  const port = Number.isFinite(parsedPort) ? parsedPort : 4311;
  const host = process.env.HOST?.trim() || "127.0.0.1";
  const server = createChaosServer();

  server.listen(port, host, () => {
    console.log(`CardPulse chaos source listening on http://${host}:${port}`);
  });
}
