import { pass, fail } from './helpers.mjs';
import { parseAtsCompanyCsv, parseCsvRows, isTrustedAtsCompanyUrl } from '../seeds/vc-portfolios.mjs';

console.log('\nATS company seed import');

let failures = 0;
function check(condition, label) {
  if (condition) pass(label);
  else { failures++; fail(label); }
}

const csv = [
  'name,slug,url',
  '"Acme, Inc.",acme,https://job-boards.greenhouse.io/acme',
  'Acme Duplicate,ACME,https://job-boards.greenhouse.io/ACME',
  'Unsafe Host,unsafe,https://evil.example/unsafe',
  'HTTP Board,http,https://job-boards.greenhouse.io.evil.example/http',
  'Bad Slug,bad/slug,https://job-boards.greenhouse.io/bad',
  'Credential URL,creds,https://user:pass@job-boards.greenhouse.io/creds',
  'Other ATS,other,https://jobs.lever.co/other',
].join('\r\n');

const rows = parseCsvRows(csv);
check(rows.length === 8, 'CSV parser handles CRLF and quoted commas');
const parsed = parseAtsCompanyCsv(csv, 'greenhouse');
check(parsed.length === 1, 'accepts only one valid canonical Greenhouse row');
check(parsed[0]?.name === 'Acme, Inc.', 'preserves quoted company name');
check(parsed[0]?.careers_url === 'https://job-boards.greenhouse.io/acme', 'sets careers_url from trusted source URL');
check(parsed[0]?.source === 'ats-scrapers', 'marks imported rows with source attribution');
check(parseAtsCompanyCsv('name,url\nAcme,acme', 'greenhouse').length === 0, 'rejects legacy/malformed headers without guessing');
check(parseAtsCompanyCsv('name,slug,url\nAcme,acme,http://job-boards.greenhouse.io/acme', 'greenhouse').length === 0, 'rejects non-HTTPS URLs');
check(parseAtsCompanyCsv('name,slug,url\nAcme,acme,https://jobs.lever.co/acme', 'greenhouse').length === 0, 'rejects URLs hosted on a different ATS');
check(!isTrustedAtsCompanyUrl('workday', 'https://myworkdayjobs.com/company'), 'rejects a non-tenant Workday host');
const workday = parseAtsCompanyCsv('name,slug,url\nAcme,acme/external,https://acme.wd5.myworkdayjobs.com/external', 'workday');
check(workday.length === 1 && workday[0]?.slug === 'acme/external', 'accepts validated Workday tenant/site identifiers');
check(parseAtsCompanyCsv('name,slug,url\nAcme,../external,https://acme.wd5.myworkdayjobs.com/external', 'workday').length === 0, 'rejects traversal in Workday identifiers');
check(parseAtsCompanyCsv('name,slug,url\nAcme,acme,https://jobs.lever.co/acme', 'not-supported').length === 0, 'rejects unsupported ATS source');
try {
  parseCsvRows('name,slug,url\n"unterminated,acme,https://job-boards.greenhouse.io/acme');
  check(false, 'rejects unterminated quoted fields');
} catch {
  check(true, 'rejects unterminated quoted fields');
}

if (failures) process.exitCode = 1;
