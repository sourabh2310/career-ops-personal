# Cell 5 — testing-and-validation (Gate 4, runs LAST, after Gates 3a–3c)

## Objective

Independently verify the wave's combined output against every cell's
acceptance criteria — including the Revision 2 gates: starter config is
complete yet unapplied, no paid dependency exists, seed/overlay separation
holds, the three source verdicts are separate rows, and the dirty work is
untouched.

## Scope

- Consume outputs of cells 2–4 (runs LAST). Read-only execution of repo
  scripts with `--help`/`--dry-run`/fixture flags; full `test-all.mjs` run
  if feasible on the free setup, else the affected suites via cell-1 runbook.

## Permitted

- Add NEW validation suites ONLY under `tests/mece-wave/*.test.mjs`
  (end-to-end: provider → filter → dedup → schema-validation walkthroughs
  with inline fixtures; no live network).
- Run any test/verify command read-only.

## Prohibited

- No modifications to product code (`*.mjs` outside `tests/mece-wave/`),
  existing tests, `modes/`, `portals.yml`, user data, `test-all.mjs`,
  tracker/reports/data. Fix nothing — file defects back to the owning cell.
- No live scans writing `data/pipeline.md` or scan-history; no submissions,
  no credentials, no `opencode run`, no subagents.

## Deliverables

- `tests/mece-wave/*.test.mjs` validation suites + 
  `.mece/cells/testing-and-validation/REPORT.md` (suite results, coverage of
  wave acceptance criteria, defects filed per owning cell).

## Acceptance criteria

- Every acceptance criterion of cells 2–4 has at least one corresponding
  validation test or a documented reason it cannot be tested offline.
- Wave-gate checks: (i) `git status` in the worktree shows no `portals.yml`
  created; (ii) no `APIFY_TOKEN`/keyed provider in the starter or code;
  (iii) original checkout's dirty files byte-identical to the Gate 1
  DIRTY-WORK.md record; (iv) three separate source verdicts present.
- Full-suite (or affected-suite) run is green; REPORT.md records exact
  commands, commit hash tested, and any skips with justification.
- Zero diffs outside `tests/mece-wave/` and the cell dir.

## Verification

- `git status --short` shows only `tests/mece-wave/` + `.mece/` additions.
- REPORT.md's commands reproduce green from a clean shell.

## Dependencies / assumptions

- Depends on cells 1–4 complete. Assumption: fixtures suffice for offline
  validation (no live ATS/portal calls in tests — project convention).

## File ownership

- OWNS: `tests/mece-wave/*.test.mjs`, `.mece/cells/testing-and-validation/*`.
- MUST NOT MODIFY: everything else in the repo.
