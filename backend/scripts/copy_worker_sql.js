/**
 * Copy worker SQL files from src/workers/sql → dist/workers/sql after tsc runs.
 * Required because SourceReportSyncWorker.loadSqlFile resolves SQL via
 * `path.resolve(__dirname, 'sql', file)`, which becomes dist/workers/sql at
 * runtime — and tsc doesn't carry non-.ts files.
 *
 * Cross-platform: pure Node (no shell), works in PowerShell + bash.
 */
const fs = require('fs');
const path = require('path');

const SRC = path.resolve(__dirname, '..', 'src', 'workers', 'sql');
const DST = path.resolve(__dirname, '..', 'dist', 'workers', 'sql');

if (!fs.existsSync(SRC)) {
  console.log(`[copy_worker_sql] no source dir (${SRC}); nothing to copy`);
  process.exit(0);
}

fs.mkdirSync(DST, { recursive: true });
let count = 0;
for (const entry of fs.readdirSync(SRC, { withFileTypes: true })) {
  if (entry.isFile() && entry.name.endsWith('.sql')) {
    fs.copyFileSync(path.join(SRC, entry.name), path.join(DST, entry.name));
    count++;
  }
}

console.log(`[copy_worker_sql] copied ${count} .sql files to ${DST}`);
