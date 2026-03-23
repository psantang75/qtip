import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'csv-parse/sync';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '../.env') });

const DATA_DIR = path.join(__dirname, '../../QTIP_data');
const BATCH_SIZE = 500;

// Insertion order respects FK dependencies
const TABLE_ORDER = [
  'roles',
  'departments',
  'users',
  'training_paths',
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
  'training_path_courses',
  'training_logs',
  'quizzes',
  'quiz_questions',
  'enrollments',
  'certificates',
  'course_pages',
  'coaching_sessions',
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
  'topics',
  'coaching_session_topics',
  'auth_logs',
];

function findCsvFile(tableName: string): string | null {
  const files = fs.readdirSync(DATA_DIR);
  const match = files.find((f) => f.startsWith(`${tableName}_`) && f.endsWith('.csv'));
  return match ? path.join(DATA_DIR, match) : null;
}

const DATE_TIME_REGEX = /^\d{1,2}\/\d{1,2}\/\d{4}\s+\d{1,2}:\d{2}:\d{2}\s+(AM|PM)$/i;
const DATE_ONLY_REGEX = /^\d{1,2}\/\d{1,2}\/\d{4}$/;

function parseDatetime(val: string): string {
  const d = new Date(val);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const seconds = String(d.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

function parseDateOnly(val: string): string {
  const d = new Date(val);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function transformValue(val: string): string | number | null {
  if (val === 'null' || val === '') return null;

  if (DATE_TIME_REGEX.test(val.trim())) {
    return parseDatetime(val.trim());
  }

  if (DATE_ONLY_REGEX.test(val.trim())) {
    return parseDateOnly(val.trim());
  }

  return val;
}

async function seedTable(conn: mysql.Connection, tableName: string): Promise<void> {
  const csvFile = findCsvFile(tableName);
  if (!csvFile) {
    console.log(`  [SKIP] No CSV found for table: ${tableName}`);
    return;
  }

  const content = fs.readFileSync(csvFile, 'utf8');
  const records: Record<string, string>[] = parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    bom: true,
  });

  if (records.length === 0) {
    console.log(`  [SKIP] Empty CSV for table: ${tableName}`);
    return;
  }

  const columns = Object.keys(records[0]);
  const columnList = columns.map((c) => `\`${c}\``).join(', ');
  const placeholders = columns.map(() => '?').join(', ');

  let inserted = 0;
  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);
    const values = batch.map((row) => columns.map((col) => transformValue(row[col])));

    if (values.length === 1) {
      await conn.execute(`INSERT INTO \`${tableName}\` (${columnList}) VALUES (${placeholders})`, values[0]);
    } else {
      const multiPlaceholders = values.map(() => `(${placeholders})`).join(', ');
      const flatValues = values.flat();
      await conn.query(
        `INSERT INTO \`${tableName}\` (${columnList}) VALUES ${multiPlaceholders}`,
        flatValues,
      );
    }
    inserted += batch.length;
  }

  console.log(`  [OK] ${tableName}: ${inserted} rows`);
}

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST ?? 'localhost',
    port: parseInt(process.env.DB_PORT ?? '3306', 10),
    user: process.env.DB_USER ?? 'root',
    password: process.env.DB_PASSWORD ?? '',
    database: process.env.DB_NAME ?? 'qtip',
    multipleStatements: true,
  });

  try {
    console.log('Starting QTIP database seed...\n');

    await conn.query('SET FOREIGN_KEY_CHECKS = 0;');
    await conn.query('SET UNIQUE_CHECKS = 0;');
    await conn.query('SET sql_mode = "";');

    for (const table of TABLE_ORDER) {
      process.stdout.write(`  Seeding ${table}...`);
      try {
        await seedTable(conn, table);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`\n  [ERROR] ${table}: ${msg}`);
      }
    }

    await conn.query('SET FOREIGN_KEY_CHECKS = 1;');
    await conn.query('SET UNIQUE_CHECKS = 1;');

    console.log('\nSeed complete!');
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
