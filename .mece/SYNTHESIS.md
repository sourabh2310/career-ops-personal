# SYNTHESIS — Career-Ops inspection findings
Revision 1: 2026-10-10 (plan-only inspection). Revision 2: 2026-10-10
(approved decisions applied; plan-only revision, no code touched).
Revision 3: 2026-10-10 (reconciled with merged `main` @ `d477566c`;
plan-only revision, no code touched).

## Revision 3 — reconciliation log (what changed and why)

- **R1 Former dirty work is LANDED.** The ATS-seeds/freehire changes live on
  `main` (commit `d8de1f90`, PR #4: `providers/freehire.mjs`,
  `tests/providers/freehire.test.mjs`, hardened Workday validation in
  `seeds/vc-portfolios.mjs`, freehire doc row + portals example). All
  "uncommitted / in-flight / pending-upstream" language is retired; freehire
  is now an ordinary landed provider, referenced — never duplicated — by cells.
- **R2 Discovery tool is LANDED.** `discover-company-jobs.mjs` +
  `lib/company-job-discovery.mjs` + `tests/company-job-discovery.test.mjs` +
  `docs/company-job-board-discovery.md` + `examples/company-names.example.csv`
  live on `main` (PR #5, `npm run discover:companies`). Audited 2026-10-10:
  free-first (DuckDuckGo HTML + Bing fallback, ~900 ms pacing, no keys),
  company-name → official domain → career/listing candidates → HTTP
  verification with evidence, 16-ATS detection rules, 0–100 confidence,
  `india_relevance` per row, CSV (`data/company-job-boards.csv`) + JSON cache
  outputs in the gitignored user layer. Cell 3 MUST reuse this output as its
  enrichment/candidate source and MUST NOT build a parallel live-discovery
  engine (see `WAVE.md` landed-code reuse rule).
- **R3 D6 reframed, D1–D5 untouched.** Free-first, English default with
  India-vocabulary-inside-EN, no paid Apify dependency, versioned seed +
  local overlay, conservative fetching, and sequential approval gates are
  unchanged. D6 drops dirty-work preservation (nothing dirty remains) and
  keeps worktree isolation for checkout hygiene + a reproducible base.
- **R4 Gate artifacts renamed to the clean reality.** Cell 1's
  `DIRTY-WORK.md` becomes `TREE-BASELINE.md` (base commit + clean-tree proof +
  landed-commit hashes); cell 5's check (iii) verifies against it instead of
  byte-comparing uncommitted files that no longer exist.
- **R5 Cell 3 scope corrected.** The "branch lands first or rebase" dependency
  is satisfied and removed; the stale "placement needs user answer" note is
  removed (D4 already fixed placement). New cell-3 code is seed
  schema/validation + discovery-CSV→seed conversion + dry-run preview only.

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
- **D6 Isolation (as decided in Rev 2; SUPERSEDED by R3 above):** dirty
  ATS-seeds work preserved untouched; implementation
  runs in a separate worktree/branch (Gate 0, see `WAVE.md`). Cells 2–4
  treat freehire/ats-seeds as pending-upstream: reference, never duplicate.

## Identified conflicts (dirty work vs wave ownership) and resolutions

Status at Revision 3: the dirty work that caused C1/C2/C4 is COMMITTED, so
each resolution below is restated as a standing ownership rule rather than a
temporary shelter arrangement.

- **C1 — `docs/SUPPORTED_JOB_BOARDS.md`:** was uncommitted freehire row vs
  cell 2's ownership of new-board rows. RESOLVED (R1): the freehire row is
  committed; standing rule is append-only end-of-table for NEW boards, never
  edit existing rows.
- **C2 — `seeds/vc-portfolios.mjs`:** was dirty (+51/-5), "owned by in-flight
  work". RESOLVED (R1): it is landed shared code on `main`. Cell 3 still MUST
  NOT modify it — read-only reference; new `seeds/*india*` files only — with
  Gate 2 escalation as the path for any shared-code change.
- **C3 — `tests/discover-*.test.mjs` glob:** previously claimed existing
  `discover-ats`/`discover-new-companies` suites by glob. UNCHANGED:
  cell 3 owns only NEW `tests/discover-india-*.test.mjs` + `tests/seeds-india-*.test.mjs`.
- **C4 — `templates/portals.example.yml` (was dirty freehire block):**
  RESOLVED (R1): the freehire block is committed. Cell 4 designs the starter
  against `main`'s committed template; freehire is a landed option, not a
  pending-upstream note.
- **C5 — parallel implementation risk:** removed. UNCHANGED: Gates 3a–3c
  sequential by default; parallel only with second explicit approval after
  Gate 2.
- **C6 (new) — landed discovery tool vs cell-3 enrichment helpers:**
  `discover-company-jobs.mjs` / `lib/company-job-discovery.mjs` already cover
  company-name → verified-board discovery. RESOLVED (R2): cell 3 reuses the
  tool's CSV output and builds no competing live-discovery code; engine
  changes need Gate 2 escalation.

## Repository state

- Root: `C:\Users\patel\Personal_Data\career-ops`. Branch `main` @ `d477566c`
  (in sync with `personal/main` at last fetch; working tree CLEAN, verified
  2026-10-10). Former ATS-seeds/freehire work LANDED (`d8de1f90`, PR #4);
  company-job-board-discovery LANDED (PR #5).
- `providers/freehire.mjs` (+ `tests/providers/freehire.test.mjs`) is ordinary
  committed code. `seeds/` on `main` = `README.md` + `vc-portfolios.mjs`
  (YC/a16z/ats-scrapers import LANDED — no longer "in progress").
- Discovery has never RUN for this user: no `portals.yml` (scanner never
  configured), `data/pipeline.md` holds template text only, no
  `data/applications.md` tracker, no `data/scan-history.tsv`,
  no `data/company-names.csv` / `data/company-job-boards.csv`,
  no `tests/mece-wave/`. `config/profile.yml` exists (gitignored user layer).
- User profile (`config/profile.yml`, re-verified 2026-10-10): Java Backend
  Developer, Spring Boot / microservices / Kafka / PostgreSQL, Hyderabad
  India, 10–15 LPA, `spend_tier: economy`, `language.output: en`. No
  `modes_dir` set → default English market modes (NOT `modes/hi`), despite
  India targeting.

## Architecture (verified from code)

- `scan.mjs` + ~100 zero-auth provider modules in `providers/` → `data/pipeline.md`
  → `oferta` evaluation → `reports/` + tracker. Auth-gated sources are
  intentionally out of core (plugin layer instead).
- `scan-ats-full.mjs` reverse sweep over ATS directories + `seeds/` (YC, a16z,
  ats-scrapers CSV import — all LANDED on `main`). `discover-ats.mjs`
  resolves company → ATS board (`--write` to `portals.yml` after review);
  `discover-new-companies.mjs` closes the scan-history → candidates loop.
- Company-name → verified-board discovery is LANDED: `discover-company-jobs.mjs`
  (`npm run discover:companies`) + `lib/company-job-discovery.mjs` —
  free-first web discovery with evidence, confidence, `india_relevance`, CSV +
  cache outputs in `data/` (user layer). Cell 3's enrichment source; not a
  wave deliverable to rebuild.
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
2. No dirty work remains to preserve (R1): the Gate 0 worktree exists for
   checkout hygiene and a reproducible base at `d477566c`, not to shelter
   uncommitted changes. The wave must still not collide with landed code —
   cells reference it and extend only via Gate 2 escalation.
3. `portals.yml` absent: nothing runs until post-wave user activation (D1).
   Cell 4's starter + activation checklist covers this. NOTE: the landed
   discovery tool's FIRST run (`data/company-names.csv` → pilot `--limit`)
   is also a post-wave user step, not wave work — cell 3 consumes only
   fixture/sample CSV output, never live runs.
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
6. ~~Land in-flight work or rebase onto dirty tree?~~ RESOLVED-superseded
   (R1): the work LANDED (`d8de1f90`, PR #4) before Revision 3 — nothing to
   land or rebase onto. Gate 0 cuts the worktree from clean `main`.
7. OPEN (Gate 0 approval): approve (a) worktree at
   `../career-ops-wave-java-india`, branch `wave/mece-java-india`, from
   `main` @ `d477566c`; (b) `npm ci` inside it (network install);
   (c) sequential gates (Gate 1 → Gate 2 sign-off → 3a→3b→3c → Gate 4) —
   each item explicitly, per `WAVE.md`'s Gate 0 approval block.
8. OPEN (post-wave): who runs starter activation (copy/snippet → `portals.yml`,
   first `verify-portals` + `audit-portals --baseline`) AND the discovery
   pilot (`data/company-names.csv` → `--limit` run → review CSV) — user solo
   or assisted session?
