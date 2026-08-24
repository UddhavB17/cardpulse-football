# CardPulse Football demo script

This is a simple 90-second walkthrough for the live app. The screenshots in
the README were captured from the same flow.

## Before recording

Open the [CardPulse live demo](https://cardpulse-football-web.onrender.com).
Keep the browser zoomed so the search box, season buttons, progress rail, and
card are visible.

Do not show `.env`, API tokens, or private Bright Data credentials.

## Script

### 0:00 to 0:10: introduce the project

**Do:** Show the empty CardPulse screen.

**Say:**

> CardPulse Football turns Premier League statistics into collectible player
> cards. The important part is that every number keeps its source and scrape
> history.

### 0:10 to 0:25: search

**Do:** Type `Haaland` and select **Erling Haaland**.

**Say:**

> I can search by player or club. The browser searches a verified directory,
> so typing does not make a paid provider request for every character.

### 0:25 to 0:35: choose a season

**Do:** Choose **2025/26**.

**Say:**

> CardPulse only offers seasons that are in its verified registry. It does not
> guess a source URL for an unknown season.

### 0:35 to 0:55: generate

**Do:** Click **Generate live card** and show the five progress stages.

**Say:**

> This one explicit action starts the live collection. The progress rail shows
> the real stages: finding the player, starting the collector, extracting the
> statistics, validating the rows, and printing the card.

### 0:55 to 1:15: inspect the card

**Do:** Show the card totals and flip to the match-history side.

**Say:**

> The card shows the season totals and the match history. The current live
> example has 36 appearances, 27 goals, and 8 assists for Erling Haaland.

### 1:15 to 1:30: show provenance

**Do:** Scroll to the provenance section.

**Say:**

> The card records when the source was observed, the snapshot version, the
> scrape run, and whether the run succeeded. If a later collection fails, the
> last verified card stays on screen instead of being replaced by invented
> data.

## Optional architecture shot

Open [docs/architecture.md](architecture.md) and point to the flow from the
browser, through the API and Bright Data, into validation and the final card.

## Recording checklist

- Search for Erling Haaland.
- Choose 2025/26.
- Generate once.
- Show the progress rail.
- Show the front and back of the card.
- Show provenance.
- Keep tokens and private IDs out of the recording.
