import dotenv from 'dotenv';
import path from 'path';
// Resolve .env relative to the compiled file so loading works regardless of
// PM2/Node cwd (same pattern as run-missed-opportunities.ts).
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import { exitIfAutomationDisabled } from './automationGuard';
import { SalesPlaysMinerWorker } from './SalesPlaysMinerWorker';

exitIfAutomationDisabled('ie-sales-plays-miner');

const worker = new SalesPlaysMinerWorker();
worker.run()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
