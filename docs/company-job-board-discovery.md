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

- **data/company-job-boards.csv** — one row per discovered board, or one explanatory row when no suitable board was found.
- **data/cache/company-job-discovery.json** — persistent discovery cache.

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

The recommended header is **company_name**. One-column CSV files without a header are also accepted. Quoted fields, commas, escaped quotes, and multiline CSV fields are supported. Company names are preserved even when no domain or board can be identified.

## Output fields

- **official_domain** — best-effort official domain inferred from search evidence.
- **career_homepage_url** — a general career page when found; kept separate from the direct listing URL.
- **job_listing_url** — a candidate board URL that appears to expose job listings.
- **ats_platform** — recognized ATS name, Company-hosted, or Unknown.
- **confidence_score** — evidence-based score from 0–100; it is not a calibrated probability.
- **verification_status** — Verified, Needs review, Not found, or Temporarily unavailable.
- **india_relevance** — whether the URL or page contains India-specific evidence; Global/unknown does not mean the company has no India jobs.
- **evidence** — auditable signals and reasons for review.

The command may return multiple distinct verified boards for one company. It does not claim a board has open jobs merely because the URL responds successfully. A live board with no current vacancies can still be valid.

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

The tests exercise CSV handling, CLI argument parsing, and candidate scoring without making live web requests.
