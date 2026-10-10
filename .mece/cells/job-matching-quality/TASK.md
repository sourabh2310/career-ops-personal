# Cell 4 — job-matching-quality (Gate 3c, sequential after cell 3)

## Objective

Make matching discriminate for a Java Backend (Spring Boot, microservices,
Kafka, PostgreSQL, ~4 yrs) × India (Hyderabad, remote/hybrid/onsite, 10–15 LPA)
search across: title relevance, location/India eligibility, remote status,
experience band, and required-skills coverage — on the DEFAULT ENGLISH
pipeline (`spend_tier: economy`), with India-specific vocabulary supported
inside it (city names, "India"/"Remote, India" phrasing, eligibility signals).

## Revision 2 constraints (binding)

- English default confirmed (D2): NO `modes/` edits, NO `modes_dir` switch.
  DECISIONS.md records the rationale; India vocabulary lives in filters,
  keywords, and corpus — not in prompt modes.
- `portals.yml` is an unresolved activation issue (D1): this cell designs a
  COMPLETE starter configuration — `STARTER-PORTALS.yml` (title/location
  filters, Java-backend × India companies from cell 3's seed, free providers
  only incl. cell 2's verdicts, NO enabled `provider: apify` entry) plus
  `ACTIVATION-CHECKLIST.md` (user copies, reviews, runs `verify-portals` +
  `audit-portals --baseline`, first scan). The live `portals.yml` is NEVER
  created or applied by this cell.

## Findings / files to inspect

- `title-keywords.mjs`, `role-matcher.mjs`, `skill-extract.mjs`,
  `jd-skill-gap.mjs`, `keyword-match.mjs`, `match-star.mjs`,
  `templates/portals.example.yml` `title_filter`/`location_filter` semantics
  (structured location field only; missing data never penalized),
  `modes/_shared.md` scoring + `modes/oferta.md` Blocks A–F (read-only reference),
  `config/profile.yml` + `cv.md` (candidate ground truth — read, don't rewrite
  without approval), `modes/hi/` (India vocabulary; `modes_dir` stays unset per D2 — record the EN-default rationale in DECISIONS.md, do not switch it).

## Permitted

- Modify: `title-keywords.mjs`, `role-matcher.mjs`, `skill-extract.mjs`,
  `jd-skill-gap.mjs`, `keyword-match.mjs` + their existing `tests/*` suites
  (Java-backend corpus: Spring Boot, Kafka, microservices titles; India
  location strings; 3–5 yr experience bands).
- Write `.mece/cells/job-matching-quality/STARTER-PORTALS.yml`: the COMPLETE
   starter configuration design (filters + companies + free providers only),
   `ACTIVATION-CHECKLIST.md` (user-executed activation steps: starter review
   PLUS the discovery pilot — `data/company-names.csv` → `--limit` run →
   review `data/company-job-boards.csv`), and
   `DECISIONS.md` (EN-default rationale, freehire-as-landed note).
  Never write `portals.yml` directly.

## Prohibited

- No edits to `modes/*.md` (shared scoring prompts — off-limits),
  `portals.yml`, `config/profile.yml`, `cv.md`, `modes/_profile.md`
  (user layer; proposals only), providers, scan/tracker core.
- No fabricated skills keywords (keywords reformulated from cv.md, never
  invented). No paid-model evaluators. No `opencode run`, no subagents.

## Deliverables

- Improved title/experience/skills matching with Java-backend × India test
  corpus (positive + negative cases: e.g. Java backend vs JavaScript/Java
  frontend, "4 years" vs "8+ years", Hyderabad vs US-only).
- STARTER-PORTALS.yml (complete, free-only, apify-free) + ACTIVATION-CHECKLIST.md.
- DECISIONS.md recording the EN-default + India-vocabulary-inside-EN rationale.

## Acceptance criteria

- Corpus tests fail pre-fix and pass post-fix (red-green demonstrated).
- Location filter keeps "Remote, India"/Hyderabad roles, drops geo-blocked
  ones, and never penalizes missing location data (project rule).
- Experience extraction distinguishes the 3–5 yr band from senior-only JDs.
- Skills gap output never injects keywords into CV-facing artifacts.

## Verification

- Cell-1 single-suite command for each touched suite
  (`title-*`, `role-matcher*`, `skill-extract*`, `jd-skill-gap*`, `keyword-*`).
- `node keyword-match.mjs --help` / `node jd-skill-gap.mjs --help` smoke run
  (read-only flags only).

## Dependencies / assumptions

- Depends on Gate 2 sign-off + cells 2–3 complete (provider verdicts constrain
  the starter's provider list; the company seed constrains its company list).
  Assumption: `economy`-tier models suffice for all matching logic (no LLM
  calls in these scripts — pure heuristics).

## File ownership

- OWNS: `title-keywords.mjs`, `role-matcher.mjs`, `skill-extract.mjs`,
  `jd-skill-gap.mjs`, `keyword-match.mjs`, their `tests/*` suites,
  `.mece/cells/job-matching-quality/*`.
- MUST NOT MODIFY: `modes/`, `portals.yml`, `config/profile.yml`, `cv.md`,
  providers, scan/tracker/verify core, `test-all.mjs`.
