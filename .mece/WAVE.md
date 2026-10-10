# MECE Work Wave — Career-Ops Job Discovery for Java Backend (India)
# Revision 3 (2026-10-10): reconciled with merged main (d477566c). PLAN-ONLY.
# Rev 2 assumed a dirty phase-2/ats-company-seeds checkout; that work is now
# LANDED on main, as is the company-job-board-discovery tool (PR #5).

## Goal

Make career-ops discover relevant **Java Backend Developer** opportunities for an
India-based candidate (Sourabh Kumar Patel, Hyderabad, 10–15 LPA, `spend_tier: economy`),
verify employers and career pages, match jobs against the profile, and support an
organized application workflow — using free, permitted methods only.

## Approved decisions (binding on all cells)

1. **Missing `portals.yml` = unresolved activation issue.** A complete starter
   configuration is DESIGNED (cell 4 deliverable, staged in the cell dir) but
   never created or applied as live config during the wave. Activation
   (copy → review → run) is an explicit user-executed step after the wave.
2. **English default.** Discovery and matching stay on default English modes;
   India-specific vocabulary (city names, "India", remote-India phrasing) and
   location/eligibility matching are supported inside the EN pipeline.
   `modes/hi` is NOT selected; `modes/*.md` are not edited.
3. **Free-first.** Only free, permitted discovery. Paid Apify integration stays
   optional, disabled by default, and OUT OF SCOPE unless separately approved.
   No cell may introduce a keyed/paid dependency.
4. **Two-layer company data.** (a) Version-controlled seed
   (`seeds/companies-india.yml`, provenance per record) + (b) a clearly
   separated local enrichment overlay in `data/` (gitignored user layer).
   Records specify: canonical name, aliases/dedup rule, official website +
   official career URL, ATS slug(s), India presence + evidence, hiring
   eligibility + evidence, confidence, `verified_at` / `unverified` status.
5. **Conservative enrichment only.** Future zero-auth career-page enrichment is
   allowed only where permitted: public unauthenticated endpoints, bounded
   pacing per host, timeouts, retries with backoff honoring `Retry-After`,
   fail-open on 403/429/challenge (unavailable, never worked around).
   `robots.txt` compliance is necessary but NOT sufficient proof of permission —
   site terms, no-login-wall, and public-endpoint evidence are also required.
6. **Implementation is isolated; landed code is shared reference.** The former
   ATS-seeds/freehire work is LANDED on `main` (commit `d8de1f90`, PR #4) and
   the company-job-board-discovery tool is LANDED on `main` (PR #5). All wave
   implementation runs in a separate worktree/branch cut from current `main`
   (Gate 0) to keep the user's live checkout pristine — not to shelter dirty
   work, since there is none. Cells treat landed code as read-only reference
   and EXTEND rather than duplicate it (see Landed-code reuse rule below).

## Cell inventory

| # | Cell | Objective | Owns (writes) |
|---|------|-----------|---------------|
| 1 | `repository-audit` | Verified inventory + tree-baseline record + test runbook | `.mece/cells/repository-audit/*` only (read-only elsewhere) |
| 2 | `job-source-coverage` | LinkedIn listings vs LinkedIn posts vs Naukri: three separate feasibility verdicts; providers only where free + permitted | NEW `providers/linkedin-*.mjs` / `providers/naukri-*.mjs` / other NEW `providers/*.mjs`, NEW `tests/providers/<new>.test.mjs`, appended rows for NEW boards in `docs/SUPPORTED_JOB_BOARDS.md` |
| 3 | `company-database` | Versioned India seed + local overlay schema + dry-run discovery flow, reusing the landed discovery tool's output | NEW `seeds/companies-india.yml`, NEW `seeds/*india*.mjs` (seed schema/validation + discovery-CSV→seed conversion; NO new live-discovery engine), `discover-new-companies.mjs`, `discover-ats.mjs` (schema read/emit, dry-run only), NEW `tests/discover-india-*.test.mjs`, `tests/seeds-india-*.test.mjs` |
| 4 | `job-matching-quality` | EN-pipeline Java-backend × India matching + complete starter-config DESIGN | `title-keywords.mjs`, `role-matcher.mjs`, `skill-extract.mjs`, `jd-skill-gap.mjs`, `keyword-match.mjs`, their `tests/*` suites, `.mece/cells/job-matching-quality/*` (incl. `STARTER-PORTALS.yml` design + activation checklist) |
| 5 | `testing-and-validation` | Independent verification of cells 2–4 output | NEW `tests/mece-wave/*.test.mjs` only (never product code or existing tests) |

## Non-overlap guarantees (verified, Gate 2)

- Providers (cell 2, new files only) vs seeds/discovery scripts (cell 3) vs
  matching scripts (cell 4) vs new-path-only tests (cell 5) vs read-only audit
  (cell 1). Cell 3 MUST NOT modify `seeds/vc-portfolios.mjs` (landed shared
  code — read-only reference); new `seeds/*india*` files only.
- Cell 2 appends rows for NEW boards only in `docs/SUPPORTED_JOB_BOARDS.md`
  (append-only, end-of-table) and MUST NOT edit existing rows (the freehire
  row is now committed on `main`).
- **Landed-code reuse rule (audited 2026-10-10 against `main` @ `d477566c`).**
  `discover-company-jobs.mjs` + `lib/company-job-discovery.mjs` already
  implement free-first company-name → verified-board discovery (official
  domain, career/listing URLs, 16-ATS detection, confidence + evidence,
  `india_relevance`, CSV + cache in `data/`). Cell 3 MUST reuse its
  `data/company-job-boards.csv` output as the enrichment/candidate source and
  MUST NOT build a parallel live-discovery engine. New cell-3 code is limited
  to seed schema/validation, CSV→seed conversion, and dry-run preview.
  Changes to the discovery engine itself require Gate 2 escalation.
- `modes/*.md`, `scan.mjs`, `scan-ats-full.mjs`, `merge-tracker.mjs`,
  `verify-pipeline.mjs`, `test-all.mjs`, `providers/_registry.mjs` (unless cell
  1 proves registration needs it — then escalate, don't edit),
  `lib/company-job-discovery.mjs`, `discover-company-jobs.mjs` (unless Gate 2
   escalation approves an extension) are off-limits to all cells.
- User layer (`portals.yml`, `config/profile.yml`, `cv.md`,
  `data/applications.md`, `modes/_profile.md`) is never written by any cell.
  Cell 4's starter config lives in its cell dir; the user activates it.

## Isolation strategy (Gate 0, conductor-executed, needs user approval)

Base state (verified 2026-10-10): branch `main` @ `d477566c`, working tree
CLEAN — the former ATS-seeds/freehire work is committed (`d8de1f90`, PR #4)
and the company-job-board-discovery tool is committed (PR #5). There is no
dirty work to shelter; isolation exists to keep the user's live checkout
pristine and give cells a reproducible base:

1. Verify the base first: `git status --porcelain` MUST be empty and HEAD
   MUST be the approved base commit before the worktree is created. If either
   check fails, stop and report — do not proceed.
2. Create an isolated worktree from current `main` on a new branch, e.g.
   `git worktree add ../career-ops-wave-java-india -b wave/mece-java-india main`.
   Implementation cells run ONLY in that worktree — never in the live checkout.
3. The worktree contains tracked files only: user-layer files (`portals.yml`
   absent anyway; `config/profile.yml`, `cv.md`) are READ from the original
   checkout read-only when needed as ground truth.
4. `node_modules` is not carried into the worktree: the first implementation
   step there is `npm ci` (network install — covered by the Gate 0 approval).
5. Landed code travels with the base: cells treat freehire/ats-seeds and the
   discovery tool as committed reference (extend, never duplicate: cell 4's
   starter lists freehire as a landed option).

### Gate 0 approval (required before any worktree, install, or cell work)

Approve ALL of the following explicitly (a single "approved" is insufficient —
each item needs a yes):

- (a) Worktree location + branch: `../career-ops-wave-java-india`,
      new branch `wave/mece-java-india`, cut from `main` @ `d477566c`.
- (b) `npm ci` inside the worktree (downloads dependencies from the network).
- (c) Execution gates stay sequential (Gate 1 → Gate 2 sign-off → Gates
      3a–3c in order → Gate 4), per the staged execution below.

## Staged execution (no parallel implementation before Gate 2 sign-off)

```
Gate 0: isolation (conductor, needs approval below)
Gate 1: cell 1 (repository-audit) — includes tree-baseline record + runbook
Gate 2: boundary verification (conductor): cell-1 outputs confirm registration
        mechanism, entry schema, ownership map → explicit sign-off
Gate 3a: cell 2 (job-source-coverage) — three separate source verdicts
Gate 3b: cell 3 (company-database) — seed + overlay + dry-run flow
Gate 3c: cell 4 (job-matching-quality) — matching + STARTER-PORTALS design
Gate 4: cell 5 (testing-and-validation, last)
```

- Gates 3a–3c run SEQUENTIALLY by default (3a → 3b → 3c: providers constrain
  the starter config; the seed constrains company coverage). Parallel run only
  with a second explicit approval after Gate 2.
- Cell 5 depends on 3a–3c all completing.

## Halt conditions (any cell stops and reports back if)

- A source requires auth, cookies, session tokens, or bot-protection evasion.
- A `robots.txt` names Claude/Anthropic crawlers as disallowed (TopDev /
  CareerLink precedent) — necessary-but-not-sufficient: also check site terms.
- Paid/keyed access would be required (Apify or otherwise) — out of scope.
- Enrichment would exceed the conservative policy (pacing, timeouts, backoff,
  fail-open) — stop, do not "make it work".
- A documented infeasibility verdict is an ACCEPTABLE terminal result for any
  of the three assessed sources (LinkedIn listings, LinkedIn posts, Naukri).
