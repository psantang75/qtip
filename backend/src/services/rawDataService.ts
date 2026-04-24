/**
 * Raw Data Service
 * Powers the data explorer and report builder live preview.
 * All queries are Prisma-based with role-based data scoping.
 *
 * Excel generation: uses ExcelJS (same library as `AnalyticsService`,
 * `coachingSessionsReport`, and `manager.controller`). The previous SheetJS
 * (`xlsx`) writer was removed during the pre-production review (item #24) so
 * every report-export path on the backend goes through one library. SheetJS
 * is still a runtime dependency, but only `services/importService.ts` uses
 * it — and only on the **read** side, where it parses uploaded .xlsx
 * uploads (a different concern from generation).
 */

import prisma from '../config/prisma';
import ExcelJS from 'exceljs';

// ── Constants ─────────────────────────────────────────────────────────────────

const EXPORT_ROW_LIMIT = 50_000;

/** Roles that can access all users' data. */
const GLOBAL_ROLES = new Set(['Admin', 'Director']);
/** Roles that can access their department's data. */
const DEPT_ROLES = new Set(['Manager', 'QA', 'Trainer']);

// ── Table registry ────────────────────────────────────────────────────────────

type PrismaRawModel =
  | typeof prisma.callActivityRaw
  | typeof prisma.salesMarginRaw
  | typeof prisma.leadSalesMarginRaw
  | typeof prisma.leadSourceRaw
  | typeof prisma.ticketTaskRaw
  | typeof prisma.emailStatsRaw;

interface PrismaModelDelegate {
  count(args?: { where?: Record<string, unknown> }): Promise<number>
  findMany(args?: {
    where?: Record<string, unknown>
    select?: Record<string, boolean>
    skip?: number
    take?: number
    orderBy?: Record<string, unknown>
  }): Promise<Record<string, unknown>[]>
}

const TABLE_PRISMA_MAP: Record<string, PrismaRawModel> = {
  call_activity_raw:     prisma.callActivityRaw,
  sales_margin_raw:      prisma.salesMarginRaw,
  lead_sales_margin_raw: prisma.leadSalesMarginRaw,
  lead_source_raw:       prisma.leadSourceRaw,
  ticket_task_raw:       prisma.ticketTaskRaw,
  email_stats_raw:       prisma.emailStatsRaw,
};

export const VALID_TABLES = Object.keys(TABLE_PRISMA_MAP);

/** Static column schema for each raw table. */
export interface ColumnSchema {
  name: string;
  type: 'string' | 'number' | 'date' | 'boolean';
  nullable: boolean;
}

const TABLE_SCHEMAS: Record<string, ColumnSchema[]> = {
  call_activity_raw: [
    { name: 'id',            type: 'number',  nullable: false },
    { name: 'user_id',       type: 'number',  nullable: false },
    { name: 'report_date',   type: 'date',    nullable: false },
    { name: 'calls_offered', type: 'number',  nullable: false },
    { name: 'calls_handled', type: 'number',  nullable: false },
    { name: 'hold_minutes',  type: 'number',  nullable: false },
    { name: 'line_minutes',  type: 'number',  nullable: false },
    { name: 'wrap_minutes',  type: 'number',  nullable: false },
    { name: 'import_id',     type: 'number',  nullable: true  },
    { name: 'created_at',    type: 'date',    nullable: false },
  ],
  sales_margin_raw: [
    { name: 'id',               type: 'number',  nullable: false },
    { name: 'user_id',          type: 'number',  nullable: false },
    { name: 'report_date',      type: 'date',    nullable: false },
    { name: 'order_count',      type: 'number',  nullable: false },
    { name: 'revenue',          type: 'number',  nullable: false },
    { name: 'cogs',             type: 'number',  nullable: false },
    { name: 'gross_margin',     type: 'number',  nullable: false },
    { name: 'product_category', type: 'string',  nullable: true  },
    { name: 'import_id',        type: 'number',  nullable: true  },
    { name: 'created_at',       type: 'date',    nullable: false },
  ],
  lead_sales_margin_raw: [
    { name: 'id',               type: 'number',  nullable: false },
    { name: 'user_id',          type: 'number',  nullable: false },
    { name: 'report_date',      type: 'date',    nullable: false },
    { name: 'leads_assigned',   type: 'number',  nullable: false },
    { name: 'leads_contacted',  type: 'number',  nullable: false },
    { name: 'orders',           type: 'number',  nullable: false },
    { name: 'lead_revenue',     type: 'number',  nullable: false },
    { name: 'lead_margin',      type: 'number',  nullable: false },
    { name: 'import_id',        type: 'number',  nullable: true  },
    { name: 'created_at',       type: 'date',    nullable: false },
  ],
  lead_source_raw: [
    { name: 'id',               type: 'number',  nullable: false },
    { name: 'user_id',          type: 'number',  nullable: false },
    { name: 'report_date',      type: 'date',    nullable: false },
    { name: 'source_name',      type: 'string',  nullable: false },
    { name: 'leads_received',   type: 'number',  nullable: false },
    { name: 'converted',        type: 'number',  nullable: false },
    { name: 'conversion_rate',  type: 'number',  nullable: false },
    { name: 'import_id',        type: 'number',  nullable: true  },
    { name: 'created_at',       type: 'date',    nullable: false },
  ],
  ticket_task_raw: [
    { name: 'id',                       type: 'number',  nullable: false },
    { name: 'user_id',                  type: 'number',  nullable: false },
    { name: 'report_date',              type: 'date',    nullable: false },
    { name: 'ticket_id',                type: 'string',  nullable: true  },
    { name: 'status',                   type: 'string',  nullable: false },
    { name: 'priority',                 type: 'string',  nullable: true  },
    { name: 'category',                 type: 'string',  nullable: true  },
    { name: 'resolution_time_minutes',  type: 'number',  nullable: true  },
    { name: 'import_id',                type: 'number',  nullable: true  },
    { name: 'created_at',               type: 'date',    nullable: false },
  ],
  email_stats_raw: [
    { name: 'id',                    type: 'number',  nullable: false },
    { name: 'user_id',               type: 'number',  nullable: false },
    { name: 'report_date',           type: 'date',    nullable: false },
    { name: 'emails_sent',           type: 'number',  nullable: false },
    { name: 'emails_received',       type: 'number',  nullable: false },
    { name: 'crm_contacts_updated',  type: 'number',  nullable: false },
    { name: 'bounces',               type: 'number',  nullable: false },
    { name: 'import_id',             type: 'number',  nullable: true  },
    { name: 'created_at',            type: 'date',    nullable: false },
  ],
};

// ── Types ─────────────────────────────────────────────────────────────────────

export interface QueryFilter {
  field: string;
  operator: 'equals' | 'notEquals' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'between' | 'in' | 'notNull' | 'null';
  value?: any;
}

export interface RawDataQueryParams {
  tableName: string;
  userId?: number;
  departmentId?: number;
  userRole: string;
  requestingUserId: number;
  startDate?: Date;
  endDate?: Date;
  filters?: QueryFilter[];
  groupBy?: string;
  columns?: string[];
  limit?: number;
  offset?: number;
}

export interface RawDataResult {
  rows: any[];
  total: number;
  columns: string[];
}

// ── Where clause builder ──────────────────────────────────────────────────────

function buildFilterClause(filter: QueryFilter): any {
  const { field, operator, value } = filter;

  switch (operator) {
    case 'equals':    return { [field]: { equals: value } };
    case 'notEquals': return { [field]: { not: value } };
    case 'gt':        return { [field]: { gt: value } };
    case 'gte':       return { [field]: { gte: value } };
    case 'lt':        return { [field]: { lt: value } };
    case 'lte':       return { [field]: { lte: value } };
    case 'contains':  return { [field]: { contains: String(value) } };
    case 'between':
      if (Array.isArray(value) && value.length === 2) {
        return { [field]: { gte: value[0], lte: value[1] } };
      }
      return {};
    case 'in':
      return { [field]: { in: Array.isArray(value) ? value : [value] } };
    case 'null':      return { [field]: null };
    case 'notNull':   return { [field]: { not: null } };
    default:          return {};
  }
}

/**
 * Resolve which user_ids this request is allowed to see,
 * respecting role-based scoping rules.
 *
 * Returns:
 *   null  → no user_id filter (see all)
 *   []    → empty set (see nothing)
 *   [ids] → specific set of allowed user_ids
 */
async function resolveAllowedUserIds(
  userRole: string,
  requestingUserId: number,
  targetUserId?: number,
  targetDepartmentId?: number,
): Promise<number[] | null> {

  // Admin / Director see all
  if (GLOBAL_ROLES.has(userRole)) {
    if (targetUserId) return [targetUserId];
    if (targetDepartmentId) {
      const users = await prisma.user.findMany({
        where: { department_id: targetDepartmentId, is_active: true },
        select: { id: true },
      });
      return users.map((u) => u.id);
    }
    return null; // no filter
  }

  // Manager / QA / Trainer — own department only
  if (DEPT_ROLES.has(userRole)) {
    const self = await prisma.user.findUnique({
      where: { id: requestingUserId },
      select: { department_id: true },
    });
    const deptId = targetDepartmentId ?? self?.department_id ?? null;

    if (!deptId) return [requestingUserId]; // no department → own data only

    const users = await prisma.user.findMany({
      where: { department_id: deptId, is_active: true },
      select: { id: true },
    });
    const deptUserIds = users.map((u) => u.id);

    if (targetUserId) {
      // Only allow if target is in same department
      return deptUserIds.includes(targetUserId) ? [targetUserId] : [];
    }
    return deptUserIds;
  }

  // CSR and all other roles — own data only
  return [requestingUserId];
}

async function buildWhereClause(
  params: RawDataQueryParams,
): Promise<any> {
  const where: any = {};

  // Role-scoped user_ids
  const allowedIds = await resolveAllowedUserIds(
    params.userRole,
    params.requestingUserId,
    params.userId,
    params.departmentId,
  );

  if (allowedIds !== null) {
    if (allowedIds.length === 0) return null; // signals "no access"
    where.user_id = { in: allowedIds };
  }

  // Date range on report_date
  if (params.startDate || params.endDate) {
    where.report_date = {};
    if (params.startDate) where.report_date.gte = params.startDate;
    if (params.endDate)   where.report_date.lte = params.endDate;
  }

  // Extra filters
  if (params.filters && params.filters.length > 0) {
    const filterClauses = params.filters.map(buildFilterClause);
    if (filterClauses.length === 1) {
      Object.assign(where, filterClauses[0]);
    } else {
      where.AND = [...(where.AND ?? []), ...filterClauses];
    }
  }

  return where;
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Paginated query with filters and role scoping. */
export async function queryRawData(params: RawDataQueryParams): Promise<RawDataResult> {
  const { tableName, limit = 100, offset = 0 } = params;

  if (!VALID_TABLES.includes(tableName)) {
    throw new Error(`Unknown table: ${tableName}`);
  }

  const model = TABLE_PRISMA_MAP[tableName] as unknown as PrismaModelDelegate;
  const schema = TABLE_SCHEMAS[tableName] ?? [];
  const allColumns = schema.map((c) => c.name);
  const selectedColumns = params.columns && params.columns.length > 0
    ? params.columns.filter((c) => allColumns.includes(c))
    : allColumns;

  const where = await buildWhereClause(params);
  if (where === null) return { rows: [], total: 0, columns: selectedColumns };

  const select = Object.fromEntries(selectedColumns.map((c) => [c, true]));

  const [total, rows] = await prisma.$transaction([
    model.count({ where }),
    model.findMany({
      where,
      select,
      skip: offset,
      take: Math.min(limit, 1000),
      orderBy: { report_date: 'desc' },
    }),
  ] as any) as [number, Record<string, unknown>[]];

  return { rows, total, columns: selectedColumns };
}

/** Return column schema for a raw data table. */
export function getTableSchema(tableName: string): ColumnSchema[] {
  if (!VALID_TABLES.includes(tableName)) {
    throw new Error(`Unknown table: ${tableName}`);
  }
  return TABLE_SCHEMAS[tableName] ?? [];
}

/** Return RawTableConfig records accessible to this role. */
export async function getAvailableTables(userRole: string) {
  // Non-admin roles only see is_active tables
  const where: any = { is_active: true };

  const configs = await prisma.rawTableConfig.findMany({
    where,
    orderBy: { display_name: 'asc' },
  });

  // Enrich with schema column count
  return configs.map((cfg) => ({
    ...cfg,
    column_count: (TABLE_SCHEMAS[cfg.table_name] ?? []).length,
    is_queryable: VALID_TABLES.includes(cfg.table_name),
  }));
}

// Excel sheet names are capped at 31 characters by the OOXML spec.
const SHEET_NAME_MAX = 31;

function buildRawDataWorkbook(
  tableName: string,
  selectedColumns: string[],
  serialisedRows: Record<string, unknown>[],
): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet(tableName.substring(0, SHEET_NAME_MAX));

  worksheet.columns = selectedColumns.map((c) => ({ header: c, key: c, width: 18 }));

  worksheet.getRow(1).font = { bold: true };
  worksheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'left' };

  for (const row of serialisedRows) worksheet.addRow(row);

  worksheet.views = [{ state: 'frozen', ySplit: 1 }];
  if (worksheet.columns.length > 0) {
    worksheet.autoFilter = {
      from: { row: 1, column: 1 },
      to:   { row: 1, column: worksheet.columns.length },
    };
  }

  return workbook;
}

async function workbookToBuffer(workbook: ExcelJS.Workbook): Promise<Buffer> {
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

/** Return all matching rows as an Excel buffer. Capped at 50,000 rows. */
export async function exportRawData(params: RawDataQueryParams): Promise<Buffer> {
  const { tableName } = params;

  if (!VALID_TABLES.includes(tableName)) {
    throw new Error(`Unknown table: ${tableName}`);
  }

  const model = TABLE_PRISMA_MAP[tableName] as unknown as PrismaModelDelegate;
  const schema = TABLE_SCHEMAS[tableName] ?? [];
  const allColumns = schema.map((c) => c.name);
  const selectedColumns = params.columns && params.columns.length > 0
    ? params.columns.filter((c) => allColumns.includes(c))
    : allColumns;

  const where = await buildWhereClause(params);
  if (where === null) {
    // Caller has no rows visible (e.g. role scope returned an empty set).
    // Still produce a valid workbook so downloads don't fail — header row only.
    return workbookToBuffer(buildRawDataWorkbook(tableName, selectedColumns, []));
  }

  const select = Object.fromEntries(selectedColumns.map((c) => [c, true]));

  const rows = await model.findMany({
    where,
    select,
    take: EXPORT_ROW_LIMIT,
    orderBy: { report_date: 'desc' },
  });

  // Convert Decimal / Date values to plain JS before serialising
  const serialised: Record<string, unknown>[] = rows.map((row: any) => {
    const out: Record<string, unknown> = {};
    for (const col of selectedColumns) {
      const v = row[col];
      if (v instanceof Date) {
        out[col] = `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
      } else if (v !== null && typeof v === 'object' && typeof v.toNumber === 'function') {
        out[col] = v.toNumber();
      } else {
        out[col] = v;
      }
    }
    return out;
  });

  return workbookToBuffer(buildRawDataWorkbook(tableName, selectedColumns, serialised));
}
