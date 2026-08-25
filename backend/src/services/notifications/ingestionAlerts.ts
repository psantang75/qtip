/**
 * Fire an admin alert when an ingestion dataset is unhealthy, whatever the channel.
 *
 * One email covers every path so operators watch a single place: the SQL
 * source-report pipeline, the rollup captures, the mailbox email pickup, and the
 * manual Excel upload. A `severity` distinguishes a hard failure/RED
 * (`failed`) from an anomalous-but-successful WARN (`warning`) — both reuse the
 * `system.ingestion_failed` template with a severity label variable, so no new
 * template is needed.
 *
 * `entityId` folds channel + code + severity + calendar day together so repeated
 * alerts of the same feed on the same day dedupe to one mail rather than a
 * flood; the MonitoringWorker only calls this on a status TRANSITION, and the
 * NotificationService rate-limit + circuit-breaker are the second line.
 *
 * Never throws — an alert that can't be sent must not turn a logged failure into
 * a crash in a background worker.
 */

import notificationService from './NotificationService';
import logger from '../../config/logger';

export type IngestionChannel = 'sql' | 'rollup' | 'email' | 'manual' | 'worker';
export type IngestionSeverity = 'warning' | 'failed';

export interface DatasetHealthAlertInput {
  /** Which ingestion path is affected. */
  channel: IngestionChannel;
  /** Human name of the feed/report/dataset (e.g. "Call Activity"). */
  name: string;
  /** Stable machine code used for dedupe (dataset_code / report_code / worker). */
  code: string;
  /** Plain-English reason. */
  reason: string;
  /** WARN (anomaly) vs hard failure/RED. Defaults to 'failed'. */
  severity?: IngestionSeverity;
  /** Optional origin — the sending address or source system. */
  source?: string | null;
  /** Defaults to now. */
  occurredAt?: Date;
}

const CHANNEL_LABEL: Record<IngestionChannel, string> = {
  sql: 'Report ingestion',
  rollup: 'Rollup capture',
  email: 'Email pickup',
  manual: 'Manual upload',
  worker: 'Background worker',
};

const SEVERITY_LABEL: Record<IngestionSeverity, string> = {
  warning: 'Warning',
  failed: 'Failure',
};

/** General dataset-health alert (WARN or RED). */
export async function notifyDatasetHealth(input: DatasetHealthAlertInput): Promise<void> {
  const occurredAt = input.occurredAt ?? new Date();
  const day = occurredAt.toISOString().slice(0, 10);
  const severity: IngestionSeverity = input.severity ?? 'failed';

  try {
    await notificationService.notify(
      'system.ingestion_failed',
      {
        channel: input.channel,
        channelLabel: CHANNEL_LABEL[input.channel],
        severity,
        severityLabel: SEVERITY_LABEL[severity],
        // Boolean flag so the (helper-free) Handlebars template can switch
        // wording/colour between a WARN anomaly and a hard RED failure.
        isWarning: severity === 'warning',
        name: input.name,
        code: input.code,
        reason: input.reason,
        source: input.source ?? null,
        occurredAt: occurredAt.toISOString(),
      },
      {
        entityType: 'ingestion_failure',
        entityId: `${input.channel}:${input.code}:${severity}:${day}`,
        deepLinkPath: '/app/admin/insights/ingestion',
      },
    );
  } catch (err) {
    logger.error('[ingestionAlerts] failed to send dataset health alert', {
      channel: input.channel, code: input.code, severity, error: (err as Error)?.message,
    });
  }
}

/** Back-compat thin wrapper: a hard ingestion failure is severity 'failed'. */
export async function notifyIngestionFailure(
  input: Omit<DatasetHealthAlertInput, 'severity'>,
): Promise<void> {
  await notifyDatasetHealth({ ...input, severity: 'failed' });
}
