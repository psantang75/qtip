/**
 * Inspect a configured external database pool.
 *
 * Usage (from backend/):
 *   npx ts-node scripts/inspect-database.ts phone   # PHONE_DB_*
 *   npx ts-node scripts/inspect-database.ts crm     # CRM_DB_*
 *
 * Output:
 *   1. Connection ping result.
 *   2. Server / schema metadata (version, schema name, total table count).
 *   3. Per-table summary: row count, column count.
 *   4. Per-table column definitions (name, type, nullable, key, default, comment).
 *
 * Read-only — runs nothing but SELECTs against information_schema and the
 * named DB. Safe to run against production.
 */

import { getDatabasePool, type DatabasePoolName } from '../src/config/database';

type Args = { pool: DatabasePoolName; verbose: boolean };

function parseArgs(): Args {
  const [, , poolArg, ...rest] = process.argv;
  if (!poolArg || (poolArg !== 'phone' && poolArg !== 'crm' && poolArg !== 'primary')) {
    console.error('Usage: ts-node scripts/inspect-database.ts <phone|crm|primary> [--verbose]');
    process.exit(2);
  }
  return {
    pool: poolArg as DatabasePoolName,
    verbose: rest.includes('--verbose'),
  };
}

async function main(): Promise<void> {
  const { pool: poolName, verbose } = parseArgs();
  console.log(`\n=== Inspecting pool: ${poolName} ===`);

  let pool;
  try {
    pool = getDatabasePool(poolName);
  } catch (err) {
    console.error(`[FAIL] Pool '${poolName}' is not configured:`, err instanceof Error ? err.message : err);
    process.exit(1);
  }

  const conn = await pool.getConnection();
  try {
    await conn.ping();
    console.log('[OK] Ping succeeded.');

    const [verRows] = await conn.query<any[]>('SELECT VERSION() AS version, DATABASE() AS db');
    const { version, db } = verRows[0];
    console.log(`Server version : ${version}`);
    console.log(`Schema         : ${db}`);

    const [tableRows] = await conn.query<any[]>(
      `SELECT TABLE_NAME, TABLE_TYPE, TABLE_ROWS, ENGINE, TABLE_COMMENT
         FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = ?
        ORDER BY TABLE_NAME`,
      [db]
    );

    console.log(`Total objects  : ${tableRows.length}\n`);

    if (tableRows.length === 0) {
      console.log('(no tables in schema)');
      return;
    }

    console.log('--- Table summary ---');
    console.log('NAME'.padEnd(45), 'TYPE'.padEnd(12), 'ROWS'.padStart(12), '  ENGINE');
    console.log('-'.repeat(85));
    for (const t of tableRows) {
      const name = String(t.TABLE_NAME).padEnd(45);
      const type = String(t.TABLE_TYPE).padEnd(12);
      const rows = String(t.TABLE_ROWS ?? '?').padStart(12);
      const engine = t.ENGINE ?? '-';
      console.log(name, type, rows, ' ', engine);
      if (t.TABLE_COMMENT) console.log(`    comment: ${t.TABLE_COMMENT}`);
    }

    console.log('\n--- Column definitions ---');
    for (const t of tableRows) {
      const tableName = t.TABLE_NAME;
      const [cols] = await conn.query<any[]>(
        `SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY, COLUMN_DEFAULT, EXTRA, COLUMN_COMMENT
           FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
          ORDER BY ORDINAL_POSITION`,
        [db, tableName]
      );

      console.log(`\n[${tableName}] (${cols.length} cols)`);
      for (const c of cols) {
        const nullable = c.IS_NULLABLE === 'YES' ? 'NULL' : 'NOT NULL';
        const key = c.COLUMN_KEY ? ` ${c.COLUMN_KEY}` : '';
        const extra = c.EXTRA ? ` ${c.EXTRA}` : '';
        const def = c.COLUMN_DEFAULT === null ? '' : ` DEFAULT ${c.COLUMN_DEFAULT}`;
        const cmt = c.COLUMN_COMMENT ? `   -- ${c.COLUMN_COMMENT}` : '';
        console.log(`  ${c.COLUMN_NAME.padEnd(38)} ${c.COLUMN_TYPE.padEnd(28)} ${nullable}${key}${extra}${def}${cmt}`);
      }

      if (verbose) {
        try {
          const [sample] = await conn.query<any[]>(`SELECT * FROM \`${tableName}\` LIMIT 1`);
          if (sample.length > 0) {
            console.log('  sample row:', JSON.stringify(sample[0], null, 2).slice(0, 800));
          }
        } catch (err) {
          console.log('  (sample read failed:', err instanceof Error ? err.message : err, ')');
        }
      }
    }
  } finally {
    conn.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Inspection failed:', err);
  process.exit(1);
});
