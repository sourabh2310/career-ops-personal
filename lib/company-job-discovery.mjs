/**
 * Company job-board discovery for Career Ops.
 *
 * Starts with company names only. It discovers likely official domains, finds
 * direct careers/job-search URLs through public search results and official
 * site links, verifies candidates, and exports an auditable CSV.
 *
 * Search engines may rate-limit automated requests. This module is deliberately
 * free-first and reports provider failures rather than claiming no board exists.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { isIP } from 'node:net';
import { pathToFileURL } from 'node:url';
import { makeHttpCtx, fetchTextWithRetry } from '../providers/_http.mjs';
import { getCareerOpsRoot } from '../path-resolver.mjs';
import { isMainModule } from './is-main-module.mjs';

const DEFAULT_TIMEOUT_MS = 10000;
const MAX_SEARCH_RESULTS = 12;
const MAX_CANDIDATES_TO_VERIFY = 8;
const MAX_REDIRECTS = 4;
const SEARCH_DELAY_MS = 900;
// Version 2: adds destination_type, reworks verification semantics (a generic
// careers/apply/culture page is no longer a verified vacancy), introduces
// third-party source detection, stricter company-identity matching, explicit
// India-relevance tiers, and expires_at cache entries. Bumping invalidates
// version-1 cache rows whose `Verified` labels were assigned under the old
// vacancy rules.
const CACHE_VERSION = 2;
// Temporary-failure rows (search blocked, HTTP 429/5xx, timeouts) are cached
// for at most this long so a transient outage is not stored as a finding.
const TEMPORARY_FAILURE_CACHE_HOURS = 24;

const ATS_RULES = [
  ['Greenhouse', /(^|\.)boards\.greenhouse\.io$|(^|\.)job-boards\.greenhouse\.io$/i],
  ['Lever', /(^|\.)jobs\.lever\.co$/i],
  ['Ashby', /(^|\.)jobs\.ashbyhq\.com$/i],
  ['Workday', /(^|\.)myworkdayjobs\.com$|(^|\.)wd\d+\.myworkdayjobs\.com$/i],
  ['SmartRecruiters', /(^|\.)jobs\.smartrecruiters\.com$|(^|\.)careers\.smartrecruiters\.com$/i],
  ['iCIMS', /(^|\.)careers-[a-z0-9-]+\.icims\.com$|(^|\.)icims\.com$/i],
  ['BambooHR', /(^|\.)bamboohr\.com$/i],
  ['Workable', /(^|\.)apply\.workable\.com$|(^|\.)jobs\.workable\.com$/i],
  ['Recruitee', /(^|\.)recruitee\.com$/i],
  ['Personio', /(^|\.)personio\.[a-z.]+$/i],
  ['Teamtailor', /(^|\.)teamtailor\.com$/i],
  ['SuccessFactors', /(^|\.)successfactors\.com$/i],
  ['Oracle Cloud', /(^|\.)oraclecloud\.com$/i],
  ['Jobvite', /(^|\.)jobvite\.com$/i],
  ['Pinpoint', /(^|\.)pinpointhq\.com$/i],
  ['Rippling', /(^|\.)rippling\.com$/i],
  // Darwinbox tenant portals live on employer-specific subdomains of
  // darwinbox.in (e.g. allcargo.darwinbox.in) or under the /ms/candidate
  // portal path on darwinbox.com tenants (e.g.
  // rategain.darwinbox.com/ms/candidate/careers). Bare darwinbox.com /
  // darwinbox.in are Darwinbox corporate domains, not customer ATS boards,
  // so they are deliberately NOT matched here; see DARWINBOX_TENANT_RE and
  // DARWINBOX_PORTAL_PATH_RE used by detectAts() instead.
  ['Darwinbox', /^[a-z0-9][a-z0-9-]*\.darwinbox\.in$/i],
];

// Hostname evidence for Darwinbox customer portals on darwinbox.com tenants.
const DARWINBOX_PORTAL_PATH_RE = /^\/ms\/candidate(\/|$)/i;
// Page-content markers observed on live Darwinbox candidate portals
// (allcargo.darwinbox.in serves a login/careers shell containing these).
const DARWINBOX_CONTENT_MARKERS = [
  /\/images\/darwinbox\//i,
  /powered-?by-darwinbox/i,
  /dbox\.darwinbox\.com/i,
];
// Darwinbox corporate / product pages. Never an employer ATS board.
const DARWINBOX_CORPORATE_RE = /(^|\.)darwinbox\.com$/i;

// Hosts that aggregate many employers' postings. A page here may describe a
// company's openings, but it is NEVER an official company-hosted page, so it
// can never verify an official domain or a direct vacancy. Matched on the
// registrable host so regional subdomains (e.g. in.indeed.com) are covered.
const THIRD_PARTY_JOB_HOSTS = [
  'jobaaj.com', 'cutshort.io', 'naukri.com', 'foundit.in', 'shine.com',
  'timesjobs.com', 'indeed.com', 'linkedin.com', 'glassdoor.com',
  'wellfound.com', 'angellis.co', 'angellist.com', 'instahyre.com',
  'hirist.tech', 'iimjobs.com', 'monster.com', 'ziprecruiter.com',
  'simplyhired.com', 'freshersworld.com', 'internshala.com', 'apna.co',
  'upwork.com', 'freelancer.com', 'dice.com',
  'naukrigulf.com', 'bayt.com', 'gulftalent.com', 'totaljobs.com',
  'reed.co.uk', 'seek.com.au', 'stepstone.de', 'xing.com',
  'careerpages.co.in',
];

// Query parameters that never change the destination. Everything else is
// preserved, because ATS boards route on params (job IDs, locale, req IDs).
const TRACKING_PARAMS_RE = /^(utm_[a-z_]*|gclid|fbclid|msclkid|mc_[a-z_]*|igshid|vero_[a-z_]*|_ga|_gl|yclid|twclid|li_fat_id|vero_conv|srsltid|gad_source|gbraid|wbraid)$/i;

// Fragments that route inside single-page career apps (Phenom, SuccessFactors
// deep links). Other fragments are position anchors and are dropped for
// deduplication.
const ROUTING_FRAGMENT_RE = /^#!?\/(job|career|position|posting|opening|vacanc|search|result)/i;

// URL paths that are informational, cultural, editorial, or generic
// application hubs rather than individual vacancies or job-search interfaces.
// A URL containing `jobs`/`careers`/`apply` inside one of these segments
// (e.g. /perspectives/articles/jobs, /life-at-accenture/working-here,
// /us/en/apply, /us/en/intern-and-graduate) is NOT vacancy evidence.
const NON_LISTING_PATH_RE = /\/(life-at|working-here|culture|values|benefits|perks|diversity|inclusion|belonging|sustainability|about(-us)?|our-story|news|blog|perspectives|articles?|stories|insights|press|media|events|podcast|apply|applynow|intern(ship)?s?(-and-graduate)?|students?|graduates?|early-careers|university|home)(\/|$|[?#])/i;

// Detail-page shapes that, combined with application/vacancy language and
// company-identity evidence, indicate ONE specific opening on an official
// domain (not a listing hub). Query strings are checked separately by
// JOB_ID_PARAM_RE.
const VACANCY_DETAIL_PATH_RE = /\/(jobdetails?|careerdetail|job-details?|job-description|position-details?|opening-details?|vacancy-details?|posting-details?|requisition|jobs?\/\d|positions?\/\d|openings?\/\d|[a-z-]*jobs?\/[a-z0-9][a-z0-9-_]*\d[a-z0-9-_]*|careers?\/job)/i;
// Unambiguous single-opening markers: dedicated detail routes. Generic
// `/jobs`-style segments are deliberately absent: they are listing hubs until
// a job ID says otherwise.
const STRONG_DETAIL_PATH_RE = /\/(jobdetails?|careerdetail|job-details?|job-description|position-details?|position-description|opening-details?|vacancy-details?|posting-details?|requisition)\b/i;
// A job identifier inside the URL itself: ATS posting IDs, numeric posting
// segments (/jobs/123), UUIDs, or routing params (job IDs, req IDs, locale
// params alone do NOT count).
const URL_VACANCY_ID_RE = /\/\d[\w-]*(\/|$|[?#])|[0-9a-f]{8}-[0-9a-f-]{4,}/i;
const JOB_ID_PARAM_RE = /(^|[?&])(jobid|job_id|jobcode|job_code|postingid|posting_id|positionid|position_id|requisitionid|requisition_id|reqid|req_id|posting|position|listing|vacancy|opening|gh_jid|lever-[a-z]+|ashby[a-z]*id|wdjob|job)=[^&]*[0-9a-z][^&]*/i;
// A listing hub by URL shape: the final path segment is a bare listing word
// (/jobsearch, /search-results, /careers/jobs). Hubs aggregate openings; they
// are classified as career/job-search destinations even when they embed
// structured data for the listed jobs.
const LISTING_HUB_SEGMENT_RE = /^(jobsearch|search-results|search|find-jobs|browse-jobs|jobs|careers|openings|positions|vacancies|job|career)$/i;

// Explicit JSON-LD JobPosting (a bare ItemList only proves a search page).
const STRUCTURED_JOB_POSTING_RE = /"@type"\s*:\s*"JobPosting"/i;
const STRUCTURED_JOB_LIST_RE = /"@type"\s*:\s*"(JobPosting|ItemList)"|"jobPosting"|"totalJobs"/i;

// Locale/India signals. A bare `/in-en/`-style segment or `.in` domain is a
// candidate; it becomes `india_specific` only together with India hiring
// text (see classifyIndiaRelevance), never from the URL alone.
const INDIA_LOCALE_PATH_RE = /\/(in-en|en-in|india|careers-india|jobs-india|india-careers|india-jobs)([\/?#]|$)/i;
const INDIA_HIRING_TEXT_RE = /\b(jobs in india|jobs across india|india (careers|jobs|openings|vacancies|hiring)|openings in india|hiring in india|work location[^.]{0,80}india|location[^.]{0,80}\bindia\b|pan-india|pan india)\b/i;

// Destination types recorded in the `destination_type` CSV column. They
// separate WHAT a URL is from WHETHER it verified (verification_status).
export const DESTINATION_TYPES = [
  'official_company_website',
  'official_careers_homepage',
  'ats_job_board',
  'verified_active_job',
  'third_party_job_source',
  'needs_review',
  'not_found',
  'temporarily_unavailable',
];

const EXCLUDED_SEARCH_HOSTS = new Set([
  'google.com', 'www.google.com', 'bing.com', 'www.bing.com',
  'duckduckgo.com', 'html.duckduckgo.com', 'linkedin.com', 'www.linkedin.com',
  'wikipedia.org', 'www.wikipedia.org', 'glassdoor.com', 'www.glassdoor.com',
  'indeed.com', 'www.indeed.com', 'facebook.com', 'www.facebook.com',
  'instagram.com', 'www.instagram.com', 'x.com', 'twitter.com',
  'crunchbase.com', 'www.crunchbase.com', 'zoominfo.com', 'www.zoominfo.com',
]);

const JOB_PATH = /(^|\/)(jobs?|careers?|openings|positions|vacancies|job-search|search-jobs)(\/|$|[?#])/i;
const CAREER_WORDS = /\b(careers?|open positions|open roles|job openings|current openings|vacancies|join our team|search jobs|view all jobs|explore jobs|opportunities)\b/i;
const JOB_CARD_WORDS = /\b(apply now|apply for this job|view job|job details|requisition|job id|full.?time|part.?time|software engineer|location:|posted \d+ days ago)\b/i;
const BLOCKED_DOMAIN_SUFFIXES = ['.localhost', '.local', '.internal', '.test', '.invalid'];

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function htmlDecode(value) {
  return String(value ?? '')
    .replace(/&amp;/gi, '&').replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

function stripHtml(value) {
  return htmlDecode(String(value ?? '').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
}

function normalizeCompanyName(name) {
  return String(name ?? '').replace(/^\uFEFF/, '').replace(/\s+/g, ' ').trim();
}

/** Small RFC-4180 CSV parser; handles quoted commas, quotes and embedded newlines. */
export function parseCsv(text) {
  const input = String(text ?? '').replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (quoted) {
      if (ch === '"' && input[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"' && field.length === 0) {
      quoted = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && input[i + 1] === '\n') i += 1;
      row.push(field);
      if (row.some((cell) => cell.trim() !== '')) rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  if (quoted) throw new Error('Input CSV contains an unterminated quoted field.');
  row.push(field);
  if (row.some((cell) => cell.trim() !== '')) rows.push(row);
  if (!rows.length) return [];

  const first = rows[0].map((cell) => cell.trim().toLowerCase());
  const nameIndex = first.findIndex((cell) => ['company_name', 'company', 'company name', 'name'].includes(cell));
  const hasHeader = nameIndex >= 0;
  const headers = hasHeader ? first : ['company_name'];
  const start = hasHeader ? 1 : 0;
  const companyIndex = hasHeader ? nameIndex : 0;
  return rows.slice(start).map((cells, index) => {
    const record = {};
    headers.forEach((header, i) => { record[header || ('column_' + (i + 1))] = String(cells[i] ?? '').trim(); });
    record.company_name = normalizeCompanyName(cells[companyIndex] ?? '');
    record.input_row = index + start + 1;
    return record;
  }).filter((record) => record.company_name);
}

function csvCell(value) {
  const text = value == null ? '' : String(value);
  return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

export function toCsv(rows, columns) {
  const keys = columns ?? [...new Set(rows.flatMap((row) => Object.keys(row)))];
  return [keys.map(csvCell).join(','), ...rows.map((row) => keys.map((key) => csvCell(row[key])).join(','))].join('\r\n') + '\r\n';
}

function safeUrl(value) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (!host || host === 'localhost' || BLOCKED_DOMAIN_SUFFIXES.some((suffix) => host.endsWith(suffix))) return null;
    if (isIP(host)) return null;
    url.hash = '';
    return url;
  } catch {
    return null;
  }
}

function canonicalUrl(value) {
  const url = safeUrl(value);
  if (!url) return '';
  url.hostname = url.hostname.toLowerCase();
  if ((url.pathname === '/' || url.pathname === '') && !url.search) url.pathname = '';
  return url.href.replace(/\/$/, '');
}

/**
 * Deduplication key for career-destination URLs.
 *
 * Normalizations applied (display URLs keep their original form):
 * - scheme http/https treated as equivalent (key always uses https);
 * - hostname lowercased, leading `www.` stripped, default ports removed;
 * - fragment dropped unless it routes an SPA job app (`#/job/...`);
 * - query parameters sorted; known tracking params (utm_*, gclid, fbclid,
 *   msclkid, _ga, ...) removed; all other params (job IDs, req IDs, locale,
 *   pagination) preserved so genuinely different vacancies never collapse;
 * - trailing slash removed (except the root path).
 */
export function normalizeUrlForDedup(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return '';
  }
  if (!['http:', 'https:'].includes(url.protocol)) return '';
  let host = url.hostname.toLowerCase();
  if (!host) return '';
  host = host.replace(/^www\./, '');
  const defaultPort = (url.protocol === 'http:' && url.port === '80')
    || (url.protocol === 'https:' && url.port === '443');
  const port = (!url.port || defaultPort) ? '' : ':' + url.port;
  let path = url.pathname || '';
  if (path.length > 1) path = path.replace(/\/+$/, '');
  const params = new URLSearchParams(url.search);
  const kept = [];
  for (const [name, paramValue] of params) {
    if (!name || TRACKING_PARAMS_RE.test(name)) continue;
    kept.push([name, paramValue]);
  }
  kept.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0)));
  const search = kept.map(([name, paramValue]) => name + '=' + paramValue).join('&');
  let fragment = '';
  if (url.hash && ROUTING_FRAGMENT_RE.test(url.hash)) fragment = url.hash;
  return 'https://' + host + port + (path || '') + (search ? '?' + search : '') + fragment;
}

/** Canonical identity key for an input company name (case/space-insensitive). */
export function companyDedupKey(name) {
  return normalizeCompanyName(name).toLowerCase().replace(/\s+/g, ' ');
}

function registrableHost(host) {
  const labels = String(host ?? '').toLowerCase().split('.').filter(Boolean);
  if (labels.length <= 2) return labels.join('.');
  const twoLevelSuffixes = new Set(['co.uk', 'org.uk', 'com.au', 'net.au', 'co.in', 'com.sg', 'co.nz', 'com.br', 'co.jp', 'com.mx']);
  const suffix = labels.slice(-2).join('.');
  return twoLevelSuffixes.has(suffix) && labels.length >= 3 ? labels.slice(-3).join('.') : labels.slice(-2).join('.');
}

/**
 * ATS provider for a destination URL, or '' when there is no ATS evidence.
 *
 * Hostname evidence is primary. Darwinbox customer portals are
 * employer-specific tenants: `<tenant>.darwinbox.in` (observed live, e.g.
 * allcargo.darwinbox.in serving a candidate login/careers shell) or
 * `<tenant>.darwinbox.com/ms/candidate/...` (observed, e.g.
 * rategain.darwinbox.com/ms/candidate/careers). Bare darwinbox.com /
 * darwinbox.in and other darwinbox.com subdomains (newsroom, blog, product
 * pages) are Darwinbox corporate pages and NEVER count as an employer ATS.
 * The word `darwinbox` in a company name, query string, or page body alone
 * is never sufficient: the hostname or the /ms/candidate portal path must
 * match. Optional page HTML only ADDS provider evidence (portal markers);
 * it can never invent a provider the URL does not support.
 */
export function detectAts(url, html = '') {
  let host = '';
  let path = '';
  try {
    const parsed = new URL(url);
    host = parsed.hostname.toLowerCase();
    path = parsed.pathname || '';
  } catch {
    return '';
  }
  if (DARWINBOX_CORPORATE_RE.test(host) && !DARWINBOX_PORTAL_PATH_RE.test(path)) return '';
  for (const [label, pattern] of ATS_RULES) {
    if (pattern.test(host)) return label;
  }
  if (DARWINBOX_PORTAL_PATH_RE.test(path) && host.endsWith('.darwinbox.com')) return 'Darwinbox';
  if (html && /\.darwinbox\.(in|com)$/i.test(host)) {
    if (DARWINBOX_CONTENT_MARKERS.some((marker) => marker.test(html))) return 'Darwinbox';
  }
  return '';
}

/** True when the URL belongs to a job aggregator / third-party source. */
export function detectThirdParty(url) {
  let host = '';
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return THIRD_PARTY_JOB_HOSTS.some((domain) => host === domain || host.endsWith('.' + domain));
}

function unwrapSearchUrl(href) {
  const decoded = htmlDecode(href);
  try {
    const url = new URL(decoded, 'https://html.duckduckgo.com');
    const wrapped = url.searchParams.get('uddg') || url.searchParams.get('url');
    return canonicalUrl(wrapped ? decodeURIComponentSafe(wrapped) : url.href);
  } catch {
    return '';
  }
}

function decodeURIComponentSafe(value) {
  try { return decodeURIComponent(value); } catch { return value; }
}

function parseSearchResults(html, engine) {
  const results = [];
  const pattern = /<a\b([^>]*?)href\s*=\s*(['"])(.*?)\2([^>]*)>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = pattern.exec(html)) && results.length < MAX_SEARCH_RESULTS * 3) {
    const attrs = match[1] + ' ' + match[4];
    const href = match[3];
    const label = stripHtml(match[5]);
    if (!label || label.length < 2) continue;
    if (engine === 'duckduckgo' && !/result__a/i.test(attrs)) continue;
    if (engine === 'bing' && !/b_algo/i.test(html.slice(Math.max(0, match.index - 1200), match.index))) {
      if (!/href\s*=\s*['"]https?:/i.test(match[0])) continue;
    }
    const url = unwrapSearchUrl(href);
    const parsed = safeUrl(url);
    if (!parsed) continue;
    const host = parsed.hostname.toLowerCase();
    if (EXCLUDED_SEARCH_HOSTS.has(host) || host.endsWith('.duckduckgo.com') || host.endsWith('.bing.com')) continue;
    if (/^(mailto|javascript):/i.test(href)) continue;
    results.push({ url: parsed.href, title: label, snippet: '', host, engine });
  }
  const seen = new Set();
  return results.filter((item) => {
    const key = normalizeUrlForDedup(item.url) || canonicalUrl(item.url);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, MAX_SEARCH_RESULTS);
}

function nameTokens(name) {
  return normalizeCompanyName(name).toLowerCase()
    .replace(/\b(incorporated|inc|corporation|corp|limited|ltd|llc|plc|private|pvt|company|co)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter((token) => token.length > 1);
}

function haystackWords(text, host = '') {
  return (String(text) + ' ' + String(host)).toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter(Boolean);
}

/**
 * Company-identity evidence between an input company name and page/host text.
 *
 * Short tokens (<=3 chars, e.g. `mg` in `1 mg`, `ai` in `247.ai`) only count
 * on whole-word matches, so `1mgdoctors.com` is NOT accepted as the official
 * domain of `1 mg` merely because the host contains the substring `mg`.
 * Longer tokens (>=4 chars) may match as substrings of a host label
 * (`acaira` inside `acaira.com`). At least 60% of the name tokens must hit.
 * Returns the matched detail for evidence strings.
 */
export function identitySignals(name, text, host = '') {
  const tokens = nameTokens(name);
  if (!tokens.length) return { match: false, hits: [], tokens };
  const words = haystackWords(text, host);
  const wordSet = new Set(words);
  const joined = words.join(' ');
  const hits = tokens.filter((token) => {
    if (token.length <= 3) return wordSet.has(token);
    if (/^\d+$/.test(token)) return wordSet.has(token);
    return wordSet.has(token) || joined.replace(/ /g, '').includes(token);
  });
  return { match: hits.length >= Math.max(1, Math.ceil(tokens.length * 0.6)), hits, tokens };
}

function companyNameMatch(name, text, host = '') {
  return identitySignals(name, text, host).match;
}

function initialCandidateScore(companyName, candidate, officialDomain = '') {
  let score = 0;
  const path = new URL(candidate.url).pathname;
  const ats = detectAts(candidate.url);
  if (officialDomain && registrableHost(candidate.host) === registrableHost(officialDomain)) score += 30;
  if (ats) score += 20;
  if (JOB_PATH.test(path) || CAREER_WORDS.test(candidate.title)) score += 15;
  if (companyNameMatch(companyName, candidate.title, candidate.host)) score += 15;
  if (candidate.queryType === 'jobs' || candidate.queryType === 'ats') score += 5;
  if (candidate.engine === 'official-site') score += 10;
  return Math.min(70, score);
}

function extractLinks(html, baseUrl) {
  const links = [];
  const pattern = /<a\b[^>]*href\s*=\s*(['"])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = pattern.exec(html)) && links.length < 500) {
    const label = stripHtml(match[3]);
    let url;
    try { url = safeUrl(new URL(htmlDecode(match[2]), baseUrl).href); } catch { continue; }
    if (!url || !label) continue;
    links.push({ url: url.href, title: label, host: url.hostname.toLowerCase(), engine: 'official-site', queryType: 'official-site' });
  }
  return links;
}

async function safeFetchText(ctx, inputUrl, options = {}) {
  let current = safeUrl(inputUrl);
  if (!current) throw new Error('Unsafe or unsupported URL.');
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    try {
      const body = await fetchTextWithRetry(ctx, current.href, {
        timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        redirect: 'manual',
        headers: { accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.5' },
      }, { retries: 1, baseDelayMs: 400, maxDelayMs: 1500 });
      return { body, finalUrl: current.href, status: 200 };
    } catch (error) {
      const status = Number(error?.status);
      const location = error?.location;
      if (status >= 300 && status < 400 && location && hop < MAX_REDIRECTS) {
        const next = safeUrl(new URL(location, current.href).href);
        if (!next) throw new Error('Redirect target rejected by URL safety checks.');
        current = next;
        continue;
      }
      throw error;
    }
  }
  throw new Error('Redirect limit exceeded.');
}

async function searchWeb(ctx, query, engine = 'duckduckgo') {
  const encoded = encodeURIComponent(query);
  const url = engine === 'bing'
    ? 'https://www.bing.com/search?q=' + encoded + '&count=' + MAX_SEARCH_RESULTS
    : 'https://html.duckduckgo.com/html/?q=' + encoded;
  const response = await safeFetchText(ctx, url, { timeoutMs: 12000 });
  return parseSearchResults(response.body, engine);
}

function officialDomainCandidates(results, companyName) {
  const firstToken = nameTokens(companyName)[0] ?? '';
  const scores = new Map();
  for (const item of results) {
    const host = item.host;
    if (!host || EXCLUDED_SEARCH_HOSTS.has(host) || detectAts(item.url) || detectThirdParty(item.url)) continue;
    const hostWords = String(registrableHost(host)).toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter(Boolean);
    const identity = identitySignals(companyName, item.title, host);
    let score = 0;
    // Whole-word host match on the first name token (short-token safe), plus
    // title/host identity evidence. A bare substring (e.g. `mg` inside
    // `1mgdoctors`) scores nothing here.
    if (firstToken && hostWords.includes(firstToken) && firstToken.length > 2) score += 3;
    if (identity.match) score += 4;
    if (/\/(about|company|contact|careers?|jobs?)(\/|$)/i.test(new URL(item.url).pathname)) score += 1;
    if (/news|blog|press|investor|linkedin|facebook|wikipedia|crunchbase/i.test(host)) score -= 5;
    scores.set(registrableHost(host), Math.max(scores.get(registrableHost(host)) ?? -99, score));
  }
  return [...scores.entries()].sort((a, b) => b[1] - a[1]).filter((entry) => entry[1] > 0).map(([host]) => host);
}

function candidateFromResult(item, queryType) {
  const url = canonicalUrl(item.url);
  if (!url) return null;
  return { ...item, url, host: new URL(url).hostname.toLowerCase(), queryType };
}

/**
 * Page-level signals for one fetched destination.
 *
 * `vacancy` (an INDIVIDUAL active opening) requires strong evidence:
 * JSON-LD JobPosting, an ATS posting URL with an ID, a job/requisition ID
 * reference, or an official-domain detail page (`/CareerDetail/...`,
 * `/job/...`) together with application language. Career language plus
 * job-card words alone (typically site-wide nav/footer boilerplate such as
 * "search jobs / apply now") only proves a careers destination, never a
 * vacancy. Paths matching NON_LISTING_PATH_RE (culture pages, blogs,
 * articles, generic /apply hubs, intern-program pages) can never be a
 * vacancy no matter which keywords they contain.
 */
export function classifyVerification(body, url, companyName) {
  const titleMatch = body.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  const title = stripHtml(titleMatch?.[1] ?? '');
  const text = stripHtml(body).slice(0, 300000);
  const host = new URL(url).hostname.toLowerCase();
  const path = new URL(url).pathname || '';
  const search = new URL(url).search || '';
  const ats = detectAts(url, body);
  const thirdParty = detectThirdParty(url);
  const hasCareerLanguage = CAREER_WORDS.test(title + ' ' + text);
  const hasJobCards = JOB_CARD_WORDS.test(text);
  const hasStructuredJobs = STRUCTURED_JOB_LIST_RE.test(body);
  const hasStructuredJobPosting = STRUCTURED_JOB_POSTING_RE.test(body);
  const hasJobIdReference = JOB_ID_PARAM_RE.test(path + search)
    || /\b(job\s*(id|code|ref(erence)?|number|no\.?)|requisition(\s*(id|no|number))?|req(uisition)?\.?\s*(id|no|#))\s*[:#]?\s*[A-Z0-9][A-Z0-9-]{1,}/i.test(text);
  const hasJobIdInUrl = JOB_ID_PARAM_RE.test(path + search) || URL_VACANCY_ID_RE.test(path + search);
  const isListingPath = JOB_PATH.test(path);
  const isNonListingPath = NON_LISTING_PATH_RE.test(path);
  const isDetailPath = VACANCY_DETAIL_PATH_RE.test(path);
  const isStrongDetailPath = STRONG_DETAIL_PATH_RE.test(path);
  const lastSegment = path.split('/').filter(Boolean).pop() ?? '';
  const isListingHub = LISTING_HUB_SEGMENT_RE.test(lastSegment) && !hasJobIdInUrl;
  const identity = identitySignals(companyName, title + ' ' + text, host);
  const searchInterface = !isNonListingPath
    && (hasStructuredJobs || (hasCareerLanguage && hasJobCards) || (isListingPath && hasCareerLanguage));
  // Vacancy evidence tiers (any one suffices, but never on a listing hub):
  // - structured JobPosting plus a detail route or a job ID in the URL;
  // - a job/requisition ID reference plus application language;
  // - an unambiguous detail route plus application language.
  // A hub-shaped URL (/jobsearch, /search-results, /careers/jobs) embeds
  // structured data for MANY jobs, so it stays a hub no matter what.
  const vacancyEvidence = hasStructuredJobPosting && (isStrongDetailPath || hasJobIdInUrl || hasJobIdReference);
  const idEvidence = hasJobIdReference && (hasJobCards || hasCareerLanguage || hasStructuredJobs);
  const detailEvidence = isStrongDetailPath && (hasJobCards || hasCareerLanguage);
  const vacancy = !isNonListingPath && !thirdParty && !isListingHub && (vacancyEvidence || idEvidence || detailEvidence)
    && (hasJobCards || hasCareerLanguage || hasStructuredJobs);
  let score = 0;
  if (identity.match) score += 25;
  if (hasCareerLanguage || isListingPath) score += 15;
  if (ats) score += 15;
  if (vacancy) score += 25;
  return {
    title, score: Math.min(80, score), ats, thirdParty,
    hasCareerLanguage, hasJobCards, hasStructuredJobs, hasStructuredJobPosting,
    hasJobIdReference, hasJobIdInUrl, isListingPath, isListingHub,
    isNonListingPath, isDetailPath, isStrongDetailPath,
    searchInterface, vacancy, nameMatches: identity.match, identityHits: identity.hits,
  };
}

/**
 * Confidence score (0-100) for one destination. Each evidence family counts
 * once: page signals come from classifyVerification, URL signals from the
 * candidate itself, so ATS/career language is never double-counted.
 * - identity (company-name evidence in title/body/host): +25
 * - official-domain association: +15
 * - careers-destination evidence (career language or listing path): +15
 * - ATS provider evidence: +15
 * - direct vacancy evidence (only classifyVerification.vacancy): +25
 * Caps: third-party sources cap at 45 (never Verified); destinations without
 * vacancy evidence cap at 70; missing company identity caps at 40.
 */
export function scoreCandidate(candidate, verification = {}, officialDomain = '') {
  let host = '';
  let path = '';
  try {
    const parsed = new URL(candidate.url);
    host = parsed.hostname.toLowerCase();
    path = parsed.pathname || '';
  } catch {
    return 0;
  }
  const signals = verification ?? {};
  const ats = signals.ats ?? detectAts(candidate.url);
  const thirdParty = signals.thirdParty ?? detectThirdParty(candidate.url);
  const nameMatches = signals.nameMatches
    ?? companyNameMatch(candidate.company_name ?? '', String(candidate.title ?? ''), host);
  let score = 0;
  if (nameMatches) score += 25;
  if (officialDomain && registrableHost(host) === registrableHost(officialDomain)) score += 15;
  if (signals.hasCareerLanguage || JOB_PATH.test(path) || CAREER_WORDS.test(String(candidate.title ?? ''))) score += 15;
  if (ats) score += 15;
  const vacancy = signals.vacancy ?? signals.actualListing ?? false;
  if (vacancy) score += 25;
  // Backward compatibility with pre-v2 verification objects that carried a
  // precomputed 0-100 score: blend a small fraction so old callers degrade
  // gracefully instead of dropping the signal entirely.
  if (typeof signals.score === 'number' && !('vacancy' in signals) && !('hasCareerLanguage' in signals)) {
    score += Math.round(signals.score * 0.3);
  }
  score = Math.min(100, Math.round(score));
  if (thirdParty) score = Math.min(score, 45);
  if (!vacancy) score = Math.min(score, 70);
  if (!nameMatches) score = Math.min(score, 40);
  return Math.max(0, score);
}

async function discoverOfficialDomain(ctx, companyName, searchErrors) {
  const queries = [
    '"' + companyName + '" official website',
    companyName + ' company website',
  ];
  const results = [];
  for (const query of queries) {
    try {
      results.push(...(await searchWeb(ctx, query, 'duckduckgo')));
    } catch (error) {
      searchErrors.push('DuckDuckGo official-domain search: ' + String(error.message ?? error).slice(0, 180));
    }
    await sleep(SEARCH_DELAY_MS);
    if (results.length >= MAX_SEARCH_RESULTS) break;
  }
  const domains = officialDomainCandidates(results, companyName);
  if (domains.length) return domains[0];
  // One independent free search fallback when DuckDuckGo yields no plausible domain.
  try {
    const fallback = await searchWeb(ctx, '"' + companyName + '" official website', 'bing');
    const fallbackDomains = officialDomainCandidates(fallback, companyName);
    if (fallbackDomains.length) return fallbackDomains[0];
  } catch (error) {
    searchErrors.push('Bing official-domain fallback: ' + String(error.message ?? error).slice(0, 180));
  }
  return '';
}

async function collectCandidates(ctx, companyName, officialDomain, searchErrors) {
  const candidates = new Map();
  const add = (item, queryType) => {
    const candidate = candidateFromResult(item, queryType);
    if (!candidate) return;
    // Scheme-insensitive key: http/https equivalents and tracking-parameter
    // variants of one destination collapse to a single candidate.
    const key = normalizeUrlForDedup(candidate.url) || canonicalUrl(candidate.url);
    if (!key) return;
    const old = candidates.get(key);
    if (!old || initialCandidateScore(companyName, candidate, officialDomain) > initialCandidateScore(companyName, old, officialDomain)) {
      candidates.set(key, { ...candidate, company_name: companyName });
    }
  };

  if (officialDomain) {
    for (const url of [
      'https://' + officialDomain,
      'https://' + officialDomain + '/careers',
      'https://' + officialDomain + '/jobs',
    ]) {
      add({ url, title: companyName + ' official website', host: officialDomain, engine: 'official-site' }, 'official-site');
    }
    try {
      const page = await safeFetchText(ctx, 'https://' + officialDomain);
      for (const link of extractLinks(page.body, page.finalUrl)) {
        if (CAREER_WORDS.test(link.title + ' ' + link.url) || detectAts(link.url) || JOB_PATH.test(new URL(link.url).pathname)) {
          add(link, 'official-site');
        }
      }
    } catch (error) {
      searchErrors.push('Official website inspection: ' + String(error.message ?? error).slice(0, 180));
    }
  }

  const queries = [
    { query: '"' + companyName + '" careers jobs', type: 'jobs' },
    { query: '"' + companyName + '" job openings apply', type: 'jobs' },
    { query: '"' + companyName + '" site:jobs.ashbyhq.com OR site:boards.greenhouse.io OR site:jobs.lever.co OR site:myworkdayjobs.com OR site:darwinbox.in', type: 'ats' },
  ];
  for (const entry of queries) {
    try {
      const results = await searchWeb(ctx, entry.query, 'duckduckgo');
      results.forEach((item) => add(item, entry.type));
    } catch (error) {
      searchErrors.push('DuckDuckGo job-board search: ' + String(error.message ?? error).slice(0, 180));
    }
    await sleep(SEARCH_DELAY_MS);
  }
  if (candidates.size < 3) {
    try {
      const results = await searchWeb(ctx, '"' + companyName + '" careers jobs', 'bing');
      results.forEach((item) => add(item, 'jobs'));
    } catch (error) {
      searchErrors.push('Bing job-board fallback: ' + String(error.message ?? error).slice(0, 180));
    }
  }
  return [...candidates.values()].sort((a, b) =>
    initialCandidateScore(companyName, b, officialDomain) - initialCandidateScore(companyName, a, officialDomain)
  ).slice(0, 30);
}

/**
 * Geographic relevance of a destination. `india_specific` needs an India
 * locale signal (URL path like `/in-en/`, `.in`/`.co.in` host) together with
 * India hiring text; a lone locale/domain/text signal still yields
 * `india_specific` but is flagged `unconfirmed` in the evidence. A globally
 * accessible careers page alone never claims India relevance. Verified
 * careers destinations without India evidence are `global`; inconclusive
 * rows are `unknown`.
 */
export function classifyIndiaRelevance(finalUrl, title, text) {
  const localePath = INDIA_LOCALE_PATH_RE.test(finalUrl);
  let host = '';
  try {
    host = new URL(finalUrl).hostname.toLowerCase();
  } catch {
    return { relevance: 'unknown', evidence: '' };
  }
  const inDomain = host === 'in' || host.endsWith('.in') || host.endsWith('.co.in');
  const indiaText = INDIA_HIRING_TEXT_RE.test(String(title ?? '') + ' ' + String(text ?? '').slice(0, 20000));
  if ((localePath || inDomain) && indiaText) {
    return {
      relevance: 'india_specific',
      evidence: 'India-specific evidence (' + [localePath ? 'India locale URL path' : '', inDomain ? 'India domain' : '', 'India hiring-location text'].filter(Boolean).join('; ') + ')',
    };
  }
  if (localePath || inDomain || indiaText) {
    return {
      relevance: 'india_specific',
      evidence: 'Possible India relevance (' + [localePath ? 'India locale URL path' : '', inDomain ? 'India domain' : '', indiaText ? 'India hiring-location text' : ''].filter(Boolean).join('; ') + '; single signal, treat as unconfirmed)',
    };
  }
  return { relevance: 'global', evidence: '' };
}

async function verifyCandidate(ctx, companyName, candidate, officialDomain) {
  const base = {
    company_name: companyName,
    official_domain: officialDomain,
    career_homepage_url: '',
    job_listing_url: candidate.url,
    ats_platform: detectAts(candidate.url) || (JOB_PATH.test(new URL(candidate.url).pathname) ? 'Company-hosted' : 'Unknown'),
    confidence_score: 0,
    verification_status: 'Needs review',
    india_relevance: 'unknown',
    evidence: '',
    last_checked_at: new Date().toISOString(),
    search_source: candidate.engine ?? '',
    destination_type: 'needs_review',
  };
  let response;
  try {
    response = await safeFetchText(ctx, candidate.url);
  } catch (error) {
    const status = Number(error?.status);
    const temporary = status === 429 || status >= 500 || /timeout|timed out|network|fetch failed|aborted|ENOTFOUND|ECONN/i.test(String(error.message ?? error));
    return {
      ...base,
      destination_type: temporary ? 'temporarily_unavailable' : 'needs_review',
      verification_status: temporary ? 'Temporarily unavailable' : 'Needs review',
      evidence: 'Verification failed: ' + String(error.message ?? error).slice(0, 240),
    };
  }
  const finalUrl = canonicalUrl(response.finalUrl);
  const signals = classifyVerification(response.body, finalUrl, companyName);
  const text = stripHtml(response.body).slice(0, 300000);
  const finalHost = new URL(finalUrl).hostname.toLowerCase();
  const candidateHost = new URL(candidate.url).hostname.toLowerCase();
  const crossedDomains = registrableHost(candidateHost) !== registrableHost(finalHost)
    && !(officialDomain && registrableHost(finalHost) === registrableHost(officialDomain));
  const isOfficial = !!officialDomain && registrableHost(finalHost) === registrableHost(officialDomain);
  const isAts = !!signals.ats;
  const geo = classifyIndiaRelevance(finalUrl, signals.title, text);
  const evidenceParts = [
    'HTTP page fetched',
    isOfficial ? 'official-domain match' : '',
    isAts ? 'recognized ATS: ' + signals.ats : '',
    signals.thirdParty ? 'third-party job source (' + registrableHost(finalHost) + ')' : '',
    signals.hasCareerLanguage ? 'careers/job language present' : '',
    signals.hasJobCards ? 'job-card/application language present' : '',
    signals.hasStructuredJobs ? 'structured job data present' : '',
    signals.hasStructuredJobPosting ? 'structured JobPosting present' : '',
    signals.hasJobIdReference ? 'job/requisition ID reference present' : '',
    signals.nameMatches ? 'company-name evidence present (' + signals.identityHits.join(', ') + ')' : 'company-name match uncertain',
    signals.isNonListingPath ? 'informational/generic page path (not a vacancy)' : '',
    crossedDomains ? 'redirected to a different domain (' + finalHost + ')' : '',
    geo.evidence,
  ].filter(Boolean);

  // Third-party company profiles are never official pages and never verify.
  if (signals.thirdParty) {
    return {
      ...base,
      job_listing_url: finalUrl,
      ats_platform: signals.ats || 'Unknown',
      confidence_score: Math.min(scoreCandidate({ ...candidate, url: finalUrl, host: finalHost }, signals, officialDomain), 45),
      verification_status: 'Needs review',
      india_relevance: geo.relevance === 'global' ? 'unknown' : geo.relevance,
      evidence: evidenceParts.join('; '),
      destination_type: 'third_party_job_source',
    };
  }

  const identityOk = signals.nameMatches;
  const score = scoreCandidate({ ...candidate, url: finalUrl, host: finalHost }, signals, officialDomain);
  // `Verified` is evidence-gated AND score-gated: the destination kind must be
  // established above and the additive confidence must reach 50. Scores are
  // descriptive; classification never comes from the score alone, and a high
  // score never overrides missing vacancy/identity evidence.
  const verifiedDestination = score >= 50 && identityOk && (isOfficial || isAts);
  // An individual vacancy: strong vacancy evidence on an official or ATS
  // destination whose identity matches the input company.
  if (signals.vacancy && verifiedDestination) {
    return {
      ...base,
      job_listing_url: finalUrl,
      ats_platform: signals.ats || (isOfficial ? 'Company-hosted' : base.ats_platform),
      confidence_score: score,
      verification_status: 'Verified',
      india_relevance: geo.relevance,
      evidence: evidenceParts.join('; '),
      destination_type: 'verified_active_job',
    };
  }
  // A genuine job-search interface or careers hub, but no individual vacancy.
  if (signals.searchInterface && verifiedDestination) {
    const type = isAts ? 'ats_job_board' : 'official_careers_homepage';
    return {
      ...base,
      career_homepage_url: finalUrl,
      job_listing_url: '',
      ats_platform: signals.ats || (isOfficial ? 'Company-hosted' : base.ats_platform),
      confidence_score: score,
      verification_status: 'Verified',
      india_relevance: geo.relevance,
      evidence: (evidenceParts.join('; ') + '; job-search/careers destination, no individual vacancy verified'),
      destination_type: type,
    };
  }
  // Official-domain page without job-destination evidence: verified only as
  // the company's own site, never as a job board.
  if (isOfficial && identityOk && !signals.isNonListingPath && (signals.hasCareerLanguage || signals.hasJobCards || signals.hasStructuredJobs)) {
    return {
      ...base,
      career_homepage_url: finalUrl,
      job_listing_url: '',
      ats_platform: signals.ats || 'Company-hosted',
      confidence_score: score,
      verification_status: 'Needs review',
      india_relevance: geo.relevance,
      evidence: (evidenceParts.join('; ') + '; general careers page, no verified vacancy or search interface'),
      destination_type: 'official_careers_homepage',
    };
  }
  if (isOfficial && identityOk) {
    return {
      ...base,
      career_homepage_url: finalUrl,
      job_listing_url: '',
      ats_platform: signals.ats || 'Company-hosted',
      confidence_score: score,
      verification_status: 'Needs review',
      india_relevance: geo.relevance,
      evidence: (evidenceParts.join('; ') + '; official company page, no job-destination evidence'),
      destination_type: 'official_company_website',
    };
  }
  return {
    ...base,
    job_listing_url: signals.searchInterface || signals.vacancy ? finalUrl : candidate.url,
    career_homepage_url: '',
    ats_platform: signals.ats || base.ats_platform,
    confidence_score: score,
    verification_status: 'Needs review',
    india_relevance: geo.relevance === 'global' ? 'unknown' : geo.relevance,
    evidence: (evidenceParts.join('; ') || 'HTTP page fetched; no job-destination evidence') + '; company association uncertain, manual review needed',
    destination_type: 'needs_review',
  };
}

function makeNotFoundRow(companyName, officialDomain, errors) {
  const temporary = errors.length > 0;
  return {
    company_name: companyName,
    official_domain: officialDomain,
    // The official homepage is a useful fallback, but it is labeled as the
    // company website, never as a careers page: a reachable website does not
    // prove a reachable careers page.
    career_homepage_url: officialDomain ? 'https://' + officialDomain : '',
    job_listing_url: '',
    ats_platform: '',
    confidence_score: 0,
    verification_status: temporary ? 'Temporarily unavailable' : 'Not found',
    india_relevance: 'unknown',
    evidence: errors.slice(0, 4).join(' | ') || 'No sufficiently reliable direct job-listing URL discovered.',
    last_checked_at: new Date().toISOString(),
    search_source: '',
    destination_type: temporary ? 'temporarily_unavailable' : (officialDomain ? 'official_company_website' : 'not_found'),
  };
}

function readCache(cachePath) {
  try {
    if (!existsSync(cachePath)) return { version: CACHE_VERSION, companies: {} };
    const data = JSON.parse(readFileSync(cachePath, 'utf8'));
    if (data.version !== CACHE_VERSION || !data.companies || typeof data.companies !== 'object') {
      return { version: CACHE_VERSION, companies: {} };
    }
    return data;
  } catch {
    return { version: CACHE_VERSION, companies: {} };
  }
}

function writeCache(cachePath, cache) {
  mkdirSync(dirname(cachePath), { recursive: true });
  const temp = cachePath + '.tmp-' + process.pid;
  writeFileSync(temp, JSON.stringify(cache, null, 2) + '\n', 'utf8');
  renameSync(temp, cachePath);
}

function cacheExpiryMs(entry, ttlHours) {
  const expiresAt = Date.parse(entry?.expires_at ?? '');
  if (Number.isFinite(expiresAt)) return expiresAt;
  // Legacy version-1 entries carry no expires_at; they are rejected by the
  // version check in readCache anyway. This fallback only covers hypothetical
  // version-2 entries written without one.
  const checkedAt = Date.parse(entry?.checked_at ?? '');
  if (!Number.isFinite(checkedAt)) return NaN;
  return checkedAt + ttlHours * 3600000;
}

export function isFreshCache(entry, ttlHours) {
  return Array.isArray(entry?.rows) && Date.now() < cacheExpiryMs(entry, ttlHours);
}

/** Rows that only record a transient failure expire faster than findings. */
export function cacheEntryForRows(rows, ttlHours = 168) {
  const temporary = rows.length > 0 && rows.every((row) =>
    row.destination_type === 'temporarily_unavailable'
    || (row.verification_status === 'Temporarily unavailable'));
  const checkedAt = Date.now();
  const effectiveTtlHours = temporary ? Math.min(ttlHours, TEMPORARY_FAILURE_CACHE_HOURS) : ttlHours;
  return { checked_at: new Date(checkedAt).toISOString(), expires_at: new Date(checkedAt + effectiveTtlHours * 3600000).toISOString(), rows };
}

/**
 * Deduplication key for one output row: the normalized career destination
 * (job_listing_url preferred, else career_homepage_url). Company identity is
 * the caller's companyDedupKey; destinations and individual jobs are
 * distinguished by URL: tracking params, fragments, scheme, `www.`, and
 * default ports never split a destination, while job IDs, req IDs, locale
 * params, and materially different paths always do.
 */
export function rowDedupKey(row) {
  const target = row.job_listing_url || row.career_homepage_url || '';
  return normalizeUrlForDedup(target) || canonicalUrl(target);
}

/** Remove duplicate-destination rows, keeping the highest-confidence one. */
export function dedupeRows(rows) {
  const best = new Map();
  for (const row of rows) {
    const key = rowDedupKey(row);
    if (!key) continue;
    const old = best.get(key);
    if (!old || (row.confidence_score ?? 0) > (old.confidence_score ?? 0)) best.set(key, row);
  }
  return [...best.values()];
}

export async function discoverCompany(companyName, options = {}) {
  const ctx = options.ctx ?? makeHttpCtx();
  const company = normalizeCompanyName(companyName);
  const errors = [];
  const officialDomain = await discoverOfficialDomain(ctx, company, errors);
  const candidates = await collectCandidates(ctx, company, officialDomain, errors);
  // Verify each candidate URL once; the old code verified the top candidates
  // twice (shortlist, then a fallback re-pass) and the fallback pass had no
  // dedup, so redirect-collapsed URLs produced byte-identical duplicate rows.
  const rowsByUrl = new Map();
  for (const candidate of candidates.slice(0, options.maxCandidates ?? MAX_CANDIDATES_TO_VERIFY)) {
    const row = await verifyCandidate(ctx, company, candidate, officialDomain);
    const key = rowDedupKey(row);
    if (!key) continue;
    const old = rowsByUrl.get(key);
    if (!old || row.confidence_score > old.confidence_score) rowsByUrl.set(key, row);
  }
  const rows = [...rowsByUrl.values()];
  const verified = rows
    .filter((row) => row.verification_status === 'Verified' && (row.job_listing_url || row.career_homepage_url))
    .sort((a, b) => b.confidence_score - a.confidence_score);
  // One canonical row per official host for homepage-type destinations:
  // /careers and /jobs (or /careers and the site root) on the same domain
  // are the same destination for discovery purposes. Keep the
  // highest-confidence one; vacancies and ATS boards stay distinct.
  const unique = collapseHomepageTypes(verified).slice(0, 3);
  if (unique.length) return unique.sort(compareDiscoveryRows);
  const reviewed = rows
    .filter((row) => (row.job_listing_url || row.career_homepage_url)
      && (row.destination_type === 'third_party_job_source' || row.verification_status === 'Needs review'))
    .sort(compareDiscoveryRows);
  // Never present a third-party company profile as the company's own board:
  // keep it labeled third-party and only when nothing official exists.
  const officialish = collapseHomepageTypes(reviewed.filter((row) => row.destination_type !== 'third_party_job_source'
    && row.confidence_score >= 30)).slice(0, 2);
  if (officialish.length) return officialish;
  if (reviewed.length) return [reviewed[0]];
  return [makeNotFoundRow(company, officialDomain, errors)];
}

function collapseHomepageTypes(sortedRows) {
  const homepageHosts = new Set();
  const unique = [];
  for (const row of sortedRows) {
    const target = row.destination_type === 'official_careers_homepage' ? row.career_homepage_url
      : row.destination_type === 'official_company_website' ? row.career_homepage_url : '';
    if (target) {
      let hostKey = '';
      try {
        hostKey = registrableHost(new URL(target).hostname.toLowerCase());
      } catch {
        hostKey = '';
      }
      if (hostKey && homepageHosts.has(row.destination_type + '|' + hostKey)) continue;
      if (hostKey) homepageHosts.add(row.destination_type + '|' + hostKey);
    }
    unique.push(row);
  }
  return unique;
}

export function compareDiscoveryRows(a, b) {
  // Rank is display priority (vacancies first), NOT the DESTINATION_TYPES
  // array order. Unknown types sort with needs_review.
  const rank = (row) => ({
    verified_active_job: 0,
    ats_job_board: 1,
    official_careers_homepage: 2,
    official_company_website: 3,
    third_party_job_source: 4,
    needs_review: 5,
    not_found: 6,
    temporarily_unavailable: 7,
  }[row.destination_type] ?? 5);
  const rankDiff = rank(a) - rank(b);
  if (rankDiff !== 0) return rankDiff;
  if ((b.confidence_score ?? 0) !== (a.confidence_score ?? 0)) return (b.confidence_score ?? 0) - (a.confidence_score ?? 0);
  return rowDedupKey(a) < rowDedupKey(b) ? -1 : rowDedupKey(a) > rowDedupKey(b) ? 1 : 0;
}

export async function runDiscovery(options = {}) {
  const root = options.root ?? getCareerOpsRoot();
  const inputPath = resolve(options.inputPath ?? join(root, 'data', 'company-names.csv'));
  const outputPath = resolve(options.outputPath ?? join(root, 'data', 'company-job-boards.csv'));
  const cachePath = resolve(options.cachePath ?? join(root, 'data', 'cache', 'company-job-discovery.json'));
  const ttlHours = Math.max(1, Number(options.cacheTtlHours ?? 168));
  const limit = Number.isFinite(Number(options.limit)) && Number(options.limit) > 0 ? Number(options.limit) : Infinity;
  if (!existsSync(inputPath)) throw new Error('Input CSV not found: ' + inputPath + '\nCreate a CSV with a company_name column, or a one-column list of company names.');
  const inputRows = parseCsv(readFileSync(inputPath, 'utf8'));
  if (!inputRows.length) throw new Error('Input CSV contains no company names: ' + inputPath);
  const cache = readCache(cachePath);
  const output = [];
  const failures = [];
  // One canonical entry per company: repeated names in the input (different
  // spellings, reruns concatenated into one file) share one discovery pass.
  // The first submitted spelling is preserved on every output row.
  const seenCompanies = new Map();
  for (const inputRow of inputRows) {
    const key = companyDedupKey(inputRow.company_name);
    if (!key || seenCompanies.has(key)) continue;
    seenCompanies.set(key, inputRow.company_name);
  }
  const companies = [...seenCompanies.values()].slice(0, limit);
  const ctx = options.ctx ?? makeHttpCtx();
  for (let index = 0; index < companies.length; index += 1) {
    const company = companies[index];
    const key = companyDedupKey(company);
    const cached = cache.companies[key];
    let rows;
    if (!options.refresh && isFreshCache(cached, ttlHours)) {
      rows = cached.rows.map((row) => ({ ...row, search_source: (row.search_source || '') + (row.search_source ? '; ' : '') + 'cache' }));
      console.log('[' + (index + 1) + '/' + companies.length + '] ' + company + ' — cache hit (' + rows.length + ' row(s))');
    } else {
      console.log('[' + (index + 1) + '/' + companies.length + '] Discovering ' + company);
      try {
        rows = await discoverCompany(company, { ctx, maxCandidates: options.maxCandidates });
        cache.companies[key] = cacheEntryForRows(rows, ttlHours);
        writeCache(cachePath, cache);
      } catch (error) {
        failures.push(company + ': ' + String(error.message ?? error));
        rows = [makeNotFoundRow(company, '', [String(error.message ?? error)])];
      }
    }
    output.push(...rows);
    if (index < companies.length - 1) await sleep(options.companyDelayMs ?? SEARCH_DELAY_MS);
  }
  // Deterministic export: sorted by company identity, then destination-type
  // rank, then destination URL — stable across reruns and input row order.
  output.sort((a, b) => {
    const companyDiff = companyDedupKey(a.company_name) < companyDedupKey(b.company_name) ? -1
      : companyDedupKey(a.company_name) > companyDedupKey(b.company_name) ? 1 : 0;
    return companyDiff !== 0 ? companyDiff : compareDiscoveryRows(a, b);
  });
  const columns = [
    'company_name', 'official_domain', 'career_homepage_url', 'job_listing_url',
    'ats_platform', 'confidence_score', 'verification_status', 'india_relevance',
    'evidence', 'last_checked_at', 'search_source', 'destination_type',
  ];
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, toCsv(output, columns), 'utf8');
  return { inputPath, outputPath, cachePath, companyCount: companies.length, outputRows: output.length, failures };
}

export function parseArgs(args) {
  const result = { refresh: false, limit: undefined, inputPath: undefined, outputPath: undefined, cachePath: undefined };
  const takeValue = (arg, index) => {
    if (arg.includes('=')) {
      const value = arg.slice(arg.indexOf('=') + 1);
      if (!value) throw new Error('Missing value for ' + arg.split('=')[0]);
      return value;
    }
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error('Missing value for ' + arg);
    return value;
  };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') result.help = true;
    else if (arg === '--refresh') result.refresh = true;
    else if (arg === '--input' || arg.startsWith('--input=')) {
      result.inputPath = takeValue(arg, i);
      if (!arg.includes('=')) i += 1;
    } else if (arg === '--output' || arg.startsWith('--output=')) {
      result.outputPath = takeValue(arg, i);
      if (!arg.includes('=')) i += 1;
    } else if (arg === '--cache' || arg.startsWith('--cache=')) {
      result.cachePath = takeValue(arg, i);
      if (!arg.includes('=')) i += 1;
    } else if (arg === '--limit' || arg.startsWith('--limit=')) {
      result.limit = Number(takeValue(arg, i));
      if (!arg.includes('=')) i += 1;
    } else if (arg === '--cache-ttl-hours' || arg.startsWith('--cache-ttl-hours=')) {
      result.cacheTtlHours = Number(takeValue(arg, i));
      if (!arg.includes('=')) i += 1;
    } else if (arg === '--max-candidates' || arg.startsWith('--max-candidates=')) {
      result.maxCandidates = Number(takeValue(arg, i));
      if (!arg.includes('=')) i += 1;
    } else {
      throw new Error('Unknown option: ' + arg);
    }
  }
  for (const key of ['limit', 'cacheTtlHours', 'maxCandidates']) {
    if (result[key] !== undefined && (!Number.isFinite(result[key]) || result[key] <= 0)) {
      throw new Error('Expected a positive number for --' + key.replace(/[A-Z]/g, (letter) => '-' + letter.toLowerCase()));
    }
  }
  return result;
}

export const USAGE = [
  'Usage: node discover-company-jobs.mjs [options]',
  '',
  'Input CSV: one company name per row, or a company_name/company/name header.',
  'Defaults:',
  '  --input data/company-names.csv',
  '  --output data/company-job-boards.csv',
  '  --cache data/cache/company-job-discovery.json',
  '',
  'Options:',
  '  --input <path>            Input company-name CSV',
  '  --output <path>           Output job-board CSV',
  '  --cache <path>            Persistent JSON cache',
  '  --limit <n>               Process only the first n companies',
  '  --max-candidates <n>      Verify up to n URLs per company (default 8)',
  '  --cache-ttl-hours <n>     Cache freshness window (default 168)',
  '  --refresh                 Ignore fresh cache entries and search again',
  '  --help                    Show this help',
].join('\n');

if (isMainModule(import.meta.url)) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      console.log(USAGE);
    } else {
      const summary = await runDiscovery(options);
      console.log('\nDiscovery complete.');
      console.log('Companies processed: ' + summary.companyCount);
      console.log('Output rows: ' + summary.outputRows);
      console.log('CSV: ' + summary.outputPath);
      console.log('Cache: ' + summary.cachePath);
      if (summary.failures.length) console.error('Company failures: ' + summary.failures.length);
    }
  } catch (error) {
    console.error('Company job-board discovery failed: ' + String(error.message ?? error));
    process.exitCode = 1;
  }
}
