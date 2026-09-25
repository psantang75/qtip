/**
 * Rescore attendance and adherence after a schedule write.
 *
 * Both engines are derived. A shift or exception change has to recompute the
 * affected people immediately; waiting for the next punch file left Hours
 * Worked and points on the previous shift. Each engine is idempotent and
 * isolated — a failure in one never rolls back the write or the other rescore.
 * Threshold emails stay on the punch-import path, matching exception edits.
 */
import logger from '../../config/logger';
import { recomputeRange } from '../attendance/attendance.engine';
import { recomputeRange as recomputeAdherence } from '../adherence/adherence.engine';

export async function rescoreSchedule(
  from: string,
  to: string,
  userIds: number[],
  reason: string,
): Promise<void> {
  if (userIds.length === 0 || !from || !to) return;
  try {
    await recomputeRange(from, to, userIds);
  } catch (err) {
    logger.error(`[SCHEDULING] attendance recompute after ${reason} failed:`, err);
  }
  try {
    await recomputeAdherence(from, to, userIds);
  } catch (err) {
    logger.error(`[SCHEDULING] adherence recompute after ${reason} failed:`, err);
  }
}
