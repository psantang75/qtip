/**
 * Export the legacy QTIP database to the CSV bundle format consumed by
 * `migrate-production-data.ts`.
 *
 * Output matches the original 3/23/2026 export (header row, comma-separated,
 * literal `null` for NULLs, datetimes as `M/D/YYYY H:MM:SS AM/PM`, dates as
 * `M/D/YYYY`). One file per table: `<table>_<TIMESTAMP>.csv`. All files land
 * under `<OUTPUT_ROOT>/QTIP_data_prod_<TIMESTAMP>/` so the loader's
 * `findCsvFile()` (which matches `<table>_*.csv`) picks them up.
 *
 * Read-only against the source DB. Uses the same env vars as the loader, but
 * with `LEGACY_` prefix so they can sit side-by-side in .env without colliding
 * with the target DB.
 *
 *   LEGACY_DB_HOST       (default: localhost)
 *   LEGACY_DB_PORT       (default: 3306)
 *   LEGACY_DB_USER
 *   LEGACY_DB_PASSWORD
 *   LEGACY_DB_NAME       (default: qtip)
 *   EXPORT_OUTPUT_ROOT   (default: ./scripts/backups)
 */

import * as fs from 'fs';
import * as path from 'path';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '../../.env') });

// Same set as migrate-production-data.ts TABLE_ORDER, plus the two helper
// tables read inside seedCoachingAndWarnings() (`topics`, `coaching_session_topics`).
const TABLES: string[] = [
  'roles',
  'departments',
  'users',
  'forms',
  'form_metadata_fields',
  'form_categories',
  'form_questions',
  'radio_options',
  'performance_goals',
  'performance_goal_users',
  'performance_goal_departments',
  'form_question_conditions',
  'audit_assignments',
  'department_managers',
  'courses',
  'quizzes',
  'quiz_questions',
  'topics',
  'coaching_sessions',
  'coaching_session_topics',
  'calls',
  'submissions',
  'submission_metadata',
  'submission_calls',
  'submission_answers',
  'free_text_answers',
  'score_snapshots',
  'disputes',
  'dispute_score_history',
  'audit_logs',
  'agent_activity',
];

function pad2(n: number): string { return String(n).padStart(2, '0'); }

function timestampStamp(d: Date): string {
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}${pad2(d.getHours())}${pad2(d.getMinutes())}`;
}

function formatDateTime12h(d: Date): string {
  const month = d.getMonth() + 1;
  const day = d.getDate();
  const year = d.getFullYear();
  let hours = d.getHours();
  const minutes = pad2(d.getMinutes());
  const seconds = pad2(d.getSeconds());
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  if (hours === 0) hours = 12;
  return `${month}/${day}/${year} ${hours}:${minutes}:${seconds} ${ampm}`;
}

function formatDateOnly(d: Date): string {
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}

// Heuristic: a JS Date that is exactly midnight local AND came from a column
// whose MySQL type was DATE should render as M/D/YYYY, not midnight 12h. mysql2
// returns DATE values as JS Date at local midnight. We get the precise MySQL
// type from the FieldPacket so we don't have to guess.
const MYSQL_TYPE_DATE = 10;     // FIELD_TYPE.DATE
const MYSQL_TYPE_NEWDATE = 14;  // FIELD_TYPE.NEWDATE
// DATETIME=12, TIMESTAMP=7, all others normal text.

function csvEscape(raw: string): string {
  if (raw === '') return '';
  const needsQuoting = /[",\r\n]/.test(raw);
  if (!needsQuoting) return raw;
  return `"${raw.replace(/"/g, '""')}"`;
}

function formatCellRaw(
  val: unknown,
  mysqlType: number | undefined
): string {
  if (val === null || val === undefined) return 'null';
  if (val instanceof Date) {
    if (mysqlType === MYSQL_TYPE_DATE || mysqlType === MYSQL_TYPE_NEWDATE) {
      return formatDateOnly(val);
    }
    return formatDateTime12h(val);
  }
  if (Buffer.isBuffer(val)) return val.toString('utf8');
  if (typeof val === 'boolean') return val ? '1' : '0';
  return String(val);
}

async function exportTable(
  conn: mysql.Connection,
  table: string,
  outDir: string,
  stamp: string
): Promise<{ rows: number; bytes: number } | null> {
  // Verify table exists in the source schema. Skip silently if not — preserves
  // forward-compatibility with a legacy DB that doesn't have every new-schema
  // helper table.
  const [check] = await conn.query<mysql.RowDataPacket[]>(
    `SELECT 1 FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? LIMIT 1`,
    [table]
  );
  if (!check.length) {
    console.log(`  [SKIP] table not in source: ${table}`);
    return null;
  }

  // mysql2 row format includes type info via the second return value. Cast to
  // any[] because typings for the field-info tuple are loose.
  const [rows, fields] = (await conn.query(
    `SELECT * FROM \`${table}\``
  )) as unknown as [mysql.RowDataPacket[], mysql.FieldPacket[]];

  const file = path.join(outDir, `${table}_${stamp}.csv`);
  const fh = fs.openSync(file, 'w');
  try {
    if (rows.length === 0) {
      // Still write a header so the loader sees the file but treats it as
      // empty (csv-parse returns []). Use the column list from `fields`.
      const header = fields.map((f) => f.name).join(',');
      fs.writeSync(fh, header + '\n');
      console.log(`  [OK]   ${table}: 0 rows (header only)`);
      return { rows: 0, bytes: header.length + 1 };
    }
    const columns = fields.map((f) => f.name);
    const types = fields.map((f) => f.type as number);
    fs.writeSync(fh, columns.join(',') + '\n');
    let bytes = 0;
    for (const row of rows) {
      const line =
        columns
          .map((c, i) => csvEscape(formatCellRaw(row[c], types[i])))
          .join(',') + '\n';
      fs.writeSync(fh, line);
      bytes += line.length;
    }
    console.log(`  [OK]   ${table}: ${rows.length} rows`);
    return { rows: rows.length, bytes };
  } finally {
    fs.closeSync(fh);
  }
}

async function main() {
  const host = process.env.LEGACY_DB_HOST ?? 'localhost';
  const port = parseInt(process.env.LEGACY_DB_PORT ?? '3306', 10);
  const user = process.env.LEGACY_DB_USER;
  const password = process.env.LEGACY_DB_PASSWORD;
  const database = process.env.LEGACY_DB_NAME ?? 'qtip';
  if (!user || !password) {
    console.error('LEGACY_DB_USER and LEGACY_DB_PASSWORD are required');
    process.exit(1);
  }

  const outputRoot = path.resolve(
    process.env.EXPORT_OUTPUT_ROOT ??
      path.join(__dirname, '../../../scripts/backups')
  );
  const now = new Date();
  const stamp = timestampStamp(now);
  const bundleDir = path.join(outputRoot, `QTIP_data_prod_${stamp}`);
  fs.mkdirSync(bundleDir, { recursive: true });

  console.log(`Legacy source : ${user}@${host}:${port}/${database}`);
  console.log(`Bundle output : ${bundleDir}\n`);

  const conn = await mysql.createConnection({
    host,
    port,
    user,
    password,
    database,
    dateStrings: false,
  });
  // Read-only confirmation: take an explicit read-only transaction so the
  // server rejects any accidental writes that downstream code might try.
  await conn.query('SET SESSION TRANSACTION READ ONLY');
  await conn.query('START TRANSACTION');

  const summary: { table: string; rows: number }[] = [];
  try {
    console.log('Exporting tables...\n');
    for (const t of TABLES) {
      const res = await exportTable(conn, t, bundleDir, stamp);
      if (res) summary.push({ table: t, rows: res.rows });
    }
    await conn.query('COMMIT');
  } finally {
    await conn.end();
  }

  const totalRows = summary.reduce((a, b) => a + b.rows, 0);
  console.log(`\nDone. ${summary.length} tables, ${totalRows} rows total.`);
  console.log(`\nBundle path: ${bundleDir}`);
  console.log('Next step: tar -czf <bundle>.tar.gz QTIP_data_prod_<TS>/ then scp to target host.');
}

main().catch((err) => {
  console.error('\nExport failed:', err);
  process.exit(1);
});
