import ExcelJS from 'exceljs';
import prisma from '../config/prisma';
import { Prisma } from '../generated/prisma/client';
import logger from '../config/logger';

/**
 * Shared helpers for the Coaching Sessions report.
 *
 * Used by:
 *   - admin.controller (`getAdminCoachingSessions`, `exportAdminCoachingSessions`)
 *   - on-demand reports registry
 *   - coaching.controller (live list/detail) and coachingReport.controller
 *     (aggregates) — both import {@link buildCoachingSessionScope} so the
 *     visibility predicate is defined once instead of twice.
 *
 * Keeping the SQL + xlsx layout in one place avoids drift between the
 * paginated list endpoint, the existing xlsx export, and the new On Demand
 * Reports view.
 *
 * The live `getCoachingSessions` SELECT in `coaching.controller.ts` returns
 * additional columns the report does not (`is_overdue`, `quiz_count`,
 * `quiz_passed_count`, `attachment_filename`) — those stay in the live
 * controller because they are UI-only. If you need to add a filter that both
 * the live list and the report respect, add it to {@link buildCoachingSessionsWhere}
 * here (or to {@link buildCoachingSessionScope} for visibility) so it can't
 * land on only one side.
 */

/**
 * Visibility predicate applied to every coaching-session query.
 *
 *   Admin   → org-wide
 *   Manager → CSRs they manage (`u.manager_id = userId`)
 *   QA / Trainer / others past the route guard → sessions they personally
 *     created (`cs.created_by = userId`)
 *
 * Callers MUST `JOIN users u ON cs.csr_id = u.id` so the manager predicate
 * can resolve. This is the single source of truth — `coaching.controller.ts`
 * and `coachingReport.controller.ts` both consume it. Any change here applies
 * to the live list, the live detail view, every coaching-report aggregate,
 * and the on-demand exports.
 */
export const buildCoachingSessionScope = (role: string, userId: number): Prisma.Sql => {
  if (role === 'Admin') return Prisma.sql`1=1`;
  if (role === 'Manager') return Prisma.sql`u.manager_id = ${userId}`;
  return Prisma.sql`cs.created_by = ${userId}`;
};

export interface CoachingSessionsFilters {
  csrRoleId: number;
  searchTerm?: string;
  csr_id?: string | number;
  status?: string;
  coaching_purpose?: string;
  start_date?: string;
  end_date?: string;
  /** When set, restrict to sessions whose CSR is in a department managed by this user. */
  managerId?: number;
  /** When set, restrict to sessions whose CSR's department is in this list. */
  departmentIds?: number[];
  /** When set, restrict to sessions tagged with at least one of these training topics. */
  topicIds?: number[];
  /** When set, restrict to a single coaching_sessions.id (session number). */
  id?: number;
}

export interface PaginationParams {
  limit: number;
  offset: number;
}

export interface CoachingSessionRow {
  id: number;
  csr_id?: number;
  csr_name?: string | null;
  session_date?: Date | string | null;
  coaching_purpose?: string | null;
  notes?: string | null;
  status?: string | null;
  attachment_filename?: string | null;
  attachment_path?: string | null;
  attachment_size?: number | null;
  attachment_mime_type?: string | null;
  created_at?: Date | string | null;
  created_by_name?: string | null;
  topics?: string[] | string | null;
  topic_ids?: number[] | string | null;
}

let cachedCsrRoleId: number | null = null;

/**
 * Resolve the role_id of the 'CSR' role, cached for the process lifetime.
 */
export async function getCsrRoleId(): Promise<number | null> {
  if (cachedCsrRoleId !== null) return cachedCsrRoleId;
  try {
    const role = await prisma.role.findFirst({ where: { role_name: 'CSR' }, select: { id: true } });
    if (role) {
      cachedCsrRoleId = role.id;
      return role.id;
    }
  } catch (error) {
    logger.error('Error fetching CSR role ID:', error);
  }
  return null;
}

/**
 * Build the WHERE clause shared by both list and export queries.
 */
export function buildCoachingSessionsWhere(filters: CoachingSessionsFilters): Prisma.Sql {
  const conditions: Prisma.Sql[] = [
    Prisma.sql`u.role_id = ${filters.csrRoleId}`,
    Prisma.sql`u.is_active = 1`,
    Prisma.sql`d.is_active = 1`,
  ];

  if (filters.searchTerm) {
    const like = `%${filters.searchTerm}%`;
    conditions.push(Prisma.sql`(
      u.username LIKE ${like}
      OR EXISTS (
        SELECT 1 FROM coaching_session_topics cst
        JOIN list_items li_t ON cst.topic_id = li_t.id
        WHERE cst.coaching_session_id = cs.id
        AND li_t.label LIKE ${like}
      )
    )`);
  }

  if (filters.csr_id) {
    conditions.push(Prisma.sql`cs.csr_id = ${typeof filters.csr_id === 'string' ? parseInt(filters.csr_id) : filters.csr_id}`);
  }
  if (filters.status) conditions.push(Prisma.sql`cs.status = ${filters.status}`);
  if (filters.coaching_purpose) conditions.push(Prisma.sql`cs.coaching_purpose = ${filters.coaching_purpose}`);
  if (filters.start_date) conditions.push(Prisma.sql`DATE(cs.session_date) >= ${filters.start_date}`);
  if (filters.end_date) conditions.push(Prisma.sql`DATE(cs.session_date) <= ${filters.end_date}`);

  if (filters.managerId) {
    conditions.push(Prisma.sql`u.department_id IN (
      SELECT dm.department_id FROM department_managers dm
      WHERE dm.manager_id = ${filters.managerId} AND dm.is_active = 1
    )`);
  }

  if (filters.departmentIds && filters.departmentIds.length > 0) {
    conditions.push(Prisma.sql`u.department_id IN (${Prisma.join(filters.departmentIds)})`);
  }

  if (filters.topicIds && filters.topicIds.length > 0) {
    conditions.push(Prisma.sql`EXISTS (
      SELECT 1 FROM coaching_session_topics cst_f
      WHERE cst_f.coaching_session_id = cs.id
        AND cst_f.topic_id IN (${Prisma.join(filters.topicIds)})
    )`);
  }

  if (filters.id != null && Number.isFinite(Number(filters.id))) {
    conditions.push(Prisma.sql`cs.id = ${Number(filters.id)}`);
  }

  return Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`;
}

/**
 * Fetch a single page of coaching sessions plus the total row count.
 * `transform: true` (default) splits topics/topic_ids strings into arrays.
 */
export async function fetchCoachingSessionsPage(
  filters: CoachingSessionsFilters,
  pagination: PaginationParams,
  transform: boolean = true,
): Promise<{ sessions: CoachingSessionRow[]; totalCount: number }> {
  const whereClause = buildCoachingSessionsWhere(filters);

  const [countResult, sessions] = await Promise.all([
    prisma.$queryRaw<{ total: bigint }[]>`
      SELECT COUNT(*) as total
      FROM coaching_sessions cs
      JOIN users u ON cs.csr_id = u.id
      JOIN departments d ON u.department_id = d.id
      ${whereClause}
    `,
    prisma.$queryRaw<any[]>`
      SELECT
        cs.id, cs.csr_id, u.username as csr_name, cs.session_date, cs.coaching_purpose, cs.notes, cs.status,
        cs.attachment_filename, cs.attachment_path, cs.attachment_size, cs.attachment_mime_type,
        cs.created_at, creator.username as created_by_name,
        GROUP_CONCAT(DISTINCT li_t.label ORDER BY li_t.label SEPARATOR ', ') as topics,
        GROUP_CONCAT(DISTINCT li_t.id ORDER BY li_t.id SEPARATOR ',') as topic_ids
      FROM coaching_sessions cs
      JOIN users u ON cs.csr_id = u.id
      JOIN departments d ON u.department_id = d.id
      LEFT JOIN users creator ON cs.created_by = creator.id
      LEFT JOIN coaching_session_topics cst ON cs.id = cst.coaching_session_id
      LEFT JOIN list_items li_t ON cst.topic_id = li_t.id
      ${whereClause}
      GROUP BY cs.id
      ORDER BY cs.session_date DESC
      LIMIT ${Number(pagination.limit)} OFFSET ${Number(pagination.offset)}
    `,
  ]);

  const totalCount = Number(countResult[0]?.total || 0);

  const transformed = transform
    ? (sessions || []).map((s: any) => ({
        ...s,
        topics: s.topics ? s.topics.split(', ') : [],
        topic_ids: s.topic_ids ? s.topic_ids.split(',').map((id: string) => parseInt(id)) : [],
      }))
    : (sessions || []);

  return { sessions: transformed, totalCount };
}

/**
 * Fetch ALL matching coaching sessions (no pagination) for export.
 *
 * Selects the extra fields (`require_action_plan`, `due_date`,
 * `require_acknowledgment`, `csr_acknowledged_at`) and aggregates the three
 * internal-note categories from `coaching_session_behavior_flags` so the xlsx
 * generator can include them. The list view query (`fetchCoachingSessionsPage`)
 * deliberately omits these joins to keep paginated reads lean.
 */
export async function fetchAllCoachingSessions(
  filters: CoachingSessionsFilters,
): Promise<CoachingSessionRow[]> {
  const whereClause = buildCoachingSessionsWhere(filters);

  return prisma.$queryRaw<any[]>`
    SELECT
      cs.id, cs.session_date, cs.coaching_purpose, cs.notes, cs.status, cs.attachment_filename,
      cs.created_at, cs.completed_at, cs.require_action_plan, cs.require_acknowledgment,
      cs.csr_acknowledged_at,
      u.username as csr_name, creator.username as created_by_name,
      GROUP_CONCAT(DISTINCT li_t.label ORDER BY li_t.label SEPARATOR ', ') as topics,
      GROUP_CONCAT(DISTINCT CASE WHEN li_bf.list_type = 'behavior_flag'  THEN li_bf.label END ORDER BY li_bf.label SEPARATOR ', ') as behavior_flags,
      GROUP_CONCAT(DISTINCT CASE WHEN li_bf.list_type = 'root_cause'     THEN li_bf.label END ORDER BY li_bf.label SEPARATOR ', ') as root_causes,
      GROUP_CONCAT(DISTINCT CASE WHEN li_bf.list_type = 'support_needed' THEN li_bf.label END ORDER BY li_bf.label SEPARATOR ', ') as support_needed
    FROM coaching_sessions cs
    JOIN users u ON cs.csr_id = u.id
    JOIN departments d ON u.department_id = d.id
    LEFT JOIN users creator ON cs.created_by = creator.id
    LEFT JOIN coaching_session_topics cst ON cs.id = cst.coaching_session_id
    LEFT JOIN list_items li_t ON cst.topic_id = li_t.id
    LEFT JOIN coaching_session_behavior_flags csbf ON csbf.coaching_session_id = cs.id
    LEFT JOIN list_items li_bf ON csbf.list_item_id = li_bf.id
    ${whereClause}
    GROUP BY cs.id
    ORDER BY cs.session_date DESC
  `;
}

/**
 * Display column definitions used by both the in-browser report viewer
 * and the xlsx generator. Defined once so the two stay in sync.
 */
export const COACHING_SESSIONS_COLUMNS = [
  { key: 'id', label: 'Session ID', width: 14 },
  { key: 'status', label: 'Status', width: 14 },
  { key: 'coaching_purpose', label: 'Coaching Purpose', width: 20 },
  { key: 'csr_name', label: 'CSR Name', width: 24 },
  { key: 'topics', label: 'Topics', width: 36 },
  { key: 'created_by_name', label: 'Manager/Trainer', width: 24 },
  { key: 'session_date', label: 'Session Date', width: 16 },
  { key: 'notes', label: 'Notes', width: 48 },
] as const;

/**
 * Extra columns appended to the xlsx download only (not the on-screen table).
 * Mirrors the action-plan / acknowledgement workflow + the three internal-note
 * categories captured on the coaching session form.
 */
export const COACHING_SESSIONS_DOWNLOAD_EXTRA_COLUMNS = [
  { key: 'require_action_plan',    label: 'Action Plan Required',         width: 18 },
  { key: 'completed_at',            label: 'Action Plan Date',             width: 16 },
  { key: 'require_acknowledgment', label: 'Acknowledgement Required',     width: 22 },
  { key: 'csr_acknowledged_at',    label: 'Acknowledgement Date',         width: 18 },
  { key: 'root_causes',             label: 'Internal Note: Root Cause',    width: 36 },
  { key: 'behavior_flags',          label: 'Internal Note: Behavior Flags',width: 36 },
  { key: 'support_needed',          label: 'Internal Note: Support Needed',width: 36 },
] as const;

/**
 * Format a single raw coaching session row for display (table view + xlsx).
 * Topics may arrive as a comma-joined string (export query) or array (list query).
 */
export function formatCoachingSessionRow(session: any): Record<string, string> {
  const topicsValue = Array.isArray(session.topics)
    ? session.topics.join(', ')
    : (session.topics || '');

  return {
    id: `#${session.id}`,
    status: session.status
      ? session.status.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c: string) => c.toUpperCase())
      : '',
    coaching_purpose: (session.coaching_purpose || '').toUpperCase(),
    csr_name: session.csr_name || '',
    topics: topicsValue,
    created_by_name: session.created_by_name || 'Unknown',
    session_date: session.session_date ? new Date(session.session_date).toLocaleDateString('en-US') : '',
    notes: session.notes || '',
  };
}

/** Booleans arrive from MySQL as 0/1 (Buffer in some setups). Normalize to Yes/No. */
function yesNo(value: any): string {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Buffer.isBuffer(value)) return value[0] ? 'Yes' : 'No';
  return Number(value) ? 'Yes' : 'No';
}

function formatDateOnly(value: any): string {
  if (!value) return '';
  return new Date(value).toLocaleDateString('en-US');
}

/**
 * Format a row for the xlsx download — base columns plus the extra
 * action-plan / acknowledgement / internal-note fields. The on-screen table
 * keeps using {@link formatCoachingSessionRow}.
 */
export function formatCoachingSessionDownloadRow(session: any): Record<string, string> {
  return {
    ...formatCoachingSessionRow(session),
    require_action_plan:    yesNo(session.require_action_plan),
    completed_at:            formatDateOnly(session.completed_at),
    require_acknowledgment: yesNo(session.require_acknowledgment),
    csr_acknowledged_at:    formatDateOnly(session.csr_acknowledged_at),
    root_causes:             session.root_causes    || '',
    behavior_flags:          session.behavior_flags || '',
    support_needed:          session.support_needed || '',
  };
}

/**
 * Build the Coaching Sessions xlsx. Uses the shared base column definitions
 * plus the download-only extras (action plan, acknowledgement, internal notes).
 */
export async function generateCoachingSessionsXlsx(sessions: CoachingSessionRow[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Coaching Sessions');

  const allColumns = [
    ...COACHING_SESSIONS_COLUMNS,
    ...COACHING_SESSIONS_DOWNLOAD_EXTRA_COLUMNS,
  ];

  worksheet.columns = allColumns.map(col => ({
    header: col.label,
    key: col.key,
    width: col.width,
  }));

  worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  worksheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF00AEEF' } };
  worksheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };
  worksheet.getRow(1).height = 22;

  (sessions || []).forEach((session: any) => {
    worksheet.addRow(formatCoachingSessionDownloadRow(session));
  });

  worksheet.eachRow((row, rowNumber) => {
    row.alignment = {
      vertical: 'top',
      horizontal: rowNumber === 1 ? 'center' : 'left',
      wrapText: true,
    };
  });

  worksheet.views = [{ state: 'frozen', ySplit: 1 }];
  worksheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: worksheet.columns.length },
  };

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
