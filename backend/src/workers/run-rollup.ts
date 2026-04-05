import dotenv from 'dotenv';
dotenv.config();

import { RollupWorker } from './RollupWorker';

const worker = new RollupWorker();
worker.run()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
