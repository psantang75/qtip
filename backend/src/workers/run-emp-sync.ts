import dotenv from 'dotenv';
dotenv.config();

import { EmployeeSyncWorker } from './EmployeeSyncWorker';

const worker = new EmployeeSyncWorker();
worker.run()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
