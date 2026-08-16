/**
 * Fire an admin alert when a data ingestion fails, whatever the channel.
 *
 * The three ingestion paths all reach the same email so operators watch one
 * place: the SQL source-report pipeline, the mailbox email pickup, and the
 * manual Excel upload. Recipients are the "Alert Recipients" list by default
 * (List Management > Notifications), with "All admins" toggleable on the
 * template — the resolution is handled by NotificationService.
 *
 * `entityId` folds channel + code + calendar day together so repeated failures
 * of the same feed on the same day dedupe to one mail rather than a flood; the
 * NotificationService rate-limit and circuit-breaker are the second line.
 *
 * Never throws — an alert that can't be sent must not turn a logged failure
 * into a crash in a background worker.
 */

import notificationService from './NotificationService';
import logger from '../../config/logger';

export type IngestionFailureChannel = 'sql' | 'email' | 'manual';

export interface IngestionFailureInput {
  /** Which ingestion path failed. */
  channel: IngestionFailureChannel;
  /** Human name of the feed/report/file (e.g. "Paychex Punch Data"). */
  name: string;
  /** Stable machine code used for dedupe (report_code / data_type / sender). */
  code: string;
  /** Plain-English reason it failed. */
  reason: string;
  /** Optional origin — the sending address or source system. */
  source?: string | null;
  /** Defaults to now. */
  occurredAt?: Date;
}

const CHANNEL_LABEL: Record<IngestionFailureChannel, string> = {
  sql: 'Report ingestion',
  email: 'Email pickup',
  manual: 'Manual upload',
};

export async function notifyIngestionFailure(input: IngestionFailureInput): Promise<void> {
  const occurredAt = input.occurredAt ?? new Date();
  const day = occurredAt.toISOString().slice(0, 10);

  try {
    await notificationService.notify(
      'system.ingestion_failed',
      {
        channel: input.channel,
        channelLabel: CHANNEL_LABEL[input.channel],
        name: input.name,
        code: input.code,
        reason: input.reason,
        source: input.source ?? null,
        occurredAt: occurredAt.toISOString(),
      },
      {
        entityType: 'ingestion_failure',
        entityId: `${input.channel}:${input.code}:${day}`,
        deepLinkPath: '/app/admin/insights/ingestion',
      },
    );
  } catch (err) {
    logger.error('[ingestionAlerts] failed to send ingestion failure alert', {
      channel: input.channel, code: input.code, error: (err as Error)?.message,
    });
  }
}
