# Cell 2 — job-source-coverage (Gate 3a, runs after Gate 2 sign-off)

## Objective

Produce THREE SEPARATE feasibility assessments — **(a) LinkedIn job listings**,
**(b) LinkedIn recruitment posts**, **(c) Naukri listings** — plus other
configured sources (job_boards, HN, Interamt, seeds). Implement a provider
only where collection is free AND permitted. A documented infeasibility
verdict is an acceptable terminal result for any source.

## Revision 2 constraints (binding)

- Free-first: NO keyed/paid dependency may be introduced. Apify stays
  optional, disabled by default, OUT OF SCOPE (reference in verdicts only).
- The starter config (cell 4) MUST NOT contain an enabled `provider: apify`
  entry as a result of this cell's work.
- Enrichment/fetch policy (also binding on any new provider): public
  unauthenticated endpoints only; bounded per-host pacing; timeouts; retries
  with backoff honoring `Retry-After`; fail-open on 403/429/challenge
  (treat as unavailable, never work around). `robots.txt` is necessary but
  NOT sufficient — site terms + no-login-wall + public-endpoint evidence also
  required.

## Findings / files to inspect

- `providers/ADDING_A_PROVIDER.md` (the contract), `providers/_registry.mjs`,
  `providers/telegram-channel.mjs` (how `linkedin.com/jobs/view` links are
  emitted), `liveness-api.mjs` LinkedIn rung (why guest-endpoint liveness is
  fragile), `plugins/apify/` (keyed fallback), `docs/PLUGINS.md` (Gmail-alerts
  plugin), `docs/SUPPORTED_JOB_BOARDS.md` (evaluated-not-supported precedent).
- Plan-time verdict to confirm-or-overturn with evidence: no LinkedIn or Naukri
  provider exists; both likely need login/API-key/browser-stealth.

## Permitted

- Write NEW files only: `providers/linkedin-*.mjs`, `providers/naukri-*.mjs`
  (or a documented "not feasible" note instead of code), other new
  `providers/<board>.mjs`, NEW `tests/providers/<new>.test.mjs` with inline
  fixtures (no live network in tests).
- Append rows for NEW boards only at END OF TABLE in
  `docs/SUPPORTED_JOB_BOARDS.md` (including "Evaluated, not supported" rows
  on negative findings). NEVER edit existing rows (the freehire row is
  committed on `main`).

## Prohibited

- No edits to existing providers, `scan.mjs`, `scan-ats-full.mjs`,
  `providers/_registry.mjs` (escalate if registration needs core changes),
  `portals.yml`, credentials/cookies/sessions, bot-evasion tooling, paid APIs.
- No live crawling of LinkedIn/Naukri behind login walls; fixtures only.
- No `opencode run`, no spawned subagents, no sends/submissions.

## Deliverables

- Feasibility verdict per source (feasible / keyed-plugin-only / out-of-scope)
  with robots.txt + ToS evidence, in `.mece/cells/job-source-coverage/VERDICTS.md`.
- New provider module(s) ONLY where zero-auth + robots.txt-clean; else the
  verdict row is the deliverable (a negative finding is a complete result).
- Fixture-based tests for any new provider; documented fields collected +
  dedup strategy + employer-confirmation path per source.

## Acceptance criteria

- Three separate verdict rows: (a) LinkedIn listings, (b) LinkedIn posts,
  (c) Naukri — each with access method, auth/ToS/robots evidence, and verdict
  (feasible / infeasible-documented). Listings vs posts are never conflated.
- Any new provider: zero-auth, no secrets, no paid dependency, conservative
  fetch policy honored, JD-text/dedup/employer-URL-confirmation behavior,
  tests pass via the cell-1 runbook command.
- Aggregator-sourced jobs (LinkedIn/Naukri/Wellfound-style) are marked
  UNCONFIRMED pending employer-ATS confirmation (project rule).

## Verification

- Single-suite command from cell 1 for each new/changed test file.
- `node validate-portals.mjs --help` (read-only) to confirm config-shape
  compatibility of any new provider options.

## Dependencies / assumptions

- Depends on cell 1 (test runbook, registration mechanism, entry schema).
- Assumption: provider modules are auto-discovered; if not, escalate.
- `providers/freehire.mjs` is LANDED on `main` (ordinary existing provider):
  treat as reference coverage for catalogue-style discovery; do not duplicate
  it and do not modify it (existing-provider rule above).

## File ownership

- OWNS: NEW `providers/linkedin-*.mjs`, NEW `providers/naukri-*.mjs`, other NEW
  `providers/*.mjs`, NEW `tests/providers/<new>.test.mjs`, appended new-board
  rows in `docs/SUPPORTED_JOB_BOARDS.md`.
- MUST NOT MODIFY: existing providers (incl. landed `freehire.mjs`),
  `scan*.mjs`, registry, modes, portals, user data, `test-all.mjs`,
  existing doc rows.
