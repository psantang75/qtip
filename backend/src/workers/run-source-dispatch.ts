import dotenv from 'dotenv';
import path from 'path';
// Resolve .env relative to the compiled file so loading works regardless of
// PM2/Node cwd (same pattern as backend/src/index.ts and the other run-* entrypoints).
//   prod: /opt/qtip/backend/dist/workers/run-*.js -> /opt/qtip/backend/.env
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import { SourceReportDispatcher } from './SourceReportDispatcher';

const dispatcher = new SourceReportDispatcher();
dispatcher.run()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
