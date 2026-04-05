import dotenv from 'dotenv';
dotenv.config();

import { BusinessCalendarSyncWorker } from './BusinessCalendarSyncWorker';

const worker = new BusinessCalendarSyncWorker();
worker.run()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
