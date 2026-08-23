# Live Scraper Studio evidence

The deterministic mock proves CardPulse behavior, but hackathon eligibility
requires a real custom scraper created and run through Bright Data Scraper
Studio. Capture the following before submission:

- the public, non-government football source URL (StatBunker seed page chosen
  in [the live runbook](../docs/statbunker-live-runbook.md) step 2);
- the custom Scraper Studio create command and redacted result
  (`bdata scraper create … "$(cat scrapers/statbunker/create-prompt.txt)"`);
- the first successful run with the real `c_*` Collector ID partially redacted;
- representative structured JSON returned by that run (10 rows, stable
  provider shape, numeric zeros preserved, nullable enrichment omitted);
- a layout change or controlled equivalent that breaks the extraction;
- `bdata scraper heal` with `scrapers/statbunker/heal-prompt.txt` repairing
  that same Collector ID;
- the approval preview, its schema/count validation, and explicit approval
  (`bdata scraper approve`, never `--auto-approve`);
- the successful same-ID rerun and the CardPulse recovery ledger;
- a short screen recording showing the terminal command and downstream card.

Store redacted artifacts under `evidence/live/` using the redaction commands
in [the runbook](../docs/statbunker-live-runbook.md). Rate discipline applies
to every capture: manual runs only at a low request rate, and stop on any 403
or 429. If a capture cannot be made, leave both its file and this checklist
unticked — do not substitute placeholders or invented IDs.

Never commit or record the Bright Data API token, operator token, cookies, or
account details. Show only enough of the Collector ID to prove it stays the
same throughout the flow.

## Current live evidence

[The redacted first-run artifact](live/statbunker-first-run-failure.redacted.json)
proves that Bright Data accepted the original job and returned a real `#show`
selector timeout.

[The redacted same-ID recovery artifact](live/statbunker-same-id-recovery.redacted.json)
records the rejected invalid preview, the corrected sentinel-validated
preview, explicit approval, a successful 10-row same-ID rerun, its SHA-256,
and 10/10 acceptance through the CardPulse mapper. This proves the provider
and mapping path. A recorded browser/API live-mode run and submission video
are still required before claiming the complete deployed experience.
