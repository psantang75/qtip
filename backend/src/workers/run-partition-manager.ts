import dotenv from 'dotenv';
dotenv.config();

import { PartitionManagerWorker } from './PartitionManagerWorker';

const worker = new PartitionManagerWorker();
worker.run()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
