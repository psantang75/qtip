import { BaseInsightsWorker, WorkerResult } from './BaseInsightsWorker';
import { runMonitorEvaluation } from '../services/insights/datasetMonitor';
import { notifyDatasetHealth } from '../services/notifications/ingestionAlerts';
import logger from '../config/logger';

const SERVICE = 'MonitoringWorker';

/**
 * Evaluates every active ie_dataset_monitor row against freshness + a
 * weekday-aware volume baseline, upserts ie_dataset_health, and emails an alert
 * only when a dataset TRANSITIONS into WARN or RED (transition tracked via
 * ie_dataset_health.status_since, then deduped per day by NotificationService).
 * Runs at :25/:55 so the current cycle's source-report + rollup loads have landed.
 */
export class MonitoringWorker extends BaseInsightsWorker {
  constructor() {
    super('monitoring-eval', 'system');
  }

  protected async execute(): Promise<WorkerResult> {
    const results = await runMonitorEvaluation();
    let warn = 0;
    let red = 0;
    let alerts = 0;

    for (const r of results) {
      if (r.health.status === 'WARN') warn++;
      if (r.health.status === 'RED') red++;
      if (r.transitioned && r.health.status !== 'OK') {
        alerts++;
        await notifyDatasetHealth({
          channel: r.health.producerKind === 'source_report' ? 'sql' : 'rollup',
          name: r.health.displayName,
          code: r.health.datasetCode,
          reason: r.health.reason,
          severity: r.health.status === 'RED' ? 'failed' : 'warning',
        });
      }
    }

    logger.info('Dataset health evaluated', { service: SERVICE, total: results.length, warn, red, alerts });
    return {
      rowsExtracted: results.length,
      rowsLoaded: results.length,
      rowsSkipped: 0,
      rowsErrored: red,
      batchIdentifier: `ok:${results.length - warn - red};warn:${warn};red:${red};alerts:${alerts}`,
    };
  }
}
