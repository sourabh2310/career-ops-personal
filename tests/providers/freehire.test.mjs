// tests/providers/freehire.test.mjs — mirrors the yourator/remotli board-wide provider tests.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — freehire');

try {
  const freehireModule = await import(pathToFileURL(join(ROOT, 'providers/freehire.mjs')).href);
  const freehire = freehireModule.default;
  const { normalizeFreehireJob, resolveFreehireUrl } = freehireModule;

  if (freehire.id === 'freehire') pass('freehire.id is "freehire"');
  else fail(`freehire.id is ${JSON.stringify(freehire.id)}`);

  if (typeof freehire.detect !== 'function') pass('freehire has no detect() — explicit provider: only');
  else fail('freehire should not define detect() (board-wide feed, explicit provider: only)');

  // --- resolveFreehireUrl — rule 2 (employer link first) --------------------

  const employer = resolveFreehireUrl({
    public_slug: 'senior-java-dev-acme-1a2b',
    url: 'https://boards.greenhouse.io/acme/jobs/123?utm_source=freehire.me',
  });
  if (employer === 'https://boards.greenhouse.io/acme/jobs/123') {
    pass('resolveFreehireUrl prefers the employer URL and strips utm_* attribution');
  } else {
    fail(`resolveFreehireUrl employer url = ${JSON.stringify(employer)}`);
  }

  const keepsFunctional = resolveFreehireUrl({
    public_slug: 'x-1',
    url: 'https://jobs.lever.co/acme/abc-123?utm_source=freehire.me&lever-source=search',
  });
  if (keepsFunctional === 'https://jobs.lever.co/acme/abc-123?lever-source=search') {
    pass('resolveFreehireUrl keeps functional query params while stripping utm_*');
  } else {
    fail(`resolveFreehireUrl functional params = ${JSON.stringify(keepsFunctional)}`);
  }

  const fallbacks = [
    resolveFreehireUrl({ public_slug: 'backend-dev-acme-9z8y', url: 'http://insecure.example/j' }),
    resolveFreehireUrl({ public_slug: 'backend-dev-acme-9z8y', url: 'not a url' }),
    resolveFreehireUrl({ public_slug: 'backend-dev-acme-9z8y' }),
  ];
  if (fallbacks.every((u) => u === 'https://freehire.me/jobs/backend-dev-acme-9z8y')) {
    pass('resolveFreehireUrl falls back to the catalogue page on non-https / malformed / absent url');
  } else {
    fail(`resolveFreehireUrl fallbacks = ${JSON.stringify(fallbacks)}`);
  }

  const drops = [
    resolveFreehireUrl({ public_slug: '//evil.example/jobs/1' }),
    resolveFreehireUrl({ public_slug: '' }),
    resolveFreehireUrl({}),
  ];
  if (drops.every((u) => u === '')) {
    pass('resolveFreehireUrl drops protocol-relative / empty / absent slugs (safeEncodeURIComponent guard)');
  } else {
    fail(`resolveFreehireUrl drops = ${JSON.stringify(drops)}`);
  }

  // --- normalizeFreehireJob --------------------------------------------------

  const full = normalizeFreehireJob(
    {
      public_slug: 'java-backend-dev-acme-1a2b',
      url: 'https://jobs.ashbyhq.com/acme/xyz?utm_source=freehire.me',
      title: '  Java Backend Developer &amp; Spring Boot  ',
      company: '  Acme Corp  ',
      location: 'Hyderabad, India',
      description: '<p>Build <strong>microservices</strong> with Spring Boot.</p>',
      posted_at: '2026-10-08T00:00:00Z',
      closed_at: null,
    },
    'Fallback',
  );
  if (
    full &&
    full.title === 'Java Backend Developer & Spring Boot' &&
    full.url === 'https://jobs.ashbyhq.com/acme/xyz' &&
    full.company === 'Acme Corp' &&
    full.location === 'Hyderabad, India' &&
    full.description === 'Build microservices with Spring Boot.' &&
    full.postedAt === Date.parse('2026-10-08T00:00:00Z')
  ) {
    pass('normalizeFreehireJob maps + trims + decodes entities + htmlToText + postedAt');
  } else {
    fail(`normalizeFreehireJob full row = ${JSON.stringify(full)}`);
  }

  const badDate = normalizeFreehireJob({
    public_slug: 'x-1',
    url: 'https://example.example/j/1',
    title: 'T',
    posted_at: 'not-a-date',
  });
  if (badDate && !('postedAt' in badDate)) pass('normalizeFreehireJob omits postedAt on an unparseable date (NaN-safe)');
  else fail(`normalizeFreehireJob bad date = ${JSON.stringify(badDate)}`);

  const closed = normalizeFreehireJob({
    public_slug: 'x-2',
    url: 'https://example.example/j/2',
    title: 'T',
    closed_at: '2026-09-01T00:00:00Z',
  });
  if (closed === null) pass('normalizeFreehireJob skips rows with a truthy closed_at');
  else fail(`normalizeFreehireJob closed row = ${JSON.stringify(closed)}`);

  const coFromEntry = normalizeFreehireJob({ public_slug: 'x-3', url: 'https://example.example/j/3', title: 'T', company: '  ' }, 'Entry Name');
  const coDefault = normalizeFreehireJob({ public_slug: 'x-4', url: 'https://example.example/j/4', title: 'T' });
  if (coFromEntry?.company === 'Entry Name' && coDefault?.company === 'freehire') {
    pass('normalizeFreehireJob falls back company → entry name → "freehire"');
  } else {
    fail(`normalizeFreehireJob company fallbacks = ${JSON.stringify({ a: coFromEntry?.company, b: coDefault?.company })}`);
  }

  const badRows = [
    normalizeFreehireJob({ public_slug: 'x-5', url: 'https://example.example/j/5', title: '' }),
    normalizeFreehireJob({ public_slug: '', title: 'No usable url' }),
    normalizeFreehireJob(null),
    normalizeFreehireJob('nope'),
  ];
  if (badRows.every((r) => r === null)) {
    pass('normalizeFreehireJob drops empty-title / unusable-url / non-object rows');
  } else {
    fail(`normalizeFreehireJob drops = ${JSON.stringify(badRows)}`);
  }

  // --- fetch() ---------------------------------------------------------------

  const mk = (i) => ({
    public_slug: `role-${i}`,
    url: `https://boards.greenhouse.io/co/jobs/${i}`,
    title: `Role ${i}`,
    company: `Co ${i}`,
    location: 'Remote',
    description: `<p>Desc ${i}</p>`,
    posted_at: '2026-10-01T00:00:00Z',
    closed_at: null,
  });
  // 100 rows on page 0 (full), 2 rows on page 1 (short → natural end).
  const pages = {
    0: { data: Array.from({ length: 100 }, (_, i) => mk(i)), meta: { total: 102, limit: 100, offset: 0 } },
    1: { data: [mk(100), { public_slug: 'bad', url: 'https://boards.greenhouse.io/co/jobs/bad', title: '' }], meta: { total: 102, limit: 100, offset: 100 } },
    2: { data: [mk(999)], meta: { total: 102, limit: 100, offset: 200 } }, // must never be requested
  };
  const requested = [];
  const ctx = {
    transport: 'http',
    sleep: async () => {},
    fetchJson: async (url, opts) => {
      requested.push({ url, redirect: opts?.redirect });
      return pages[Number(new URL(url).searchParams.get('offset')) / 100];
    },
  };
  const jobs = await freehire.fetch({ name: 'freehire' }, ctx);
  const urls = requested.map((r) => r.url);
  if (
    jobs.length === 101 &&
    urls.length === 2 &&
    urls[0] === 'https://freehire.me/api/v1/agent/jobs/search?limit=100&offset=0' &&
    urls[1] === 'https://freehire.me/api/v1/agent/jobs/search?limit=100&offset=100' &&
    requested.every((r) => r.redirect === 'error')
  ) {
    pass('freehire.fetch paginates limit/offset, stops on a short page, drops bad rows, sends redirect:"error"');
  } else {
    fail(`freehire.fetch pagination = ${JSON.stringify({ count: jobs.length, urls, redirects: requested.map((r) => r.redirect) })}`);
  }

  // keywords: fan-out with one walk per query, deduped by URL across passes.
  const kwRequested = [];
  const kwCtx = {
    transport: 'http',
    sleep: async () => {},
    fetchJson: async (url, opts) => {
      kwRequested.push(url);
      const q = new URL(url).searchParams.get('q');
      if (q === 'java backend') return { data: [mk(1), mk(2)], meta: { total: 2, limit: 100, offset: 0 } };
      if (q === 'spring boot') return { data: [mk(2), mk(3)], meta: { total: 2, limit: 100, offset: 0 } };
      throw new Error(`unexpected q=${q}`);
    },
  };
  const kwJobs = await freehire.fetch({ name: 'freehire', keywords: ['java backend', 'spring boot'] }, kwCtx);
  const kwQs = kwRequested.map((u) => new URL(u).searchParams.get('q'));
  if (kwJobs.length === 3 && kwQs.join(',') === 'java backend,spring boot') {
    pass('freehire.fetch fans out one walk per keywords: entry and dedups by URL across passes');
  } else {
    fail(`freehire.fetch keywords = ${JSON.stringify({ count: kwJobs.length, qs: kwQs })}`);
  }

  // A pass whose first page fully overlaps an earlier pass still walks deeper.
  const overlapCtx = {
    transport: 'http',
    sleep: async () => {},
    fetchJson: async (url) => {
      const u = new URL(url);
      const q = u.searchParams.get('q');
      const offset = Number(u.searchParams.get('offset'));
      if (q === 'a') return offset === 0
        ? { data: Array.from({ length: 100 }, (_, i) => mk(i)), meta: { total: 101, limit: 100, offset } }
        : { data: [mk(100)], meta: { total: 101, limit: 100, offset } };
      // pass "b": first page is a dup of pass "a" page 0, deeper page is unique.
      if (q === 'b') return offset === 0
        ? { data: Array.from({ length: 100 }, (_, i) => mk(i)), meta: { total: 101, limit: 100, offset } }
        : { data: [mk(500)], meta: { total: 101, limit: 100, offset } };
      throw new Error(`unexpected q=${q}`);
    },
  };
  const overlapJobs = await freehire.fetch({ name: 'freehire', keywords: ['a', 'b'] }, overlapCtx);
  if (overlapJobs.length === 102 && overlapJobs.some((j) => j.title === 'Role 500')) {
    pass('freehire.fetch walks deeper pages of a pass even when its first page fully overlaps');
  } else {
    fail(`freehire.fetch overlap walk = ${JSON.stringify({ count: overlapJobs.length })}`);
  }

  // ctx.maxPages (health probe) wins over max_pages on the entry: exactly one
  // list request.
  const probed = [];
  await freehire.fetch(
    { name: 'freehire', max_pages: 50 },
    {
      transport: 'http',
      maxPages: 1,
      sleep: async () => {},
      fetchJson: async (url) => {
        probed.push(url);
        return { data: [mk(0)], meta: { total: 1, limit: 100, offset: 0 } };
      },
    },
  );
  if (probed.length === 1) pass('freehire.fetch honors ctx.maxPages over the entry max_pages (probe = 1 request)');
  else fail(`freehire.fetch probe requests = ${JSON.stringify(probed)}`);

  // The "raise max_pages" warning fires on the entry/default cap only — a
  // probe cut off at a full page must stay silent.
  const warned = [];
  const origError = console.error;
  console.error = (...args) => { warned.push(args.join(' ')); };
  try {
    await freehire.fetch(
      { name: 'freehire' },
      {
        transport: 'http',
        maxPages: 1,
        sleep: async () => {},
        fetchJson: async () => ({ data: Array.from({ length: 100 }, (_, i) => mk(300 + i)), meta: { total: 5000, limit: 100, offset: 0 } }),
      },
    );
  } finally {
    console.error = origError;
  }
  if (warned.length === 0) pass('freehire.fetch does not warn about max_pages when a probe cap stops a full page');
  else fail(`freehire.fetch probe warning = ${JSON.stringify(warned)}`);

  // A ctx.fetchJson rejection while probing propagates unwrapped (fail loud —
  // no per-page catch swallows ProbePageBudgetReached into []).
  class ProbeCutoff extends Error {}
  let propagated = null;
  try {
    await freehire.fetch(
      { name: 'freehire' },
      { transport: 'http', maxPages: 1, sleep: async () => {}, fetchJson: async () => { throw new ProbeCutoff('budget'); } },
    );
  } catch (e) {
    propagated = e;
  }
  if (propagated instanceof ProbeCutoff) pass('freehire.fetch propagates a probe-budget rejection unwrapped');
  else fail(`freehire.fetch probe rejection = ${String(propagated)}`);

  // Empty-vs-broken split: present-and-empty data → []; missing envelope → throw.
  const emptyJobs = await freehire.fetch(
    { name: 'freehire' },
    { transport: 'http', sleep: async () => {}, fetchJson: async () => ({ data: [], meta: { total: 0, limit: 100, offset: 0 } }) },
  );
  let threw = false;
  try {
    await freehire.fetch({ name: 'freehire' }, { transport: 'http', sleep: async () => {}, fetchJson: async () => ({ error: 'nope' }) });
  } catch {
    threw = true;
  }
  if (Array.isArray(emptyJobs) && emptyJobs.length === 0 && threw) {
    pass('freehire.fetch returns [] on present-and-empty data and throws on a missing envelope');
  } else {
    fail(`freehire.fetch empty/broken = ${JSON.stringify({ empty: emptyJobs?.length, threw })}`);
  }
} catch (e) {
  fail(`freehire provider test crashed: ${e?.message}`);
}
