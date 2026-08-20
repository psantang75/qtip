/**
 * Polls the QTIP mailbox and loads any Excel report emailed to it.
 *
 * Same shape as DigestScheduler — a module-level `setInterval` with a `running`
 * guard — so operators have one mental model for background workers.
 *
 * A fixed interval rather than a 6am cron on purpose. The Paychex punch report
 * is scheduled daily at 6am, but it also gets re-run by hand during the day, and
 * an idle tick costs one cheap FindItems call that returns nothing. Being clever
 * about the clock would buy nothing and miss the manual re-runs.
 *
 * Idle ticks log nothing, so an hourly heartbeat reports that the poller is
 * alive — see `noteCheck`.
 *
 * Ordering within a tick is what keeps this safe:
 *   1. oldest message first, so the freshest copy of a repeated report lands last
 *   2. mark read BEFORE importing, which claims the message
 *   3. move to a subfolder after, so the Inbox is a queue and the folders are the record
 *
 * Nothing here deletes mail. A message this rejects stays in QTIP Failed for
 * somebody to look at.
 */

import logger from '../../config/logger';
import { config, mailboxImportConfig } from '../../config/environment';
import { detectDataType, resolveAllowedDataTypes, type DataType } from '../importService';
import { runImport } from '../imports/runImport';
import { ExchangeMailClient, type MailMessage } from './ExchangeMailClient';
import { isSenderAllowed, loadAllowedSenders, resolveImporter } from './senderAllowlist';
import { notifyIngestionFailure } from '../notifications/ingestionAlerts';

const FOLDER_PROCESSED = 'QTIP Processed';
const FOLDER_FAILED = 'QTIP Failed';
const MAX_MESSAGES_PER_TICK = 25;

/**
 * The report types the mailbox is allowed to ingest when nothing is configured.
 * In practice only the Paychex punch feed arrives by email — every other
 * `*_raw` dataset comes from the warehouse queries, not the inbox — and punches
 * are the one type that self-heals on re-import (`PunchRaw` upsert on
 * `post_id`). Keeping this strict means a stray or spoofed spreadsheet of any
 * other type can't inject rows into the raw tables via mail.
 */
const DEFAULT_MAILBOX_TYPES: readonly DataType[] = ['punch_data'];

/**
 * Resolve the strict mailbox type allowlist from `MAILBOX_IMPORT_ALLOWED_TYPES`,
 * defaulting to {@link DEFAULT_MAILBOX_TYPES}. Thin wrapper over the shared
 * {@link resolveAllowedDataTypes} so the mailbox and the manual Import Center
 * parse their allowlists identically. Exported for unit testing.
 */
export function resolveMailboxAllowedTypes(raw: string | undefined): DataType[] {
  return resolveAllowedDataTypes(raw, DEFAULT_MAILBOX_TYPES);
}

/**
 * How often the poller states that it is alive, whether or not mail arrived.
 * An hour is frequent enough to notice a dead timer the same morning, and rare
 * enough that a quiet weekend adds ~48 lines instead of ~1000.
 */
const HEARTBEAT_MINUTES = 60;

let intervalHandle: NodeJS.Timeout | null = null;
let running = false;
let warnedMissingAuthResults = false;

let heartbeat = { since: Date.now(), checks: 0, imported: 0, rejected: 0 };
let lastImportAt: Date | null = null;

export interface TickSummary {
  examined: number;
  imported: number;
  rejected: number;
  ignored: number;
}

export function startMailboxImportScheduler(): void {
  if (intervalHandle) return;
  if (!mailboxImportConfig.enabled) {
    logger.info('[MAILBOX] EXCHANGE_EWS_URL not set — inbound import poller disabled');
    return;
  }

  const tickMs = mailboxImportConfig.pollMinutes * 60 * 1000;
  // First tick on a short delay so a broken configuration shows up in stdout
  // near boot rather than ten minutes later.
  setTimeout(() => { void safeTick(); }, 30_000);
  intervalHandle = setInterval(() => { void safeTick(); }, tickMs);

  logger.info(
    `[MAILBOX] poller started for ${mailboxImportConfig.mailbox || '(mailbox unset)'}, ` +
    `every ${mailboxImportConfig.pollMinutes}min, dryRun=${mailboxImportConfig.dryRun}`,
  );
}

export function stopMailboxImportScheduler(): void {
  if (intervalHandle) clearInterval(intervalHandle);
  intervalHandle = null;
}

async function safeTick(): Promise<void> {
  try {
    await runOnce();
  } catch (err) {
    logger.error('[MAILBOX] tick failed', err);
  }
}

/**
 * Records one completed poll and, once an hour, says so out loud.
 *
 * A tick that finds nothing is otherwise silent, which leaves no way to tell a
 * healthy quiet mailbox from a timer that died hours ago. This is the only line
 * that proves the poller is still running.
 */
function noteCheck(summary: TickSummary): void {
  heartbeat.checks++;
  heartbeat.imported += summary.imported;
  heartbeat.rejected += summary.rejected;
  if (summary.imported > 0) lastImportAt = new Date();

  const elapsedMs = Date.now() - heartbeat.since;
  if (elapsedMs < HEARTBEAT_MINUTES * 60 * 1000) return;

  logger.info(
    `[MAILBOX] alive — ${heartbeat.checks} check(s) in the last ${Math.round(elapsedMs / 60_000)}min, ` +
    `${heartbeat.imported} imported, ${heartbeat.rejected} rejected. ` +
    `Last import: ${lastImportAt ? lastImportAt.toISOString() : 'none since startup'}`,
  );
  heartbeat = { since: Date.now(), checks: 0, imported: 0, rejected: 0 };
}

/** Floor date below which pre-existing mail is left alone entirely. */
function ignoreBefore(): Date | null {
  const raw = mailboxImportConfig.ignoreBefore;
  if (!raw) return null;
  const parsed = new Date(`${raw}T00:00:00`);
  return isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Whether the gateway's SPF/DKIM/DMARC verdict permits this message.
 *
 * Returns null when there is no verdict to read, which is the current state of
 * this mail server — it does not stamp Authentication-Results. That is reported
 * once and then tolerated, because the alternative is refusing every message.
 * The moment the gateway starts stamping the header, this begins enforcing it
 * with no code change.
 */
export function authVerdict(header: string | null): { ok: boolean; reason: string | null } {
  if (!header) {
    if (!warnedMissingAuthResults) {
      warnedMissingAuthResults = true;
      logger.warn(
        '[MAILBOX] mail carries no Authentication-Results header, so sender identity ' +
        'rests on the allowlist alone. Ask IT to enable DKIM/DMARC validation on the gateway.',
      );
    }
    return { ok: true, reason: null };
  }
  if (/\b(dmarc|dkim|spf)=pass\b/i.test(header)) return { ok: true, reason: null };
  return { ok: false, reason: `sender authentication did not pass: ${header.slice(0, 200)}` };
}

export async function runOnce(): Promise<TickSummary> {
  const empty: TickSummary = { examined: 0, imported: 0, rejected: 0, ignored: 0 };
  if (running) return empty;

  const client = ExchangeMailClient.fromConfig();
  if (!client) return empty;

  running = true;
  const summary = { ...empty };
  const { dryRun } = mailboxImportConfig;

  try {
    const messages = await client.findUnread(MAX_MESSAGES_PER_TICK);
    if (messages.length === 0) return summary;

    const allowed = await loadAllowedSenders();
    const floor = ignoreBefore();

    for (const message of messages) {
      if (floor && message.receivedAt < floor) {
        summary.ignored++;
        continue;
      }
      summary.examined++;

      const failure = await handleMessage(client, message, allowed, dryRun);
      if (failure) {
        summary.rejected++;
        logger.warn(`[MAILBOX] rejected "${message.subject}" from ${message.from}: ${failure}`);
        if (!dryRun) {
          await client.moveToFolder(message.id, FOLDER_FAILED);
          // A dry run is a rehearsal, not a real miss — only alert on live rejections.
          await notifyIngestionFailure({
            channel: 'email',
            name: message.subject || '(no subject)',
            code: message.from || 'unknown-sender',
            reason: failure,
            source: message.from,
            occurredAt: message.receivedAt,
          });
        }
      } else {
        summary.imported++;
        if (!dryRun) await client.moveToFolder(message.id, FOLDER_PROCESSED);
      }
    }

    if (summary.ignored > 0) {
      logger.info(`[MAILBOX] left ${summary.ignored} message(s) alone, received before the configured floor`);
    }
    logger.info(
      `[MAILBOX] tick complete${dryRun ? ' (DRY RUN — nothing imported or moved)' : ''}: ` +
      `examined=${summary.examined} imported=${summary.imported} rejected=${summary.rejected}`,
    );
    return summary;
  } finally {
    running = false;
    noteCheck(summary);
  }
}

/**
 * Vet and load one message. Returns null on success, or the reason it was
 * refused — the caller turns that into a log line and a folder move.
 */
async function handleMessage(
  client: ExchangeMailClient,
  message: MailMessage,
  allowed: Set<string>,
  dryRun: boolean,
): Promise<string | null> {
  if (!isSenderAllowed(message.from, allowed)) {
    return `sender ${message.from || '(none)'} is not on the import allowlist`;
  }

  const detail = await client.loadDetail(message.id);

  const verdict = authVerdict(detail.authenticationResults);
  if (!verdict.ok) return verdict.reason;

  if (detail.attachments.length === 0) {
    return detail.ignored.length > 0
      ? `no spreadsheet attachment (ignored: ${detail.ignored.join(', ')})`
      : 'no attachments';
  }

  // Work out every attachment's type before importing any of them, so a message
  // carrying one good file and one unrecognised one is refused whole rather than
  // half-loaded.
  const allowedTypes = resolveMailboxAllowedTypes(mailboxImportConfig.allowedTypesRaw);
  const planned: Array<{ name: string; buffer: Buffer; dataType: ReturnType<typeof detectDataType>['dataType'] }> = [];
  for (const attachment of detail.attachments) {
    if (attachment.content.length > config.MAX_FILE_SIZE) {
      return `${attachment.name} is ${attachment.content.length} bytes, over the ${config.MAX_FILE_SIZE} limit`;
    }
    let detected;
    try {
      detected = detectDataType(attachment.content);
    } catch (err) {
      return `${attachment.name} could not be read as a workbook: ${(err as Error).message}`;
    }
    if (!detected.dataType) return `${attachment.name}: ${detected.reason}`;
    // Strict type control: the mailbox only accepts what it's meant to (default
    // punch_data). Everything else comes from the warehouse queries, so a file
    // of any other type emailed in is refused whole to QTIP Failed.
    if (!allowedTypes.includes(detected.dataType)) {
      return `${attachment.name}: report type "${detected.dataType}" is not permitted via mailbox import (allowed: ${allowedTypes.join(', ')})`;
    }
    planned.push({ name: attachment.name, buffer: attachment.content, dataType: detected.dataType });
  }

  const importedBy = await resolveImporter(message.from, mailboxImportConfig.importedByUserId);
  if (importedBy === null) {
    return 'no user to attribute the import to — set MAILBOX_IMPORT_USER_ID';
  }

  if (dryRun) {
    for (const item of planned) {
      logger.info(
        `[MAILBOX] DRY RUN would import ${item.name} as ${item.dataType} ` +
        `from ${message.from}, credited to user ${importedBy}`,
      );
    }
    return null;
  }

  // Claim first: if this crashes mid-import the message is already read, so the
  // next tick will not load the same rows a second time.
  await client.markRead(message.id);

  for (const item of planned) {
    const result = await runImport(item.dataType!, item.buffer, item.name, importedBy, {
      kind: 'mailbox',
      from: message.from,
      subject: message.subject,
    });
    logger.info(
      `[MAILBOX] imported ${item.name} as ${item.dataType}: ` +
      `${result.rows_imported} rows (skipped ${result.rows_skipped}, errored ${result.rows_errored})` +
      (result.attendance ? `, rescored ${result.attendance.daysScored} attendance days` : ''),
    );
  }

  return null;
}
