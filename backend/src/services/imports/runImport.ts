/**
 * One place that turns a workbook into loaded rows, whoever supplied it.
 *
 * Both entry points need identical behaviour — a file uploaded at
 * Admin > Manual Upload and the same file emailed to the QTIP mailbox must land
 * the same way, including the attendance rescore that punches trigger. This
 * module exists so there is one implementation of that rather than two that
 * agree until somebody edits one of them.
 *
 * The dispatch table and the rescore both used to live privately inside
 * `controllers/importController.ts`; the controller is now a thin HTTP wrapper
 * over `runImport`.
 */

import prisma from '../../config/prisma';
import logger from '../../config/logger';
import {
  DATA_TYPES,
  type DataType,
  type ImportResult,
  importCallActivity,
  importSalesMargin,
  importLeadSalesMargin,
  importLeadSource,
  importTicketTask,
  importEmailStats,
  importPunchData,
} from '../importService';
import { recomputeRange } from '../attendance/attendance.engine';
import { getPunchWatermark } from '../attendance/punchProvider';
import { queueThresholdCrossings } from '../attendance/attendance.notify';
import { addDays } from '../scheduling/schedule.dates';
import { deriveTimeOffExceptions } from '../scheduling/timeOff.derive.service';
import { notifyIngestionFailure } from '../notifications/ingestionAlerts';

// One rolling window. Anything older than this has already rolled out of every
// live point total, so rescoring it would cost time and change nothing visible.
const RESCORE_WINDOW_DAYS = 90;

type ImportHandler = (
  buffer: Buffer,
  fileName: string,
  importedBy: number,
) => Promise<ImportResult>;

const HANDLERS: Record<DataType, ImportHandler> = {
  call_activity:     importCallActivity,
  sales_margin:      importSalesMargin,
  lead_sales_margin: importLeadSalesMargin,
  lead_source:       importLeadSource,
  ticket_task:       importTicketTask,
  email_stats:       importEmailStats,
  punch_data:        importPunchData,
};

export interface AttendanceRescore {
  daysScored: number;
  occurrences: number;
  exceptionsDerived: number;
}

/** Where a file came from, when it was not a person clicking Upload. */
export interface ImportSource {
  kind: 'mailbox';
  from: string;
  subject: string;
}

export interface RunImportResult extends ImportResult {
  attendance?: AttendanceRescore;
}

export function isDataType(value: unknown): value is DataType {
  return typeof value === 'string' && (DATA_TYPES as readonly string[]).includes(value);
}

/**
 * Rescore attendance over the rolling window after a punch import, then queue any
 * new discipline-threshold crossings.
 *
 * Time-off exceptions are derived FIRST. The Non-Work blocks that prove somebody
 * was on approved PTO arrive in the same file as the punches, so scoring before
 * deriving would charge points for leave the file itself excuses, then quietly
 * clear them on the next import.
 *
 * The window is deliberately wider than the file: Paychex exports overlap and heal
 * earlier punches in place, so a correction to a three-week-old punch must re-score
 * that day too. Failures are logged and swallowed — a rescore problem must not turn
 * a successful import into a failure.
 */
async function rescoreAfterPunchImport(): Promise<AttendanceRescore | undefined> {
  try {
    const watermark = await getPunchWatermark();
    if (!watermark) return undefined;
    const from = addDays(watermark, -(RESCORE_WINDOW_DAYS - 1));
    const derived = await deriveTimeOffExceptions(from, watermark);
    const result = await recomputeRange(from, watermark);
    await queueThresholdCrossings(result.to);
    return {
      daysScored: result.daysScored,
      occurrences: result.occurrences,
      exceptionsDerived: derived.created,
    };
  } catch (err) {
    logger.error('[IMPORT] attendance rescore after punch import failed:', err);
    return undefined;
  }
}

/**
 * Record on the ImportLog that this run came from the mailbox rather than a
 * person, so the history page can tell them apart. Written after the fact
 * because the import functions own the log's whole lifecycle; a failure here is
 * cosmetic and must not fail an import whose rows already landed.
 */
async function stampSource(
  importLogId: number,
  source: ImportSource,
  warnings: string[],
): Promise<void> {
  try {
    await prisma.importLog.update({
      where: { id: importLogId },
      data: {
        error_details: {
          source: source.kind,
          from: source.from,
          subject: source.subject,
          warnings,
        },
      },
    });
  } catch (err) {
    logger.warn('[IMPORT] could not stamp import source', { importLogId, err });
  }
}

/**
 * Load a workbook of the given type and run whatever has to follow it.
 *
 * @param importedBy user credited on the ImportLog row
 * @param source     set only for non-interactive callers, e.g. the mailbox poller
 */
export async function runImport(
  dataType: DataType,
  buffer: Buffer,
  fileName: string,
  importedBy: number,
  source?: ImportSource,
): Promise<RunImportResult> {
  let result: ImportResult;
  try {
    result = await HANDLERS[dataType](buffer, fileName, importedBy);
  } catch (err) {
    // The row is already marked FAILED by the handler (failImportLog); alert
    // admins here where we still know the file, type, and origin. Whether it
    // came by mail or a person's upload decides the channel.
    await notifyIngestionFailure({
      channel: source ? 'email' : 'manual',
      name: fileName,
      code: dataType,
      reason: err instanceof Error ? err.message : String(err),
      source: source?.from,
    });
    throw err;
  }

  if (source) await stampSource(result.import_log_id, source, result.warnings);

  // New punches change attendance, so rescore. Orchestrated HERE rather than
  // inside importService: that service is a generic multi-type importer, and
  // teaching it about attendance would couple two unrelated domains.
  const attendance = dataType === 'punch_data' ? await rescoreAfterPunchImport() : undefined;

  return { ...result, ...(attendance ? { attendance } : {}) };
}
