# Live Scraper Studio evidence

The deterministic mock proves CardPulse behavior, but hackathon eligibility
requires a real custom scraper created and run through Bright Data Scraper
Studio. Capture the following before submission:

- the public, non-government football source URL;
- the custom Scraper Studio create command and redacted result;
- the first successful run with the real `c_*` Collector ID partially redacted;
- representative structured JSON returned by that run;
- a layout change or controlled equivalent that breaks the extraction;
- `bdata scraper heal` repairing that same Collector ID;
- the approval preview and explicit approval;
- the successful same-ID rerun and the CardPulse recovery ledger;
- a short screen recording showing the terminal command and downstream card.

Never commit or record the Bright Data API token, operator token, cookies, or
account details. Show only enough of the Collector ID to prove it stays the
same throughout the flow.
