# Company job-board discovery

This command starts from **company names only**. It searches public web results, identifies likely official company domains, inspects official-site career links, detects supported ATS providers, verifies candidate job-board URLs, and writes a reviewable CSV.

## Quick start

Create **data/company-names.csv**:

~~~csv
company_name
Amazon
Microsoft
Atlassian
ServiceNow
Stripe
~~~

Run a small pilot first:

~~~bash
npm run discover:companies -- --input data/company-names.csv --limit 25
~~~

Default outputs:

- **data/company-job-boards.csv** — one row per discovered destination, or one explanatory row when no suitable destination was found.
- **data/cache/company-job-discovery.json** — persistent discovery cache (schema version 2; older caches are ignored and rebuilt).

Use a custom input/output path:

~~~bash
node discover-company-jobs.mjs --input ./companies.csv --output ./job-boards.csv
~~~

Force a refresh, or inspect the CLI without network access:

~~~bash
node discover-company-jobs.mjs --help
node discover-company-jobs.mjs --input ./companies.csv --limit 3 --refresh
~~~

## Input format

The recommended header is **company_name**. One-column CSV files without a header are also accepted. Quoted fields, commas, escaped quotes, and multiline CSV fields are supported. Company names are whitespace-normalized and deduplicated case-insensitively, so repeated names share one discovery pass; the first submitted spelling is preserved on every output row for traceability.

## Output fields

- **company_name** — the submitted company name (first spelling wins on repeats).
- **official_domain** — best-effort official domain inferred from search evidence. Never taken from a third-party host, and never from a bare company-name substring (see identity rules below).
- **career_homepage_url** — a verified careers homepage or search hub. Empty when the row is an individual vacancy or when no careers page was verified.
- **job_listing_url** — an individual vacancy URL, an ATS board URL, or a candidate URL kept for review. Empty when the row is a homepage-type destination.
- **ats_platform** — recognized ATS name, Company-hosted, or Unknown.
- **confidence_score** — additive evidence score from 0–100; descriptive, not a calibrated probability, and never the sole basis for a classification (see scoring).
- **verification_status** — Verified, Needs review, Not found, or Temporarily unavailable (see statuses).
- **india_relevance** — `india_specific`, `global`, or `unknown` (see geography).
- **evidence** — auditable signals and reasons for review.
- **destination_type** — what the URL *is*, independent of whether it verified (see destination types).

The command may return multiple distinct verified destinations for one company (up to three). It does not claim open jobs merely because a URL responds successfully. A live board with no current vacancies can still be a valid `ats_job_board` or `official_careers_homepage` row.

## Destination types vs verification statuses

`destination_type` says WHAT a URL is; `verification_status` says WHETHER it checked out:

| destination_type | Meaning |
|---|---|
| `official_company_website` | The company's own site, verified as official but with no job-destination evidence. Never a vacancy. |
| `official_careers_homepage` | Official careers hub or job-search page. No individual vacancy is claimed. |
| `ats_job_board` | Recognized ATS tenant/board belonging to the company (job-search interface, not necessarily one vacancy). |
| `verified_active_job` | An individual opening with direct vacancy evidence (see below) on an official or ATS destination whose identity matches the company. |
| `third_party_job_source` | Aggregator or third-party company profile (Naukri, Cutshort, Jobaaj, LinkedIn, …). Never Verified, never official. |
| `needs_review` | Fetched but ambiguous — uncertain company association or unclear destination. |
| `not_found` | No reliable destination discovered. |
| `temporarily_unavailable` | Fetch or search was blocked (HTTP 429/5xx, timeouts, DNS). Retry later; not a finding. |

`verification_status` semantics:

- **Verified** — the destination is confirmed as a job/careers destination (homepage, ATS board, or individual vacancy per `destination_type`) with company-identity evidence and confidence ≥ 50. A Verified homepage is NOT a confirmed vacancy.
- **Needs review** — fetched but ambiguous, third-party, or an official page without job evidence. Manual judgment required.
- **Not found** — no reliable destination discovered.
- **Temporarily unavailable** — verification was blocked; the row records the failure, not a result.

### What counts as vacancy evidence

A page is a `verified_active_job` only with **direct** evidence: JSON-LD `JobPosting` plus a detail route or a job ID in the URL, a job/requisition ID reference plus application language, or an unambiguous official-domain detail route (`/CareerDetail/…`, `/job-details/…`) plus application language. Listing hubs (`/jobsearch`, `/search-results`, `/careers/jobs`) aggregate many openings, so they stay hubs — typed `ats_job_board` or `official_careers_homepage` — even when they embed structured data for the listed jobs. Career language plus job-card words alone (usually site-wide nav/footer boilerplate such as "search jobs / apply now") only proves a careers destination. These paths can never be vacancies regardless of keywords: culture/life-at pages, blogs/articles/perspectives, generic `/apply` hubs, intern-program pages, and `…/home` portal landings without vacancy evidence. A URL containing `jobs`, `careers`, or `apply` is not sufficient evidence on its own. One canonical homepage-type row is kept per official host (`/careers` and `/jobs`, or `/careers` and the site root, collapse to the best row); distinct vacancies and locale destinations never collapse.

## Supported ATS providers

Greenhouse, Lever, Ashby, Workday, SmartRecruiters, iCIMS, BambooHR, Workable, Recruitee, Personio, Teamtailor, SuccessFactors, Oracle Cloud, Jobvite, Pinpoint, Rippling, and **Darwinbox**.

### Darwinbox detection rules

- `<tenant>.darwinbox.in` — employer-specific tenant portals (observed live, e.g. `allcargo.darwinbox.in` serving a candidate login/careers shell with `/images/darwinbox/poweredby.png` and "Powered By" Darwinbox branding).
- `<tenant>.darwinbox.com/ms/candidate/…` — candidate-portal path on Darwinbox tenants (observed, e.g. `rategain.darwinbox.com/ms/candidate/careers`).
- Page-content portal markers (`/images/darwinbox/`, `powered-by-darwinbox`, `dbox.darwinbox.com`) only CONFIRM a hostname/path match; they never classify on their own.
- Never classified: bare `darwinbox.com` / `darwinbox.in` and other Darwinbox corporate subdomains (newsroom, blog, product pages); URLs that merely contain the word `darwinbox` in the company name, query string, or page text.
- ATS detection is independent of vacancy verification: a Darwinbox board is typed `ats_job_board` unless an individual vacancy is evidenced, in which case it is `verified_active_job` with `ats_platform` Darwinbox.
- Limitation: tenants using fully custom domains (no `darwinbox.*` host or portal path) are not detectable without deeper content analysis; such pages stay `needs_review` with the evidence recorded.

## Company identity verification

Official ownership is never inferred from a company-name substring alone. `identitySignals` requires ≥ 60% of name tokens to match, and short tokens (≤ 3 chars, e.g. `mg` in `1 mg`, `ai` in `247.ai`) count only on whole-word matches — so `1mgdoctors.com` is not accepted as the official domain of `1 mg`. Signals combined: official-site cross-links, page title/metadata branding, domain consistency, and ATS tenant identity. Third-party hosts are excluded from official-domain candidacy entirely, and ambiguous candidates stay `needs_review` with the uncertainty recorded in `evidence`. Similar names never silently share a domain: each input maps to its own canonical identity key.

## India relevance

- `india_specific` — an India locale signal (URL path like `/in-en/`, `.in`/`.co.in` host) together with India hiring text, or an explicit India-jobs page. A lone locale segment is kept but flagged `unconfirmed` in `evidence`; a globally accessible careers page alone never claims India relevance.
- `global` — a verified careers destination with no India evidence. This does not mean the company has no India jobs.
- `unknown` — inconclusive rows (not found, unavailable, needs review without geography).

Locale-specific URLs (`/in-en/…` vs `/us/en/…`) are preserved as materially different destinations and never merged.

## URL normalization and deduplication

Dedup key (`normalizeUrlForDedup`): scheme `http`/`https` equivalent, hostname lowercased with leading `www.` stripped, default ports removed, tracking params (`utm_*`, `gclid`, `fbclid`, `msclkid`, `_ga`, …) and plain fragments dropped, remaining query params sorted. Preserved because they route or identify content: job IDs, req IDs, locale/pagination params, SPA job-app fragments (`#/job/…`), and materially different paths. One canonical careers homepage per official host (`/careers` and `/jobs` on the same domain collapse to the best row); distinct vacancies and locale destinations never collapse. Company key: case/whitespace-insensitive name. Output is sorted by (company, destination rank, destination URL), so reruns and input reorderings export byte-identically apart from timestamps. CSV round-trips through the RFC-4180 parser (`parseCsv`/`toCsv`).

## Cache behaviour

Cache entries carry `expires_at`. Normal findings live for `--cache-ttl-hours` (default 168); rows that only record transient failures (`temporarily_unavailable`) expire after at most 24 hours so an outage is never stored as a finding. `--refresh` ignores fresh entries. Schema or verification-semantics changes bump the cache version (currently 2) and silently invalidate older caches — including stale `Verified` labels assigned under previous rules. Malformed cache files are treated as empty; search-provider failures are recorded as errors, never as boards.

## Limitations

- Ordinary HTTP inspection only: JavaScript-heavy boards, bot challenges, and login-walled portals stay `needs_review` or `temporarily_unavailable`.
- A Verified destination is not a confirmed open requisition; confirm headcount with the employer before applying.
- Search providers (DuckDuckGo HTML, Bing fallback) may rate-limit or change markup; the module paces requests and reports blocks as temporary failures.

## Options

| Option | Meaning |
|---|---|
| --input PATH | Input CSV (default data/company-names.csv) |
| --output PATH | Output CSV (default data/company-job-boards.csv) |
| --cache PATH | JSON cache location |
| --limit N | Process the first N companies |
| --max-candidates N | Candidate URLs to verify per company (default 8) |
| --cache-ttl-hours N | Cache freshness window (default 168 hours) |
| --refresh | Ignore fresh cache entries |
| --help | Show usage |

## Free-first search and limits

The first search provider is DuckDuckGo's public HTML results, with Bing as a fallback. These services can change their markup, rate-limit automated access, or block requests. This module intentionally makes paced requests and records temporary failures rather than reporting a confident Not found when search was blocked. No search API key is required, and no paid service is configured.

The first version uses ordinary HTTP inspection and existing Career Ops network/IP safety guards. Some JavaScript-heavy pages, bot challenges, and complex tenant URLs may remain Needs review; browser-based verification can be added where useful. Do not run high-volume batches until a small pilot has been reviewed.

## Test

~~~bash
node test-all.mjs --only company-job-discovery
~~~

The tests exercise CSV handling, CLI argument parsing, URL normalization/dedup, destination classification, company-identity matching, India relevance, ATS detection (including Darwinbox true/false positives and all pre-existing providers), confidence caps, cache expiry/invalidation, and end-to-end fixture-driven discovery runs — all with mocked HTTP responses and deterministic HTML fixtures, no live network.
