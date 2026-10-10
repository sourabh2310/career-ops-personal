# Cell 1 — repository-audit

## Objective

Produce a verified, evidence-backed inventory of the career-ops repo:
what is implemented, partially implemented, missing, broken, or unverified —
with every claim pointing at code or test output, never at config-name mentions.

## Scope

Read-only inspection of: repo root layout, `ARCHITECTURE.md`, `DATA_CONTRACT.md`,
`scan.mjs`, `scan-ats-full.mjs`, `providers/_registry.mjs`,
`templates/portals.example.yml`, `modes/scan.md`, `modes/discover.md`,
`seeds/`, `discover-*.mjs`, matching scripts, verification scripts,
`tests/` layout, `test-all.mjs` invocation, `package.json` scripts.

## Findings to verify (from plan-time inspection)

- ~100 provider modules in `providers/`; confirm exact count of non-helper
  modules and the registration mechanism (auto-discovered vs registry edit).
- `portals.yml` absent; `data/pipeline.md` empty; no tracker, no scan-history.
- No LinkedIn/Naukri provider (only liveness rung, `linkedin-join.mjs`,
  telegram link targets, apify/Gmail plugins, `modes/hi` prompts).
- Dirty tree on branch `phase-2/ats-company-seeds` (freehire + ats-seeds work).
- Confirm the exact command to run a SINGLE test suite (needed by cells 2–5).

## Permitted

- Read files; run read-only git commands (`status`, `log`, `diff --stat`).
- Run read-only health commands that touch no data
  (e.g. `node verify-pipeline.mjs`, `node doctor.mjs --json`).
- Write only inside `.mece/cells/repository-audit/`.

## Prohibited

- No edits to any file outside the cell dir. No `opencode run`, no agents,
  no installs, no migrations, no network scans, no credential use.

## Deliverables

- `.mece/cells/repository-audit/FINDINGS.md`: module inventory table
  (file → purpose → status: verified/partial/missing/broken) with file:line refs.
- `.mece/cells/repository-audit/TEST-RUNBOOK.md`: exact single-suite test
  command + full-suite command, provider-registration mechanism, portals entry
  schema (fields observed in `templates/portals.example.yml`).
- `.mece/cells/repository-audit/DIRTY-WORK.md`: read-only record of
  pre-existing uncommitted work (files, `git diff --stat`, relation to wave
  ownership) so Gate 0 isolation can be verified against it.
- `.mece/cells/repository-audit/OWNERSHIP-MAP.md`: confirmed per-file
  ownership table for cells 2–5 (feeds the Gate 2 boundary sign-off).

## Acceptance criteria

- Every "implemented" claim cites a file:line or a passing test.
- Every "missing" claim cites the search performed (pattern + scope).
- TEST-RUNBOOK commands verified by actually running them read-only
  (e.g. `--help` flags, one existing suite if runnable without side effects).
- No file outside the cell dir modified (`git status --short` shows only
  `.mece/` additions from this wave).

## Verification

- `git status --short` — only `.mece/` paths added.
- Re-run the documented single-suite command from a clean shell; it must work.

## Dependencies / assumptions

- None (first cell). Assumption: `providers/` modules are auto-registered;
  if a registry edit is required, document it — cells 2–4 depend on this answer.
- Runs in the Gate 0 worktree AND records the original checkout's dirty state
  read-only (never touches, stages, or carries over dirty files).

## File ownership

- OWNS: `.mece/cells/repository-audit/*`. MUST NOT MODIFY: everything else.
