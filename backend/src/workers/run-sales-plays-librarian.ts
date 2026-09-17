import dotenv from 'dotenv';
import path from 'path';
// Resolve .env relative to the compiled file so loading works regardless of cwd
// (same pattern as run-sales-plays-miner.ts).
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import logger from '../config/logger';
import { canonicalizePlays } from '../services/insights/missedOpportunities/salesPlays/librarian';

// Manual/admin tool — rebuild the canonical sales-plays playbook from the mined
// `proposed` pile. Not scheduled (not gated by the automation kill-switch). Pass
// `activate` to insert canon as approved (active) instead of proposed-for-review.
const activate = process.argv.slice(2).includes('activate');

canonicalizePlays({ activate })
  .then((s) => {
    logger.info(`[run-sales-plays-librarian] ${JSON.stringify(s)}`);
    process.exit(0);
  })
  .catch((err) => {
    logger.error(`[run-sales-plays-librarian] failed: ${(err as Error).message}`);
    process.exit(1);
  });
