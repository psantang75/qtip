/**
 * Import Service
 * Handles Excel file parsing and insertion into raw data tables.
 * Users are matched by email address. Unmatched emails become warnings.
 *
 * Library choice: this is the only module in the backend that depends on
 * SheetJS. It is intentionally kept on the read side because
 * `XLSX.read` + `sheet_to_json` handle the long tail of upload formats
 * (legacy .xls, CSV, SYLK, ODS) that the rest of the system never has to
 * generate. All Excel **generation** paths use ExcelJS — see
 * `services/AnalyticsService.ts`, `services/coachingSessionsReport.ts`,
 * `services/rawDataService.ts`, and `controllers/manager.controller.ts`.
 * Pre-production review item #24 documents the read/write split.
 *
 * We import from `@e965/xlsx`, the community-maintained fork of SheetJS,
 * because the plain `xlsx` package on npm has not been published with
 * security fixes for some of its historical CVEs. `@e965/xlsx` preserves
 * the exact same API surface (`read`, `utils.sheet_to_json`), so swapping
 * is a pure package-name change (pre-production review item #84).
 */

import * as XLSX from '@e965/xlsx';
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
 * Every kind of workbook this service knows how to load. Declared here rather
 * than in the controller because `REQUIRED_COLUMNS` below is the real authority
 * on what a type means, and two lists that must agree eventually stop agreeing.
 */
export const DATA_TYPES = [
  'call_activity',
  'sales_margin',
  'lead_sales_margin',
  'lead_source',
  'ticket_task',
  'email_stats',
  'punch_data',
] as const;

export type DataType = typeof DATA_TYPES[number];

/**
 * Resolve a strict ingestion allowlist from a comma-separated env string
 * (e.g. `MAILBOX_IMPORT_ALLOWED_TYPES`, `IMPORT_ALLOWED_TYPES`). Tokens are
 * trimmed/lower-cased; anything that isn't a known {@link DataType} is dropped.
 * If the result is empty (unset, blank, or all-garbage) we fall back to
 * `defaults` so a typo can neither silently open the gate to every type nor
 * fully close it. Pure + exported for unit testing.
 *
 * Shared by both ingestion entry points (mailbox poller + manual Import Center)
 * so the "which report types may be ingested" rule lives in exactly one place.
 */
export function resolveAllowedDataTypes(
  raw: string | undefined,
  defaults: readonly DataType[],
): DataType[] {
  const known = DATA_TYPES as readonly string[];
  const parsed = (raw ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is DataType => known.includes(s));
  return parsed.length > 0 ? Array.from(new Set(parsed)) : [...defaults];
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

/** Collapse runs of whitespace and trim. Paychex emits "PTO -  Approved". */
function squish(val: any): string | null {
  if (val == null) return null;
  const s = String(val).replace(/\s+/g, ' ').trim();
  return s || null;
}

/**
 * "First Last" (lower-cased, whitespace-collapsed) to user id, for punch rows
 * Paychex sent without an Alert Email. A name shared by two users maps to null
 * rather than guessing — a punch on the wrong person's roster is worse than a
 * missing one, because it earns them points they can see and dispute.
 */
async function buildNameMap(): Promise<Map<string, number | null>> {
  const users = await prisma.user.findMany({ select: { id: true, username: true } });
  const map = new Map<string, number | null>();
  for (const u of users) {
    const key = u.username.replace(/\s+/g, ' ').trim().toLowerCase();
    if (!key) continue;
    map.set(key, map.has(key) ? null : u.id);
  }
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

/**
 * Parse a full date-time cell like "07/28/2026 08:00 AM" (Paychex punch export)
 * into a LOCAL Date (see date-handling rule). Also accepts already-parsed Date
 * objects and ISO strings. Returns null when unparseable.
 */
function parseDateTime(value: any): Date | null {
  if (value == null) return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;

  const s = String(value).trim();
  if (!s) return null;

  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s*([AP]M)?$/i);
  if (m) {
    let hh = +m[4];
    const ap = m[6]?.toUpperCase();
    if (ap === 'PM' && hh < 12) hh += 12;
    if (ap === 'AM' && hh === 12) hh = 0;
    return new Date(+m[3], +m[1] - 1, +m[2], hh, +m[5]);
  }

  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

/** Parse a time-only cell like "04:00 PM" into {h, m} (24h). Null if unparseable. */
function parseClockTime(value: any): { h: number; m: number } | null {
  if (value == null) return null;
  if (value instanceof Date && !isNaN(value.getTime())) {
    return { h: value.getHours(), m: value.getMinutes() };
  }
  const s = String(value).trim();
  const m = s.match(/^(\d{1,2}):(\d{2})\s*([AP]M)?$/i);
  if (!m) return null;
  let hh = +m[1];
  const ap = m[3]?.toUpperCase();
  if (ap === 'PM' && hh < 12) hh += 12;
  if (ap === 'AM' && hh === 12) hh = 0;
  return { h: hh, m: +m[2] };
}

/**
 * The Paychex "Actual Time Out" cell is time-only (no date). Combine it with the
 * punch-in date; if the resulting time is before punch-in, the shift crossed
 * midnight, so roll the date forward one day.
 */
function derivePunchOut(inAt: Date | null, timeOut: any): Date | null {
  const t = parseClockTime(timeOut);
  if (!t || !inAt) return null;
  let out = new Date(inAt.getFullYear(), inAt.getMonth(), inAt.getDate(), t.h, t.m);
  if (out.getTime() < inAt.getTime()) out = new Date(out.getTime() + 86400000);
  return out;
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
      } catch {
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

// ── importPunchData ───────────────────────────────────────────────────────────

/**
 * Paychex "employee-time-cards" punch export. One row per punch segment.
 * Expected Excel columns:
 *   Post ID, Alert Email, Actual Date/Time In, Regular Duration
 * Optional: Pay Type, First Name, Last Name, Punch Type In, Punch Type Out,
 *           Actual Time Out
 *
 * Identity is matched by `Alert Email`, falling back to an exact "First Last"
 * match against username when Paychex left the email blank — roughly one row in
 * eight, which used to vanish silently and read as absences. Rows that resolve
 * to neither are skipped and surfaced as warnings, never errors.
 *
 * `Pay Type` is what makes a Start Non-Work block self-describing ("PTO -
 * Approved" vs "Holiday"); scheduling derives excused exceptions from it.
 *
 * Dedup key is `Post ID`: the importer UPSERTS on it, so overlapping or re-sent
 * 14-day exports never duplicate and later Paychex edits heal in place.
 */
export async function importPunchData(
  buffer: Buffer,
  fileName: string,
  importedBy: number,
): Promise<ImportResult> {
  const REQUIRED = ['Post ID', 'Alert Email', 'Actual Date/Time In', 'Regular Duration'];
  const logId = await createImportLog('punch_data', fileName, importedBy);

  try {
    const rows = parseExcel(buffer);
    validateColumns(rows, REQUIRED);
    const [emailMap, nameMap] = await Promise.all([buildEmailMap(), buildNameMap()]);

    const warnings: string[] = [];
    const unmatchedEmails = new Set<string>();
    const unresolvedNames = new Set<string>();
    const seenPostIds = new Set<string>();
    let nameMatchedRows = 0;
    let unmatchedRows = 0;
    let errored = 0;
    const prepared: any[] = [];

    for (const row of rows) {
      try {
        const postId = str(row['Post ID']);
        if (!postId) throw new Error('Missing Post ID');
        // Guard against duplicate Post IDs within a single file (last wins).
        if (seenPostIds.has(postId)) {
          const dupIdx = prepared.findIndex(r => r.post_id === postId);
          if (dupIdx >= 0) prepared.splice(dupIdx, 1);
        }

        const email = str(row['Alert Email'])?.toLowerCase() ?? '';
        const fullName = squish(`${str(row['First Name']) ?? ''} ${str(row['Last Name']) ?? ''}`);

        let userId = email ? (emailMap.get(email) ?? null) : null;
        if (!userId && email) unmatchedEmails.add(email);
        if (!userId && fullName) {
          userId = nameMap.get(fullName.toLowerCase()) ?? null;
          if (userId) nameMatchedRows++;
        }
        if (!userId) {
          unmatchedRows++;
          if (!email && fullName) unresolvedNames.add(fullName);
          continue;
        }

        const punchInAt = parseDateTime(row['Actual Date/Time In']);
        const punchOutAt = derivePunchOut(punchInAt, row['Actual Time Out']);

        seenPostIds.add(postId);
        prepared.push({
          post_id: postId,
          user_id: userId,
          punch_in_at: punchInAt,
          punch_out_at: punchOutAt,
          punch_type_in: str(row['Punch Type In']),
          punch_type_out: str(row['Punch Type Out']),
          pay_type: squish(row['Pay Type']),
          regular_duration: num(row['Regular Duration'], true),
          import_id: logId,
        });
      } catch {
        errored++;
      }
    }

    // Upsert by post_id in chunked transactions — heals edits, never duplicates.
    let imported = 0;
    for (let i = 0; i < prepared.length; i += BATCH_SIZE) {
      const chunk = prepared.slice(i, i + BATCH_SIZE);
      await prisma.$transaction(
        chunk.map(rec =>
          prisma.punchRaw.upsert({
            where: { post_id: rec.post_id },
            create: rec,
            update: {
              user_id: rec.user_id,
              punch_in_at: rec.punch_in_at,
              punch_out_at: rec.punch_out_at,
              punch_type_in: rec.punch_type_in,
              punch_type_out: rec.punch_type_out,
              pay_type: rec.pay_type,
              regular_duration: rec.regular_duration,
              import_id: rec.import_id,
            },
          }),
        ),
      );
      imported += chunk.length;
    }

    if (nameMatchedRows > 0) {
      warnings.push(`${nameMatchedRows} row(s) had no usable Alert Email and were matched by name. Add the alert email in Paychex for these employees.`);
    }
    if (unresolvedNames.size > 0) {
      warnings.push(`${unresolvedNames.size} employee(s) had no Alert Email and no name match: ${[...unresolvedNames].slice(0, 10).join(', ')}${unresolvedNames.size > 10 ? '...' : ''}`);
    }
    if (unmatchedEmails.size > 0) {
      warnings.push(`${unmatchedEmails.size} email(s) not matched to any user: ${[...unmatchedEmails].slice(0, 10).join(', ')}${unmatchedEmails.size > 10 ? '...' : ''}`);
    }

    const result: ImportResult = {
      import_log_id: logId,
      rows_total: rows.length,
      rows_imported: imported,
      rows_skipped: unmatchedRows,
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

const REQUIRED_COLUMNS: Record<DataType, string[]> = {
  call_activity:      ['Email', 'ReportDate', 'CallsOffered', 'CallsHandled', 'HoldMinutes', 'LineMinutes'],
  sales_margin:       ['Email', 'ReportDate', 'OrderCount', 'Revenue', 'COGS', 'GrossMargin'],
  lead_sales_margin:  ['Email', 'ReportDate', 'LeadsAssigned', 'LeadsContacted', 'Orders', 'LeadRevenue', 'LeadMargin'],
  lead_source:        ['Email', 'ReportDate', 'SourceName', 'LeadsReceived', 'Converted'],
  ticket_task:        ['Email', 'ReportDate', 'Status'],
  email_stats:        ['Email', 'ReportDate', 'EmailsSent', 'EmailsReceived'],
  punch_data:         ['Post ID', 'Alert Email', 'Actual Date/Time In', 'Regular Duration'],
};

// Most imports carry the user identity in an `Email` column; the Paychex punch
// export uses `Alert Email`. Preview reads the right key per data type.
const EMAIL_COLUMN: Record<string, string> = {
  punch_data: 'Alert Email',
};

export interface DetectionResult {
  /** Null when the columns matched nothing, or matched ambiguously. */
  dataType: DataType | null;
  columns: string[];
  /** Plain-English reason detection failed, for the log. Null on success. */
  reason: string | null;
}

/**
 * Work out which kind of import a workbook is from its column headers alone.
 *
 * Exists for the mailbox poller, which has no human to ask. Every other caller
 * is told the type by whoever picked the file, and should keep doing that —
 * an explicit choice beats a good guess.
 *
 * A type qualifies only if EVERY one of its required columns is present, and
 * the most specific qualifying type wins. That tie-break is load-bearing rather
 * than decorative: `ticket_task` requires only Email/ReportDate/Status, so it is
 * a strict subset of several other types and would otherwise swallow them.
 * Anything still ambiguous is refused rather than guessed at, because guessing
 * wrong writes real rows into the wrong warehouse table.
 */
export function detectDataType(buffer: Buffer): DetectionResult {
  const rows = parseExcel(buffer);
  if (rows.length === 0) {
    return { dataType: null, columns: [], reason: 'The workbook has no data rows.' };
  }

  const columns = Object.keys(rows[0]);
  const present = new Set(columns);
  const qualifying = DATA_TYPES
    .map(type => ({ type, required: REQUIRED_COLUMNS[type] }))
    .filter(({ required }) => required.every(col => present.has(col)));

  if (qualifying.length === 0) {
    return {
      dataType: null,
      columns,
      reason: `No import type matches these columns: ${columns.join(', ')}`,
    };
  }

  const mostSpecific = Math.max(...qualifying.map(q => q.required.length));
  const best = qualifying.filter(q => q.required.length === mostSpecific);
  if (best.length > 1) {
    return {
      dataType: null,
      columns,
      reason: `Columns match more than one import type equally well: ${best.map(b => b.type).join(', ')}`,
    };
  }

  return { dataType: best[0].type, columns, reason: null };
}

export async function previewImport(
  buffer: Buffer,
  dataType: string,
): Promise<PreviewResult> {
  const rows = parseExcel(buffer);
  const required = REQUIRED_COLUMNS[dataType as DataType] ?? [];
  const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
  const missing = required.filter(c => !columns.includes(c));

  // Sample first 10 rows for preview
  const preview_rows = rows.slice(0, 10);

  // Email matching check on first 100 rows
  const emailKey = EMAIL_COLUMN[dataType] ?? 'Email';
  const emailMap = await buildEmailMap();
  const emailRows = rows.slice(0, 100);
  const checkedEmails = emailRows.map(r => str(r[emailKey])?.toLowerCase() ?? '').filter(Boolean);
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
