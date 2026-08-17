import dotenv from 'dotenv';
import path from 'path';
// Resolve .env relative to the compiled file so loading works regardless of
// PM2/Node cwd (same pattern as backend/src/index.ts).
//   prod: /opt/qtip/backend/dist/workers/run-*.js -> /opt/qtip/backend/.env
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import { exitIfAutomationDisabled } from './automationGuard';
import { EmployeeSyncWorker } from './EmployeeSyncWorker';

exitIfAutomationDisabled('ie-emp-sync');

const worker = new EmployeeSyncWorker();
worker.run()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
