import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'csv-parse/sync';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '../../.env') });

const DATA_DIR = path.join(__dirname, '../../../../QTIP_data_prod_3_23_2026/QTIP_data_prod_3_23_2026');
const BATCH_SIZE = 500;

// Tables to import in FK-safe order. Dropped/irrelevant tables are excluded.
// `coaching_sessions` is special-cased: the old single section is split into
// the new `coaching_sessions` (developmental coaching) and `write_ups`
// (performance warnings). `topics` and `coaching_session_topics` are no longer
// imported as-is (the old `topics` table was dropped; training topics now live
// in `list_items`). They are remapped inside seedCoachingAndWarnings().
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
  'coaching_sessions',  // special-cased: split into coaching_sessions + write_ups
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

// --- Old combined coaching_type -> new system split ----------------------------
//
// Old enum: 'Classroom','Side-by-Side','Team Session','1-on-1','PIP',
//           'Verbal Warning','Written Warning'
//
// Warning types become `write_ups` (performance warnings); everything else stays
// a developmental coaching session.

// PIP = Performance Improvement Plan. Treated as formal discipline and mapped to
// the most severe warning tier. Flip to 'WRITTEN_WARNING' (or move PIP out of
// WARNING_DOCUMENT_TYPES into the coaching branch) after reviewing real counts.
const PIP_TARGET: 'FINAL_WARNING' | 'WRITTEN_WARNING' = 'FINAL_WARNING';

const WARNING_DOCUMENT_TYPES: Record<string, string> = {
  'Verbal Warning': 'VERBAL_WARNING',
  'Written Warning': 'WRITTEN_WARNING',
  'PIP': PIP_TARGET,
};

function isWarningType(coachingType: string): boolean {
  return Object.prototype.hasOwnProperty.call(WARNING_DOCUMENT_TYPES, coachingType.trim());
}

// Coaching purpose/format are List-Management lists keyed by label (no slugs).
function mapCoachingType(coachingType: string): { coaching_purpose: string; coaching_format: string } {
  switch (coachingType.trim()) {
    case 'Classroom':    return { coaching_purpose: 'Onboarding', coaching_format: 'Team Session' };
    case 'Side-by-Side': return { coaching_purpose: 'Weekly',     coaching_format: 'Side-by-Side' };
    case 'Team Session': return { coaching_purpose: 'Weekly',     coaching_format: 'Team Session' };
    case '1-on-1':
    default:             return { coaching_purpose: 'Weekly',     coaching_format: '1-on-1'       };
  }
}

// Old coaching_sessions.status enum was only SCHEDULED / COMPLETED.
function mapCoachingStatus(oldStatus: string | null): string {
  return (oldStatus ?? '').trim().toUpperCase() === 'COMPLETED' ? 'COMPLETED' : 'SCHEDULED';
}

function mapWriteUpStatus(oldStatus: string | null): string {
  switch ((oldStatus ?? '').trim().toUpperCase()) {
    case 'COMPLETED': return 'CLOSED';
    case 'SCHEDULED': return 'SCHEDULED';
    default:          return 'DRAFT';
  }
}

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

// Pick the user that legacy warnings with a null author are attributed to.
// `write_ups.created_by` is NOT NULL, but old coaching_sessions.created_by was
// nullable. Prefers an admin/manager, else the lowest user id. Override with
// LEGACY_IMPORT_USER_ID.
async function resolveFallbackUserId(conn: mysql.Connection): Promise<number> {
  const envId = process.env.LEGACY_IMPORT_USER_ID;
  if (envId && /^\d+$/.test(envId)) return parseInt(envId, 10);
  const [rows] = await conn.query<mysql.RowDataPacket[]>(
    `SELECT u.id
       FROM users u
       JOIN roles r ON r.id = u.role_id
   ORDER BY (LOWER(r.role_name) IN ('admin','administrator','manager')) DESC, u.id ASC
      LIMIT 1`
  );
  return rows[0]?.id ?? 1;
}

// Old `topics` rows -> `list_items` (list_type='training_topic'). Returns maps
// from old topic id to the new list_item id and to the topic label.
async function seedTopicsIntoListItems(
  conn: mysql.Connection
): Promise<{ idMap: Map<string, number>; labelMap: Map<string, string> }> {
  const idMap = new Map<string, number>();
  const labelMap = new Map<string, string>();
  const records = readCsv('topics');
  if (records.length === 0) {
    console.log('  [SKIP] No data: topics');
    return { idMap, labelMap };
  }
  for (const r of records) {
    const oldId = String(r['id']);
    const label = r['topic_name'];
    labelMap.set(oldId, label);
    const [res] = await conn.execute<mysql.ResultSetHeader>(
      `INSERT INTO list_items (list_type, category, item_key, label, sort_order, is_active, created_at)
       VALUES ('training_topic', NULL, NULL, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))`,
      [
        label,
        transformValue(r['sort_order'] ?? '0') ?? 0,
        transformValue(r['is_active'] ?? '1') ?? 1,
        transformValue(r['created_at'] ?? ''),
      ]
    );
    idMap.set(oldId, res.insertId);
  }
  console.log(`  [OK]   topics -> list_items: ${records.length} rows`);
  return { idMap, labelMap };
}

// Old coaching_session_topics -> grouped by coaching_session_id (old id) -> [old topic ids].
function readSessionTopicLinks(): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const r of readCsv('coaching_session_topics')) {
    const sid = String(r['coaching_session_id']);
    const tid = String(r['topic_id']);
    if (!map.has(sid)) map.set(sid, []);
    map.get(sid)!.push(tid);
  }
  return map;
}

// Split the old combined coaching_sessions export into the new coaching_sessions
// (developmental) and write_ups (performance warnings) tables, remap training
// topics into list_items, and stamp every migrated row as legacy.
async function seedCoachingAndWarnings(conn: mysql.Connection, fallbackUserId: number): Promise<void> {
  // Topics must be seeded first so coaching topic links can be remapped and
  // warning topic labels can be folded into write-up notes.
  const { idMap: topicIdMap, labelMap: topicLabelMap } = await seedTopicsIntoListItems(conn);
  const sessionTopics = readSessionTopicLinks();

  const records = readCsv('coaching_sessions');
  if (records.length === 0) {
    console.log('  [SKIP] No data: coaching_sessions');
    return;
  }

  const coachingColumns = [
    'id', 'csr_id', 'session_date', 'coaching_purpose', 'coaching_format', 'notes',
    'attachment_filename', 'attachment_path', 'attachment_size', 'attachment_mime_type',
    'status', 'created_at', 'created_by', 'is_legacy', 'legacy_coaching_type',
  ];

  // coaching_purpose / coaching_format are now list_items.id FKs (List Management).
  // Resolve the built-in ids by label so legacy rows map correctly.
  const [coachingListRows] = await conn.execute<mysql.RowDataPacket[]>(
    `SELECT id, list_type, label FROM list_items WHERE list_type IN ('coaching_purpose','coaching_format')`
  );
  const coachingListIdMap = new Map<string, number>();
  for (const lr of coachingListRows as mysql.RowDataPacket[]) {
    coachingListIdMap.set(`${lr.list_type}:${lr.label}`, lr.id as number);
  }
  const coachingRows: (string | number | null)[][] = [];
  const coachingTopicLinks: { sessionId: number; topicIds: string[] }[] = [];

  let writeUpCount = 0;
  let attachmentCount = 0;

  for (const r of records) {
    const coachingType = (r['coaching_type'] ?? '').trim();

    if (isWarningType(coachingType)) {
      const oldId = String(r['id']);
      const labels = (sessionTopics.get(oldId) ?? [])
        .map(t => topicLabelMap.get(t))
        .filter((l): l is string => Boolean(l));
      const internalNotes = labels.length ? `Legacy training topics: ${labels.join(', ')}` : null;

      const [res] = await conn.execute<mysql.ResultSetHeader>(
        `INSERT INTO write_ups
           (csr_id, document_type, status, meeting_date, meeting_notes, internal_notes,
            created_by, created_at, is_legacy, legacy_coaching_type)
         VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP), 1, ?)`,
        [
          transformValue(r['csr_id']),
          WARNING_DOCUMENT_TYPES[coachingType],
          mapWriteUpStatus(r['status'] ?? null),
          transformValue(r['session_date'] ?? ''),
          transformValue(r['notes'] ?? ''),
          internalNotes,
          transformValue(r['created_by'] ?? '') ?? fallbackUserId,
          transformValue(r['created_at'] ?? ''),
          coachingType,
        ]
      );
      writeUpCount++;

      const attFilename = transformValue(r['attachment_filename'] ?? '');
      if (attFilename) {
        await conn.execute(
          `INSERT INTO write_up_attachments
             (write_up_id, attachment_type, filename, file_path, file_size, mime_type, created_at)
           VALUES (?, 'LEGACY', ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))`,
          [
            res.insertId,
            attFilename,
            transformValue(r['attachment_path'] ?? ''),
            transformValue(r['attachment_size'] ?? ''),
            transformValue(r['attachment_mime_type'] ?? ''),
            transformValue(r['created_at'] ?? ''),
          ]
        );
        attachmentCount++;
      }
    } else {
      const { coaching_purpose, coaching_format } = mapCoachingType(coachingType);
      const purposeId = coachingListIdMap.get(`coaching_purpose:${coaching_purpose}`) ?? null;
      const formatId  = coachingListIdMap.get(`coaching_format:${coaching_format}`) ?? null;
      coachingRows.push([
        transformValue(r['id']),
        transformValue(r['csr_id']),
        transformValue(r['session_date'] ?? ''),
        purposeId,
        formatId,
        transformValue(r['notes'] ?? ''),
        transformValue(r['attachment_filename'] ?? ''),
        transformValue(r['attachment_path'] ?? ''),
        transformValue(r['attachment_size'] ?? ''),
        transformValue(r['attachment_mime_type'] ?? ''),
        mapCoachingStatus(r['status'] ?? null),
        transformValue(r['created_at'] ?? ''),
        transformValue(r['created_by'] ?? ''),
        1,
        coachingType || null,
      ]);
      const oldId = String(r['id']);
      const topicIds = sessionTopics.get(oldId);
      if (topicIds && topicIds.length) {
        coachingTopicLinks.push({ sessionId: parseInt(oldId, 10), topicIds });
      }
    }
  }

  if (coachingRows.length > 0) {
    await insertBatch(conn, 'coaching_sessions', coachingColumns, coachingRows);
  }
  console.log(`  [OK]   coaching_sessions: ${coachingRows.length} rows`);
  console.log(`  [OK]   write_ups (from legacy warnings): ${writeUpCount} rows`);
  if (attachmentCount > 0) {
    console.log(`  [OK]   write_up_attachments: ${attachmentCount} rows`);
  }

  // Re-link coaching topics, remapped old topic id -> new list_item id. Only
  // coaching sessions (not warnings) keep their original ids in this table.
  let linkCount = 0;
  for (const link of coachingTopicLinks) {
    for (const oldTopicId of link.topicIds) {
      const newTopicId = topicIdMap.get(oldTopicId);
      if (!newTopicId) continue;
      await conn.execute(
        `INSERT IGNORE INTO coaching_session_topics (coaching_session_id, topic_id) VALUES (?, ?)`,
        [link.sessionId, newTopicId]
      );
      linkCount++;
    }
  }
  console.log(`  [OK]   coaching_session_topics (remapped): ${linkCount} rows`);
}

async function resetAutoIncrements(conn: mysql.Connection): Promise<void> {
  const tables = [
    'roles', 'departments', 'users', 'forms', 'form_metadata_fields', 'form_categories',
    'form_questions', 'radio_options', 'form_question_conditions', 'performance_goals',
    'performance_goal_users', 'performance_goal_departments', 'audit_assignments',
    'department_managers', 'courses', 'quizzes', 'quiz_questions', 'quiz_attempts',
    'coaching_sessions', 'coaching_session_topics', 'list_items', 'write_ups',
    'write_up_attachments', 'calls', 'submissions', 'submission_metadata',
    'submission_calls', 'submission_answers', 'free_text_answers', 'score_snapshots',
    'disputes', 'dispute_score_history', 'audit_logs', 'agent_activity',
  ];
  for (const t of tables) {
    try {
      const [rows] = await conn.query<mysql.RowDataPacket[]>(
        `SELECT IFNULL(MAX(id), 0) + 1 AS next_id FROM \`${t}\``
      );
      const nextId = rows[0]?.next_id ?? 1;
      await conn.query(`ALTER TABLE \`${t}\` AUTO_INCREMENT = ?`, [nextId]);
    } catch {
      console.log(`  [SKIP] AUTO_INCREMENT reset (table missing): ${t}`);
    }
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
        const fallbackUserId = await resolveFallbackUserId(conn);
        await seedCoachingAndWarnings(conn, fallbackUserId);
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
