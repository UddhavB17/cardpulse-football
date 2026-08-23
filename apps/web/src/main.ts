// CardPulse Football — searchable card generator orchestrator.
//
// Every visual phase of the generation rail is gated by resolved network
// work: the five operations advance only when the requests behind them
// resolve, never on timers. Failures preserve the last printed card and are
// always surfaced truthfully. Provider credentials stay server-side: the
// browser prepares a cached live index and generation requests are rate-limited
// by the API before they can reach Bright Data.

import type {
  CardRecord,
  FootballApiClient,
  GenerateOutcome,
  PlayerSearchResult,
} from "./data-client";
import { DataClientError, HttpFootballApiClient } from "./data-client";
import {
  RAIL_LABELS,
  RAIL_STEPS,
  completedSteps,
  initialFlowState,
  transition,
  type FlowState,
} from "./football/flow";
import { buildCardBundle } from "./football/mapping";
import type { SourceHealthSummary } from "./data-client";
import {
  announceResultState,
  dedupeHits,
  firstMatchSpan,
  handleSearchKey,
  isSearchableQuery,
  normalizeQuery,
  resolveResultState,
  type SearchOption,
} from "./football/search";
import {
  CURRENT_SEASON,
  SEASON_KEYS,
  SEASON_UNAVAILABLE_MESSAGE,
  buildCompareDeltas,
  buildSeasonOptions,
  isInProgressSeason,
  latestAvailableSeason,
  latestCompleteSeason,
  parseSeasonKey,
  seasonCardMissingMessage,
  seasonLabel,
  seasonNotIndexedMessage,
  type StatTotalsLike,
} from "./football/seasons";
import type {
  CardBundle,
  PaletteView,
  ResultState,
  SeasonKey,
} from "./football/types";
import {
  athleteSvg,
  boltIcon,
  checkIcon,
  crestSvg,
  pulseMarkSvg,
  warningIcon,
} from "./football/artwork";
import "./style.css";

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

const appElement = document.querySelector<HTMLElement>("#app");
if (appElement === null) throw new Error("Missing #app root");
const app: HTMLElement = appElement;

const configuredApiBase: string =
  import.meta.env.VITE_API_BASE_URL?.trim() ?? "";
const SEARCH_DEBOUNCE_MS = 250;
const POLL_INTERVAL_MS = 1_500;
const MAX_POLLS = 40;
const MAX_POLL_FAILURES = 3;
const DEFAULT_INDEX_SEASON: SeasonKey = CURRENT_SEASON;

interface AppState {
  client: FootballApiClient;
  searchQuery: string;
  searchLoading: boolean;
  searchFailed: boolean;
  searchHits: SearchOption[];
  searchOpen: boolean;
  searchActiveIndex: number;
  selectedHit: SearchOption | null;
  seasons: ReadonlySet<SeasonKey> | null;
  seasonsError: string | null;
  selectedSeason: SeasonKey | null;
  seasonLoading: boolean;
  seasonMessage: string | null;
  card: CardBundle | null;
  matchesUnavailable: boolean;
  sourceHealth: SourceHealthSummary | null;
  compareOn: boolean;
  compareCard: CardBundle | null;
  compareNote: string | null;
  flipped: boolean;
  flow: FlowState;
  errorMessage: string | null;
  indexRefreshing: boolean;
  indexMessage: string | null;
}

const state: AppState = {
  client: new HttpFootballApiClient(configuredApiBase),
  searchQuery: "",
  searchLoading: false,
  searchFailed: false,
  searchHits: [],
  searchOpen: false,
  searchActiveIndex: -1,
  selectedHit: null,
  seasons: new Set(SEASON_KEYS),
  seasonsError: null,
  selectedSeason: CURRENT_SEASON,
  seasonLoading: false,
  seasonMessage: null,
  card: null,
  matchesUnavailable: false,
  sourceHealth: null,
  compareOn: false,
  compareCard: null,
  compareNote: null,
  flipped: false,
  flow: initialFlowState(),
  errorMessage: null,
  indexRefreshing: false,
  indexMessage: null,
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function qs<T extends Element>(selector: string): T | null {
  return document.querySelector<T>(selector);
}

function errorMessage(error: unknown): string {
  if (error instanceof DataClientError || error instanceof Error) {
    return error.message;
  }
  return "Unknown pipeline failure";
}

function dispatch(event: Parameters<typeof transition>[1]): void {
  state.flow = transition(state.flow, event);
}

function createLiveClient(): HttpFootballApiClient {
  return new HttpFootballApiClient(configuredApiBase);
}

function reducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
motionQuery.addEventListener("change", () => {
  document.body.classList.toggle("reduced-motion", motionQuery.matches);
});
document.body.classList.toggle("reduced-motion", motionQuery.matches);

// ---------------------------------------------------------------------------
// Static shell
// ---------------------------------------------------------------------------

app.innerHTML = `
  <a class="skip-link" href="#main-content">Skip to content</a>
  <header class="topbar shell">
    <span class="wordmark">
      <span class="wordmark-row">${pulseMarkSvg()}<span class="wordmark-title chromatic">Card//Pulse</span></span>
      <span class="wordmark-sub">Football</span>
    </span>
    <div class="topbar-tools" id="topbar-tools"></div>
  </header>
  <main id="main-content" class="shell">
    <section class="hero-copy" aria-labelledby="hero-title">
      <p class="eyebrow">Unofficial fan project · Premier League season cards</p>
      <h1 id="hero-title">Search a player. <em>Print the proof.</em></h1>
      <p class="thesis-note">Pick any Premier League player, choose a season, and generate a collectible
      card from observed source data — every stat stamped with where it came from and when it was seen.
      No player photos, club crests or logos are used anywhere: the art is drawn from scratch.</p>
      <p class="unofficial-note">Unofficial. Not affiliated with the Premier League or any club.</p>
    </section>

    <section class="finder reveal" aria-labelledby="finder-title">
      <h2 id="finder-title" class="visually-hidden">Player finder</h2>
      <div class="combobox-shell">
        <label class="search-label" for="player-input">Find a Premier League player or club</label>
        <div class="search-row">
          <input id="player-input" class="search-input" type="text" role="combobox"
            autocomplete="off" aria-autocomplete="list" aria-expanded="false"
            aria-controls="player-listbox" placeholder="e.g. Erling Haaland or Arsenal…"
            spellcheck="false" />
          <span class="search-spin" id="search-spin" aria-hidden="true"></span>
        </div>
        <ul id="player-listbox" class="search-listbox" role="listbox"
          aria-label="Player suggestions"></ul>
        <p class="sr-status" id="search-status" role="status" aria-live="polite"></p>
        <p id="index-status" class="live-index-status" role="status" aria-live="polite"></p>
      </div>

      <div class="season-row">
        <fieldset class="season-fieldset">
          <legend class="season-legend">Season</legend>
          <div class="season-options" id="season-options" role="radiogroup"
            aria-label="Card season"></div>
        </fieldset>
        <div class="action-row" id="action-row"></div>
      </div>
      <p class="season-note" id="season-note" role="status" aria-live="polite"></p>

      <p class="live-search-note">Search automatically uses a cached Bright Data player directory. Generating a card refreshes that player’s selected-season statistics from the verified source.</p>
    </section>

    <section class="pipeline reveal" aria-label="Card generation pipeline">
      <ol class="rail" id="rail" aria-label="Generation operations"></ol>
      <div class="notice-region" id="notice-region"></div>
    </section>

    <section class="stage-section reveal" aria-label="Player card">
      <div class="card-stage" id="card-stage"></div>
      <p class="sr-status" id="card-status" role="status" aria-live="polite"></p>
      <aside class="side-panel" id="side-panel"></aside>
    </section>

    <details class="drawer reveal" id="provenance-drawer">
      <summary>Provenance &amp; reliability</summary>
      <div class="drawer-body" id="drawer-body"></div>
    </details>
  </main>
  <footer class="site-footer shell">
    <span>CardPulse Football · unofficial hackathon project</span>
    <span>All stats validated structurally before printing</span>
    <span>No player photography, crests or club assets are used</span>
  </footer>
`;

// ---------------------------------------------------------------------------
// Painters
// ---------------------------------------------------------------------------

function paintTopbar(): void {
  const target = qs("#topbar-tools");
  if (target === null) return;
  target.innerHTML = `
    <span class="chip live">
      <span class="dot" aria-hidden="true"></span>Bright Data live
    </span>
    <span class="chip chip-outline">Unofficial</span>`;
}

function highlightName(name: string, query: string): string {
  const span = firstMatchSpan(name, query);
  if (span === null) return escapeHtml(name);
  const [start, end] = span;
  return `${escapeHtml(name.slice(0, start))}<mark>${escapeHtml(
    name.slice(start, end),
  )}</mark>${escapeHtml(name.slice(end))}`;
}

function optionId(index: number): string {
  return `player-option-${index}`;
}

function paintSearchListbox(): void {
  const listbox = qs("#player-listbox");
  const input = qs<HTMLInputElement>("#player-input");
  const status = qs("#search-status");
  const spin = qs("#search-spin");
  if (listbox === null || input === null || status === null || spin === null)
    return;

  const resultState: ResultState = resolveResultState({
    queryLength: normalizeQuery(state.searchQuery).length,
    loading: state.searchLoading,
    failed: state.searchFailed,
    resultCount: state.searchHits.length,
  });
  spin.classList.toggle("active", state.searchLoading);

  let listHtml = "";
  if (state.searchOpen && resultState !== "too-short") {
    if (resultState === "loading" && state.searchHits.length === 0) {
      listHtml = `<li class="list-state" role="status">Searching players…</li>`;
    } else if (resultState === "source-unavailable") {
      listHtml = `<li class="list-state list-error" role="alert">
        Player source unavailable. <button type="button" class="text-button" data-action="retry-search">Retry</button>
      </li>`;
    } else if (resultState === "empty") {
      listHtml = `<li class="list-state">No players found for “${escapeHtml(
        normalizeQuery(state.searchQuery),
      )}”.</li>`;
    } else {
      listHtml = state.searchHits
        .map((hit, index) => {
          const active = state.searchActiveIndex === index;
          const seasons = hit.seasons
            .map((season) => {
              const key = parseSeasonKey(season);
              return key === null ? null : seasonLabel(key);
            })
            .filter((label): label is string => label !== null);
          return `<li id="${optionId(index)}" role="option" class="search-option${
            active ? " active" : ""
          }" aria-selected="${active}" data-index="${index}">
            <span class="option-name">${highlightName(hit.playerName, normalizeQuery(state.searchQuery))}</span>
            <span class="option-meta">
            <span class="option-club">${highlightName(hit.clubName, state.searchQuery)}</span>
              <span class="option-pos">${escapeHtml(hit.positionDisplay)}</span>
              <span class="option-seasons">${escapeHtml(seasons.join(" · ")) || "no seasons listed"}</span>
            </span>
          </li>`;
        })
        .join("");
    }
  }
  listbox.innerHTML = listHtml;
  if (listHtml === "") listbox.setAttribute("hidden", "");
  else listbox.removeAttribute("hidden");

  input.setAttribute(
    "aria-expanded",
    String(state.searchOpen && resultState !== "too-short"),
  );
  const activeId =
    state.searchOpen && state.searchActiveIndex >= 0
      ? optionId(state.searchActiveIndex)
      : "";
  if (activeId !== "") input.setAttribute("aria-activedescendant", activeId);
  else input.removeAttribute("aria-activedescendant");

  const selectedPlayer = state.selectedHit;
  status.textContent =
    selectedPlayer !== null &&
    !state.searchOpen &&
    normalizeQuery(state.searchQuery) ===
      normalizeQuery(selectedPlayer.playerName)
      ? `Selected ${selectedPlayer.playerName}, ${selectedPlayer.clubName}.`
      : resultState === "results" || resultState === "empty"
        ? announceResultState(resultState, state.searchHits.length)
        : announceResultState(resultState);
}

function paintSeasons(): void {
  const wrap = qs("#season-options");
  const note = qs("#season-note");
  if (wrap === null || note === null) return;

  const catalog = state.seasons ?? new Set(SEASON_KEYS);
  const options = buildSeasonOptions(catalog);
  wrap.innerHTML = options
    .map((option) => {
      const checked = state.selectedSeason === option.key;
      const disabled = !option.available;
      return `<button type="button" role="radio" class="season-pill${checked ? " selected" : ""}"
        aria-checked="${checked}" data-season="${option.key}"
        ${disabled ? "disabled" : ""}
        ${option.inProgress ? 'data-in-progress="true"' : ""}>
        ${escapeHtml(option.label)}${option.inProgress ? '<small aria-hidden="true">●</small>' : ""}
      </button>`;
    })
    .join("");

  if (state.seasonsError !== null) {
    note.textContent = state.seasonsError;
  } else if (state.seasonMessage !== null) {
    note.textContent = state.seasonMessage;
  } else if (state.selectedHit === null) {
    note.textContent = `Search uses ${seasonLabel(state.selectedSeason ?? CURRENT_SEASON)}. Pick another verified season if that directory is empty.`;
  } else if (
    state.selectedSeason !== null &&
    isInProgressSeason(state.selectedSeason)
  ) {
    note.textContent = `${seasonLabel(state.selectedSeason)} is the current campaign — cards are incomplete by nature.`;
  } else {
    note.textContent = "";
  }
}

function isBusy(): boolean {
  return state.flow.generation.kind === "running";
}

function paintActions(): void {
  const target = qs("#action-row");
  if (target === null) return;
  const ready = state.selectedHit !== null && state.selectedSeason !== null;
  const busy = isBusy();
  const generateDisabled = !ready || busy;
  target.innerHTML = `
    <button class="btn btn-primary" type="button" data-action="generate"
      ${generateDisabled ? "disabled" : ""} ${busy ? 'aria-busy="true"' : ""}>
      ${boltIcon()} ${busy ? "Scraping live stats…" : "Generate live card"}
    </button>
    ${
      state.card !== null
        ? `<button class="btn btn-dark" type="button" data-action="flip" aria-pressed="${state.flipped}">${checkIcon()} Flip card</button>`
        : ""
    }`;
}

function paintRail(): void {
  const rail = qs("#rail");
  if (rail === null) return;
  const gen = state.flow.generation;
  const done = completedSteps(state.flow);
  const currentStep = gen.kind === "running" ? gen.step : null;
  const failedStep = gen.kind === "failed" ? gen.step : null;
  rail.innerHTML = RAIL_STEPS.map((step) => {
    let status: "pending" | "done" | "current" | "failed" = "pending";
    if (failedStep === step) status = "failed";
    else if (done.has(step)) status = "done";
    else if (currentStep === step) status = "current";
    const icon =
      status === "done"
        ? checkIcon()
        : status === "failed"
          ? warningIcon()
          : "";
    const label = RAIL_LABELS[step];
    return `<li class="${status}" ${
      status === "current" ? 'aria-current="step"' : ""
    }><span class="rail-icon" aria-hidden="true">${icon}</span><strong>${label}</strong>${
      status === "current"
        ? '<span class="rail-live" aria-hidden="true"></span>'
        : ""
    }</li>`;
  }).join("");
  rail.classList.toggle("working", gen.kind === "running");
}

interface BannerSpec {
  tone: "warn" | "bad" | "info";
  role: "alert" | "status";
  html: string;
}

function paintNotices(): void {
  const region = qs("#notice-region");
  if (region === null) return;
  const banners: BannerSpec[] = [];
  if (state.errorMessage !== null) {
    banners.push({
      tone: "bad",
      role: "alert",
      html: `<strong>Generation failed.</strong> ${escapeHtml(state.errorMessage)}
        The last printed card is still shown below.
        <button type="button" class="text-button" data-action="generate">Retry generation</button>`,
    });
  }
  region.innerHTML = banners
    .map(
      (banner) =>
        `<div class="banner ${banner.tone}" role="${banner.role}"><p>${banner.html}</p></div>`,
    )
    .join("");
}

function paletteStyle(palette: PaletteView): string {
  return `--team-primary:${palette.primary};--team-secondary:${palette.secondary};--team-accent:${palette.accent}`;
}

function formatTimestamp(value: string | null): string {
  if (value === null) return "not recorded";
  const parsed = Date.parse(value);
  return Number.isFinite(parsed)
    ? new Intl.DateTimeFormat("en-GB", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(parsed))
    : value;
}

function statLine(label: string, value: number | null): string {
  return `<div class="stat-cell"><dt>${escapeHtml(label)}</dt><dd>${
    value === null ? "n/a" : String(value)
  }</dd></div>`;
}

function renderCardStage(): void {
  const stage = qs("#card-stage");
  if (stage === null) return;
  const card = state.card;
  if (card === null) {
    stage.innerHTML = `<div class="card-placeholder">
      <strong>The press is warm</strong>
      <span>Search a player, pick a season, then generate a card.</span>
      <span class="placeholder-hint">Cards print from observed source data — nothing here is invented.</span>
    </div>`;
    return;
  }

  const front = card.front;
  const back = card.back;
  const progressBadge = front.seasonInProgress
    ? `<span class="progress-badge">Season in progress</span>`
    : "";
  const cardAriaLabel = state.flipped
    ? `Player card, ${front.playerName}. Back: season-bound match details and goal timeline. Press Enter to return to season totals.`
    : `Player card, ${front.playerName}. Front: season totals. Press Enter to flip to match details.`;
  const match = back.headlineMatch;
  const timeline =
    back.timeline.length > 0
      ? `<ol class="goal-timeline">${back.timeline
          .map(
            (entry) =>
              `<li class="tone-${entry.tone}"><strong>${escapeHtml(entry.title)}</strong><span>${escapeHtml(entry.detail)}</span></li>`,
          )
          .join("")}</ol>`
      : `<p class="timeline-empty">${
          back.note ?? "No goal events recorded."
        }</p>`;

  stage.innerHTML = `
  <article class="flip-card${state.flipped ? " flipped" : ""}" id="flip-card"
    tabindex="0" role="button" aria-roledescription="collectible card"
    aria-label="${escapeHtml(cardAriaLabel)}"
    style="${paletteStyle(front.palette)}">
    <div class="card-inner3d">
      <div class="face face-front">
        <header class="card-head">
          <span class="club-line"><span class="club-badge" aria-hidden="true">${escapeHtml(front.clubCode)}</span>${escapeHtml(front.clubName)}</span>
          <span class="card-serial">${escapeHtml(front.serialNumber)} · ${escapeHtml(front.seasonLabel)}</span>
        </header>
        <div class="card-art">
          ${crestSvg({ initials: escapeHtml(front.clubCode), halftoneId: `ht-front-${front.playerId.replace(/[^a-z0-9]/gi, "")}` })}
          ${athleteSvg({ halftoneId: "ht-athlete" })}
          <span class="card-number" aria-hidden="true">${front.shirtNumber ?? "—"}</span>
          ${progressBadge}
        </div>
        <div class="card-body">
          <h3 class="player-name chromatic">${escapeHtml(front.playerName)}</h3>
          <p class="player-meta">
            <span class="position-tag">${escapeHtml(front.positionDisplay)}</span>
            <span>${escapeHtml(front.clubName)}</span>
            <span>${escapeHtml(front.seasonLabel)}${front.seasonInProgress ? " · in progress" : ""}</span>
          </p>
          <dl class="stat-grid">
            ${statLine("Appearances", front.totals.appearances)}
            ${statLine("Goals", front.totals.goals)}
            ${statLine("Assists", front.totals.assists)}
            ${statLine("Minutes", front.totals.minutesPlayed)}
            ${statLine("Yellows", front.totals.yellowCards)}
            ${statLine("Reds", front.totals.redCards)}
          </dl>
          <dl class="attr-grid">
            ${front.attributes
              .map(
                (attr) =>
                  `<div><dt>${escapeHtml(attr.label)}</dt><dd class="attr-bar"><i style="width:${attr.pct}%"></i></dd><dd class="attr-value">${attr.value}</dd></div>`,
              )
              .join("")}
          </dl>
          <p class="verified-line">Source observed: ${escapeHtml(formatTimestamp(front.verifiedAtLabel))}</p>
        </div>
      </div>
      <div class="face face-back">
        <header class="card-head">
          <span class="club-line"><span class="club-badge" aria-hidden="true">${escapeHtml(front.clubCode)}</span>${escapeHtml(front.seasonLabel)} · match sheet</span>
          <span class="card-serial">${escapeHtml(front.serialNumber)}</span>
        </header>
        <div class="card-body back-body">
          ${
            match === null
              ? `<p class="match-empty">${escapeHtml(back.note ?? "No match selected.")}</p>`
              : `<h4 class="match-headline">Top scoring match</h4>
          <p class="match-line">
            <span class="venue-tag">${escapeHtml(match.venue)}</span>
            <strong>${escapeHtml(match.opponent)}</strong>
            <span class="match-score">${escapeHtml(match.scoreLabel ?? "score n/a")}</span>
          </p>
          <p class="match-date">${escapeHtml(match.dateLabel)}</p>
          <dl class="stat-grid compact">
            ${statLine("Goals", match.goals)}
            ${statLine("Assists", match.assists)}
            ${statLine("Minutes", match.minutes)}
          </dl>`
          }
          <h4 class="timeline-head">Goal timeline · ${escapeHtml(front.seasonLabel)}</h4>
          ${timeline}
          <p class="flip-hint">Use the Flip control or press Enter again to return to the totals face.</p>
        </div>
      </div>
    </div>
  </article>`;

  attachTilt(stage.querySelector<HTMLElement>("#flip-card"));
  paintSidePanel();
  paintDrawer();
}

function paintSidePanel(): void {
  const panel = qs("#side-panel");
  if (panel === null) return;
  const card = state.card;
  if (card === null) {
    panel.innerHTML = "";
    return;
  }
  const compareRows = (): string => {
    if (!state.compareOn) return "";
    if (state.compareCard === null) {
      return `<h4 class="panel-title">Season comparison</h4>
        <p class="panel-note">${escapeHtml(
          state.compareNote ?? "Previous-season data is not available.",
        )}</p>`;
    }
    const current: StatTotalsLike | null = card.front.totals;
    const previous = state.compareCard.front.totals;
    const deltas = buildCompareDeltas(current, previous);
    const previousLabel = state.compareCard.front.seasonLabel;
    return `<h4 class="panel-title">Compared with ${escapeHtml(previousLabel)}</h4>
      <table class="compare-table">
        <caption class="visually-hidden">Season over season deltas</caption>
        <thead><tr><th scope="col">Metric</th><th scope="col">This</th><th scope="col">Prev</th><th scope="col">Δ</th></tr></thead>
        <tbody>
          ${deltas
            .map(
              (delta) =>
                `<tr><th scope="row">${escapeHtml(delta.metric)}</th><td>${escapeHtml(delta.currentLabel)}</td><td>${escapeHtml(delta.previousLabel)}</td><td class="delta ${delta.direction}">${escapeHtml(delta.deltaLabel)}</td></tr>`,
            )
            .join("")}
        </tbody>
      </table>`;
  };

  panel.innerHTML = `
    <h4 class="panel-title">${escapeHtml(card.front.playerName)} · ${escapeHtml(card.front.seasonLabel)}</h4>
    <ul class="panel-facts">
      <li><span>Data</span><strong>Live provider</strong></li>
      <li><span>Snapshot</span><strong>${escapeHtml(card.provenance.snapshotVersionLabel)} · ${escapeHtml(card.provenance.snapshotHashShort)}</strong></li>
      <li><span>Scrape run</span><strong>${escapeHtml(card.provenance.scrapeRunLabel)} (${escapeHtml(card.provenance.scrapeStatusLabel)})</strong></li>
      <li><span>Cache</span><strong>${escapeHtml(card.provenance.cacheLabel)}</strong></li>
    </ul>
    <div class="panel-actions">
      <button type="button" class="text-button" data-action="toggle-compare" aria-pressed="${state.compareOn}">
        ${state.compareOn ? "Hide season comparison" : "Compare with previous season"}
      </button>
      <button type="button" class="text-button" data-action="flip">Flip card</button>
    </div>
    ${compareRows()}
    ${
      card.front.seasonInProgress
        ? '<p class="panel-note">Current-season cards stay incomplete until the final whistle of the campaign.</p>'
        : ""
    }`;
}

function paintDrawer(): void {
  const body = qs("#drawer-body");
  const card = state.card;
  if (body === null || card === null) return;
  const p = card.provenance;
  body.innerHTML = `
    <section aria-label="Card provenance">
      <h3>This card</h3>
      <dl class="drawer-stats">
        <div><dt>Source URL</dt><dd>${
          p.sourceUrl === null
            ? "not published"
            : `<a href="${escapeHtml(p.sourceUrl)}" rel="noopener noreferrer" target="_blank">${escapeHtml(p.sourceUrl)}</a>`
        }</dd></div>
        <div><dt>Observed</dt><dd>${escapeHtml(formatTimestamp(p.observedAtLabel))}</dd></div>
        <div><dt>Snapshot</dt><dd>${escapeHtml(p.snapshotVersionLabel)} · ${escapeHtml(p.snapshotHashShort)}</dd></div>
        <div><dt>Collector</dt><dd>${escapeHtml(p.collectorRedacted)} (redacted)</dd></div>
        <div><dt>Scrape run</dt><dd>${escapeHtml(p.scrapeRunLabel)} · ${escapeHtml(p.scrapeStatusLabel)}</dd></div>
        <div><dt>Cache freshness</dt><dd>${escapeHtml(p.cacheLabel)}</dd></div>
      </dl>
    </section>
    <section aria-label="Source health">
      <h3>Source health</h3>
      <dl class="drawer-stats">
        <div><dt>State</dt><dd>${escapeHtml(p.sourceHealthLabel)}</dd></div>
        <div><dt>Healing</dt><dd>${escapeHtml(p.healingLabel)}</dd></div>
        <div><dt>Data label</dt><dd>Live provider</dd></div>
      </dl>
      <p class="drawer-note">Bright Data credentials remain on the server. Public scrape requests are cached, deduplicated and rate-limited before reaching the provider.</p>
    </section>`;
}

function paintLiveIndexStatus(): void {
  const status = qs("#index-status");
  if (status !== null) status.textContent = state.indexMessage ?? "";
  status?.classList.toggle("loading", state.indexRefreshing);
}

function paintAll(): void {
  // Chrome glitch is bound strictly to real in-flight work.
  app.classList.toggle("is-busy", isBusy());
  paintTopbar();
  paintSearchListbox();
  paintSeasons();
  paintActions();
  paintRail();
  paintNotices();
  paintLiveIndexStatus();
  renderCardStage();
}

// ---------------------------------------------------------------------------
// Search flow
// ---------------------------------------------------------------------------

let searchDebounceHandle: number | null = null;
let searchAbort: AbortController | null = null;
let searchSequence = 0;

function cancelPendingSearch(): void {
  if (searchDebounceHandle !== null) {
    window.clearTimeout(searchDebounceHandle);
    searchDebounceHandle = null;
  }
  if (searchAbort !== null) {
    searchAbort.abort();
    searchAbort = null;
  }
}

function scheduleSearch(rawQuery: string): void {
  const query = normalizeQuery(rawQuery);
  state.searchQuery = rawQuery;
  cancelPendingSearch();

  if (!isSearchableQuery(query)) {
    state.searchLoading = false;
    state.searchFailed = false;
    state.searchHits = [];
    state.searchOpen = false;
    state.searchActiveIndex = -1;
    paintSearchListbox();
    return;
  }

  state.searchOpen = true;
  state.searchLoading = true;
  paintSearchListbox();

  searchDebounceHandle = window.setTimeout(() => {
    void executeSearch(query);
  }, SEARCH_DEBOUNCE_MS);
}

async function executeSearch(query: string): Promise<void> {
  const sequence = (searchSequence += 1);
  searchAbort = new AbortController();
  const applyHits = (payload: PlayerSearchResult): void => {
    state.searchFailed = false;
    state.searchLoading = false;
    state.searchHits = dedupeHits(
      payload.results.map((hit): SearchOption => ({
        id: "",
        playerId: hit.playerId,
        playerName: hit.playerName,
        clubName: hit.clubName,
        positionDisplay:
          hit.position === null ? "—" : hit.position.toUpperCase().slice(0, 3),
        seasons: hit.seasons,
      })),
    ).map((hit, index) => ({ ...hit, id: optionId(index) }));
    state.searchOpen = true;
    state.searchActiveIndex = state.searchHits.length > 0 ? 0 : -1;
  };
  try {
    const payload = await state.client.searchPlayers(
      query,
      state.selectedSeason,
      searchAbort.signal,
    );
    if (sequence !== searchSequence) return;
    applyHits(payload);
  } catch (error) {
    if (sequence !== searchSequence) return;
    if (error instanceof DOMException && error.name === "AbortError") return;
    const fallback = latestCompleteSeason();
    if (
      error instanceof DataClientError &&
      error.status === 503 &&
      state.selectedSeason === CURRENT_SEASON &&
      fallback !== CURRENT_SEASON
    ) {
      try {
        const payload = await state.client.searchPlayers(
          query,
          fallback,
          searchAbort.signal,
        );
        if (sequence !== searchSequence) return;
        state.selectedSeason = fallback;
        state.indexMessage = `${seasonLabel(CURRENT_SEASON)} has no verified player rows yet; searching ${seasonLabel(fallback)} instead.`;
        applyHits(payload);
        return;
      } catch (fallbackError) {
        if (sequence !== searchSequence) return;
        if (
          fallbackError instanceof DOMException &&
          fallbackError.name === "AbortError"
        ) {
          return;
        }
        state.searchFailed = true;
        state.searchLoading = false;
        state.searchHits = [];
        state.searchActiveIndex = -1;
        return;
      }
    }
    state.searchFailed = true;
    state.searchLoading = false;
    state.searchHits = [];
    state.searchActiveIndex = -1;
  } finally {
    if (sequence === searchSequence) {
      searchAbort = null;
      paintSearchListbox();
      paintSeasons();
      paintLiveIndexStatus();
    }
  }
}

async function selectHit(hit: SearchOption): Promise<void> {
  state.selectedHit = hit;
  state.searchOpen = false;
  state.searchHits = [];
  state.searchActiveIndex = -1;
  state.searchQuery = hit.playerName;
  state.client = createLiveClient();
  state.errorMessage = null;
  state.compareCard = null;
  state.compareNote = null;
  state.seasonsError = null;
  state.seasonMessage = null;
  const previousSeason = state.selectedSeason;
  const input = qs<HTMLInputElement>("#player-input");
  if (input !== null) input.value = hit.playerName;
  paintAll();

  try {
    const payload = await state.client.getPlayerSeasons(hit.playerId);
    const available = new Set<SeasonKey>();
    for (const raw of payload.seasons) {
      const key = parseSeasonKey(raw);
      if (key !== null) available.add(key);
    }
    state.seasons = available.size > 0 ? available : new Set(SEASON_KEYS);
    state.selectedSeason =
      previousSeason !== null && available.has(previousSeason)
        ? previousSeason
        : (latestAvailableSeason(available) ?? previousSeason ?? CURRENT_SEASON);
    if (state.selectedSeason === null) {
      state.seasonMessage = `${SEASON_UNAVAILABLE_MESSAGE} No catalog season (${SEASON_KEYS.map(seasonLabel).join(", ")}) has verified data for this player.`;
    } else {
      await loadSeasonData(false);
    }
  } catch (error) {
    state.seasons = new Set(SEASON_KEYS);
    state.seasonsError = `${SEASON_UNAVAILABLE_MESSAGE} (${errorMessage(error)})`;
  }
  paintAll();
}

// ---------------------------------------------------------------------------
// Season switching + card reads
// ---------------------------------------------------------------------------

async function loadSeasonData(isSwitch: boolean): Promise<void> {
  const hit = state.selectedHit;
  const season = state.selectedSeason;
  if (hit === null || season === null) return;
  state.seasonLoading = true;
  if (isSwitch) state.seasonMessage = null;
  paintAll();

  try {
    const record = await state.client.getCard(hit.playerId, season);
    if (record === null) {
      // Keep the last printed card visible; explain the gap honestly.
      const indexed = state.seasons?.has(season) ?? false;
      state.seasonMessage = indexed
        ? seasonCardMissingMessage(season)
        : seasonNotIndexedMessage(season);
      state.matchesUnavailable = true;
      state.sourceHealth = null;
      return;
    }
    applyCard(record);
    await hydrateMatches(record);
    state.seasonMessage = null;
    state.compareCard = null;
    state.compareNote = null;
    if (state.compareOn) await refreshCompare();
  } catch (error) {
    state.seasonMessage = `Could not read the ${seasonLabel(season)} card: ${errorMessage(error)}`;
  } finally {
    state.seasonLoading = false;
    paintAll();
  }
}

function applyCard(record: CardRecord): void {
  const seasonKey = parseSeasonKey(record.season) ?? "2025";
  state.card = buildCardBundle({
    payload: record,
    matches: [],
    matchesUnavailable: true,
    sourceHealth: state.sourceHealth,
  });
  state.card.seasonKey = seasonKey;
  state.flipped = false;
  void hydrateSourceHealth(record.sourceId);
}

async function hydrateMatches(record: CardRecord): Promise<void> {
  try {
    const matchesPayload = await state.client.getPlayerMatches(
      record.playerId,
      record.season,
    );
    const seasonKey = parseSeasonKey(record.season) ?? "2025";
    state.matchesUnavailable = !matchesPayload.available;
    state.card = buildCardBundle({
      payload: record,
      matches: matchesPayload.matches,
      matchesUnavailable: !matchesPayload.available,
      sourceHealth: state.sourceHealth,
    });
    if (!matchesPayload.available && matchesPayload.reason !== null) {
      state.card.back.note = matchesPayload.reason;
    }
    state.card.seasonKey = seasonKey;
  } catch {
    state.matchesUnavailable = true;
    if (state.card !== null) {
      const rebuilt = buildCardBundle({
        payload: record,
        matches: [],
        matchesUnavailable: true,
        sourceHealth: state.sourceHealth,
      });
      rebuilt.back.note = "Per-match history could not be loaded right now.";
      state.card = rebuilt;
    }
  }
}

async function hydrateSourceHealth(sourceId: string | null): Promise<void> {
  if (sourceId === null) {
    state.sourceHealth = null;
    return;
  }
  try {
    state.sourceHealth = await state.client.getSourceHealth(sourceId);
  } catch {
    state.sourceHealth = null;
  }
  paintDrawer();
}

async function onSeasonChange(rawKey: string): Promise<void> {
  const key = parseSeasonKey(rawKey);
  if (key === null || key === state.selectedSeason) return;
  state.selectedSeason = key;
  state.errorMessage = null;
  if (state.selectedHit !== null) await loadSeasonData(true);
  else if (isSearchableQuery(normalizeQuery(state.searchQuery))) {
    paintAll();
    await executeSearch(normalizeQuery(state.searchQuery));
  } else paintAll();
}

// ---------------------------------------------------------------------------
// Live index preparation + generation
// ---------------------------------------------------------------------------

async function prepareLiveIndex(): Promise<void> {
  if (state.indexRefreshing) return;
  const client = createLiveClient();
  state.client = client;
  state.indexRefreshing = true;
  state.selectedSeason = DEFAULT_INDEX_SEASON;
  state.indexMessage = `Preparing ${seasonLabel(DEFAULT_INDEX_SEASON)} search directory…`;
  state.errorMessage = null;
  paintAll();
  try {
    await client.refreshPlayerIndex(DEFAULT_INDEX_SEASON);
    state.indexMessage = null;
    const query = normalizeQuery(state.searchQuery);
    if (isSearchableQuery(query)) await executeSearch(query);
  } catch (error) {
    const fallback = latestCompleteSeason();
    if (fallback !== DEFAULT_INDEX_SEASON) {
      try {
        state.indexMessage = `${seasonLabel(DEFAULT_INDEX_SEASON)} is empty; preparing ${seasonLabel(fallback)}…`;
        paintLiveIndexStatus();
        await client.refreshPlayerIndex(fallback);
        state.selectedSeason = fallback;
        state.indexMessage = null;
        const query = normalizeQuery(state.searchQuery);
        if (isSearchableQuery(query)) await executeSearch(query);
      } catch (fallbackError) {
        state.indexMessage = `Live directory unavailable right now; searching will retry automatically. ${errorMessage(fallbackError)}`;
      }
    } else {
      state.indexMessage = `Live directory unavailable right now. ${errorMessage(error)}`;
    }
  } finally {
    state.indexRefreshing = false;
    paintAll();
  }
}

async function runGeneration(): Promise<void> {
  if (isBusy()) return;

  state.client = createLiveClient();

  // Live generation requires an explicit player + verified season.
  if (state.selectedHit === null || state.selectedSeason === null) {
    paintAll();
    return;
  }
  const hit = state.selectedHit;
  const season = state.selectedSeason;
  if (hit === null || season === null) {
    paintAll();
    return;
  }

  state.errorMessage = null;
  state.flipped = false;
  dispatch({ type: "begin", mode: "live" });
  paintAll();

  try {
    // Steps 1–2: the POST acknowledges both the player lookup and collector.
    const outcome: GenerateOutcome = await state.client.generateCard({
      playerId: hit.playerId,
      season,
      mode: "live",
    });
    dispatch({ type: "player-found" });
    let record: CardRecord | null;
    if (outcome.kind === "run") {
      // Async path: poll the genuine scrape status until it settles.
      dispatch({ type: "collector-accepted" });
      paintAll();
      record = await pollUntilCard(outcome.runId, hit.playerId, season);
    } else {
      // Synchronous path: the same response resolved the collector too.
      dispatch({ type: "collector-accepted" });
      record = outcome.card;
    }

    // Step 3: extraction is complete once the record exists.
    dispatch({ type: "extraction-complete" });
    // Step 4: structural validation happens now, before anything renders.
    if (record.playerName.trim() === "") {
      throw new DataClientError("The returned card omitted the player name.");
    }
    dispatch({ type: "validation-passed", cardId: record.playerId });
    paintAll();

    // Step 5: printing — assemble provenance, match history and the view.
    await hydrateSourceHealth(record.sourceId);
    await hydrateMatches(record);
    state.seasonMessage = null;
    dispatch({ type: "card-printed", cardId: record.playerId });
    state.compareCard = null;
    state.compareNote = null;
    if (state.compareOn) void refreshCompare();
  } catch (error) {
    dispatch({ type: "failed", reason: errorMessage(error) });
    state.errorMessage = errorMessage(error);
  } finally {
    paintAll();
  }
}

/** Poll GET /api/scrapes/:runId until terminal; no fake progress, ever. */
function advanceRailFromScrapeStatus(status: string, runId: string): void {
  const normalized = status.trim().toLowerCase().replaceAll("-", "_");
  const rank: Record<string, number> = {
    finding_player: 0,
    starting_collector: 1,
    extracting_statistics: 2,
    validating_data: 3,
    printing_card: 4,
    succeeded: 5,
  };
  const observedRank = rank[normalized];
  if (observedRank === undefined) return;
  if (observedRank >= 1) dispatch({ type: "player-found" });
  if (observedRank >= 2) dispatch({ type: "collector-accepted" });
  if (observedRank >= 3) dispatch({ type: "extraction-complete" });
  if (observedRank >= 4) {
    dispatch({ type: "validation-passed", cardId: runId });
  }
  paintRail();
}

async function pollUntilCard(
  runId: string,
  playerId: string,
  season: string,
): Promise<CardRecord> {
  let consecutiveFailures = 0;
  for (let attempt = 0; attempt < MAX_POLLS; attempt += 1) {
    let snapshot;
    try {
      snapshot = await state.client.getScrapeRun(runId);
      consecutiveFailures = 0;
      advanceRailFromScrapeStatus(snapshot.status, runId);
    } catch (error) {
      consecutiveFailures += 1;
      if (consecutiveFailures >= MAX_POLL_FAILURES) throw error;
      await wait(POLL_INTERVAL_MS);
      continue;
    }

    if (snapshot.progress === "completed") {
      if (snapshot.card !== null) return snapshot.card;
      dispatch({ type: "collector-accepted" });
      const stored = await state.client.getCard(playerId, season);
      if (stored === null) {
        throw new DataClientError(
          "The collector finished but no verified card was stored.",
        );
      }
      return stored;
    }
    if (snapshot.progress === "failed") {
      throw new DataClientError(
        snapshot.detail === null
          ? `Collector run ${runId} reported status "${snapshot.status}".`
          : snapshot.detail,
      );
    }
    await wait(POLL_INTERVAL_MS);
  }
  throw new DataClientError(
    "The collector run did not finish in time — try again shortly.",
  );
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Compare mode
// ---------------------------------------------------------------------------

function previousSeasonOf(key: SeasonKey): SeasonKey | null {
  const index = SEASON_KEYS.indexOf(key);
  return index > 0 ? (SEASON_KEYS[index - 1] ?? null) : null;
}

async function refreshCompare(): Promise<void> {
  const card = state.card;
  if (card === null) {
    state.compareOn = false;
    return;
  }
  const previousKey = previousSeasonOf(card.seasonKey);
  if (previousKey === null) {
    state.compareCard = null;
    state.compareNote = "This is the earliest season in the catalog.";
    paintSidePanel();
    return;
  }
  try {
    const record = await state.client.getCard(card.front.playerId, previousKey);
    if (record === null) {
      state.compareCard = null;
      state.compareNote = `${SEASON_UNAVAILABLE_MESSAGE} (${seasonLabel(previousKey)})`;
    } else {
      state.compareCard = buildCardBundle({
        payload: record,
        matches: [],
        matchesUnavailable: true,
        sourceHealth: null,
      });
      state.compareNote = null;
    }
  } catch (error) {
    state.compareCard = null;
    state.compareNote = `Previous season unavailable: ${errorMessage(error)}`;
  }
  paintSidePanel();
}

async function onToggleCompare(): Promise<void> {
  state.compareOn = !state.compareOn;
  paintSidePanel();
  if (state.compareOn) await refreshCompare();
}

// ---------------------------------------------------------------------------
// Flip interaction + pointer tilt
// ---------------------------------------------------------------------------

function setFlipped(flipped: boolean): void {
  if (state.card === null) return;
  state.flipped = flipped;
  const cardEl = qs<HTMLElement>("#flip-card");
  if (cardEl !== null) {
    cardEl.classList.toggle("flipped", flipped);
    cardEl.setAttribute(
      "aria-label",
      flipped
        ? `Player card, ${state.card.front.playerName}. Back: season-bound match details and goal timeline. Press Enter to return to season totals.`
        : `Player card, ${state.card.front.playerName}. Front: season totals. Press Enter to flip to match details.`,
    );
  }
  const flipButtons = document.querySelectorAll<HTMLButtonElement>(
    '[data-action="flip"]',
  );
  for (const button of flipButtons) {
    if (button.getAttribute("aria-pressed") !== null) {
      button.setAttribute("aria-pressed", String(flipped));
    }
  }
  const status = qs("#card-status");
  if (status !== null) {
    status.textContent = flipped
      ? "Back face: season-bound match details and goal timeline."
      : "Front face: season totals.";
  }
}

function attachTilt(card: HTMLElement | null): void {
  if (card === null) return;
  if (reducedMotion()) return;
  card.addEventListener("pointermove", (event) => {
    if (event.pointerType === "touch") return;
    const rect = card.getBoundingClientRect();
    const px = (event.clientX - rect.left) / rect.width;
    const py = (event.clientY - rect.top) / rect.height;
    card.classList.add("tilting");
    card.style.setProperty("--ry", `${((px - 0.5) * 10).toFixed(2)}deg`);
    card.style.setProperty("--rx", `${((0.5 - py) * 8).toFixed(2)}deg`);
  });
  card.addEventListener("pointerleave", () => {
    card.classList.remove("tilting");
    card.style.setProperty("--rx", "0deg");
    card.style.setProperty("--ry", "0deg");
  });
}

function flipFromCardEvent(event: Event): void {
  const target = event.target;
  if (
    target instanceof Element &&
    target.closest('button, a, input, select, textarea, [role="option"]')
  ) {
    return; // inner controls handle themselves
  }
  setFlipped(!state.flipped);
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

const searchInput = qs<HTMLInputElement>("#player-input");
if (searchInput !== null) {
  searchInput.addEventListener("input", () => {
    scheduleSearch(searchInput.value);
  });
  searchInput.addEventListener("keydown", (event) => {
    if (!(event instanceof KeyboardEvent)) return;
    const action = handleSearchKey(
      {
        open: state.searchOpen,
        activeIndex: state.searchActiveIndex,
        optionCount: state.searchHits.length,
      },
      event.key,
    );
    switch (action.type) {
      case "highlight":
        event.preventDefault();
        state.searchOpen = true;
        state.searchActiveIndex = action.index;
        paintSearchListbox();
        break;
      case "select":
        event.preventDefault();
        {
          const hit = state.searchHits[action.index];
          if (hit !== undefined) void selectHit(hit);
        }
        break;
      case "close":
        event.preventDefault();
        if (state.searchOpen) {
          state.searchOpen = false;
          paintSearchListbox();
        } else {
          searchInput.value = "";
          state.searchQuery = "";
          paintSearchListbox();
        }
        break;
      default:
        break;
    }
  });
  searchInput.addEventListener("blur", () => {
    window.setTimeout(() => {
      if (state.searchOpen) {
        state.searchOpen = false;
        paintSearchListbox();
      }
    }, 120);
  });
}

const listbox = qs("#player-listbox");
if (listbox !== null) {
  listbox.addEventListener("mousedown", (event) => {
    // Keep focus on the input while choosing an option.
    event.preventDefault();
  });
  listbox.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const option = target.closest<HTMLElement>("[role='option']");
    const index = Number(option?.dataset.index ?? "-1");
    const hit = state.searchHits[index];
    if (hit !== undefined) void selectHit(hit);
  });
}

app.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const seasonButton = target.closest<HTMLButtonElement>("button[data-season]");
  if (seasonButton !== null && !seasonButton.disabled) {
    void onSeasonChange(seasonButton.dataset.season ?? "");
    return;
  }

  const actionButton = target.closest<HTMLButtonElement>("button[data-action]");
  if (actionButton !== null) {
    switch (actionButton.dataset.action) {
      case "generate":
        void runGeneration();
        break;
      case "flip":
        setFlipped(!state.flipped);
        break;
      case "toggle-compare":
        void onToggleCompare();
        break;
      case "retry-search":
        if (searchInput !== null) scheduleSearch(searchInput.value);
        break;
      default:
        break;
    }
    return;
  }

  if (target.closest("#flip-card")) flipFromCardEvent(event);
});

const flipCardStage = qs("#card-stage");
if (flipCardStage !== null) {
  flipCardStage.addEventListener("keydown", (event) => {
    if (!(event instanceof KeyboardEvent)) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest("#flip-card") === null) return;
    // Inner controls keep their own keyboard behaviour.
    if (
      target.closest('button, a, input, select, textarea, [role="option"]') !==
      null
    )
      return;
    event.preventDefault();
    setFlipped(!state.flipped);
  });
}

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  const drawer = qs("#provenance-drawer");
  if (drawer instanceof HTMLDetailsElement && drawer.open) {
    drawer.open = false;
    drawer.querySelector("summary")?.focus();
  }
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

paintAll();
void prepareLiveIndex();
