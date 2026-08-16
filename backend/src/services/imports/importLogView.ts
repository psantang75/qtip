/**
 * Shared read-side helpers for presenting `import_logs` rows alongside the
 * Insights Engine's `ie_ingestion_log`. Both feed the Admin > Insights views
 * (Report Schedules email feeds, Ingestion Log), so the mapping from an
 * ImportLog to the unified vocabulary lives here once rather than in each
 * controller that reads it.
 */

/** The three ingestion channels surfaced in the admin UI. */
export type IngestionChannel = 'sql' | 'email' | 'manual';

/**
 * Collapse ImportLog's lifecycle statuses onto the same vocabulary the
 * ie_ingestion_log uses, so one status filter and one set of badge colours
 * cover both. PENDING/PROCESSING read as RUNNING; COMPLETE reads as SUCCESS.
 */
export function normalizeImportStatus(status: string): string {
  switch (status) {
    case 'COMPLETE':
      return 'SUCCESS';
    case 'PENDING':
    case 'PROCESSING':
      return 'RUNNING';
    default:
      return status; // FAILED passes through unchanged
  }
}

/**
 * Where an Excel import came from. The mailbox poller stamps
 * `error_details.source = 'mailbox'` (see imports/runImport `stampSource`);
 * anything without that marker was a person clicking Upload.
 */
export function importChannel(errorDetails: unknown): Exclude<IngestionChannel, 'sql'> {
  const source = (errorDetails as { source?: string } | null)?.source;
  return source === 'mailbox' ? 'email' : 'manual';
}

/**
 * Best human-readable line for a failed/warned import. Prefers the failure
 * message, falls back to concatenated warnings, else null.
 */
export function importDetailMessage(errorDetails: unknown): string | null {
  const details = errorDetails as { message?: string; warnings?: unknown } | null;
  if (details?.message) return details.message;
  if (Array.isArray(details?.warnings) && details.warnings.length > 0) {
    return details.warnings.join(' ');
  }
  return null;
}
