/**
 * Import Service
 * Handles Excel file parsing and insertion into raw data tables.
 * Users are matched by email address. Unmatched emails become warnings.
 */

import * as XLSX from 'xlsx';
import prisma from '../config/prisma';

const BATCH_SIZE = 500;

// ── Shared helpers ────────────────────────────────────────────────────────────

export interface ImportResult {
  import_log_id: number;
  rows_total: number;
  rows_imported: number;
  rows_skipped: number;
  rows_errored: number;
  warnings: string[];
}

/**
 * Parse an Excel buffer into an array of row objects.
 * Uses the first sheet found. Returns raw: true to preserve negative values.
 */
function parseExcel(buffer: Buffer): Record<string, any>[] {
  // cellDates: true — parse Excel serial dates into JS Date objects
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error('No sheets found in Excel file');
  const worksheet = workbook.Sheets[sheetName];
  // raw: true — preserve negative numbers and exact values
  return XLSX.utils.sheet_to_json<Record<string, any>>(worksheet, {
    raw: true,
    defval: null,
  });
}

/**
 * Validate that all required column names are present in the first data row.
 */
function validateColumns(rows: Record<string, any>[], required: string[]): void {
  if (rows.length === 0) throw new Error('Excel file contains no data rows');
  const found = Object.keys(rows[0]);
  const missing = required.filter(col => !found.includes(col));
  if (missing.length > 0) {
    throw new Error(`Missing required columns: ${missing.join(', ')}. Found: ${found.join(', ')}`);
  }
}

/**
 * Build an email → user_id map from the users table.
 */
async function buildEmailMap(): Promise<Map<string, number>> {
  const users = await prisma.user.findMany({
    select: { id: true, email: true },
  });
  const map = new Map<string, number>();
  users.forEach(u => map.set(u.email.toLowerCase().trim(), u.id));
  return map;
}

/**
 * Parse a date value from an Excel cell (Date object, serial number, or string).
 * Returns a UTC-midnight Date or null.
 */
function parseDate(value: any): Date | null {
  if (value == null) return null;

  if (value instanceof Date) {
    if (isNaN(value.getTime())) return null;
    return new Date(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()));
  }

  if (typeof value === 'number' && value >= 1 && value <= 2958465) {
    // Excel serial date
    const excelEpoch = new Date(1899, 11, 30);
    const d = new Date(excelEpoch.getTime() + value * 86400000);
    return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  }

  if (typeof value === 'string') {
    const t = value.trim();
    if (!t || t === '0001-01-01') return null;

    const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return new Date(Date.UTC(+iso[1], +iso[2] - 1, +iso[3]));

    const mdy = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (mdy) return new Date(Date.UTC(+mdy[3], +mdy[1] - 1, +mdy[2]));

    const d = new Date(t);
    if (!isNaN(d.getTime())) {
      return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    }
  }

  return null;
}

/** Safe numeric parse — returns 0 for null/NaN/negative values (unless allowNegative). */
function num(val: any, allowNegative = false): number {
  const n = parseFloat(String(val ?? 0));
  if (isNaN(n)) return 0;
  if (!allowNegative && n < 0) return 0;
  return n;
}

/** Safe integer parse. */
function int(val: any): number {
  const n = parseInt(String(val ?? 0), 10);
  return isNaN(n) ? 0 : n;
}

/** Safe string trim, null if empty. */
function str(val: any): string | null {
  if (val == null) return null;
  const s = String(val).trim();
  return s || null;
}

// ── Create / finalise ImportLog helpers ──────────────────────────────────────

async function createImportLog(
  dataType: string,
  fileName: string,
  importedBy: number,
): Promise<number> {
  const log = await prisma.importLog.create({
    data: {
      data_type: dataType,
      file_name: fileName,
      imported_by: importedBy,
      status: 'PENDING',
    },
  });
  return log.id;
}

async function finaliseImportLog(
  logId: number,
  result: Omit<ImportResult, 'import_log_id'>,
  errorDetails: any = null,
): Promise<void> {
  await prisma.importLog.update({
    where: { id: logId },
    data: {
      status: 'COMPLETE',
      rows_imported: result.rows_imported,
      rows_skipped: result.rows_skipped,
      rows_errored: result.rows_errored,
      error_details: errorDetails,
    },
  });
}

async function failImportLog(logId: number, error: unknown): Promise<void> {
  await prisma.importLog.update({
    where: { id: logId },
    data: {
      status: 'FAILED',
      error_details: {
        message: error instanceof Error ? error.message : String(error),
      },
    },
  }).catch(() => {/* best-effort */});
}

// ── importCallActivity ────────────────────────────────────────────────────────

/**
 * Expected Excel columns:
 *   Email, ReportDate, CallsOffered, CallsHandled,
 *   HoldMinutes, LineMinutes, WrapMinutes
 */
export async function importCallActivity(
  buffer: Buffer,
  fileName: string,
  importedBy: number,
): Promise<ImportResult> {
  const REQUIRED = ['Email', 'ReportDate', 'CallsOffered', 'CallsHandled', 'HoldMinutes', 'LineMinutes'];
  const logId = await createImportLog('call_activity', fileName, importedBy);

  try {
    const rows = parseExcel(buffer);
    validateColumns(rows, REQUIRED);
    const emailMap = await buildEmailMap();

    const warnings: string[] = [];
    const unmatchedEmails = new Set<string>();
    const records: any[] = [];
    let errored = 0;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      try {
        const email = str(row['Email'])?.toLowerCase() ?? '';
        const reportDate = parseDate(row['ReportDate']);
        if (!reportDate) throw new Error(`Invalid ReportDate: ${row['ReportDate']}`);

        const userId = email ? (emailMap.get(email) ?? null) : null;
        if (email && !userId) unmatchedEmails.add(email);

        records.push({
          user_id: userId ?? 0,
          report_date: reportDate,
          calls_offered: int(row['CallsOffered']),
          calls_handled: int(row['CallsHandled']),
          hold_minutes: num(row['HoldMinutes']),
          line_minutes: num(row['LineMinutes']),
          wrap_minutes: num(row['WrapMinutes']),
          import_id: logId,
        });
      } catch (e) {
        errored++;
      }
    }

    // Only insert rows where user was matched
    const matched = records.filter(r => r.user_id !== 0);
    const skipped = records.filter(r => r.user_id === 0).length;

    for (let i = 0; i < matched.length; i += BATCH_SIZE) {
      await prisma.callActivityRaw.createMany({ data: matched.slice(i, i + BATCH_SIZE) });
    }

    if (unmatchedEmails.size > 0) {
      warnings.push(`${unmatchedEmails.size} email(s) not matched to any user: ${[...unmatchedEmails].slice(0, 10).join(', ')}${unmatchedEmails.size > 10 ? '...' : ''}`);
    }

    const result: ImportResult = {
      import_log_id: logId,
      rows_total: rows.length,
      rows_imported: matched.length,
      rows_skipped: skipped,
      rows_errored: errored,
      warnings,
    };
    await finaliseImportLog(logId, result, warnings.length ? { warnings } : null);
    return result;
  } catch (err) {
    await failImportLog(logId, err);
    throw err;
  }
}

// ── importSalesMargin ─────────────────────────────────────────────────────────

/**
 * Expected Excel columns:
 *   Email, ReportDate, OrderCount, Revenue, COGS, GrossMargin
 * Optional: ProductCategory
 */
export async function importSalesMargin(
  buffer: Buffer,
  fileName: string,
  importedBy: number,
): Promise<ImportResult> {
  const REQUIRED = ['Email', 'ReportDate', 'OrderCount', 'Revenue', 'COGS', 'GrossMargin'];
  const logId = await createImportLog('sales_margin', fileName, importedBy);

  try {
    const rows = parseExcel(buffer);
    validateColumns(rows, REQUIRED);
    const emailMap = await buildEmailMap();

    const warnings: string[] = [];
    const unmatchedEmails = new Set<string>();
    const records: any[] = [];
    let errored = 0;

    for (const row of rows) {
      try {
        const email = str(row['Email'])?.toLowerCase() ?? '';
        const reportDate = parseDate(row['ReportDate']);
        if (!reportDate) throw new Error(`Invalid ReportDate`);

        const userId = email ? (emailMap.get(email) ?? null) : null;
        if (email && !userId) unmatchedEmails.add(email);

        records.push({
          user_id: userId ?? 0,
          report_date: reportDate,
          order_count: int(row['OrderCount']),
          revenue: num(row['Revenue'], true),
          cogs: num(row['COGS'], true),
          gross_margin: num(row['GrossMargin'], true),
          product_category: str(row['ProductCategory']),
          import_id: logId,
        });
      } catch {
        errored++;
      }
    }

    const matched = records.filter(r => r.user_id !== 0);
    const skipped = records.filter(r => r.user_id === 0).length;

    for (let i = 0; i < matched.length; i += BATCH_SIZE) {
      await prisma.salesMarginRaw.createMany({ data: matched.slice(i, i + BATCH_SIZE) });
    }

    if (unmatchedEmails.size > 0) {
      warnings.push(`${unmatchedEmails.size} email(s) not matched: ${[...unmatchedEmails].slice(0, 10).join(', ')}${unmatchedEmails.size > 10 ? '...' : ''}`);
    }

    const result: ImportResult = {
      import_log_id: logId,
      rows_total: rows.length,
      rows_imported: matched.length,
      rows_skipped: skipped,
      rows_errored: errored,
      warnings,
    };
    await finaliseImportLog(logId, result, warnings.length ? { warnings } : null);
    return result;
  } catch (err) {
    await failImportLog(logId, err);
    throw err;
  }
}

// ── importLeadSalesMargin ─────────────────────────────────────────────────────

/**
 * Expected Excel columns:
 *   Email, ReportDate, LeadsAssigned, LeadsContacted, Orders, LeadRevenue, LeadMargin
 */
export async function importLeadSalesMargin(
  buffer: Buffer,
  fileName: string,
  importedBy: number,
): Promise<ImportResult> {
  const REQUIRED = ['Email', 'ReportDate', 'LeadsAssigned', 'LeadsContacted', 'Orders', 'LeadRevenue', 'LeadMargin'];
  const logId = await createImportLog('lead_sales_margin', fileName, importedBy);

  try {
    const rows = parseExcel(buffer);
    validateColumns(rows, REQUIRED);
    const emailMap = await buildEmailMap();

    const warnings: string[] = [];
    const unmatchedEmails = new Set<string>();
    const records: any[] = [];
    let errored = 0;

    for (const row of rows) {
      try {
        const email = str(row['Email'])?.toLowerCase() ?? '';
        const reportDate = parseDate(row['ReportDate']);
        if (!reportDate) throw new Error(`Invalid ReportDate`);

        const userId = email ? (emailMap.get(email) ?? null) : null;
        if (email && !userId) unmatchedEmails.add(email);

        records.push({
          user_id: userId ?? 0,
          report_date: reportDate,
          leads_assigned: int(row['LeadsAssigned']),
          leads_contacted: int(row['LeadsContacted']),
          orders: int(row['Orders']),
          lead_revenue: num(row['LeadRevenue'], true),
          lead_margin: num(row['LeadMargin'], true),
          import_id: logId,
        });
      } catch {
        errored++;
      }
    }

    const matched = records.filter(r => r.user_id !== 0);
    const skipped = records.filter(r => r.user_id === 0).length;

    for (let i = 0; i < matched.length; i += BATCH_SIZE) {
      await prisma.leadSalesMarginRaw.createMany({ data: matched.slice(i, i + BATCH_SIZE) });
    }

    if (unmatchedEmails.size > 0) {
      warnings.push(`${unmatchedEmails.size} email(s) not matched: ${[...unmatchedEmails].slice(0, 10).join(', ')}${unmatchedEmails.size > 10 ? '...' : ''}`);
    }

    const result: ImportResult = {
      import_log_id: logId,
      rows_total: rows.length,
      rows_imported: matched.length,
      rows_skipped: skipped,
      rows_errored: errored,
      warnings,
    };
    await finaliseImportLog(logId, result, warnings.length ? { warnings } : null);
    return result;
  } catch (err) {
    await failImportLog(logId, err);
    throw err;
  }
}

// ── importLeadSource ──────────────────────────────────────────────────────────

/**
 * Expected Excel columns:
 *   Email, ReportDate, SourceName, LeadsReceived, Converted, ConversionRate
 */
export async function importLeadSource(
  buffer: Buffer,
  fileName: string,
  importedBy: number,
): Promise<ImportResult> {
  const REQUIRED = ['Email', 'ReportDate', 'SourceName', 'LeadsReceived', 'Converted'];
  const logId = await createImportLog('lead_source', fileName, importedBy);

  try {
    const rows = parseExcel(buffer);
    validateColumns(rows, REQUIRED);
    const emailMap = await buildEmailMap();

    const warnings: string[] = [];
    const unmatchedEmails = new Set<string>();
    const records: any[] = [];
    let errored = 0;

    for (const row of rows) {
      try {
        const email = str(row['Email'])?.toLowerCase() ?? '';
        const reportDate = parseDate(row['ReportDate']);
        if (!reportDate) throw new Error(`Invalid ReportDate`);

        const userId = email ? (emailMap.get(email) ?? null) : null;
        if (email && !userId) unmatchedEmails.add(email);

        const leadsReceived = int(row['LeadsReceived']);
        const converted = int(row['Converted']);
        // Calculate conversion rate if not supplied
        const conversionRate = row['ConversionRate'] != null
          ? num(row['ConversionRate'])
          : leadsReceived > 0 ? +(converted / leadsReceived).toFixed(4) : 0;

        records.push({
          user_id: userId ?? 0,
          report_date: reportDate,
          source_name: str(row['SourceName']) ?? 'Unknown',
          leads_received: leadsReceived,
          converted,
          conversion_rate: conversionRate,
          import_id: logId,
        });
      } catch {
        errored++;
      }
    }

    const matched = records.filter(r => r.user_id !== 0);
    const skipped = records.filter(r => r.user_id === 0).length;

    for (let i = 0; i < matched.length; i += BATCH_SIZE) {
      await prisma.leadSourceRaw.createMany({ data: matched.slice(i, i + BATCH_SIZE) });
    }

    if (unmatchedEmails.size > 0) {
      warnings.push(`${unmatchedEmails.size} email(s) not matched: ${[...unmatchedEmails].slice(0, 10).join(', ')}${unmatchedEmails.size > 10 ? '...' : ''}`);
    }

    const result: ImportResult = {
      import_log_id: logId,
      rows_total: rows.length,
      rows_imported: matched.length,
      rows_skipped: skipped,
      rows_errored: errored,
      warnings,
    };
    await finaliseImportLog(logId, result, warnings.length ? { warnings } : null);
    return result;
  } catch (err) {
    await failImportLog(logId, err);
    throw err;
  }
}

// ── importTicketTask ──────────────────────────────────────────────────────────

/**
 * Expected Excel columns:
 *   Email, ReportDate, Status
 * Optional: TicketId, Priority, Category, ResolutionTimeMinutes
 */
export async function importTicketTask(
  buffer: Buffer,
  fileName: string,
  importedBy: number,
): Promise<ImportResult> {
  const REQUIRED = ['Email', 'ReportDate', 'Status'];
  const logId = await createImportLog('ticket_task', fileName, importedBy);

  try {
    const rows = parseExcel(buffer);
    validateColumns(rows, REQUIRED);
    const emailMap = await buildEmailMap();

    const warnings: string[] = [];
    const unmatchedEmails = new Set<string>();
    const records: any[] = [];
    let errored = 0;

    for (const row of rows) {
      try {
        const email = str(row['Email'])?.toLowerCase() ?? '';
        const reportDate = parseDate(row['ReportDate']);
        if (!reportDate) throw new Error(`Invalid ReportDate`);

        const status = str(row['Status']);
        if (!status) throw new Error('Status is required');

        const userId = email ? (emailMap.get(email) ?? null) : null;
        if (email && !userId) unmatchedEmails.add(email);

        records.push({
          user_id: userId ?? 0,
          report_date: reportDate,
          ticket_id: str(row['TicketId']) ?? str(row['TicketID']),
          status,
          priority: str(row['Priority']),
          category: str(row['Category']),
          resolution_time_minutes: row['ResolutionTimeMinutes'] != null
            ? int(row['ResolutionTimeMinutes'])
            : null,
          import_id: logId,
        });
      } catch {
        errored++;
      }
    }

    const matched = records.filter(r => r.user_id !== 0);
    const skipped = records.filter(r => r.user_id === 0).length;

    for (let i = 0; i < matched.length; i += BATCH_SIZE) {
      await prisma.ticketTaskRaw.createMany({ data: matched.slice(i, i + BATCH_SIZE) });
    }

    if (unmatchedEmails.size > 0) {
      warnings.push(`${unmatchedEmails.size} email(s) not matched: ${[...unmatchedEmails].slice(0, 10).join(', ')}${unmatchedEmails.size > 10 ? '...' : ''}`);
    }

    const result: ImportResult = {
      import_log_id: logId,
      rows_total: rows.length,
      rows_imported: matched.length,
      rows_skipped: skipped,
      rows_errored: errored,
      warnings,
    };
    await finaliseImportLog(logId, result, warnings.length ? { warnings } : null);
    return result;
  } catch (err) {
    await failImportLog(logId, err);
    throw err;
  }
}

// ── importEmailStats ──────────────────────────────────────────────────────────

/**
 * Expected Excel columns:
 *   Email, ReportDate, EmailsSent, EmailsReceived, CRMContactsUpdated, Bounces
 * The Email column is the mailbox address — it IS the identity key for matching.
 */
export async function importEmailStats(
  buffer: Buffer,
  fileName: string,
  importedBy: number,
): Promise<ImportResult> {
  const REQUIRED = ['Email', 'ReportDate', 'EmailsSent', 'EmailsReceived'];
  const logId = await createImportLog('email_stats', fileName, importedBy);

  try {
    const rows = parseExcel(buffer);
    validateColumns(rows, REQUIRED);
    const emailMap = await buildEmailMap();

    const warnings: string[] = [];
    const unmatchedEmails = new Set<string>();
    const records: any[] = [];
    let errored = 0;

    for (const row of rows) {
      try {
        const email = str(row['Email'])?.toLowerCase() ?? '';
        const reportDate = parseDate(row['ReportDate']);
        if (!reportDate) throw new Error(`Invalid ReportDate`);

        const userId = email ? (emailMap.get(email) ?? null) : null;
        if (email && !userId) unmatchedEmails.add(email);

        records.push({
          user_id: userId ?? 0,
          report_date: reportDate,
          emails_sent: int(row['EmailsSent']),
          emails_received: int(row['EmailsReceived']),
          crm_contacts_updated: int(row['CRMContactsUpdated']),
          bounces: int(row['Bounces']),
          import_id: logId,
        });
      } catch {
        errored++;
      }
    }

    const matched = records.filter(r => r.user_id !== 0);
    const skipped = records.filter(r => r.user_id === 0).length;

    for (let i = 0; i < matched.length; i += BATCH_SIZE) {
      await prisma.emailStatsRaw.createMany({ data: matched.slice(i, i + BATCH_SIZE) });
    }

    if (unmatchedEmails.size > 0) {
      warnings.push(`${unmatchedEmails.size} email(s) not matched: ${[...unmatchedEmails].slice(0, 10).join(', ')}${unmatchedEmails.size > 10 ? '...' : ''}`);
    }

    const result: ImportResult = {
      import_log_id: logId,
      rows_total: rows.length,
      rows_imported: matched.length,
      rows_skipped: skipped,
      rows_errored: errored,
      warnings,
    };
    await finaliseImportLog(logId, result, warnings.length ? { warnings } : null);
    return result;
  } catch (err) {
    await failImportLog(logId, err);
    throw err;
  }
}

// ── Preview helper (used by controller) ──────────────────────────────────────

export interface PreviewResult {
  columns: string[];
  preview_rows: Record<string, any>[];
  total_rows: number;
  email_match_summary: {
    checked: number;
    matched: number;
    unmatched: number;
    unmatched_emails: string[];
  };
  column_check: {
    data_type: string;
    required: string[];
    missing: string[];
    valid: boolean;
  };
}

const REQUIRED_COLUMNS: Record<string, string[]> = {
  call_activity:      ['Email', 'ReportDate', 'CallsOffered', 'CallsHandled', 'HoldMinutes', 'LineMinutes'],
  sales_margin:       ['Email', 'ReportDate', 'OrderCount', 'Revenue', 'COGS', 'GrossMargin'],
  lead_sales_margin:  ['Email', 'ReportDate', 'LeadsAssigned', 'LeadsContacted', 'Orders', 'LeadRevenue', 'LeadMargin'],
  lead_source:        ['Email', 'ReportDate', 'SourceName', 'LeadsReceived', 'Converted'],
  ticket_task:        ['Email', 'ReportDate', 'Status'],
  email_stats:        ['Email', 'ReportDate', 'EmailsSent', 'EmailsReceived'],
};

export async function previewImport(
  buffer: Buffer,
  dataType: string,
): Promise<PreviewResult> {
  const rows = parseExcel(buffer);
  const required = REQUIRED_COLUMNS[dataType] ?? [];
  const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
  const missing = required.filter(c => !columns.includes(c));

  // Sample first 10 rows for preview
  const preview_rows = rows.slice(0, 10);

  // Email matching check on first 100 rows
  const emailMap = await buildEmailMap();
  const emailRows = rows.slice(0, 100);
  const checkedEmails = emailRows.map(r => str(r['Email'])?.toLowerCase() ?? '').filter(Boolean);
  const matchedCount = checkedEmails.filter(e => emailMap.has(e)).length;
  const unmatched = [...new Set(checkedEmails.filter(e => !emailMap.has(e)))];

  return {
    columns,
    preview_rows,
    total_rows: rows.length,
    email_match_summary: {
      checked: checkedEmails.length,
      matched: matchedCount,
      unmatched: unmatched.length,
      unmatched_emails: unmatched.slice(0, 20),
    },
    column_check: {
      data_type: dataType,
      required,
      missing,
      valid: missing.length === 0,
    },
  };
}
