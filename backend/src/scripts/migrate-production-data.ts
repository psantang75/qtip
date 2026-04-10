import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'csv-parse/sync';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '../../.env') });

const DATA_DIR = path.join(__dirname, '../../../../QTIP_data_prod_3_23_2026/QTIP_data_prod_3_23_2026');
const BATCH_SIZE = 500;

// Tables to import in FK-safe order. Dropped/irrelevant tables are excluded.
const TABLE_ORDER = [
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
  'coaching_sessions',  // special-cased below
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
];

// Tables dropped in new schema migrations — skip entirely
const SKIP_TABLES = new Set([
  'training_paths',
  'training_path_courses',
  'training_logs',
  'enrollments',
  'certificates',
  'course_pages',
  'performance_goals_legacy',
  'auth_logs',
]);

const DATE_TIME_REGEX = /^\d{1,2}\/\d{1,2}\/\d{4}\s+\d{1,2}:\d{2}:\d{2}\s+(AM|PM)$/i;
const DATE_ONLY_REGEX  = /^\d{1,2}\/\d{1,2}\/\d{4}$/;

function parseDatetime(val: string): string {
  const d = new Date(val);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ` +
         `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;
}

function parseDateOnly(val: string): string {
  const d = new Date(val);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function transformValue(val: string): string | number | null {
  if (val === 'null' || val === '') return null;
  if (DATE_TIME_REGEX.test(val.trim())) return parseDatetime(val.trim());
  if (DATE_ONLY_REGEX.test(val.trim()))  return parseDateOnly(val.trim());
  return val;
}

function findCsvFile(tableName: string): string | null {
  if (!fs.existsSync(DATA_DIR)) return null;
  const files = fs.readdirSync(DATA_DIR);
  const match  = files.find(f => f.startsWith(`${tableName}_`) && f.endsWith('.csv'));
  return match ? path.join(DATA_DIR, match) : null;
}

function readCsv(tableName: string): Record<string, string>[] {
  const csvFile = findCsvFile(tableName);
  if (!csvFile) return [];
  const content = fs.readFileSync(csvFile, 'utf8');
  return parse(content, { columns: true, skip_empty_lines: true, trim: true, bom: true });
}

async function insertBatch(
  conn: mysql.Connection,
  tableName: string,
  columns: string[],
  rows: (string | number | null)[][]
): Promise<void> {
  const colList      = columns.map(c => `\`${c}\``).join(', ');
  const placeholder  = columns.map(() => '?').join(', ');
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    if (batch.length === 1) {
      await conn.execute(`INSERT INTO \`${tableName}\` (${colList}) VALUES (${placeholder})`, batch[0]);
    } else {
      const multi = batch.map(() => `(${placeholder})`).join(', ');
      await conn.query(`INSERT INTO \`${tableName}\` (${colList}) VALUES ${multi}`, batch.flat());
    }
  }
}

async function seedTable(conn: mysql.Connection, tableName: string): Promise<void> {
  const records = readCsv(tableName);
  if (records.length === 0) {
    console.log(`  [SKIP] No data: ${tableName}`);
    return;
  }
  const columns = Object.keys(records[0]);
  const rows    = records.map(r => columns.map(c => transformValue(r[c])));
  await insertBatch(conn, tableName, columns, rows);
  console.log(`  [OK]   ${tableName}: ${records.length} rows`);
}

function mapCoachingType(coachingType: string): { coaching_purpose: string; coaching_format: string } {
  switch (coachingType.trim()) {
    case 'Side-by-Side':    return { coaching_purpose: 'WEEKLY',      coaching_format: 'SIDE_BY_SIDE' };
    case 'Verbal Warning':  return { coaching_purpose: 'PERFORMANCE',  coaching_format: 'ONE_ON_ONE'   };
    case 'Written Warning': return { coaching_purpose: 'PERFORMANCE',  coaching_format: 'ONE_ON_ONE'   };
    case '1-on-1':
    default:                return { coaching_purpose: 'WEEKLY',       coaching_format: 'ONE_ON_ONE'   };
  }
}

async function seedCoachingSessions(conn: mysql.Connection): Promise<void> {
  const records = readCsv('coaching_sessions');
  if (records.length === 0) {
    console.log('  [SKIP] No data: coaching_sessions');
    return;
  }
  const newColumns = [
    'id','csr_id','session_date','coaching_purpose','coaching_format',
    'notes','attachment_filename','attachment_path','attachment_size',
    'attachment_mime_type','status','created_at','created_by'
  ];
  const rows = records.map(r => {
    const { coaching_purpose, coaching_format } = mapCoachingType(r['coaching_type'] ?? '');
    return [
      transformValue(r['id']),
      transformValue(r['csr_id']),
      transformValue(r['session_date']),
      coaching_purpose,
      coaching_format,
      transformValue(r['notes']),
      transformValue(r['attachment_filename']),
      transformValue(r['attachment_path']),
      transformValue(r['attachment_size']),
      transformValue(r['attachment_mime_type']),
      transformValue(r['status']),
      transformValue(r['created_at']),
      transformValue(r['created_by']),
    ] as (string | number | null)[];
  });
  await insertBatch(conn, 'coaching_sessions', newColumns, rows);
  console.log(`  [OK]   coaching_sessions: ${records.length} rows`);
}

async function resetAutoIncrements(conn: mysql.Connection): Promise<void> {
  const tables = [
    'roles','departments','users','forms','form_metadata_fields','form_categories',
    'form_questions','radio_options','form_question_conditions','performance_goals',
    'performance_goal_users','performance_goal_departments','audit_assignments',
    'department_managers','courses','quizzes','quiz_questions','quiz_attempts',
    'coaching_sessions','coaching_session_topics','calls','submissions',
    'submission_metadata','submission_calls','submission_answers','free_text_answers',
    'score_snapshots','disputes','dispute_score_history','audit_logs',
    'agent_activity','topics','auth_logs',
  ];
  for (const t of tables) {
    const [rows] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT IFNULL(MAX(id), 0) + 1 AS next_id FROM \`${t}\``
    );
    const nextId = rows[0]?.next_id ?? 1;
    await conn.query(`ALTER TABLE \`${t}\` AUTO_INCREMENT = ?`, [nextId]);
  }
  console.log('  [OK]   AUTO_INCREMENT values reset to max(id)+1 on all tables');
}

async function main() {
  if (!fs.existsSync(DATA_DIR)) {
    console.error(`Production data directory not found:\n  ${DATA_DIR}`);
    process.exit(1);
  }
  console.log(`Production data directory: ${DATA_DIR}\n`);

  const conn = await mysql.createConnection({
    host:               process.env.DB_HOST     ?? 'localhost',
    port:               parseInt(process.env.DB_PORT ?? '3306', 10),
    user:               process.env.DB_USER     ?? 'root',
    password:           process.env.DB_PASSWORD ?? '',
    database:           process.env.DB_NAME     ?? 'qtip',
    multipleStatements: true,
  });

  try {
    console.log('Starting production data migration...\n');
    await conn.query('SET FOREIGN_KEY_CHECKS = 0;');
    await conn.query('SET UNIQUE_CHECKS = 0;');
    await conn.query('SET sql_mode = "";');

    for (const table of TABLE_ORDER) {
      if (SKIP_TABLES.has(table)) {
        console.log(`  [SKIP] Dropped table: ${table}`);
        continue;
      }
      if (table === 'coaching_sessions') {
        await seedCoachingSessions(conn);
      } else {
        await seedTable(conn, table);
      }
    }

    console.log('\nResetting AUTO_INCREMENT values...');
    await resetAutoIncrements(conn);

    await conn.query('SET FOREIGN_KEY_CHECKS = 1;');
    await conn.query('SET UNIQUE_CHECKS = 1;');

    console.log('\nMigration complete!');
  } catch (err) {
    console.error('\nMigration failed:', err);
    process.exit(1);
  } finally {
    await conn.end();
  }
}

main();
