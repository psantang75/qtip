/**
 * Persist the user-level "does not punch" flag and rescore that person so
 * leftover attendance/adherence rows disappear (or start scoring again) on save,
 * not on the next punch import.
 */
import logger from '../../config/logger';
import { fmtLocal } from '../scheduling/schedule.dates';
import { recomputeRange as recomputeAttendance } from './attendance.engine';
import { getPointsStartDate } from './attendance.settings';
import { recomputeRange as recomputeAdherence } from '../adherence/adherence.engine';
import { getAdherenceStartDate } from '../adherence/adherence.settings';
import { setPunchExempt } from './punchExempt.settings';

export async function applyUserPunchExempt(userId: number, exempt: boolean): Promise<void> {
  await setPunchExempt(userId, exempt);

  try {
    const [attStart, adhStart] = await Promise.all([getPointsStartDate(), getAdherenceStartDate()]);
    const from = attStart < adhStart ? attStart : adhStart;
    const to = fmtLocal(new Date());
    await Promise.all([
      recomputeAttendance(from, to, [userId]),
      recomputeAdherence(from, to, [userId]),
    ]);
  } catch (err) {
    logger.warn(`punchExempt: saved flag for user ${userId} but rescore failed`, err);
  }
}
