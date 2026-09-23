/**
 * Resolve CRM deep links for cited TASK references at read time.
 *
 * The finding fact stores only the task id + kind (no layout), and the CRM's
 * `tblTaskType` lives in a different database than the warehouse fact, so the
 * URL cannot be joined in the read query. Instead we resolve the task type's
 * `NewScreen` (and JobID for job-typed tasks) in ONE batched CRM read here, then
 * hand the built URLs back to the caller. Degrades to an empty map on failure so
 * a CRM hiccup costs the links, never the report.
 */
import { executeQuery } from '../../../utils/databaseUtils';
import logger from '../../../config/logger';
import { buildCrmTaskUrl } from '../../../utils/crmLinks';

/**
 * Map of TaskID -> built CRM URL for the given task ids. Ids with no CRM row are
 * simply absent from the map (the caller renders no link for them).
 */
export async function resolveTaskCrmUrls(taskIds: number[]): Promise<Map<number, string>> {
  const ids = [...new Set(taskIds.filter((n) => Number.isFinite(n) && n > 0))];
  const out = new Map<number, string>();
  if (ids.length === 0) return out;
  try {
    const rows = await executeQuery<{
      TaskID: number;
      TaskTypeID: number | null;
      NewScreen: string | null;
      JobID: number | null;
    }>(
      `SELECT t.TaskID, t.TaskTypeID, tt.NewScreen,
              (SELECT jj.JobID FROM tblJobs jj WHERE jj.TaskID = t.TaskID LIMIT 1) AS JobID
         FROM tblTask t
         LEFT JOIN tblTaskType tt ON tt.TaskTypeID = t.TaskTypeID
        WHERE t.TaskID IN (${ids.map(() => '?').join(',')})`,
      ids,
      'crm',
    );
    for (const r of rows) {
      const taskId = Number(r.TaskID);
      if (!Number.isFinite(taskId) || taskId <= 0) continue;
      out.set(taskId, buildCrmTaskUrl({
        taskId,
        newScreen: r.NewScreen,
        taskTypeId: r.TaskTypeID == null ? null : Number(r.TaskTypeID),
        jobId: r.JobID == null ? null : Number(r.JobID),
      }));
    }
  } catch (err) {
    logger.warn(`[MISSED OPPS] task link resolution failed: ${(err as Error).message}`);
  }
  return out;
}
