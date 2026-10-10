// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

import { fetchJsonWithRetry, sleep } from './_http.mjs';
import { decodeEntities } from './_html-entities.mjs';
import { htmlToText } from './_html-to-text.mjs';
import { safeEncodeURIComponent } from './_safe-url.mjs';

// freehire provider — freehire.me, an MIT-licensed open-source catalogue of
// IT jobs crawled directly from company career pages (92 ATS platforms,
// ~294k companies, ~3.3M open postings at the time of writing). Keyless public
// JSON API, no auth, no cookie, documented for programmatic/agent consumers:
//
//   GET https://freehire.me/api/v1/agent/jobs/search?q=<query>&limit=100&offset=0
//   → { data: [ { public_slug, source, external_id, url, title, company,
//       company_slug, location, description (HTML), countries, regions,
//       work_mode, skills, cities, posted_at, closed_at, enrichment,
//       reality, ... } ], meta: { total, limit, offset } }
//
// robots.txt (verified 2026-10-10) allows `User-agent: *` everywhere except
// /my/, /signin and discussion paths, and explicitly points bots at this API
// ("The whole catalogue is a public, unauthenticated JSON API").
//
// Configure via a `job_boards` entry with `provider: freehire` (no detect() —
// only reachable via an explicit provider:, same shape as yourator.mjs):
//
//   - name: freehire (open IT catalogue)
//     provider: freehire
//     keywords: ["java backend", "spring boot"]  # optional; one server-side
//                                                # full-text query per entry,
//                                                # results deduped by URL
//     max_pages: 20                              # optional page cap per query
//                                                # (100 rows/page, default 20,
//                                                #  hard cap 100)
//     enabled: true
//
// --- Design notes -----------------------------------------------------------
//
// Complete inventory (rule 3). Without `q` the endpoint returns the whole open
// catalogue newest-first, so the default walk (no keywords:) IS the complete
// inventory ordered by recency — scanner-side title/location filters decide
// (rule 5). Each `keywords:` value is a separate server-side full-text query
// (title, company, description, location), walked and deduped by emitted URL
// behind one shared `seen` set. A pass whose first page fully overlaps an
// earlier pass still walks its deeper pages: the stop condition keys off the
// source's own page shape (a short page), never off post-dedup counts.
//
// URL / dedup key (rule 2). `url` is the employer's own ATS posting page
// (greenhouse.io, lever.co, ashbyhq.com, …) with the catalogue's `utm_*` ad
// attribution stripped, so the same role reached through the direct ATS
// provider dedups to the same key. Only `utm_*` keys are removed; functional
// query parameters survive. Fallback is the catalogue posting page
// (SITE_ORIGIN + /jobs/<slug>). NOTE (unverified): the /jobs/<slug> page shape
// was inferred from robots.txt discussion-path rules, not observed live —
// rows carrying a usable employer `url` never touch it.
// Emitted URLs are display-only and never fetched here, so they are accepted
// from any https: origin; the host lock below guards the API URLs actually
// requested, not the URLs handed downstream.
//
// Full descriptions for free. The /agent/jobs/search variant carries the full
// verbatim description in the list payload (one call, no per-job fan-out), so
// `description` is populated within the zero-token contract and feeds
// scan.mjs's content_filter. HTML → plain text via the shared htmlToText.
// Titles/companies/locations go through the shared entity decoder before any
// matching, so an encoded `&amp;` never drops a job.
//
// Freshness. List/search endpoints exclude closed postings server-side; rows
// carrying a truthy `closed_at` are additionally skipped defensively.
// `posted_at` is the SOURCE-stated date (freehire docs warn some boards
// restate it on every crawl); absent/unparseable dates omit postedAt rather
// than guessing. freehire's own `reality` ghost-job signal (fresh / stale /
// likely-evergreen) is intentionally NOT filtered here — Block G and
// detect-reposts.mjs own that judgement downstream.
//
// Salary is deliberately omitted: enrichment carries salary_min/max with a
// non-annual period on many rows, and the Job contract attaches annualized
// figures only, never inferred. A future change may attach year-period rows.

const SITE_ORIGIN = 'https://freehire.me';
const SEARCH_PATH = '/api/v1/agent/jobs/search';
const TRUSTED_HOST = 'freehire.me';
const PAGE_SIZE = 100; // API max (limit 1–100)
const DEFAULT_MAX_PAGES = 20; // safety bound: 20 × 100 rows per query walk
const MAX_PAGES_CAP = 100;
const PAGE_DELAY_MS = 200;

/** @param {string} url */
function assertFreehireUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`freehire: invalid URL: ${url}`);
  }
  if (parsed.protocol !== 'https:') throw new Error(`freehire: URL must use HTTPS: ${url}`);
  if (parsed.hostname !== TRUSTED_HOST) {
    throw new Error(`freehire: untrusted hostname "${parsed.hostname}" — must be ${TRUSTED_HOST}`);
  }
  return url;
}

/** @param {unknown} value */
function cleanText(value) {
  return typeof value === 'string' ? decodeEntities(value).trim() : '';
}

/** @param {unknown} value */
function toEpochMs(value) {
  if (!value) return undefined;
  const parsed = Date.parse(/** @type {string} */ (value));
  return Number.isNaN(parsed) ? undefined : parsed;
}

/** Resolve the page cap: a positive integer `max_pages` on the entry, capped. */
function resolveMaxPages(entry) {
  const v = entry?.max_pages;
  if (Number.isInteger(v) && v > 0) return Math.min(/** @type {number} */ (v), MAX_PAGES_CAP);
  return DEFAULT_MAX_PAGES;
}

/**
 * Keywords → one server-side full-text query each. Accepts a string or an
 * array of strings; anything else (and the empty case) is the whole board.
 * @param {any} entry
 * @returns {string[]}
 */
function resolveKeywords(entry) {
  const raw = entry?.keywords;
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [];
  const cleaned = list.map((k) => (typeof k === 'string' ? k.trim() : '')).filter(Boolean);
  return cleaned.length ? [...new Set(cleaned)] : [''];
}

/**
 * Canonical URL for a posting — rule 2, "the shortest verifiable path to the
 * employer the source exposes". Prefers the employer's own ATS page with the
 * catalogue's `utm_*` attribution stripped; falls back to the catalogue
 * posting page; '' when neither is usable and the caller drops the row.
 * @param {any} j
 * @returns {string}
 */
export function resolveFreehireUrl(j) {
  const raw = typeof j?.url === 'string' ? j.url.trim() : '';
  if (raw) {
    try {
      const parsed = new URL(raw);
      if (parsed.protocol === 'https:') {
        for (const key of [...parsed.searchParams.keys()]) {
          if (key.toLowerCase().startsWith('utm_')) parsed.searchParams.delete(key);
        }
        return parsed.href;
      }
    } catch {
      // malformed — fall through to the catalogue page
    }
  }

  const slug = typeof j?.public_slug === 'string' ? j.public_slug.trim() : '';
  // A slug is a single path segment: anything carrying a path separator would
  // resolve away from /jobs/ under the WHATWG URL parser, so reject it.
  if (!slug || slug.includes('/') || slug.includes('\\')) return '';
  const seg = safeEncodeURIComponent(slug);
  if (!seg) return '';
  return `${SITE_ORIGIN}/jobs/${seg}`;
}

/**
 * Normalize a single freehire row. Exported for unit tests.
 * @param {any} j
 * @param {string} [fallbackCompany]
 * @returns {{ title: string, url: string, company: string, location: string, description?: string, postedAt?: number } | null}
 */
export function normalizeFreehireJob(j, fallbackCompany) {
  if (!j || typeof j !== 'object') return null;
  if (j.closed_at) return null; // defensively skip closed rows

  const title = cleanText(j.title);
  if (!title) return null;

  const url = resolveFreehireUrl(j);
  if (!url) return null;

  const company = cleanText(j.company) || (typeof fallbackCompany === 'string' ? fallbackCompany.trim() : '') || 'freehire';
  const location = cleanText(j.location);

  /** @type {{ title: string, url: string, company: string, location: string, description?: string, postedAt?: number }} */
  const job = { title, url, company, location };

  if (typeof j.description === 'string' && j.description.trim()) {
    job.description = htmlToText(j.description);
  }
  const postedAt = toEpochMs(j.posted_at);
  if (postedAt !== undefined) job.postedAt = postedAt;

  return job;
}

/** @type {Provider} */
export default {
  id: 'freehire',

  async fetch(entry, ctx) {
    // ctx.maxPages is verify-portals.mjs's "first page only" health probe — it
    // always wins over the entry's own bound.
    const ctxMaxPages = Number(ctx?.maxPages);
    const ctxCap = ctxMaxPages > 0 ? ctxMaxPages : Number.POSITIVE_INFINITY;
    const entryCap = resolveMaxPages(entry);
    const maxPages = Math.min(entryCap, ctxCap);
    const fallbackCompany = entry?.name;
    const keywords = resolveKeywords(entry);
    const seen = new Set();
    const out = [];
    let truncated = false;

    for (const q of keywords) {
      for (let page = 0; page < maxPages; page++) {
        const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(page * PAGE_SIZE) });
        if (q) params.set('q', q);
        const url = assertFreehireUrl(`${SITE_ORIGIN}${SEARCH_PATH}?${params.toString()}`);
        // redirect:'error' prevents SSRF via server-side redirects
        const json = await fetchJsonWithRetry(ctx, url, { redirect: 'error' });
        const rows = json && Array.isArray(json.data) ? json.data : null;
        if (!rows) {
          const got = json && typeof json === 'object' ? Object.keys(json).join(', ') : typeof json;
          throw new Error(
            `freehire: unexpected API response (q=${JSON.stringify(q)} offset=${page * PAGE_SIZE}) — expected { data: [...] }, got: [${got}]`,
          );
        }
        for (const j of rows) {
          const normalized = normalizeFreehireJob(j, fallbackCompany);
          if (normalized && !seen.has(normalized.url)) {
            seen.add(normalized.url);
            out.push(normalized);
          }
        }
        // The walk's own natural end — a short page — is the only completeness
        // proof; it keys off the SOURCE row count, never the post-dedup count.
        if (rows.length < PAGE_SIZE) break;
        // The warning is tied to the entry/default cap only — never to a
        // ctx.maxPages probe cap.
        if (page === maxPages - 1 && maxPages >= entryCap) truncated = true;
        else await sleep(PAGE_DELAY_MS, ctx);
      }
    }

    if (truncated) {
      console.error(`freehire: ${entry?.name ?? 'board'} truncated at max_pages=${maxPages}/query — raise max_pages on this entry for a complete walk`);
    }
    return out;
  },
};
