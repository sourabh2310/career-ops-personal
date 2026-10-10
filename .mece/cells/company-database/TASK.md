# Cell 3 — company-database (Gate 3b, sequential after cell 2)

## Objective

Deliver TWO SEPARATED layers: (a) a version-controlled company seed
(`seeds/companies-india.yml`) prioritizing India presence / India-eligible
opportunities while retaining promising `unverified` companies; (b) a
clearly separated local enrichment overlay in `data/` (gitignored user
layer). Every record carries provenance, confidence, and verification
timestamps. NO mass crawl and NO live enrichment runs in this wave:
schema + seed + validation + dry-run flow only. Enrichment input is the
LANDED discovery tool's CSV output — this cell builds NO live-discovery code.

## Revision 3 constraints (binding)

- `seeds/vc-portfolios.mjs` (LANDED on `main`) is READ-ONLY reference.
  MUST NOT be modified, extended, or rewritten by this cell.
- `discover-company-jobs.mjs` / `lib/company-job-discovery.mjs` (LANDED on
  `main`) are READ-ONLY reference. This cell MUST NOT build a parallel
  live-discovery engine and MUST NOT modify the discovery engine; engine
  changes require Gate 2 escalation. New `seeds/*india*.mjs` code is limited
  to seed schema/validation, discovery-CSV→seed conversion, and dry-run
  preview helpers (fixture data only — never a live run).
- The conservative enrichment policy in `WAVE.md` (pacing, timeouts, backoff,
  fail-open; robots.txt necessary-but-not-sufficient) governs any future
  enrichment helper — this wave only dry-runs.

## Findings / files to inspect

- `seeds/vc-portfolios.mjs` + `seeds/README.md` (YC/a16z/ats-scrapers import,
  LANDED), `scan-ats-full.mjs` (ATS directory sweep), `discover-ats.mjs`,
  `discover-new-companies.mjs`, `company-history.mjs` (read-only evidence card),
  `templates/portals.example.yml` (entry schema: no provenance/confidence
  fields today), `data/` (no master DB exists; `portals.yml` absent).
- Landed discovery tool to reuse (read-only): `discover-company-jobs.mjs` +
  `lib/company-job-discovery.mjs` — input `data/company-names.csv`, output
  `data/company-job-boards.csv` columns: `company_name`, `official_domain`,
  `career_homepage_url`, `job_listing_url`, `ats_platform`,
  `confidence_score`, `verification_status`, `india_relevance`, `evidence`,
  `last_checked_at`, `search_source`. Cell 3 maps THESE columns into seed
  records (provenance = tool + evidence string; `verified_at` =
  `last_checked_at` for `Verified` rows, else explicit `unverified`).
- Plan-time gaps to confirm: no canonical company record, duplicates handled
  only by dedup heuristics, stale links via unrun `verify-portals`/`audit-portals`.

## Permitted

- Create `seeds/companies-india.yml` (version-controlled seed; per-record:
  canonical name, aliases, official website, official career URL(s), ATS
  slug(s), india_presence + evidence, hiring_eligibility + evidence,
  source_provenance, confidence, `verified_at` or explicit `unverified`).
- Document the local overlay (`data/companies.local.yml`, gitignored user
  layer, same schema, overlay-wins) in SCHEMA.md; do NOT commit sample
  enrichment output.
- Create NEW `seeds/*india*.mjs` seed helpers (fixture-tested;
  dry-run/preview output only): seed schema + validator, and a
  discovery-CSV→seed converter mapping the landed tool's columns (above) to
  seed records. NO live fetching, NO new discovery engine.
- Modify `discover-new-companies.mjs`, `discover-ats.mjs` to read/emit the
  new schema (preview/dry-run output only — never `--write` to `portals.yml`,
  never a live discovery run).
- Add NEW `tests/discover-india-*.test.mjs`, `tests/seeds-india-*.test.mjs`
  (new files only; do not edit existing discover/seed suites).

## Prohibited

- No large discovery crawl; no live enrichment or live discovery runs
  (the landed tool is NEVER executed by this cell — fixtures/sample CSV only).
- No edits to `portals.yml` (absent — do not create it), existing company
  rows anywhere, `providers/`, `scan*.mjs`, `company-history.mjs` core logic,
  or the landed discovery engine (`discover-company-jobs.mjs`,
  `lib/company-job-discovery.mjs`).
- No guessing official URLs or India presence — every record carries evidence
  (for converted rows: the discovery tool's `evidence` + `last_checked_at`)
  or an explicit `unverified` status. No overwriting landed
  `seeds/vc-portfolios.mjs`; extend via new files, don't collide.
- No secrets, no authenticated fetches, no `opencode run`, no subagents.

## Deliverables

- `data/companies.*` schema + a small hand-verified seed set (Java-backend
  employers with India presence; each with evidence links).
- Deduplication rule (canonical name + aliases + multi-URL handling) documented
  in `.mece/cells/company-database/SCHEMA.md`.
- Dry-run preview output showing discovery-CSV-row → seed-record →
  portals-entry flow (from fixture/sample CSV rows — never a live tool run).

## Acceptance criteria

- Every seeded record has provenance + confidence + `verified_at` or explicit
  `unverified` status; zero fabricated URLs (each career URL resolved from an
  evidence source cited on the record).
- Seed vs overlay separation is enforced: committed seed contains only
  hand-verified/provenance-backed rows; machine-enriched rows belong in the
  gitignored overlay. A validator test rejects a seed row missing any
  required field (negative test).
- Duplicates/multi-URL cases in the seed set resolve deterministically per the
  documented rule (canonical name + aliases + career-URL canonicalization),
  covered by tests.
- Dry-run preview demonstrates seed → candidate → portals-entry flow without
  writing `portals.yml` or touching network beyond fixture data.

## Verification

- Cell-1 single-suite command for each new/changed test file.
- Schema validator (new or extended script) run against the seed file: must
  reject a record missing provenance/verification status (negative test).

## Dependencies / assumptions

- Depends on cell 1 (runbook, entry schema) + Gate 2 sign-off. The former
  "ats-seeds lands first" external dependency is SATISFIED (landed on `main`).
- Seed vs overlay placement is FIXED by D4 (committed seed + gitignored
  overlay in `data/`) — no open placement question remains.

## File ownership

- OWNS: `seeds/companies-india.yml` (new), NEW `seeds/*india*.mjs`,
  `discover-new-companies.mjs`, `discover-ats.mjs`,
  NEW `tests/discover-india-*.test.mjs`, NEW `tests/seeds-india-*.test.mjs`.
- MUST NOT MODIFY: `seeds/vc-portfolios.mjs` (landed), the landed discovery
  engine (`discover-company-jobs.mjs`, `lib/company-job-discovery.mjs`),
  `providers/` (incl. landed `freehire.mjs`), `scan*.mjs`, `portals.yml`,
  existing test suites, modes, user profile/CV/tracker.
