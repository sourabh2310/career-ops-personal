import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, toCsv, parseArgs, scoreCandidate } from '../lib/company-job-discovery.mjs';

test('parseCsv reads company-name-only files with or without a header', () => {
  assert.deepEqual(parseCsv('company_name\nAmazon\nMicrosoft\n'), [
    { company_name: 'Amazon', input_row: 2 },
    { company_name: 'Microsoft', input_row: 3 },
  ]);
  assert.deepEqual(parseCsv('Amazon\nMicrosoft\n'), [
    { company_name: 'Amazon', input_row: 1 },
    { company_name: 'Microsoft', input_row: 2 },
  ]);
});

test('parseCsv handles BOM, quoted commas, escaped quotes and multiline values', () => {
  const rows = parseCsv('\uFEFFcompany_name,notes\r\n"Example, Inc.","said ""hello"""\r\n"New\nCompany",ok\r\n');
  assert.equal(rows[0].company_name, 'Example, Inc.');
  assert.equal(rows[0].notes, 'said "hello"');
  assert.equal(rows[1].company_name, 'New\nCompany');
});

test('parseCsv rejects an unterminated quoted field', () => {
  assert.throws(() => parseCsv('company_name\n"Broken Company'), /unterminated quoted field/i);
});

test('toCsv safely quotes values containing commas, quotes and newlines', () => {
  const csv = toCsv([{ company_name: 'Example, Inc.', evidence: 'said "hello"\nagain' }], ['company_name', 'evidence']);
  assert.equal(csv, '"company_name",evidence\r\n"Example, Inc.","said ""hello""\nagain"\r\n');
});

test('parseArgs supports equals syntax and rejects unknown flags', () => {
  assert.deepEqual(parseArgs(['--input=names.csv', '--limit', '10', '--refresh']), {
    refresh: true, limit: 10, inputPath: 'names.csv', outputPath: undefined, cachePath: undefined,
  });
  assert.throws(() => parseArgs(['--bogus']), /Unknown option/);
  assert.throws(() => parseArgs(['--input']), /Missing value/);
});

test('candidate scoring rewards known ATS job-listing URLs', () => {
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
