import dotenv from 'dotenv';
dotenv.config();

import { DepartmentSyncWorker } from './DepartmentSyncWorker';

const worker = new DepartmentSyncWorker();
worker.run()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
