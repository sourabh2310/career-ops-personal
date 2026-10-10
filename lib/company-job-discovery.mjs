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
import { isBlockedAddress } from '../providers/_ip-guard.mjs';
import { getCareerOpsRoot } from '../path-resolver.mjs';
import { isMainModule } from './is-main-module.mjs';

const DEFAULT_TIMEOUT_MS = 10000;
const MAX_SEARCH_RESULTS = 12;
const MAX_CANDIDATES_TO_VERIFY = 8;
const MAX_REDIRECTS = 4;
const SEARCH_DELAY_MS = 900;
const CACHE_VERSION = 1;

const ATS_RULES = [
  ['Greenhouse', /(^|\.)boards\.greenhouse\.io$|(^|\.)job-boards\.greenhouse\.io$/i],
  ['Lever', /(^|\.)jobs\.lever\.co$/i],
  ['Ashby', /(^|\.)jobs\.ashbyhq\.com$/i],
  ['Workday', /(^|\.)myworkdayjobs\.com$|(^|\.)wd\d+\.myworkdayjobs\.com$/i],
  ['SmartRecruiters', /(^|\.)jobs\.smartrecruiters\.com$/i],
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
    if (isIP(host) && isBlockedAddress(host)) return null;
    url.hash = '';
    return url;
  } catch {
    return null;
  }
}

function canonicalUrl(value) {
  const url = safeUrl(value);
  if (!url) return '';
  if (url.protocol === 'http:' && url.hostname !== 'localhost') url.protocol = 'https:';
  url.hostname = url.hostname.toLowerCase();
  if ((url.pathname === '/' || url.pathname === '') && !url.search) url.pathname = '';
  return url.href.replace(/\/$/, '');
}

function registrableHost(host) {
  const labels = String(host ?? '').toLowerCase().split('.').filter(Boolean);
  if (labels.length <= 2) return labels.join('.');
  const twoLevelSuffixes = new Set(['co.uk', 'org.uk', 'com.au', 'net.au', 'co.in', 'com.sg', 'co.nz', 'com.br', 'co.jp', 'com.mx']);
  const suffix = labels.slice(-2).join('.');
  return twoLevelSuffixes.has(suffix) && labels.length >= 3 ? labels.slice(-3).join('.') : labels.slice(-2).join('.');
}

function detectAts(url) {
  let host = '';
  try { host = new URL(url).hostname.toLowerCase(); } catch { return ''; }
  return ATS_RULES.find(([, pattern]) => pattern.test(host))?.[0] ?? '';
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
    const key = canonicalUrl(item.url);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, MAX_SEARCH_RESULTS);
}

function atsLabel(url) {
  return detectAts(url) || (JOB_PATH.test(new URL(url).pathname) ? 'Company-hosted' : 'Unknown');
}

function nameTokens(name) {
  return normalizeCompanyName(name).toLowerCase()
    .replace(/\b(incorporated|inc|corporation|corp|limited|ltd|llc|plc|private|pvt|company|co)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter((token) => token.length > 1);
}

function companyNameMatch(name, text, host = '') {
  const tokens = nameTokens(name);
  if (!tokens.length) return false;
  const haystack = (String(text) + ' ' + String(host)).toLowerCase().replace(/[^a-z0-9]+/g, ' ');
  const hits = tokens.filter((token) => haystack.includes(token)).length;
  return hits >= Math.max(1, Math.ceil(tokens.length * 0.6));
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
    const url = safeUrl(new URL(htmlDecode(match[2]), baseUrl).href);
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
  const scores = new Map();
  for (const item of results) {
    const host = item.host;
    if (!host || EXCLUDED_SEARCH_HOSTS.has(host) || detectAts(item.url)) continue;
    let score = 0;
    if (companyNameMatch(companyName, item.title, host)) score += 4;
    if (registrableHost(host).split('.')[0].includes(nameTokens(companyName)[0] ?? '___')) score += 3;
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

function classifyVerification(body, url, companyName) {
  const titleMatch = body.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  const title = stripHtml(titleMatch?.[1] ?? '');
  const text = stripHtml(body).slice(0, 300000);
  const ats = detectAts(url);
  const hasCareerLanguage = CAREER_WORDS.test(title + ' ' + text);
  const hasJobCards = JOB_CARD_WORDS.test(text);
  const hasStructuredJobs = /"@type"\s*:\s*"(JobPosting|ItemList)"|"jobPosting"|"totalJobs"/i.test(body);
  const isListingPath = JOB_PATH.test(new URL(url).pathname);
  const nameMatches = companyNameMatch(companyName, title + ' ' + text, new URL(url).hostname);
  let score = 0;
  if (ats) score += 20;
  if (hasCareerLanguage) score += 20;
  if (hasJobCards) score += 20;
  if (hasStructuredJobs) score += 25;
  if (isListingPath) score += 15;
  if (nameMatches) score += 10;
  const actualListing = hasStructuredJobs || (hasCareerLanguage && (hasJobCards || isListingPath)) || (ats && isListingPath && hasCareerLanguage);
  return { title, score: Math.min(100, score), actualListing, hasCareerLanguage, hasJobCards, hasStructuredJobs, nameMatches, ats };
}

export function scoreCandidate(candidate, verification = {}, officialDomain = '') {
  let score = initialCandidateScore(candidate.company_name ?? '', candidate, officialDomain);
  score += Number(verification.score ?? 0) * 0.3;
  if (verification.actualListing) score += 10;
  return Math.max(0, Math.min(100, Math.round(score)));
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
    const key = canonicalUrl(candidate.url);
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
    { query: '"' + companyName + '" site:jobs.ashbyhq.com OR site:boards.greenhouse.io OR site:jobs.lever.co OR site:myworkdayjobs.com', type: 'ats' },
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

async function verifyCandidate(ctx, companyName, candidate, officialDomain) {
  const base = {
    company_name: companyName,
    official_domain: officialDomain,
    career_homepage_url: '',
    job_listing_url: candidate.url,
    ats_platform: detectAts(candidate.url) || (JOB_PATH.test(new URL(candidate.url).pathname) ? 'Company-hosted' : 'Unknown'),
    confidence_score: 0,
    verification_status: 'Needs review',
    india_relevance: /(^|[./_-])(in|india)([./_-]|$)|india/i.test(candidate.url) ? 'India-specific URL (unverified)' : 'Global/unknown',
    evidence: '',
    last_checked_at: new Date().toISOString(),
    search_source: candidate.engine ?? '',
  };
  try {
    const response = await safeFetchText(ctx, candidate.url);
    const finalUrl = canonicalUrl(response.finalUrl);
    const signals = classifyVerification(response.body, finalUrl, companyName);
    const finalHost = new URL(finalUrl).hostname.toLowerCase();
    const isOfficial = !!officialDomain && registrableHost(finalHost) === registrableHost(officialDomain);
    const isAts = !!detectAts(finalUrl);
    let score = initialCandidateScore(companyName, { ...candidate, url: finalUrl, host: finalHost }, officialDomain);
    score = Math.min(100, Math.round(score * 0.45 + signals.score * 0.55));
    if (signals.actualListing) score = Math.min(100, score + 10);
    if (signals.nameMatches && (isOfficial || isAts)) score = Math.min(100, score + 5);
    const verified = signals.actualListing && (isOfficial || isAts || signals.nameMatches) && score >= 55;
    const homepage = !JOB_PATH.test(new URL(finalUrl).pathname) && !signals.hasJobCards && !signals.hasStructuredJobs;
    return {
      ...base,
      career_homepage_url: homepage && (isOfficial || signals.hasCareerLanguage) ? finalUrl : '',
      job_listing_url: finalUrl,
      ats_platform: detectAts(finalUrl) || (isOfficial ? 'Company-hosted' : base.ats_platform),
      confidence_score: score,
      verification_status: verified ? 'Verified' : 'Needs review',
      india_relevance: /(^|[./_-])(in|india)([./_-]|$)|india/i.test(finalUrl + ' ' + signals.title) ? 'India-specific evidence' : 'Global/unknown',
      evidence: [
        'HTTP page fetched',
        isOfficial ? 'official-domain match' : '',
        isAts ? 'recognized ATS: ' + detectAts(finalUrl) : '',
        signals.hasCareerLanguage ? 'careers/job language present' : '',
        signals.hasJobCards ? 'job-card/application language present' : '',
        signals.hasStructuredJobs ? 'structured job data present' : '',
        signals.nameMatches ? 'company-name evidence present' : 'company-name match uncertain',
        homepage ? 'appears to be a general careers homepage' : '',
      ].filter(Boolean).join('; '),
    };
  } catch (error) {
    const status = Number(error?.status);
    const temporary = status === 429 || status >= 500 || /timeout|timed out|network|fetch failed|aborted|ENOTFOUND|ECONN/i.test(String(error.message ?? error));
    return {
      ...base,
      verification_status: temporary ? 'Temporarily unavailable' : 'Needs review',
      evidence: 'Verification failed: ' + String(error.message ?? error).slice(0, 240),
    };
  }
}

function makeNotFoundRow(companyName, officialDomain, errors) {
  return {
    company_name: companyName,
    official_domain: officialDomain,
    career_homepage_url: officialDomain ? 'https://' + officialDomain : '',
    job_listing_url: '',
    ats_platform: '',
    confidence_score: 0,
    verification_status: errors.length ? 'Temporarily unavailable' : 'Not found',
    india_relevance: 'Unknown',
    evidence: errors.slice(0, 4).join(' | ') || 'No sufficiently reliable direct job-listing URL discovered.',
    last_checked_at: new Date().toISOString(),
    search_source: '',
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

function cacheKey(name) {
  return normalizeCompanyName(name).toLowerCase().replace(/\s+/g, ' ');
}

function isFreshCache(entry, ttlHours) {
  const timestamp = Date.parse(entry?.checked_at ?? '');
  return Number.isFinite(timestamp) && Date.now() - timestamp < ttlHours * 3600000 && Array.isArray(entry.rows);
}

export async function discoverCompany(companyName, options = {}) {
  const ctx = options.ctx ?? makeHttpCtx();
  const company = normalizeCompanyName(companyName);
  const errors = [];
  const officialDomain = await discoverOfficialDomain(ctx, company, errors);
  const candidates = await collectCandidates(ctx, company, officialDomain, errors);
  const verified = [];
  for (const candidate of candidates.slice(0, options.maxCandidates ?? MAX_CANDIDATES_TO_VERIFY)) {
    const row = await verifyCandidate(ctx, company, candidate, officialDomain);
    if (row.job_listing_url && row.verification_status === 'Verified') verified.push(row);
  }
  // Keep up to three distinct direct boards. Never mistake a generic homepage
  // for a direct listing URL; retain it separately as a useful fallback.
  const unique = [];
  const seen = new Set();
  for (const row of verified.sort((a, b) => b.confidence_score - a.confidence_score)) {
    const key = canonicalUrl(row.job_listing_url);
    if (key && !seen.has(key)) {
      seen.add(key);
      unique.push(row);
    }
    if (unique.length >= 3) break;
  }
  if (!unique.length) {
    const reviewed = [];
    for (const candidate of candidates.slice(0, 3)) {
      const row = await verifyCandidate(ctx, company, candidate, officialDomain);
      if (row.job_listing_url) reviewed.push(row);
    }
    const plausible = reviewed.filter((row) => row.verification_status === 'Needs review' && row.confidence_score >= 30)
      .sort((a, b) => b.confidence_score - a.confidence_score);
    if (plausible.length) return plausible.slice(0, 2);
    return [makeNotFoundRow(company, officialDomain, errors)];
  }
  return unique;
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
  const companies = inputRows.slice(0, limit);
  const ctx = options.ctx ?? makeHttpCtx();
  for (let index = 0; index < companies.length; index += 1) {
    const company = companies[index].company_name;
    const key = cacheKey(company);
    const cached = cache.companies[key];
    let rows;
    if (!options.refresh && isFreshCache(cached, ttlHours)) {
      rows = cached.rows.map((row) => ({ ...row, search_source: (row.search_source || '') + (row.search_source ? '; ' : '') + 'cache' }));
      console.log('[' + (index + 1) + '/' + companies.length + '] ' + company + ' — cache hit (' + rows.length + ' row(s))');
    } else {
      console.log('[' + (index + 1) + '/' + companies.length + '] Discovering ' + company);
      try {
        rows = await discoverCompany(company, { ctx, maxCandidates: options.maxCandidates });
        cache.companies[key] = { checked_at: new Date().toISOString(), rows };
        writeCache(cachePath, cache);
      } catch (error) {
        failures.push(company + ': ' + String(error.message ?? error));
        rows = [makeNotFoundRow(company, '', [String(error.message ?? error)])];
      }
    }
    output.push(...rows);
    if (index < companies.length - 1) await sleep(options.companyDelayMs ?? SEARCH_DELAY_MS);
  }
  const columns = [
    'company_name', 'official_domain', 'career_homepage_url', 'job_listing_url',
    'ats_platform', 'confidence_score', 'verification_status', 'india_relevance',
    'evidence', 'last_checked_at', 'search_source',
  ];
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, toCsv(output, columns), 'utf8');
  return { inputPath, outputPath, cachePath, companyCount: companies.length, outputRows: output.length, failures };
}

export function parseArgs(args) {
  const result = { refresh: false, limit: undefined, inputPath: undefined, outputPath: undefined, cachePath: undefined };
  const valueFlags = new Set(['--input', '--output', '--cache', '--limit', '--cache-ttl-hours', '--max-candidates']);
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') result.help = true;
    else if (arg === '--refresh') result.refresh = true;
    else if (arg === '--input' || arg.startsWith('--input=')) result.inputPath = arg.includes('=') ? arg.slice(arg.indexOf('=') + 1) : args[++i];
    else if (arg === '--output' || arg.startsWith('--output=')) result.outputPath = arg.includes('=') ? arg.slice(arg.indexOf('=') + 1) : args[++i];
    else if (arg === '--cache' || arg.startsWith('--cache=')) result.cachePath = arg.includes('=') ? arg.slice(arg.indexOf('=') + 1) : args[++i];
    else if (arg === '--limit' || arg.startsWith('--limit=')) result.limit = Number(arg.includes('=') ? arg.slice(arg.indexOf('=') + 1) : args[++i]);
    else if (arg === '--cache-ttl-hours' || arg.startsWith('--cache-ttl-hours=')) result.cacheTtlHours = Number(arg.includes('=') ? arg.slice(arg.indexOf('=') + 1) : args[++i]);
    else if (arg === '--max-candidates' || arg.startsWith('--max-candidates=')) result.maxCandidates = Number(arg.includes('=') ? arg.slice(arg.indexOf('=') + 1) : args[++i]);
    else if (valueFlags.has(arg)) throw new Error('Missing value for ' + arg);
    else throw new Error('Unknown option: ' + arg);
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
