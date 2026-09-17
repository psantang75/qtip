import dotenv from 'dotenv';
import path from 'path';
// Resolve .env relative to the compiled file so loading works regardless of
// PM2/Node cwd (same pattern as backend/src/index.ts).
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import { exitIfAutomationDisabled } from './automationGuard';
import { MissedOpportunitiesWorker } from './MissedOpportunitiesWorker';

exitIfAutomationDisabled('ie-missed-opportunities');

// Optional YYYY-MM-DD argument re-runs a specific business day, which is how a
// day gets re-graded after a rule change:
//   node dist/workers/run-missed-opportunities.js 2026-09-04
const arg = process.argv[2];
const runDate = arg && /^\d{4}-\d{2}-\d{2}$/.test(arg) ? arg : undefined;

const worker = new MissedOpportunitiesWorker(runDate);
worker.run()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
