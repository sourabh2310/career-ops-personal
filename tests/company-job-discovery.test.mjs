import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pass, fail } from './helpers.mjs';
import {
  DESTINATION_TYPES,
  cacheEntryForRows,
  classifyIndiaRelevance,
  classifyVerification,
  companyDedupKey,
  compareDiscoveryRows,
  dedupeRows,
  detectAts,
  detectThirdParty,
  discoverCompany,
  identitySignals,
  isFreshCache,
  normalizeUrlForDedup,
  parseArgs,
  parseCsv,
  rowDedupKey,
  runDiscovery,
  scoreCandidate,
  toCsv,
} from '../lib/company-job-discovery.mjs';

async function check(name, fn) {
  try {
    await fn();
    pass(name);
  } catch (error) {
    fail(name + ': ' + String(error?.stack ?? error));
  }
}

console.log('\ncompany job-board discovery — utility tests');

await check('parseCsv reads company-name-only files with or without a header', () => {
  assert.deepEqual(parseCsv('company_name\nAmazon\nMicrosoft\n'), [
    { company_name: 'Amazon', input_row: 2 },
    { company_name: 'Microsoft', input_row: 3 },
  ]);
  assert.deepEqual(parseCsv('Amazon\nMicrosoft\n'), [
    { company_name: 'Amazon', input_row: 1 },
    { company_name: 'Microsoft', input_row: 2 },
  ]);
});

await check('parseCsv handles BOM, quoted commas, escaped quotes and multiline values', () => {
  const rows = parseCsv('\uFEFFcompany_name,notes\r\n"Example, Inc.","said ""hello"""\r\n"New\nCompany",ok\r\n');
  assert.equal(rows[0].company_name, 'Example, Inc.');
  assert.equal(rows[0].notes, 'said "hello"');
  // Company names are whitespace-normalized for deduplication, so an embedded
  // newline folds to a space rather than surviving verbatim.
  assert.equal(rows[1].company_name, 'New Company');
});

await check('parseCsv rejects an unterminated quoted field', () => {
  assert.throws(() => parseCsv('company_name\n"Broken Company'), /unterminated quoted field/i);
});

await check('toCsv safely quotes values containing commas, quotes and newlines', () => {
  const csv = toCsv([{ company_name: 'Example, Inc.', evidence: 'said "hello"\nagain' }], ['company_name', 'evidence']);
  assert.equal(csv, 'company_name,evidence\r\n"Example, Inc.","said ""hello""\nagain"\r\n');
});

await check('toCsv round-trips the full discovery schema including destination_type', () => {
  const rows = [{
    company_name: 'Example, Inc.', official_domain: 'example.com',
    career_homepage_url: '', job_listing_url: 'https://example.com/CareerDetail/Eng-1',
    ats_platform: 'Company-hosted', confidence_score: 90, verification_status: 'Verified',
    india_relevance: 'global', evidence: 'a; b', last_checked_at: '2026-01-01T00:00:00.000Z',
    search_source: 'duckduckgo', destination_type: 'verified_active_job',
  }];
  const columns = Object.keys(rows[0]);
  const parsed = parseCsv(toCsv(rows, columns));
  assert.equal(parsed.length, 1);
  for (const key of columns) {
    assert.equal(parsed[0][key], String(rows[0][key]), 'round-trip field ' + key);
  }
});

await check('parseArgs supports equals syntax and rejects unknown or missing arguments', () => {
  assert.deepEqual(parseArgs(['--input=names.csv', '--limit', '10', '--refresh']), {
    refresh: true, limit: 10, inputPath: 'names.csv', outputPath: undefined, cachePath: undefined,
  });
  assert.throws(() => parseArgs(['--bogus']), /Unknown option/);
  assert.throws(() => parseArgs(['--input']), /Missing value/);
});

await check('candidate scoring rewards known ATS job-listing URLs', () => {
  const candidate = {
    company_name: 'Example Technologies',
    url: 'https://jobs.ashbyhq.com/example-technologies',
    host: 'jobs.ashbyhq.com',
    title: 'Example Technologies Careers',
    queryType: 'ats',
    engine: 'duckduckgo',
  };
  const score = scoreCandidate(candidate, { score: 60, actualListing: true }, '');
  assert.ok(score >= 40 && score <= 100);
});

console.log('\ncompany job-board discovery — URL normalization and deduplication');

await check('companyDedupKey folds case and whitespace so repeated inputs share one pass', () => {
  assert.equal(companyDedupKey('Acme Corp'), companyDedupKey('  ACME   corp '));
  assert.notEqual(companyDedupKey('Acme Corp'), companyDedupKey('Acme Labs'));
});

await check('normalizeUrlForDedup collapses scheme, www, case, ports, slashes', () => {
  const a = normalizeUrlForDedup('http://www.3i-infotech.com:80/careers');
  const b = normalizeUrlForDedup('https://3I-INFOTECH.com:443/careers/');
  assert.ok(a);
  assert.equal(a, b);
});

await check('normalizeUrlForDedup strips tracking params and fragments', () => {
  const clean = normalizeUrlForDedup('https://example.com/careers');
  assert.equal(normalizeUrlForDedup('https://example.com/careers?utm_source=google&utm_medium=cpc&gclid=abc&fbclid=x#team'), clean);
  assert.equal(normalizeUrlForDedup('https://example.com/careers?b=2&a=1'), 'https://example.com/careers?a=1&b=2');
});

await check('normalizeUrlForDedup preserves job IDs, locale and routing-significant values', () => {
  const job1 = normalizeUrlForDedup('https://ats.example.com/jobs?gh_jid=aaa111&locale=en');
  const job2 = normalizeUrlForDedup('https://ats.example.com/jobs?gh_jid=bbb222&locale=en');
  assert.ok(job1.includes('gh_jid=aaa111') && job1.includes('locale=en'));
  assert.notEqual(job1, job2);
  assert.notEqual(
    normalizeUrlForDedup('https://example.com/CareerDetail/HR-Intern'),
    normalizeUrlForDedup('https://example.com/CareerDetail/Dot-Net-Developer'),
  );
  // Locale-specific career destinations stay distinct.
  assert.notEqual(
    normalizeUrlForDedup('https://example.com/in-en/careers/jobsearch'),
    normalizeUrlForDedup('https://example.com/us/en/careers/jobsearch'),
  );
  // SPA job-app routing fragments are significant; plain anchors are not.
  assert.notEqual(
    normalizeUrlForDedup('https://example.com/careers#/job/123'),
    normalizeUrlForDedup('https://example.com/careers'),
  );
  assert.equal(
    normalizeUrlForDedup('https://example.com/careers#team'),
    normalizeUrlForDedup('https://example.com/careers'),
  );
});

await check('dedupeRows collapses equivalent destinations and keeps the best row', () => {
  const rows = [
    { company_name: '3i Infotech', job_listing_url: 'http://www.3i-infotech.com/careers', career_homepage_url: '', confidence_score: 80 },
    { company_name: '3i Infotech', job_listing_url: 'https://www.3i-infotech.com/careers?utm_source=x', career_homepage_url: '', confidence_score: 82 },
    { company_name: '3i Infotech', job_listing_url: 'https://www.3i-infotech.com/perspectives/articles/jobs', career_homepage_url: '', confidence_score: 60 },
  ];
  const deduped = dedupeRows(rows);
  assert.equal(deduped.length, 2);
  assert.equal(deduped.find((row) => row.confidence_score === 82)?.job_listing_url, 'https://www.3i-infotech.com/careers?utm_source=x');
});

await check('rowDedupKey prefers the listing URL and is scheme-insensitive', () => {
  assert.equal(
    rowDedupKey({ job_listing_url: 'http://example.com/careers', career_homepage_url: 'https://example.com/other' }),
    rowDedupKey({ job_listing_url: 'https://example.com/careers', career_homepage_url: '' }),
  );
});

await check('compareDiscoveryRows orders vacancies before boards, homepages, third-party and unknowns', () => {
  const row = (destination_type, confidence_score = 50, job_listing_url = 'https://example.com/x') =>
    ({ company_name: 'Example', destination_type, confidence_score, job_listing_url, career_homepage_url: '' });
  const shuffled = [
    row('temporarily_unavailable'), row('third_party_job_source'), row('not_found'),
    row('official_careers_homepage'), row('verified_active_job'), row('ats_job_board'),
    row('needs_review'), row('official_company_website'),
  ];
  const ordered = [...shuffled].sort(compareDiscoveryRows).map((r) => r.destination_type);
  assert.deepEqual(ordered, [
    'verified_active_job', 'ats_job_board', 'official_careers_homepage', 'official_company_website',
    'third_party_job_source', 'needs_review', 'not_found', 'temporarily_unavailable',
  ]);
  // Ties break by score, then URL: fully deterministic.
  const tie = [row('needs_review', 40, 'https://example.com/b'), row('needs_review', 60, 'https://example.com/a')]
    .sort(compareDiscoveryRows);
  assert.equal(tie[0].confidence_score, 60);
});

console.log('\ncompany job-board discovery — destination classification');

const HUB_HTML = '<html><head><title>Example Corp Careers</title></head><body>'
  + '<h1>Example Corp Careers</h1><p>Explore open roles across the globe. Join our team and search jobs by location.</p>'
  + '</body></html>';

const VACANCY_HTML = '<html><head><title>Senior Engineer - Example Corp</title>'
  + '<script type="application/ld+json">{"@context":"https://schema.org","@type":"JobPosting","title":"Senior Engineer"}</script>'
  + '</head><body><h1>Senior Engineer, Example Corp</h1><p>Example Corp is hiring. '
  + 'This full-time role is based in Bengaluru. Job ID: EX-2026-118. Apply for this job today.</p></body></html>';

const CULTURE_HTML = '<html><head><title>Working Here | Accenture</title></head><body>'
  + '<h1>Life at Accenture</h1><p>Our culture and values shape working here. Meet our people.</p>'
  + '<nav><a href="/in-en/careers/jobsearch">Search Jobs</a> <a href="/in-en/careers/jobsearch">Apply Now</a></nav>'
  + '<footer>Software engineer stories from Bengaluru, India.</footer></body></html>';

const ARTICLE_HTML = '<html><head><title>Jobs market outlook | 3i Infotech Perspectives</title></head><body>'
  + '<article><h1>Perspectives on jobs in banking</h1><p>3i Infotech analysts discuss full-time '
  + 'hiring trends. View job details in the report. Search jobs across sectors.</p></article></body></html>';

const APPLY_HUB_HTML = '<html><head><title>Apply | Adobe Careers</title></head><body>'
  + '<h1>Adobe Careers application hub</h1><p>Start and manage your Adobe application. Search jobs and view your profile.</p>'
  + '<script type="application/ld+json">{"@context":"https://schema.org","@type":"ItemList","name":"Adobe jobs"}</script>'
  + '</body></html>';

const THIRD_PARTY_HTML = '<html><head><title>314e Corporation Careers and Jobs | Cutshort</title></head><body>'
  + '<h1>314e Corporation jobs at Cutshort</h1><p>Apply now to open roles. 314e Corporation is hiring software engineers.</p>'
  + '<script type="application/ld+json">{"@context":"https://schema.org","@type":"ItemList"}</script>'
  + '</body></html>';

await check('careers hub is a search destination, not an individual vacancy', () => {
  const signals = classifyVerification(HUB_HTML, 'https://example.com/careers', 'Example Corp');
  assert.equal(signals.vacancy, false);
  assert.equal(signals.searchInterface, true);
  assert.equal(signals.thirdParty, false);
});

await check('JSON-LD JobPosting with application language is vacancy evidence', () => {
  const signals = classifyVerification(VACANCY_HTML, 'https://example.com/CareerDetail/Senior-Engineer-EX-118', 'Example Corp');
  assert.equal(signals.vacancy, true);
  assert.equal(signals.hasStructuredJobPosting, true);
  assert.equal(signals.hasJobIdReference, true);
});

await check('culture page with footer boilerplate is never a vacancy', () => {
  const signals = classifyVerification(
    CULTURE_HTML, 'https://www.accenture.com/in-en/careers/life-at-accenture/working-here', 'Accenture');
  assert.equal(signals.isNonListingPath, true);
  assert.equal(signals.vacancy, false);
  assert.equal(signals.searchInterface, false);
});

await check('blog/article URL containing "jobs" is never a vacancy', () => {
  const signals = classifyVerification(
    ARTICLE_HTML, 'https://www.3i-infotech.com/perspectives/articles/jobs', '3i Infotech');
  assert.equal(signals.isNonListingPath, true);
  assert.equal(signals.vacancy, false);
});

await check('generic apply hub and program pages are not individual vacancies', () => {
  const apply = classifyVerification(APPLY_HUB_HTML, 'https://careers.adobe.com/us/en/apply', 'Adobe');
  assert.equal(apply.isNonListingPath, true);
  assert.equal(apply.vacancy, false);
  const intern = classifyVerification(HUB_HTML, 'https://careers.adobe.com/us/en/intern-and-graduate', 'Adobe');
  assert.equal(intern.isNonListingPath, true);
  assert.equal(intern.vacancy, false);
});

await check('third-party company pages are flagged and can never be vacancies', () => {
  const signals = classifyVerification(THIRD_PARTY_HTML, 'https://cutshort.io/company/314e-corporation-03-t6ePLz3x', '314e Corporation');
  assert.equal(signals.thirdParty, true);
  assert.equal(signals.vacancy, false);
});

await check('listing hubs stay hubs even when they embed JobPosting data for many jobs', () => {
  const hubWithPostings = '<html><head><title>Acme Jobs</title>'
    + '<script type="application/ld+json">{"@context":"https://schema.org","@type":"ItemList"}</script>'
    + '<script type="application/ld+json">{"@context":"https://schema.org","@type":"JobPosting","title":"Engineer I"}</script>'
    + '</head><body><h1>Acme Jobs</h1><p>Search jobs at Acme. Twenty open roles. Apply now.</p></body></html>';
  for (const url of [
    'https://www.accenture.com/in-en/careers/jobsearch',
    'https://careers.adobe.com/us/en/search-results',
    'https://www.acko.com/careers/jobs',
  ]) {
    const signals = classifyVerification(hubWithPostings.replaceAll('Acme', 'Acme'), url, 'Acme');
    assert.equal(signals.isListingHub, true, url);
    assert.equal(signals.vacancy, false, url + ' is a hub, not one vacancy');
    assert.equal(signals.searchInterface, true, url);
  }
});

await check('posting URLs with job IDs are vacancies, not hubs', () => {
  const posting = '<html><head><title>Senior Engineer - Acme</title>'
    + '<script type="application/ld+json">{"@context":"https://schema.org","@type":"JobPosting","title":"Senior Engineer"}</script>'
    + '</head><body><h1>Senior Engineer, Acme</h1><p>Acme is hiring. Apply for this job today.</p></body></html>';
  const greenhouse = classifyVerification(posting, 'https://boards.greenhouse.io/acme/jobs/123456', 'Acme');
  assert.equal(greenhouse.hasJobIdInUrl, true);
  assert.equal(greenhouse.isListingHub, false);
  assert.equal(greenhouse.vacancy, true);
  const detail = classifyVerification(posting, 'https://www.acme.com/CareerDetail/Senior-Engineer', 'Acme');
  assert.equal(detail.vacancy, true);
});

await check('white-label career hosts are third-party, never official domains', () => {
  assert.equal(detectThirdParty('https://www.careerpages.co.in/company/1-mg'), true);
});

console.log('\ncompany job-board discovery — company identity and geography');

await check('short name tokens require whole-word matches (1 mg vs 1mgdoctors.com)', () => {
  assert.equal(identitySignals('1 mg', 'Doctors at 1mg Doctors portal', '1mgdoctors.com').match, false);
  assert.equal(identitySignals('1 mg', 'Tata 1mg careers. Jobs at 1 mg in Gurugram.', 'www.1mg.com').match, true);
});

await check('identity matching accepts official hosts and rejects unrelated domains', () => {
  assert.equal(identitySignals('Acaira', 'Acaira Careers. Join Acaira today.', 'www.acaira.com').match, true);
  assert.equal(identitySignals('247.ai', '247.ai Careers and open roles at 247.ai', 'www.247.ai').match, true);
  assert.equal(identitySignals('Accenture', 'Life at Accenture, working here', 'www.accenture.com').match, true);
  assert.equal(identitySignals('Acme Corp', 'Unrelated generic job board with thousands of listings', 'jobs.example.net').match, false);
});

await check('classifyIndiaRelevance tiers locale+text, global and unknown apart', () => {
  const specific = classifyIndiaRelevance(
    'https://www.accenture.com/in-en/careers/jobsearch', 'Accenture Careers',
    'Find jobs in India across Bengaluru and Hyderabad. Open roles in India.');
  assert.equal(specific.relevance, 'india_specific');
  const global = classifyIndiaRelevance('https://example.com/careers', 'Example Careers', 'Welcome to our careers page.');
  assert.equal(global.relevance, 'global');
  const unknown = classifyIndiaRelevance('not a url', '', '');
  assert.equal(unknown.relevance, 'unknown');
  // A bare locale segment without hiring text stays explicitly unconfirmed.
  const thin = classifyIndiaRelevance('https://example.com/in-en/careers', 'Example Careers', 'Welcome.');
  assert.equal(thin.relevance, 'india_specific');
  assert.match(thin.evidence, /unconfirmed/i);
});

console.log('\ncompany job-board discovery — ATS detection');

await check('existing ATS providers keep working (no regressions)', () => {
  const cases = [
    ['https://boards.greenhouse.io/acme/jobs/123', 'Greenhouse'],
    ['https://job-boards.greenhouse.io/acme', 'Greenhouse'],
    ['https://jobs.lever.co/acme/abc-123', 'Lever'],
    ['https://jobs.ashbyhq.com/acme', 'Ashby'],
    ['https://acme.wd3.myworkdayjobs.com/careers', 'Workday'],
    ['https://jobs.smartrecruiters.com/Acme', 'SmartRecruiters'],
    ['https://careers-acme.icims.com/jobs/1234/job', 'iCIMS'],
    ['https://apply.workable.com/acme', 'Workable'],
    ['https://acme.recruitee.com', 'Recruitee'],
    ['https://jobs.jobvite.com/acme', 'Jobvite'],
    ['https://acme.teamtailor.com', 'Teamtailor'],
    ['https://jobs.successfactors.com', 'SuccessFactors'],
    ['https://acme.fa.us2.oraclecloud.com/hcmUI', 'Oracle Cloud'],
    ['https://acme.bamboohr.com/jobs', 'BambooHR'],
  ];
  for (const [url, expected] of cases) assert.equal(detectAts(url), expected, url);
  assert.equal(detectAts('https://example.com/careers'), '');
});

await check('Darwinbox tenant portals are detected as Darwinbox', () => {
  assert.equal(detectAts('https://allcargo.darwinbox.in'), 'Darwinbox');
  assert.equal(detectAts('https://acme-corp.darwinbox.in/login'), 'Darwinbox');
  assert.equal(detectAts('https://rategain.darwinbox.com/ms/candidate/careers'), 'Darwinbox');
  const portalHtml = '<html><head><title>Acme : Login</title></head><body><form>candidate login</form>'
    + '<a href="https://www.darwinbox.com/"><img src="/images/darwinbox/poweredby.png" alt="logo"></a></body></html>';
  assert.equal(detectAts('https://acme.darwinbox.in/login', portalHtml), 'Darwinbox');
});

await check('Darwinbox corporate pages and bare-word matches are not ATS boards', () => {
  assert.equal(detectAts('https://darwinbox.com/blog/some-post'), '');
  assert.equal(detectAts('https://newsroom.darwinbox.com/press-release/x'), '');
  assert.equal(detectAts('https://darwinbox.com/products/recruitment'), '');
  // Company name, query string, or page text containing "darwinbox" is not enough.
  assert.equal(detectAts('https://darwinboxsolutions.com/careers'), '');
  assert.equal(detectAts('https://example.com/careers?vendor=darwinbox'), '');
  assert.equal(detectAts('https://example.com/careers', '<html><body>we migrated from darwinbox</body></html>'), '');
});

await check('detectThirdParty separates aggregators from official and ATS pages', () => {
  for (const url of [
    'https://www.jobaaj.com/company/314e-corporation-careers',
    'https://cutshort.io/company/acme-03-abc',
    'https://www.naukri.com/acme-jobs',
    'https://in.indeed.com/cmp/Acme',
    'https://www.linkedin.com/company/acme',
  ]) assert.equal(detectThirdParty(url), true, url);
  for (const url of [
    'https://www.acme.com/careers',
    'https://jobs.ashbyhq.com/acme',
    'https://acme.darwinbox.in',
  ]) assert.equal(detectThirdParty(url), false, url);
});

await check('DESTINATION_TYPES keeps the eight required semantic distinctions', () => {
  assert.deepEqual([...DESTINATION_TYPES].sort(), [
    'ats_job_board', 'needs_review', 'not_found', 'official_careers_homepage',
    'official_company_website', 'temporarily_unavailable', 'third_party_job_source',
    'verified_active_job',
  ].sort());
});

console.log('\ncompany job-board discovery — confidence scoring');

await check('confidence reflects evidence: vacancy required for high scores', () => {
  const candidate = (url, title) => ({ company_name: 'Example Corp', url, host: new URL(url).hostname, title });
  const hubSignals = { ats: '', thirdParty: false, nameMatches: true, hasCareerLanguage: true, vacancy: false };
  const hubScore = scoreCandidate(candidate('https://example.com/careers', 'Example Corp Careers'), hubSignals, 'example.com');
  assert.ok(hubScore < 95 && hubScore > 40, 'hub scores mid-range, got ' + hubScore);
  // A strong domain match alone never reaches vacancy-level confidence.
  const bareSignals = { ats: '', thirdParty: false, nameMatches: true, hasCareerLanguage: false, vacancy: false };
  const bareScore = scoreCandidate(candidate('https://example.com/', 'Example Corp'), bareSignals, 'example.com');
  assert.ok(bareScore <= 70, 'no vacancy evidence caps at 70, got ' + bareScore);
});

await check('third-party results and missing identity are capped down', () => {
  const candidate = (url, title) => ({ company_name: '314e Corporation', url, host: new URL(url).hostname, title });
  const third = scoreCandidate(
    candidate('https://cutshort.io/company/314e-corporation-03-x', '314e Corporation Jobs | Cutshort'),
    { ats: '', thirdParty: true, nameMatches: true, hasCareerLanguage: true, vacancy: false }, '');
  assert.ok(third <= 45, 'third-party caps at 45, got ' + third);
  const noIdentity = scoreCandidate(
    candidate('https://example.com/CareerDetail/X-1', 'Some Job'),
    { ats: '', thirdParty: false, nameMatches: false, hasCareerLanguage: true, vacancy: true }, 'example.com');
  assert.ok(noIdentity <= 40, 'missing identity caps at 40, got ' + noIdentity);
});

await check('corroborated vacancy evidence scores high without double-counting ATS', () => {
  const candidate = {
    company_name: 'Example Corp', url: 'https://example.com/CareerDetail/X-1',
    host: 'example.com', title: 'Senior Engineer - Example Corp',
  };
  const signals = { ats: '', thirdParty: false, nameMatches: true, hasCareerLanguage: true, vacancy: true };
  const once = scoreCandidate(candidate, signals, 'example.com');
  const twice = scoreCandidate(candidate, { ...signals, score: 100 }, 'example.com');
  assert.equal(once, twice, 'embedded legacy score field must not inflate v2 signals');
  assert.ok(once >= 80, 'corroborated vacancy scores high, got ' + once);
});

console.log('\ncompany job-board discovery — cache behaviour');

await check('cacheEntryForRows gives temporary failures a short TTL and findings the full TTL', () => {
  const tempEntry = cacheEntryForRows([{
    destination_type: 'temporarily_unavailable', verification_status: 'Temporarily unavailable',
  }], 168);
  const tempTtl = (Date.parse(tempEntry.expires_at) - Date.parse(tempEntry.checked_at)) / 3600000;
  assert.ok(tempTtl <= 24 && tempTtl > 0, 'temporary TTL ' + tempTtl);
  const okEntry = cacheEntryForRows([{
    destination_type: 'official_careers_homepage', verification_status: 'Verified',
  }], 168);
  assert.equal((Date.parse(okEntry.expires_at) - Date.parse(okEntry.checked_at)) / 3600000, 168);
});

await check('isFreshCache honours expires_at and rejects malformed entries', () => {
  const fresh = { checked_at: new Date().toISOString(), expires_at: new Date(Date.now() + 3600000).toISOString(), rows: [] };
  assert.equal(isFreshCache(fresh, 168), true);
  assert.equal(isFreshCache({ ...fresh, expires_at: new Date(Date.now() - 1000).toISOString() }, 168), false);
  assert.equal(isFreshCache({ checked_at: 'garbage', rows: [] }, 168), false);
  assert.equal(isFreshCache(null, 168), false);
  assert.equal(isFreshCache({ checked_at: new Date().toISOString(), rows: 'nope' }, 168), false);
});

console.log('\ncompany job-board discovery — fixture-driven discovery runs');

// Deterministic stub transport: routes fetchText calls to fixtures, records
// every request, and never touches the network.
function makeStubTransport(handler) {
  const calls = [];
  const ctx = {
    fetchText: async (url) => {
      calls.push(url);
      const outcome = handler(url);
      if (outcome instanceof Error) throw outcome;
      return outcome;
    },
  };
  return { calls, ctx };
}

const statusError = (status, message) => Object.assign(new Error(message), { status });

function searchHtml(links) {
  return '<html><body>' + links.map(([href, label]) =>
    '<div class="result"><a class="result__a" href="' + href + '">' + label + '</a></div>').join('') + '</body></html>';
}

await check('discoverCompany collapses http/https and redirect duplicates into one row', async () => {
  const hub = HUB_HTML.replaceAll('Example Corp', 'Redirect Corp');
  const { calls, ctx } = makeStubTransport((url) => {
    if (url.includes('duckduckgo.com') || url.includes('bing.com')) {
      return searchHtml([
        ['https://redirect.example.com/', 'Redirect Corp Official Site'],
        ['http://redirect.example.com/careers', 'Redirect Corp Careers'],
        ['https://www.redirect.example.com/careers', 'Redirect Corp Careers and Jobs'],
      ]);
    }
    if (url === 'https://redirect.example.com') {
      return '<html><head><title>Redirect Corp</title></head><body>'
        + '<a href="https://redirect.example.com/careers">Redirect Corp Careers</a></body></html>';
    }
    if (url === 'http://redirect.example.com/careers') throw statusError(301, 'Moved');
    if (url === 'https://redirect.example.com/careers' || url === 'https://www.redirect.example.com/careers') return hub;
    throw statusError(404, 'HTTP 404 Not Found');
  });
  // Emulate the 301 target resolution the live fetcher performs.
  const realFetch = ctx.fetchText;
  ctx.fetchText = async (url) => {
    if (url === 'http://redirect.example.com/careers') return hub;
    return realFetch(url);
  };
  const rows = await discoverCompany('Redirect Corp', { ctx });
  assert.ok(rows.length >= 1, 'expected at least one row, got ' + rows.length);
  const keys = rows.map(rowDedupKey);
  assert.equal(new Set(keys).size, keys.length, 'duplicate destinations in ' + JSON.stringify(keys));
  assert.ok(rows.every((row) => row.destination_type !== 'verified_active_job'), 'hub is not a vacancy');
  assert.ok(calls.length > 0, 'stub transport was exercised');
});

await check('discoverCompany collapses same-host fallback pages into one row', async () => {
  const plain = '<html><head><title>RateGain</title></head><body><h1>RateGain</h1><p>RateGain travel technology.</p></body></html>';
  const { ctx } = makeStubTransport((url) => {
    if (url.includes('duckduckgo.com') || url.includes('bing.com')) {
      return searchHtml([['https://rategain.example.com/', 'RateGain Official Site']]);
    }
    if (url === 'https://rategain.example.com') return plain;
    if (url === 'https://rategain.example.com/careers' || url === 'https://rategain.example.com/jobs') return plain;
    throw statusError(404, 'HTTP 404 Not Found');
  });
  const rows = await discoverCompany('RateGain', { ctx });
  const keys = rows.map(rowDedupKey);
  assert.equal(new Set(keys).size, keys.length, 'duplicate fallback destinations in ' + JSON.stringify(keys));
  assert.ok(rows.every((row) => row.destination_type !== 'verified_active_job'), 'plain pages are not vacancies');
});

await check('discoverCompany labels third-party profiles third-party, never Verified', async () => {
  const { ctx } = makeStubTransport((url) => {
    if (url.includes('duckduckgo.com') || url.includes('bing.com')) {
      return searchHtml([
        ['https://cutshort.io/company/314e-corporation-03-x', '314e Corporation Careers and Jobs | Cutshort'],
        ['https://www.jobaaj.com/company/314e-corporation-careers', '314e Corporation Jobs | Jobaaj'],
      ]);
    }
    if (url.includes('cutshort.io') || url.includes('jobaaj.com')) {
      return THIRD_PARTY_HTML.replaceAll('314e Corporation', '314e Corporation');
    }
    throw statusError(404, 'HTTP 404 Not Found');
  });
  const rows = await discoverCompany('314e Corporation', { ctx });
  assert.ok(rows.length >= 1, 'expected fallback rows');
  for (const row of rows) {
    assert.equal(row.destination_type, 'third_party_job_source');
    assert.notEqual(row.verification_status, 'Verified');
    assert.ok(row.confidence_score <= 45, 'third-party confidence capped, got ' + row.confidence_score);
  }
});

await check('discoverCompany detects a Darwinbox tenant board as Darwinbox ATS', async () => {
  const portal = '<html><head><title>Acme : Careers</title></head><body><h1>Acme Careers</h1>'
    + '<p>Explore open roles at Acme. Search jobs and apply now.</p>'
    + '<a href="https://www.darwinbox.com/"><img src="/images/darwinbox/poweredby.png"></a></body></html>';
  const { ctx } = makeStubTransport((url) => {
    if (url.includes('duckduckgo.com') || url.includes('bing.com')) {
      if (url.includes('official')) {
        return searchHtml([['https://acme.example.com/', 'Acme Official Site']]);
      }
      return searchHtml([
        ['https://acme.example.com/', 'Acme Official Site'],
        ['https://acme.darwinbox.in/ms/candidate/careers', 'Acme Careers Portal'],
      ]);
    }
    if (url === 'https://acme.example.com') {
      return '<html><head><title>Acme</title></head><body><a href="https://acme.example.com/about">About Acme</a></body></html>';
    }
    if (url === 'https://acme.darwinbox.in/ms/candidate/careers') return portal;
    throw statusError(404, 'HTTP 404 Not Found');
  });
  const rows = await discoverCompany('Acme', { ctx });
  const board = rows.find((row) => row.ats_platform === 'Darwinbox');
  assert.ok(board, 'expected a Darwinbox row in ' + JSON.stringify(rows.map((r) => [r.ats_platform, r.destination_type])));
  assert.equal(board.destination_type, 'ats_job_board');
  assert.equal(board.verification_status, 'Verified');
});

await check('runDiscovery dedups input companies, caches, refreshes and stays deterministic', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'co-discovery-'));
  const inputPath = join(dir, 'companies.csv');
  const outputPath = join(dir, 'job-boards.csv');
  const cachePath = join(dir, 'cache.json');
  writeFileSync(inputPath, 'company_name\nExample Corp\nexample corp\n', 'utf8');
  let fetches = 0;
  const { ctx } = makeStubTransport((url) => {
    fetches += 1;
    if (url.includes('duckduckgo.com') || url.includes('bing.com')) {
      return searchHtml([['https://example.com/careers', 'Example Corp Careers']]);
    }
    if (url === 'https://example.com/careers') return HUB_HTML;
    throw statusError(404, 'HTTP 404 Not Found');
  });
  const runOpts = { inputPath, outputPath, cachePath, companyDelayMs: 0 };
  const first = await runDiscovery({ ...runOpts, ctx });
  assert.equal(first.companyCount, 1, 'duplicate input names share one pass');
  assert.ok(fetches > 0, 'first run fetches');
  const normalize = (rows) => rows.map((row) => ({ ...row, last_checked_at: 'T', search_source: row.search_source.replace('; cache', '') }));
  const firstRows = normalize(parseCsv(readFileSync(outputPath, 'utf8')));
  assert.ok(firstRows.every((row) => row.destination_type), 'destination_type exported');
  const keys = firstRows.map(rowDedupKey);
  assert.equal(new Set(keys).size, keys.length, 'no duplicate destinations exported');

  fetches = 0;
  await runDiscovery({ ...runOpts, ctx });
  assert.equal(fetches, 0, 'second run is a full cache hit');
  const secondRows = normalize(parseCsv(readFileSync(outputPath, 'utf8')));
  assert.deepEqual(secondRows, firstRows, 'repeated runs are deterministic');

  // Reversed input order exports identically (output is sorted, not input-ordered).
  // The submitted spelling of the first occurrence wins for traceability.
  writeFileSync(inputPath, 'company_name\nexample corp\nExample Corp\n', 'utf8');
  await runDiscovery({ ...runOpts, ctx, refresh: true });
  const reversedRows = normalize(parseCsv(readFileSync(outputPath, 'utf8')));
  assert.equal(reversedRows[0].company_name, 'example corp', 'first submitted spelling wins');
  const spellNormalized = (rows) => rows.map((row) => ({ ...row, company_name: companyDedupKey(row.company_name) }));
  assert.deepEqual(spellNormalized(reversedRows), spellNormalized(firstRows), 'output order is input-order independent');
});

await check('runDiscovery recovers from malformed and expired caches', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'co-discovery-'));
  const inputPath = join(dir, 'companies.csv');
  const outputPath = join(dir, 'job-boards.csv');
  const cachePath = join(dir, 'cache.json');
  writeFileSync(inputPath, 'company_name\nExample Corp\n', 'utf8');
  let fetches = 0;
  const { ctx } = makeStubTransport((url) => {
    fetches += 1;
    if (url.includes('duckduckgo.com') || url.includes('bing.com')) {
      return searchHtml([['https://example.com/careers', 'Example Corp Careers']]);
    }
    if (url === 'https://example.com/careers') return HUB_HTML;
    throw statusError(404, 'HTTP 404 Not Found');
  });
  const runOpts = { inputPath, outputPath, cachePath, companyDelayMs: 0 };
  writeFileSync(cachePath, '{ this is not json', 'utf8');
  await runDiscovery({ ...runOpts, ctx });
  assert.ok(fetches > 0, 'malformed cache is ignored and discovery refetches');
  const parsed = JSON.parse(readFileSync(cachePath, 'utf8'));
  assert.equal(parsed.version, 2, 'cache carries the v2 schema version');

  fetches = 0;
  const stale = JSON.parse(readFileSync(cachePath, 'utf8'));
  stale.companies['example corp'].expires_at = new Date(Date.now() - 1000).toISOString();
  writeFileSync(cachePath, JSON.stringify(stale), 'utf8');
  await runDiscovery({ ...runOpts, ctx });
  assert.ok(fetches > 0, 'expired entries are refetched');
});
