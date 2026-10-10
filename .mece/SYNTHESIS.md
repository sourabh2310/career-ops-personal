# SYNTHESIS — Career-Ops inspection findings
Revision 1: 2026-10-10 (plan-only inspection). Revision 2: 2026-10-10
(approved decisions applied; plan-only revision, no code touched).

## Revision 2 — decision log (what changed and why)

- **D1 `portals.yml`:** treated as an unresolved activation/configuration
  issue. Cell 4 now designs a COMPLETE starter configuration
  (`STARTER-PORTALS.yml` + activation checklist in its cell dir); creating or
  applying the live `portals.yml` is an explicit post-wave user step.
- **D2 English default:** wave stays on default English modes. India-specific
  vocabulary and location/eligibility matching are implemented inside the EN
  pipeline (filters, keywords, corpus). `modes/hi` not selected, `modes/`
  unedited. Cell 4's DECISIONS.md records this instead of asking.
- **D3 Free-first:** Apify is optional, disabled by default, out of scope
  unless separately approved. Cell 2 acceptance criteria now forbid
  keyed/paid dependencies; no starter config may contain an enabled
  `provider: apify` entry.
- **D4 Two-layer company data:** version-controlled `seeds/companies-india.yml`
  (committed, provenance per record) + local enrichment overlay in `data/`
  (gitignored user layer). Schema fields fixed in `WAVE.md` (canonical name,
  aliases/dedup, official URLs, ATS slugs, India presence + evidence,
  eligibility + evidence, confidence, `verified_at`/`unverified`).
- **D5 Conservative enrichment:** permitted only where free + public +
  unauthenticated, with per-host pacing, timeouts, backoff honoring
  `Retry-After`, fail-open on 403/429/challenge. `robots.txt` = necessary but
  not sufficient (site terms + no-login-wall + public-endpoint evidence also
  required). Eploy's bounded paced enrichment is the in-repo precedent.
- **D6 Isolation:** dirty ATS-seeds work preserved untouched; implementation
  runs in a separate worktree/branch (Gate 0, see `WAVE.md`). Cells 2–4
  treat freehire/ats-seeds as pending-upstream: reference, never duplicate.

## Identified conflicts (dirty work vs wave ownership) and resolutions

- **C1 — `docs/SUPPORTED_JOB_BOARDS.md`:** uncommitted freehire row vs cell 2's
  ownership of new-board rows. Resolution: append-only at end-of-table; cell 2
  MUST NOT touch the freehire row; isolation worktree excludes dirty files.
- **C2 — `seeds/vc-portfolios.mjs` (dirty, +51/-5):** cell 3 previously allowed
  to "extend" it. Resolution: cell 3 MUST NOT modify it — read-only reference;
  new `seeds/*india*` files only.
- **C3 — `tests/discover-*.test.mjs` glob:** previously claimed existing
  `discover-ats`/`discover-new-companies` suites by glob. Resolution: cell 3
  owns only NEW `tests/discover-india-*.test.mjs` + `tests/seeds-india-*.test.mjs`.
- **C4 — `templates/portals.example.yml` (dirty freehire block):** cell 4's
  starter is designed against the committed template in the clean worktree;
  freehire noted as a pending-upstream option, not a dependency.
- **C5 — parallel implementation risk:** removed. Gates 3a–3c sequential by
  default; parallel only with second explicit approval after Gate 2.

## Repository state

- Root: `C:\Users\patel\Personal_Data\career-ops`. Branch `phase-2/ats-company-seeds`.
- Working tree **dirty**: modified `docs/SUPPORTED_JOB_BOARDS.md`,
  `seeds/vc-portfolios.mjs`, `templates/portals.example.yml`,
  `tests/ats-company-seeds.test.mjs`; untracked `providers/freehire.mjs`,
  `tests/providers/freehire.test.mjs`. Active in-flight work on ATS company
  directory import + a freehire provider — the wave must not collide with it.
- No `.mece/` existed; created by this plan. No `portals.yml` exists
  (scanner never configured). `data/pipeline.md` is empty; no
  `data/applications.md` tracker, no `data/scan-history.tsv`. Discovery has
  never run for this user.
- User profile (`config/profile.yml`): Java Backend Developer, Spring Boot /
  microservices / Kafka / PostgreSQL, ~4 yrs, Hyderabad India, 10–15 LPA,
  `spend_tier: economy`, `language.output: en`. No `modes_dir` set → default
  English market modes (NOT `modes/hi`), despite India targeting.

## Architecture (verified from code)

- `scan.mjs` + ~100 zero-auth provider modules in `providers/` → `data/pipeline.md`
  → `oferta` evaluation → `reports/` + tracker. Auth-gated sources are
  intentionally out of core (plugin layer instead).
- `scan-ats-full.mjs` reverse sweep over ATS directories + `seeds/` (YC, a16z,
  ats-scrapers CSV import — in progress on this branch). `discover-ats.mjs`
  resolves company → ATS board (`--write` to `portals.yml` after review);
  `discover-new-companies.mjs` closes the scan-history → candidates loop.
- Matching: `title_filter`/`location_filter` in `portals.yml` (scanner),
  `title-keywords.mjs`, `role-matcher.mjs`, `skill-extract.mjs`,
  `jd-skill-gap.mjs`, `keyword-match.mjs`, scoring in `modes/_shared.md` (Blocks A–H).
- Verification: `verify-portals.mjs` (reachability), `audit-portals.mjs`
  (content audit + baseline diff), `check-liveness.mjs` (posting still open);
  aggregator listings are UNCONFIRMED until confirmed at the employer ATS.
- Suite: 300+ files in `tests/`, discovered by `test-all.mjs` by glob.

## Job-source verdicts (evidence-backed, not assumed)

| Source | Implemented? | Enabled? | Evidence |
|--------|--------------|----------|----------|
| Company career pages / ATS APIs | Yes (~100 providers) | No (`portals.yml` absent) | `providers/`, `templates/portals.example.yml` |
| LinkedIn job listings | **No** — no provider | No | grep: only liveness rung + telegram link target |
| LinkedIn recruitment posts | **No** | No | no collector exists |
| Naukri listings | **No** — no provider/scraper | No | only `modes/hi/naukri.md` eval prompts |
| Other configured sources | Partially (template has examples; job_boards, HN, Interamt, seeds) | No | `templates/portals.example.yml`, `scan-hn.mjs`, `seeds/README.md` |
| LinkedIn-adjacent that DO exist | liveness check of pasted LinkedIn URLs; `linkedin-join.mjs` warm intros (offline CSV); telegram-channel may emit `linkedin.com/jobs/view` links; third-party Gmail-alerts plugin; keyed `apify` plugin (needs `APIFY_TOKEN`) | — | `liveness-api.mjs`, `linkedin-join.mjs`, `providers/telegram-channel.mjs`, `docs/PLUGINS.md`, `plugins/apify/` |

Collected-job fields: title, URL, company, location (structured ATS field),
description/JD where the feed carries it; dedup by URL + company+title
(+ optional location-aware, req-ID disambiguation) via scan-history and
`merge-tracker.mjs`. Location/India eligibility, remote status, experience, and
skills are evaluated at filter time (`location_filter`, `title_filter`) and at
evaluation time (oferta Blocks A–F); nothing enforces them at a DB level.

## Company-database gaps

- No master company DB file exists; company data = `portals.yml`
  `tracked_companies` (absent) + seed/ATS-directory pipelines.
- No India-presence, eligibility-evidence, provenance, verification-timestamp,
  or confidence schema on portal entries (entries carry `name`, `careers_url`,
  `provider`/`api`, filters, `notes:` free text).
- Duplicate/multi-URL handling exists only via dedup + `discover-ats` probing,
  not a canonical company record. Stale-link detection = `verify-portals` +
  `audit-portals --baseline`, both unrun here.

## Risks

1. LinkedIn/Naukri likely **cannot** be zero-auth providers (login walls, ToS,
   anti-bot). Per D3 a documented "not feasible in core" verdict is a valid
   terminal outcome — fallbacks are employer-ATS confirmation of pasted URLs
   and the (separately-approved-only) keyed Apify / Gmail-alerts plugins.
2. In-flight branch work (`ats-company-seeds`, `freehire`) is preserved via
   the Gate 0 worktree (D6); cells reference it as pending-upstream and never
   duplicate or modify it.
3. `portals.yml` absent: nothing runs until post-wave user activation (D1).
   Cell 4's starter + activation checklist covers this.
4. Free-model constraint (`economy` tier): cells must not introduce evaluators
   requiring paid endpoints.

## Proposed sequence

Gate 0 (isolation) → Gate 1 (cell 1) → Gate 2 (boundary sign-off) →
Gate 3a (cell 2) → Gate 3b (cell 3) → Gate 3c (cell 4) → Gate 4 (cell 5).
See `WAVE.md`. Sequential by default; no parallel implementation cells
until boundaries and dependencies are verified at Gate 2.

## Unresolved questions (Revision 2 status)

1. ~~Starter `portals.yml` scope?~~ RESOLVED (D1): cell 4 designs a complete
   starter (`STARTER-PORTALS.yml` in cell dir); user activates post-wave.
2. ~~English modes vs `modes/hi`?~~ RESOLVED (D2): English default, India
   vocabulary inside the EN pipeline.
3. ~~Apify acceptable if zero-auth fails?~~ RESOLVED (D3): no — Apify stays
   optional/disabled/out-of-scope; infeasibility verdicts are acceptable.
4. ~~Company DB placement?~~ RESOLVED (D4): versioned `seeds/companies-india.yml`
   + gitignored local overlay in `data/`.
5. ~~HTTP enrichment of career pages allowed?~~ RESOLVED (D5): only under the
   conservative enrichment policy in `WAVE.md`.
6. ~~Land in-flight work or rebase onto dirty tree?~~ RESOLVED (D6):
   neither — preserve dirty work untouched, implement in an isolated
   worktree; rebase when upstream lands.
7. OPEN (Gate 0 approval): approve worktree creation + `npm ci` inside it
   (network install) as the first implementation step?
8. OPEN (post-wave): who runs starter activation (copy/snippet → `portals.yml`,
   first `verify-portals` + `audit-portals --baseline`) — user solo or
   assisted session?
