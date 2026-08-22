// CardPulse Football — single-page demo orchestrator.
//
// Every visual phase of the generate/heal flows is gated by resolved async
// work against the data client; presentation dwell times only pace what the
// viewer sees, they never fake completion.

import type {
  CardPulseDataClient,
  CollectionMode,
  DashboardSnapshot,
} from "./data-client";
import {
  DataClientError,
  FixtureCardPulseDataClient,
  HttpCardPulseDataClient,
} from "./data-client";
import {
  hydrateFlowState,
  initialFlowState,
  isChromeGlitched,
  transition,
  type FlowEvent,
  type FlowState,
} from "./football/flow";
import {
  buildClubViews,
  buildPlayerCard,
  buildReliabilityView,
  buildTeamViews,
  describeHealing,
  describeStatChange,
  isCompromisedState,
  type SourceHealthLike,
} from "./football/mapping";
import { buildSeasonTable, clubForId } from "./football/content";
import {
  athleteSvg,
  boltIcon,
  checkIcon,
  crestSvg,
  pulseMarkSvg,
  refreshIcon,
  warningIcon,
} from "./football/artwork";
import type {
  PlayerCardView,
  StandingRowView,
  TimelineEntry,
} from "./football/types";
import { orderShifts } from "./football/util";
import "./style.css";

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

const appElement = document.querySelector<HTMLElement>("#app");
if (appElement === null) throw new Error("Missing #app root");
const app: HTMLElement = appElement;

const query = new URLSearchParams(window.location.search);
const useFixtures = query.get("adapter") === "fixture";
const configuredApiBase = import.meta.env.VITE_API_BASE_URL?.trim() ?? "";

const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
});

const SEASON_SEED = "cardpulse-2526";

interface AppState {
  client: CardPulseDataClient;
  usingFixtureAdapter: boolean;
  snapshot: DashboardSnapshot | null;
  flow: FlowState;
  hero: PlayerCardView | null;
  busy: boolean;
  actionError: string | null;
  jobsTriggered: number;
  sessionLog: TimelineEntry[];
  operatorToken: string;
  fallbackNotice: string | null;
  previousTableOrder: string[];
  bonusPoints: number;
  failedStepKey: string | null;
  lastRenderedRecovery: FlowState["recovery"];
}

const state: AppState = {
  client: useFixtures
    ? new FixtureCardPulseDataClient()
    : new HttpCardPulseDataClient(configuredApiBase),
  usingFixtureAdapter: useFixtures,
  snapshot: null,
  flow: initialFlowState(),
  hero: null,
  busy: false,
  actionError: null,
  jobsTriggered: 0,
  sessionLog: [],
  operatorToken: "",
  fallbackNotice: useFixtures
    ? "Deterministic fixture adapter requested via ?adapter=fixture."
    : null,
  previousTableOrder: [],
  bonusPoints: 0,
  failedStepKey: null,
  lastRenderedRecovery: "none",
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

function formatTimestamp(value: string | null): string {
  if (value === null) return "Not yet verified";
  const parsed = Date.parse(value);
  return Number.isFinite(parsed)
    ? dateFormatter.format(new Date(parsed))
    : "Unknown timestamp";
}

function reducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Paces the visible phases without faking async completion. */
function dwell(ms: number): Promise<void> {
  if (reducedMotion()) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function errorMessage(error: unknown): string {
  if (error instanceof DataClientError || error instanceof Error) {
    return error.message;
  }
  return "Unknown pipeline failure";
}

function dispatch(event: FlowEvent): void {
  state.flow = transition(state.flow, event);
}

function pushSessionLog(entry: Omit<TimelineEntry, "time">): void {
  state.sessionLog.unshift({ ...entry, time: new Date().toISOString() });
}

// ---------------------------------------------------------------------------
// Static shell
// ---------------------------------------------------------------------------

const RAIL_STEPS = [
  { key: "connecting", title: "Connecting", hint: "Runtime handshake" },
  {
    key: "extracting",
    title: "Extracting fields",
    hint: "Collector pulls records",
  },
  { key: "validating", title: "Validating", hint: "Frozen contract checks" },
  { key: "materializing", title: "Materializing", hint: "Print plates cut" },
  { key: "verified", title: "Verified", hint: "Archived w/ provenance" },
] as const;

let halftoneCounter = 0;

app.innerHTML = `
  <a class="skip-link" href="#main-content">Skip to content</a>
  <header class="topbar shell">
    <a class="wordmark" href="/" aria-label="CardPulse Football home">
      <span class="wordmark-row">${pulseMarkSvg()}<span class="wordmark-title chromatic">Card//Pulse</span></span>
      <span class="wordmark-sub">Football</span>
    </a>
    <div class="topbar-tools" id="topbar-tools"></div>
  </header>
  <main id="main-content" class="shell">
    <section class="hero-copy" aria-labelledby="thesis-title">
      <div>
        <p class="eyebrow">Matchday intelligence · self-healing pipeline</p>
        <h1 id="thesis-title">Living football cards that <em>survive the web.</em></h1>
        <p class="thesis-note">Every card is extracted, validated field-by-field against a frozen contract,
        and stamped with provenance. When a source layout breaks mid-match, the last verified card stays on
        the pitch while the same collector repairs itself — approval required before anything is re-printed.</p>
      </div>
      <dl class="hero-facts" id="hero-facts"></dl>
    </section>

    <section class="matchday" aria-label="Matchday hero card and live pipeline">
      <div class="card-stage reveal" id="card-stage" aria-live="polite"></div>
      <div class="console reveal">
        <div class="console-head">
          <h2>Live card pipeline</h2>
          <span class="console-state" id="console-state" role="status"></span>
        </div>
        <ol class="rail" id="rail" aria-label="Generation phases"></ol>
        <div class="console-actions" id="console-actions"></div>
        <p class="console-footnote" id="console-footnote"></p>
      </div>
    </section>

    <div class="notice-region" id="notice-region"></div>

    <section class="section reveal" aria-labelledby="teams-title">
      <div class="section-heading">
        <div><p class="eyebrow">Squad integrity</p><h2 id="teams-title">Team summary</h2></div>
        <p class="kicker-note">Each monitored source wears its club colours. Health state, verification streaks
        and recovery actions come straight from the pipeline.</p>
      </div>
      <div class="team-grid" id="team-grid"></div>
    </section>

    <section class="section reveal" aria-labelledby="standings-title">
      <div class="section-heading">
        <div><p class="eyebrow">Secondary table · animated</p><h2 id="standings-title">Standings</h2></div>
        <p class="kicker-note">Provider rows when the pipeline supplies them; otherwise a simulated league.
        Verified recoveries nudge the sim table — watch rows reorder.</p>
      </div>
      <div class="table-scroller">
        <table class="standings">
          <caption id="standings-caption">Season 25/26 · simulated league · demo data</caption>
          <thead>
            <tr>
              <th scope="col">#</th><th scope="col">Club</th><th scope="col">P</th><th scope="col">W</th>
              <th scope="col">D</th><th scope="col">L</th><th scope="col">GF</th><th scope="col">GA</th>
              <th scope="col">GD</th><th scope="col">Pts</th>
            </tr>
          </thead>
          <tbody id="standings-body"></tbody>
        </table>
      </div>
      <p class="sim-note"><span id="standings-note">Simulated standings · fictional clubs · always demo data</span></p>
    </section>

    <details class="drawer section reveal" id="reliability-drawer">
      <summary>Reliability ledger &amp; recovery timeline</summary>
      <div class="drawer-body" id="drawer-body"></div>
    </details>
  </main>
  <footer class="site-footer shell" id="site-footer"></footer>
`;

// ---------------------------------------------------------------------------
// Snapshot helpers
// ---------------------------------------------------------------------------

async function loadSnapshot(): Promise<DashboardSnapshot> {
  const snapshot = await state.client.load();
  state.snapshot = snapshot;
  return snapshot;
}

function switchToFixture(reason: string): void {
  state.client = new FixtureCardPulseDataClient();
  state.usingFixtureAdapter = true;
  state.fallbackNotice = reason;
}

function collectorIdOf(snapshot: DashboardSnapshot): string | null {
  return snapshot.healing.incident?.collectorId ?? null;
}

function sourceList(snapshot: DashboardSnapshot): SourceHealthLike[] {
  return snapshot.sources.data.map((source) => ({
    sourceId: source.sourceId,
    state: source.state,
    checkedAt: source.checkedAt,
    lastSuccessfulAt: source.lastSuccessfulAt,
    consecutiveFailures: source.consecutiveFailures,
    recentFailureRate: source.recentFailureRate,
    activeIncident:
      source.activeIncident === null
        ? null
        : {
            reason: source.activeIncident.reason,
            detail: source.activeIncident.detail,
          },
    latestRecoveryEvidence: source.latestRecoveryEvidence
      ? { actions: source.latestRecoveryEvidence.actions }
      : null,
  }));
}

// ---------------------------------------------------------------------------
// Painters
// ---------------------------------------------------------------------------

function paintTopbarTools(): void {
  const target = qs("#topbar-tools");
  if (target === null || state.snapshot === null) return;
  const runtime = state.snapshot.runtime;
  const ready =
    runtime.mode === "mock" ||
    (runtime.collectorConfigured && runtime.targetConfigured);
  const live = runtime.mode === "live" && !state.usingFixtureAdapter;
  target.innerHTML = `
    <span class="chip ${live ? "live" : "demo"}">
      <span class="dot" aria-hidden="true"></span>${live ? "Live provider" : "Demo data"}
    </span>
    <span class="chip ${ready ? "demo" : ""}" style="${ready ? "" : "border-color: var(--gold); color: var(--gold);"}">
      ${ready ? "Runtime ready" : "Config incomplete"}
    </span>`;
}

function paintHeroFacts(): void {
  const target = qs("#hero-facts");
  if (target === null || state.snapshot === null) return;
  const rows: Array<[string, string]> = [
    ["Data mode", resolveDataLabelText()],
    ["Pipeline", resolveModeChipText()],
    ["Tracked sources", String(state.snapshot.sources.pagination.total)],
    ["Verified cards", String(state.snapshot.players.pagination.total)],
    ["Last sync", formatTimestamp(state.snapshot.receivedAt)],
  ];
  target.innerHTML = rows
    .map(
      ([label, value]) =>
        `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`,
    )
    .join("");
}

function resolveDataLabelText(): string {
  if (state.snapshot === null) return "…";
  const live =
    state.snapshot.runtime.mode === "live" && !state.usingFixtureAdapter;
  return live ? "LIVE PROVIDER" : "DEMO DATA";
}

function resolveModeChipText(): string {
  if (state.usingFixtureAdapter) return "MOCK PIPELINE";
  if (state.snapshot?.runtime.mode === "live") return "LIVE PROVIDER";
  return "LOCAL API";
}

function paintRail(): void {
  const rail = qs("#rail");
  if (rail === null) return;
  const order = [
    "idle",
    "connecting",
    "extracting",
    "validating",
    "materializing",
    "verified",
  ];
  const phaseIndex = Math.max(order.indexOf(state.flow.phase), 0);
  const failedIndex = state.failedStepKey
    ? RAIL_STEPS.findIndex((step) => step.key === state.failedStepKey)
    : -1;
  rail.innerHTML = RAIL_STEPS.map((step, index) => {
    let status: "pending" | "done" | "current" | "failed" = "pending";
    if (failedIndex >= 0 && index === failedIndex) status = "failed";
    else if (failedIndex >= 0 && index < failedIndex) status = "done";
    else if (phaseIndex > index + 1 || state.flow.phase === "verified")
      status = index + 1 <= phaseIndex ? "done" : "pending";
    else if (phaseIndex === index + 1) status = "current";
    const icon =
      status === "done"
        ? checkIcon()
        : status === "failed"
          ? warningIcon()
          : "";
    return `<li class="${status}"${status === "current" ? ' aria-current="step"' : ""}>
      ${icon}<strong>${step.title}</strong><small>${step.hint}</small>
    </li>`;
  }).join("");
}

function paintConsoleState(): void {
  const target = qs("#console-state");
  if (target === null) return;
  const flow = state.flow;
  let text: string;
  if (state.busy) text = `PHASE: ${flow.phase.toUpperCase()}…`;
  else if (flow.phase === "blocked") text = "PIPELINE BLOCKED";
  else if (flow.recovery === "compromised")
    text = "RECOVERY: DRIFT QUARANTINED";
  else if (flow.recovery === "repair-requested")
    text = "RECOVERY: PREVIEW PENDING VALIDATION";
  else if (flow.recovery === "preview-valid")
    text = "RECOVERY: APPROVAL GATE OPEN";
  else if (flow.recovery === "preview-invalid")
    text = "RECOVERY: PREVIEW REJECTED";
  else if (flow.recovery === "recovery-failed") text = "RECOVERY FAILED SAFELY";
  else if (flow.recovery === "recovered") text = "VERIFIED RECOVERY COMPLETE";
  else if (flow.phase === "verified") text = "CARD VERIFIED & ARCHIVED";
  else text = `PHASE: ${flow.phase.toUpperCase()}`;
  target.textContent = text;
}

function paintConsoleActions(): void {
  const target = qs("#console-actions");
  if (target === null) return;
  const flow = state.flow;
  const busy = state.busy;
  const buttons: string[] = [];

  if (busy) {
    buttons.push(
      `<button class="btn btn-primary" type="button" disabled aria-busy="true">${boltIcon()} Working…</button>`,
    );
  } else if (
    flow.phase === "idle" ||
    flow.phase === "verified" ||
    (flow.phase === "blocked" && flow.recovery !== "compromised")
  ) {
    buttons.push(
      `<button class="btn btn-primary" type="button" data-action="generate">${boltIcon()} Generate card</button>`,
    );
  }

  if (!busy && flow.recovery === "compromised") {
    buttons.push(
      `<button class="btn btn-dark" type="button" data-action="repair-request">${refreshIcon()} Fetch repair preview</button>`,
    );
  } else if (!busy && flow.recovery === "repair-requested") {
    buttons.push(
      `<button class="btn btn-dark" type="button" data-action="validate-preview">${checkIcon()} Validate preview</button>`,
    );
  } else if (!busy && flow.recovery === "preview-valid") {
    buttons.push(
      `<button class="btn btn-primary" type="button" data-action="approve-repair">${checkIcon()} Approve repair</button>`,
    );
  } else if (!busy && flow.recovery === "preview-invalid") {
    buttons.push(
      `<button class="btn btn-dark" type="button" data-action="validate-preview">${refreshIcon()} Retry preview validation</button>`,
    );
  } else if (!busy && flow.recovery === "recovery-failed") {
    buttons.push(
      `<button class="btn btn-dark" type="button" data-action="generate">${refreshIcon()} Re-run baseline generation</button>`,
    );
  }

  if (
    !busy &&
    flow.phase === "verified" &&
    (flow.recovery === "none" || flow.recovery === "recovered")
  ) {
    buttons.push(
      `<button class="btn btn-ghost-danger btn-small" type="button" data-action="inject-drift">${warningIcon()} Inject layout drift · demo</button>`,
    );
  }

  const tokenField =
    !busy &&
    state.snapshot?.runtime.mode === "live" &&
    state.snapshot.runtime.liveMutationsEnabled
      ? `<label class="token-field">Operator token
           <input id="operator-token" type="password" autocomplete="off"
             placeholder="32+ chars · memory only" value="${escapeHtml(state.operatorToken)}">
         </label>`
      : "";

  target.innerHTML = `${buttons.join("")}${tokenField}${
    state.actionError
      ? `<p class="action-error" role="alert">${escapeHtml(state.actionError)}</p>`
      : ""
  }`;
}

function paintFootnote(): void {
  const target = qs("#console-footnote");
  if (target === null) return;
  const preserved = state.hero
    ? `Preserved card: ${state.hero.serialNumber} (${state.hero.playerName}).`
    : "No verified card yet.";
  target.textContent = `Phases advance only when each pipeline step resolves. ${preserved}`;
}

function renderPlaceholder(): void {
  const stage = qs("#card-stage");
  if (stage === null) return;
  stage.innerHTML = `<div class="card-placeholder">
    <strong>Awaiting first extraction</strong>
    <span>Run the pipeline to materialize the matchday hero</span>
  </div>`;
}

function renderCard(card: PlayerCardView): void {
  const stage = qs("#card-stage");
  if (stage === null) return;
  const htId = `cp-ht-${(halftoneCounter += 1)}`;
  const crestHtId = `cp-crest-${halftoneCounter}`;
  const provenance = card.provenance;
  stage.innerHTML = `<article class="hero-card" tabindex="0" aria-label="Matchday hero card: ${escapeHtml(
    card.playerName,
  )}, ${escapeHtml(card.clubName)}, position ${escapeHtml(card.positionDisplay)}">
    <div class="card-frame" id="card-frame">
      <div class="card-inner">
        <header class="card-head">
          <span class="club-line"><span class="club-badge" aria-hidden="true">${escapeHtml(card.clubCode)}</span>${escapeHtml(card.clubName)}</span>
          <span class="card-serial">${escapeHtml(card.serialNumber)} · ${escapeHtml(card.seasonLabel)}</span>
        </header>
        <div class="card-art">
          ${crestSvg({ initials: escapeHtml(card.clubCode), halftoneId: crestHtId })}
          ${athleteSvg({ halftoneId: htId })}
          <span class="card-number" aria-hidden="true">${card.shirtNumber ?? "—"}</span>
        </div>
        <div class="verify-stamp chromatic">Verified<small>${escapeHtml(formatTimestamp(provenance.verifiedAt))}</small></div>
        <div class="card-body">
          <h3 class="player-name">${escapeHtml(card.playerName)}</h3>
          <p class="player-meta">
            <span class="position-tag">${escapeHtml(card.positionDisplay)}</span>
            <span>${escapeHtml(card.clubName)}</span>
            <span>Form bound to snapshot v${provenance.snapshotVersion}</span>
          </p>
          <dl class="attr-grid">
            ${card.attributes
              .map(
                (attr) => `<div><dt>${escapeHtml(attr.label)}</dt>
                  <dd class="attr-bar"><i style="width:${attr.pct}%"></i></dd>
                  <dd>${attr.value}</dd></div>`,
              )
              .join("")}
          </dl>
          <dl class="form-row"><dt>Form</dt>
            ${card.form.map((mark) => `<dd class="form-mark ${mark}">${mark}</dd>`).join("")}
          </dl>
          <dl class="provenance">
            <div><dt>Verified at</dt><dd>${escapeHtml(formatTimestamp(provenance.verifiedAt))}</dd></div>
            <div><dt>Source</dt><dd>${escapeHtml(provenance.sourceId)}</dd></div>
            <div><dt>Snapshot</dt><dd>v${provenance.snapshotVersion}</dd></div>
            <div><dt>Collector</dt><dd>${escapeHtml(provenance.collectorIdRedacted)}</dd></div>
            <div><dt>Signature</dt><dd>${escapeHtml(provenance.signature)}</dd></div>
            <div><dt>Data label</dt><dd>${escapeHtml(resolveDataLabelText())}</dd></div>
          </dl>
          <p class="identity-note">Form index and serial are presentation, bound to snapshot ${escapeHtml(provenance.snapshotId.slice(0, 8))}… — the provenance record is real.</p>
        </div>
        <div class="card-shine" aria-hidden="true"></div>
      </div>
    </div>
  </article>`;
  attachTilt(stage.querySelector<HTMLElement>(".hero-card"));
}

function updateChromeGlitch(previousRecovery: FlowState["recovery"]): void {
  const stage = qs<HTMLElement>(".hero-card");
  if (stage === null) return;
  const glitched = isChromeGlitched(state.flow);
  stage.classList.toggle("is-compromised", glitched);
  if (previousRecovery !== "recovered" && state.flow.recovery === "recovered") {
    stage.classList.add("just-recovered");
    window.setTimeout(() => stage.classList.remove("just-recovered"), 900);
  }
}

interface BannerSpec {
  tone: "warn" | "bad" | "good";
  role: "status" | "alert";
  title: string;
  body: string;
  action?: string;
  actionLabel?: string;
}

function paintNotices(): void {
  const region = qs("#notice-region");
  if (region === null || state.snapshot === null) return;
  const banners: BannerSpec[] = [];

  if (state.fallbackNotice !== null) {
    banners.push({
      tone: "warn",
      role: "status",
      title: "Demo data",
      body: `${state.fallbackNotice} No provider claims are made in this mode.`,
      action: "retry-api",
      actionLabel: "Retry CardPulse API",
    });
  }
  if (state.snapshot.stale) {
    banners.push({
      tone: "warn",
      role: "status",
      title: "Stale sync",
      body: "Responses are older than two minutes. Values stay visible but are not current.",
    });
  }
  const healingState = state.snapshot.healing.state;
  if (isCompromisedState(healingState)) {
    const incident = state.snapshot.healing.incident;
    banners.push({
      tone: "bad",
      role: "alert",
      title: "Layout drift contained",
      body: `${describeHealing(healingState)} ${
        incident?.reason ?? ""
      } The last verified card keeps playing — only its chrome glitches.`,
    });
  } else if (state.flow.recovery === "recovered") {
    banners.push({
      tone: "good",
      role: "status",
      title: "Verified recovery",
      body: "Same collector, clean rerun, evidence archived. The card was never replaced.",
    });
  }
  const change = state.snapshot.changes.data[0];
  if (change !== undefined) {
    const summaries = change.changes
      .map(describeStatChange)
      .filter((item): item is string => item !== null);
    banners.push({
      tone: "warn",
      role: "status",
      title: "Real amendment detected",
      body:
        summaries.join(" ") ||
        "Verified business change after the recovery rerun.",
    });
  }

  if (banners.length > 0) {
    region.setAttribute("aria-label", "Pipeline notices");
  } else {
    region.removeAttribute("aria-label");
  }
  region.innerHTML = banners
    .map(
      (banner) => `<div class="banner ${banner.tone}" role="${banner.role}">
        <strong>${escapeHtml(banner.title)}</strong>
        <p>${escapeHtml(banner.body)}</p>
        ${
          banner.action
            ? `<button class="text-button" type="button" data-action="${banner.action}">${escapeHtml(banner.actionLabel ?? "Retry")}</button>`
            : ""
        }
      </div>`,
    )
    .join("");
}

function paintTeams(): void {
  const grid = qs("#team-grid");
  if (grid === null || state.snapshot === null) return;
  const sources = sourceList(state.snapshot);
  const teams = buildTeamViews(
    state.snapshot.teams.data.map((team) => ({
      teamId: team.teamId,
      sourceId: team.sourceId,
      name: team.name,
      shortName: team.shortName,
      city: team.city,
      stadium: team.stadium,
      coach: team.coach,
      founded: team.founded,
      observedAt: team.observedAt,
      latestSnapshot: team.latestSnapshot,
    })),
    sources,
  );

  if (teams.length > 0) {
    grid.innerHTML = teams
      .map(
        (team) => `<article class="team-card">
          <header>
            <h3>${escapeHtml(team.name)}</h3>
            ${
              team.state
                ? `<span class="state-pill ${team.state}">${escapeHtml(team.state)}</span>`
                : ""
            }
          </header>
          <dl>
            ${team.city ? `<div><dt>City</dt><dd>${escapeHtml(team.city)}</dd></div>` : ""}
            ${team.stadium ? `<div><dt>Stadium</dt><dd>${escapeHtml(team.stadium)}</dd></div>` : ""}
            ${team.coach ? `<div><dt>Coach</dt><dd>${escapeHtml(team.coach)}</dd></div>` : ""}
            ${team.founded !== null ? `<div><dt>Founded</dt><dd>${team.founded}</dd></div>` : ""}
            <div><dt>Snapshot</dt><dd>v${team.snapshotVersion}</dd></div>
            <div><dt>Last verified</dt><dd>${escapeHtml(formatTimestamp(team.observedAt))}</dd></div>
          </dl>
        </article>`,
      )
      .join("");
    return;
  }

  // No tracked teams yet: fall back to source-integrity club cards.
  const clubs = buildClubViews(sources);
  if (clubs.length === 0) {
    grid.innerHTML = `<p class="empty-note">No tracked teams yet — run the pipeline once.</p>`;
    return;
  }
  grid.innerHTML = clubs
    .map((club) => {
      const incidentNote =
        club.incidentReason !== null
          ? `<p class="incident-note"><strong>${escapeHtml(club.incidentReason)}</strong> — extraction damage is quarantined here, never printed onto cards.</p>`
          : "";
      const actions =
        club.recoveryActions.length > 0
          ? `<ul class="recovery-actions-list">${club.recoveryActions
              .map((action) => `<li>${escapeHtml(action)}</li>`)
              .join("")}</ul>`
          : "";
      return `<article class="team-card">
        <header>
          <h3>${escapeHtml(club.clubCode)} · source</h3>
          <span class="state-pill ${club.state}">${escapeHtml(club.state)}</span>
        </header>
        <dl>
          <div><dt>Source id</dt><dd>${escapeHtml(club.sourceId)}</dd></div>
          <div><dt>Fail streak</dt><dd>${club.consecutiveFailures}</dd></div>
          <div><dt>Recent failures</dt><dd>${club.recentFailureRate}%</dd></div>
          <div><dt>Last healthy</dt><dd>${escapeHtml(formatTimestamp(club.lastSuccessfulAt))}</dd></div>
        </dl>
        ${incidentNote}${actions}
      </article>`;
    })
    .join("");
}

// ---------------------------------------------------------------------------
// Standings — provider rows when present, deterministic sim table otherwise
// ---------------------------------------------------------------------------

interface ActiveTable {
  rows: StandingRowView[];
  orderKeys: string[];
}

function activeStandingsTable(): ActiveTable {
  const snapshot = state.snapshot;
  if (snapshot !== null && snapshot.standings.data.length > 0) {
    const rows = [...snapshot.standings.data]
      .sort((a, b) => a.rank - b.rank)
      .map((entry) => ({
        key: `p:${entry.teamId}`,
        clubName: entry.teamName,
        played: entry.played,
        won: entry.won,
        drawn: entry.drawn,
        lost: entry.lost,
        goalsFor: entry.goalsFor,
        goalsAgainst: entry.goalsAgainst,
        goalDiff: entry.goalsFor - entry.goalsAgainst,
        points: entry.points,
        rank: entry.rank,
        isHeroClub:
          state.hero !== null && state.hero.clubName === entry.teamName,
      }));
    return { rows, orderKeys: rows.map((row) => row.key) };
  }
  const simRows = buildSeasonTable(
    SEASON_SEED,
    heroClubCode(),
    state.bonusPoints,
  ).map((row) => ({
    ...row,
    key: `s:${row.clubCode}`,
    rank: null,
    goalDiff: row.goalsFor - row.goalsAgainst,
  }));
  return { rows: simRows, orderKeys: simRows.map((row) => row.key) };
}

function heroClubCode(): string | null {
  if (state.hero !== null) return state.hero.clubCode;
  const firstSource = state.snapshot?.sources.data[0]?.sourceId;
  return firstSource ? clubForId(firstSource).code : null;
}

function movementClass(shift: number): string {
  if (shift > 0) return "up";
  if (shift < 0) return "down";
  return "flat";
}

function rowHtml(row: StandingRowView, index: number, shift: number): string {
  const diff = row.goalDiff;
  return `<tr data-club="${escapeHtml(row.key)}" class="${row.isHeroClub ? "hero-club" : ""}"
    style="--stagger:${index}">
    <td><span class="pos-cell"><span class="movement ${movementClass(shift)}" role="img" aria-label="${
      shift > 0
        ? `up ${shift}`
        : shift < 0
          ? `down ${Math.abs(shift)}`
          : "no change"
    }"></span><span class="pos-badge">${index + 1}</span></span></td>
    <th scope="row">${escapeHtml(row.clubName)}</th>
    <td>${row.played}</td><td>${row.won}</td><td>${row.drawn}</td><td>${row.lost}</td>
    <td>${row.goalsFor}</td><td>${row.goalsAgainst}</td><td>${diff > 0 ? `+${diff}` : diff}</td>
    <td class="points">${row.points}</td>
  </tr>`;
}

function paintStandings(): void {
  const tbody = qs("#standings-body");
  if (tbody === null) return;
  const table = activeStandingsTable();
  const providerBacked = table.rows[0]?.key.startsWith("p:") ?? false;
  const caption = qs("#standings-caption");
  if (caption !== null) {
    caption.textContent = providerBacked
      ? "Season 2025 · provider-synced table · labelled by runtime"
      : "Season 25/26 · simulated league · demo data";
  }
  const note = qs("#standings-note");
  if (note !== null) {
    note.textContent = providerBacked
      ? "Rows come from the verified standings snapshot · arrows show reorder since last sync"
      : "Simulated standings · fictional clubs · always demo data";
  }
  const nextOrder = table.orderKeys;
  const shifts = orderShifts(state.previousTableOrder, nextOrder);
  const firstPaint = state.previousTableOrder.length === 0;
  tbody.innerHTML = table.rows
    .map((row, index) => rowHtml(row, index, shifts[row.key] ?? 0))
    .join("");

  if (!firstPaint && !reducedMotion() && Object.keys(shifts).length > 0) {
    const rowHeight =
      tbody.firstElementChild?.getBoundingClientRect().height ?? 42;
    const movingRows = Array.from(tbody.children).filter((element) => {
      const key = (element as HTMLElement).dataset.club;
      return key !== undefined && (shifts[key] ?? 0) !== 0;
    }) as HTMLElement[];
    for (const row of movingRows) {
      const key = row.dataset.club ?? "";
      row.style.transform = `translateY(${(shifts[key] ?? 0) * rowHeight}px)`;
    }
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        for (const row of movingRows) {
          row.classList.add("flipping");
          row.style.transform = "";
        }
        window.setTimeout(() => {
          for (const row of movingRows) row.classList.remove("flipping");
        }, 600);
      });
    });
  }
  state.previousTableOrder = nextOrder;
}

function paintDrawer(): void {
  const body = qs("#drawer-body");
  if (body === null || state.snapshot === null) return;
  const reliability = buildReliabilityView({
    runtime: state.snapshot.runtime,
    usingFixtureAdapter: state.usingFixtureAdapter,
    jobsTriggered: state.jobsTriggered,
    quarantineCount: state.snapshot.quarantines.pagination.total,
    amendmentCount: state.snapshot.changes.pagination.total,
    stale: state.snapshot.stale,
    receivedAt: state.snapshot.receivedAt,
    collectorId: collectorIdOf(state.snapshot),
  });

  const timeline: TimelineEntry[] = [...state.sessionLog];
  for (const club of buildClubViews(sourceList(state.snapshot))) {
    for (const action of club.recoveryActions) {
      timeline.push({
        time: null,
        title: "Recovery evidence",
        detail: action,
        tone: "info",
      });
    }
  }

  const stats: Array<[string, string]> = [
    ["Collection mode", reliability.modeChip],
    ["Data label", reliability.dataLabel],
    ["Collector ID", reliability.collectorIdRedacted],
    ["Jobs this session", String(reliability.jobsTriggered)],
    ["Evidence records", String(reliability.evidenceCount)],
    ["Quarantined", String(reliability.quarantineCount)],
    ["Amendments", String(reliability.amendmentCount)],
    ["Last sync", formatTimestamp(reliability.receivedAt)],
    ["Stale flag", reliability.stale ? "yes" : "no"],
  ];

  body.innerHTML = `
    <section aria-label="Reliability facts">
      <h3>Facts</h3>
      <dl class="drawer-stats">
        ${stats
          .map(
            ([label, value]) =>
              `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`,
          )
          .join("")}
      </dl>
    </section>
    <section aria-label="Recovery timeline">
      <h3>Timeline</h3>
      ${
        timeline.length === 0
          ? '<p class="drawer-issues">No recovery events yet. Inject drift to watch the same-collector repair chain.</p>'
          : `<ol class="timeline">${timeline
              .slice(0, 8)
              .map(
                (entry) => `<li class="tone-${entry.tone}">
                  <time>${entry.time === null ? "Provider evidence" : escapeHtml(formatTimestamp(entry.time))}</time>
                  <strong>${escapeHtml(entry.title)}</strong>
                  <p>${escapeHtml(entry.detail)}</p>
                </li>`,
              )
              .join("")}</ol>`
      }
    </section>
    <section aria-label="Configuration notes">
      <h3>Configuration</h3>
      ${
        reliability.issues.length === 0
          ? '<p class="drawer-issues">No configuration issues reported by the runtime.</p>'
          : `<ul class="drawer-issues">${reliability.issues
              .map((issue) => `<li>${escapeHtml(issue)}</li>`)
              .join("")}</ul>`
      }
    </section>`;
}

function paintFooter(): void {
  const footer = qs("#site-footer");
  if (footer === null) return;
  footer.innerHTML = `<span>CardPulse Football · hackathon demo</span>
    <span>All fields validated against frozen schema v1 before materialization</span>
    <span>Last sync ${escapeHtml(formatTimestamp(state.snapshot?.receivedAt ?? null))}</span>`;
}

function paintAll(): void {
  paintTopbarTools();
  paintHeroFacts();
  paintRail();
  paintConsoleState();
  paintConsoleActions();
  paintFootnote();
  paintNotices();
  paintTeams();
  paintStandings();
  paintDrawer();
  paintFooter();
  const previousRecovery = state.lastRenderedRecovery;
  state.lastRenderedRecovery = state.flow.recovery;
  updateChromeGlitch(previousRecovery);
}

// ---------------------------------------------------------------------------
// Tilt interaction
// ---------------------------------------------------------------------------

function attachTilt(card: HTMLElement | null): void {
  if (card === null || reducedMotion()) return;
  const frame = card.querySelector<HTMLElement>("#card-frame");
  if (frame === null) return;
  card.addEventListener("pointermove", (event) => {
    if (event.pointerType === "touch") return;
    const rect = frame.getBoundingClientRect();
    const px = (event.clientX - rect.left) / rect.width;
    const py = (event.clientY - rect.top) / rect.height;
    frame.classList.add("is-tilting");
    frame.style.setProperty("--ry", `${((px - 0.5) * 12).toFixed(2)}deg`);
    frame.style.setProperty("--rx", `${((0.5 - py) * 10).toFixed(2)}deg`);
    frame.style.setProperty("--mx", `${(px * 100).toFixed(1)}%`);
    frame.style.setProperty("--my", `${(py * 100).toFixed(1)}%`);
  });
  card.addEventListener("pointerleave", () => {
    frame.classList.remove("is-tilting");
    frame.style.setProperty("--rx", "0deg");
    frame.style.setProperty("--ry", "0deg");
    frame.style.setProperty("--mx", "50%");
    frame.style.setProperty("--my", "50%");
  });
}

// ---------------------------------------------------------------------------
// Flows
// ---------------------------------------------------------------------------

function tokenOptions(): { operatorToken?: string } {
  return state.operatorToken === ""
    ? {}
    : { operatorToken: state.operatorToken };
}

function collectionMode(): CollectionMode {
  return state.snapshot?.runtime.mode === "live" && !state.usingFixtureAdapter
    ? "live"
    : "valid";
}

async function connectWithFallback(): Promise<boolean> {
  try {
    await loadSnapshot();
    return true;
  } catch (error) {
    if (!state.usingFixtureAdapter) {
      switchToFixture(
        `CardPulse API unreachable (${errorMessage(error)}) — switched to the deterministic demo pipeline.`,
      );
      await loadSnapshot();
      return true;
    }
    dispatch({ type: "connection-failed", reason: errorMessage(error) });
    return false;
  }
}

async function runGenerate(): Promise<void> {
  if (state.busy) return;
  state.busy = true;
  state.actionError = null;
  state.failedStepKey = null;
  dispatch({ type: "generate-start" });
  paintAll();

  try {
    // Phase 1: connecting — runtime handshake via a real load.
    const connected = await connectWithFallback();
    if (!connected) return;
    dispatch({ type: "connection-established" });
    paintAll();
    await dwell(520);

    // Phase 2: extracting — real collect call against the configured mode.
    await state.client.collect(collectionMode(), tokenOptions());
    state.jobsTriggered += 1;
    dispatch({ type: "extraction-complete" });
    paintAll();
    await dwell(560);

    // Phase 3: validating — reload runs the frozen Zod contract client-side.
    const fresh = await loadSnapshot();
    const healingClean = !isCompromisedState(fresh.healing.state);
    const playerRecord = fresh.players.data[0] ?? null;
    if (!healingClean || playerRecord === null) {
      state.failedStepKey = "validating";
      dispatch({
        type: "validation-failed",
        reason: healingClean
          ? "Extraction returned no verifiable record."
          : describeHealing(fresh.healing.state),
        preservedCardId: state.hero?.id ?? null,
      });
      pushSessionLog({
        tone: "bad",
        title: "Validation blocked",
        detail: "Candidate output did not pass the frozen contract.",
      });
      return;
    }
    const candidate = buildPlayerCard(playerRecord, collectorIdOf(fresh));
    if (candidate === null) {
      state.failedStepKey = "validating";
      dispatch({
        type: "validation-failed",
        reason: "Card derivation failed for the returned record.",
        preservedCardId: state.hero?.id ?? null,
      });
      return;
    }
    dispatch({ type: "validation-passed", cardId: candidate.id });
    paintAll();
    await dwell(480);

    // Phase 4: materializing — print plates cut, card enters the DOM.
    state.hero = candidate;
    renderCard(candidate);
    await nextFrame();
    dispatch({ type: "card-materialized" });
    pushSessionLog({
      tone: "good",
      title: "Card verified",
      detail: `${candidate.playerName} bound to snapshot v${candidate.provenance.snapshotVersion}.`,
    });
  } catch (error) {
    state.actionError = errorMessage(error);
    pushSessionLog({
      tone: "warn",
      title: "Pipeline error",
      detail: state.actionError,
    });
  } finally {
    state.busy = false;
    paintAll();
  }
}

async function runInjectDrift(): Promise<void> {
  if (state.busy || state.hero === null) return;
  state.busy = true;
  state.actionError = null;
  paintAll();
  await dwell(420);
  try {
    await state.client.collect("drift", tokenOptions());
    state.jobsTriggered += 1;
    await loadSnapshot();
    dispatch({ type: "drift-confirmed", preservedCardId: state.hero.id });
    const quarantine = state.snapshot?.quarantines.data[0];
    pushSessionLog({
      tone: "warn",
      title: "Layout drift quarantined",
      detail:
        quarantine === undefined
          ? "Broken extraction could not overwrite the verified card."
          : (quarantine.issues[0]?.message ?? "Invalid extraction isolated."),
    });
  } catch (error) {
    state.actionError = errorMessage(error);
  } finally {
    state.busy = false;
    paintAll();
  }
}

async function runRepairRequest(): Promise<void> {
  if (state.busy) return;
  state.busy = true;
  state.actionError = null;
  paintAll();
  try {
    await state.client.progressHealing(tokenOptions());
    state.jobsTriggered += 1;
    await loadSnapshot();
    dispatch({ type: "repair-requested" });
    pushSessionLog({
      tone: "info",
      title: "Repair preview received",
      detail:
        "The existing collector was refactored in place and reached the approval preview — identity unchanged.",
    });
  } catch (error) {
    state.actionError = errorMessage(error);
  } finally {
    state.busy = false;
    paintAll();
  }
}

async function runValidatePreview(): Promise<void> {
  if (state.busy) return;
  state.busy = true;
  state.actionError = null;
  paintAll();
  try {
    await state.client.validatePreview(tokenOptions());
    await loadSnapshot();
    const valid = state.snapshot?.healing.state === "preview_valid";
    dispatch({ type: "preview-resolved", valid });
    pushSessionLog(
      valid
        ? {
            tone: "good",
            title: "Preview validated",
            detail: "Candidate passed schema and count canaries.",
          }
        : {
            tone: "bad",
            title: "Preview rejected",
            detail: "Candidate failed the frozen contract. Approval blocked.",
          },
    );
  } catch (error) {
    state.actionError = errorMessage(error);
  } finally {
    state.busy = false;
    paintAll();
  }
}

async function runApproveRepair(): Promise<void> {
  if (state.busy) return;
  state.busy = true;
  state.actionError = null;
  paintAll();
  try {
    await state.client.approve(true, tokenOptions());
    state.jobsTriggered += 1;
    const fresh = await loadSnapshot();
    const recovered = fresh.healing.state === "recovered";
    dispatch({
      type: "repair-approved",
      outcome: recovered ? "recovered" : "failed",
    });
    if (recovered) {
      const recoveredRecord =
        fresh.players.data.find(
          (record) => record.playerId === state.hero?.id,
        ) ?? fresh.players.data[0];
      const recoveredCard = buildPlayerCard(
        recoveredRecord ?? null,
        collectorIdOf(fresh),
      );
      if (recoveredCard !== null) {
        state.hero = recoveredCard;
        renderCard(recoveredCard);
      }
      state.bonusPoints += 3;
      pushSessionLog({
        tone: "good",
        title: "Recovered",
        detail: "Same-collector rerun verified. Hero club earns three points.",
      });
    } else {
      pushSessionLog({
        tone: "bad",
        title: "Recovery failed safely",
        detail: "The verified card remains protected.",
      });
    }
  } catch (error) {
    state.actionError = errorMessage(error);
  } finally {
    state.busy = false;
    paintAll();
  }
}

async function runRetryApi(): Promise<void> {
  if (state.busy) return;
  state.client = new HttpCardPulseDataClient(configuredApiBase);
  state.usingFixtureAdapter = false;
  state.fallbackNotice = null;
  state.previousTableOrder = [];
  await runGenerate();
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

app.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const button = target.closest<HTMLElement>("[data-action]");
  const action = button?.dataset.action;
  switch (action) {
    case "generate":
      void runGenerate();
      break;
    case "inject-drift":
      void runInjectDrift();
      break;
    case "repair-request":
      void runRepairRequest();
      break;
    case "validate-preview":
      void runValidatePreview();
      break;
    case "approve-repair":
      void runApproveRepair();
      break;
    case "retry-api":
      void runRetryApi();
      break;
    default:
      break;
  }
});

app.addEventListener("input", (event) => {
  const target = event.target;
  if (target instanceof HTMLInputElement && target.id === "operator-token") {
    state.operatorToken = target.value;
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  const drawer = qs("#reliability-drawer");
  if (drawer instanceof HTMLDetailsElement && drawer.open) {
    drawer.open = false;
    drawer.querySelector("summary")?.focus();
  }
});

// Section reveals
const revealObserver = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        entry.target.classList.add("in-view");
        revealObserver.unobserve(entry.target);
      }
    }
  },
  { threshold: 0.15 },
);

for (const element of document.querySelectorAll(".reveal")) {
  revealObserver.observe(element);
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

renderPlaceholder();
paintAll();

async function boot(): Promise<void> {
  state.busy = true;
  paintAll();
  try {
    const connected = await connectWithFallback();
    if (!connected) return;
    const snapshot = state.snapshot;
    const player = snapshot?.players.data[0] ?? null;
    const candidate = buildPlayerCard(
      player,
      snapshot === null ? null : collectorIdOf(snapshot),
    );
    if (candidate !== null && snapshot !== null) {
      state.hero = candidate;
      state.flow = hydrateFlowState(snapshot.healing.state, candidate.id);
      renderCard(candidate);
      pushSessionLog({
        tone: snapshot.healing.state === "healthy" ? "good" : "warn",
        title: "Verified card restored",
        detail:
          snapshot.healing.state === "healthy"
            ? `Loaded ${candidate.playerName} from snapshot v${candidate.provenance.snapshotVersion}.`
            : `${candidate.playerName} remains pinned while recovery resumes from ${snapshot.healing.state}.`,
      });
      return;
    }
  } finally {
    state.busy = false;
    paintAll();
  }
  await runGenerate();
}

void boot();
