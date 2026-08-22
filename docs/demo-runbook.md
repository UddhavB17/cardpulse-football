# CardPulse Football judge demo

## One-minute story

Start the chaos source, API, and web app before the timer. Open
`http://127.0.0.1:4173`.

| Time      | Action                                        | Narration                                                                                                  |
| --------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 0:00–0:08 | Point to the `Mock Demo` badge and empty card | “This path is deterministic evidence. I will not pretend it is a live provider call.”                      |
| 0:08–0:18 | **Generate card**                             | “Football rows become a contract-validated player card, teams, and standings — with source provenance.”    |
| 0:18–0:28 | **Inject layout drift**                       | “The source changes from a table to cards. Broken output is quarantined; the verified card stays visible.” |
| 0:28–0:38 | **Fetch repair preview**                      | “Confirmed drift already requested repair of the same `c_*` collector; now its approval preview arrives.”  |
| 0:38–0:47 | **Validate preview**                          | “No approval button exists until every preview row passes the frozen schema and count gate.”               |
| 0:47–0:55 | **Approve repair**                            | “The collector resumes, reaches `done`, reruns, and records hashes and counts as recovery evidence.”       |
| 0:55–1:00 | Point to recovered card and change ledger     | “Now a real stat amendment is accepted — layout drift and football change are different events.”           |

Closing line: “The card gets attention; the verifiable self-healing scraper is
why you can trust it.”

## Live evidence checklist

Do not claim live Bright Data proof until all of these are captured:

- a real Scraper Studio `c_*` collector targeting the deployed `/players` HTML;
- a redacted baseline job and dataset;
- `baseline-table` → `drift-cards` at the same stable URL;
- the refactor request, structured preview, schema-valid gate, and human
  approval;
- terminal `done` and a successful rerun of the same redacted `c_*` ID;
- `amended-stats` producing a football change event;
- `pnpm check` passing immediately before the recording.

Keep API and operator tokens out of the recording, source control, and logs.
Until this trail exists, say “live path implemented; deterministic mock path
verified.”
