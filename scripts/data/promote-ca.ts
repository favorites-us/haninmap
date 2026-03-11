/**
 * CLI entry point: Promote CA staged data to the Business table.
 *
 * Default: DRY RUN (no DB changes, report only)
 *
 * Usage:
 *   npx tsx scripts/promote-ca.ts              # dry run (default)
 *   npx tsx scripts/promote-ca.ts --dry-run    # explicit dry run
 *   npx tsx scripts/promote-ca.ts --apply      # live mode (writes to DB)
 *   npx tsx scripts/promote-ca.ts --limit 100
 *   npx tsx scripts/promote-ca.ts --crawlRunId 5
 */

import { promoteCountry, type PromoteOptions } from './promote/promote-country';

function parseArgs(): PromoteOptions {
  const args = process.argv.slice(2);
  const options: PromoteOptions = {};

  let explicitApply = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dry-run') {
      options.dryRun = true;
    } else if (args[i] === '--apply') {
      explicitApply = true;
    } else if (args[i] === '--limit' && args[i + 1]) {
      options.limit = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--crawlRunId' && args[i + 1]) {
      options.crawlRunId = parseInt(args[i + 1], 10);
      i++;
    }
  }

  // Default is dry run unless --apply is explicitly passed
  if (explicitApply) {
    options.dryRun = false;
  } else if (options.dryRun === undefined) {
    options.dryRun = true;
  }

  return options;
}

const options = parseArgs();
promoteCountry('CA', options).catch((err) => {
  console.error('Promotion failed:', err);
  process.exit(1);
});
