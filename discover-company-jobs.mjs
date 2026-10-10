#!/usr/bin/env node

import { isMainModule } from './lib/is-main-module.mjs';
import { parseArgs, runDiscovery, USAGE } from './lib/company-job-discovery.mjs';

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
