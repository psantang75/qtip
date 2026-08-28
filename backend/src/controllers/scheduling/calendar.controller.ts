/**
 * Read-only business-calendar day types for a date range.
 *
 * Company-wide, non-sensitive facts (which days are weekends / holidays /
 * closures), so this is gated on authentication only — no page permission. Both
 * the scheduling grid and the phone-queue views read it to grey non-business
 * days and to skip them when the date arrows move, which means a queue-only
 * manager (sched_queues, no sched_calendar) must be able to read it too. The
 * admin calendar endpoints under /insights/admin/calendar stay admin-only for
 * writes; this is the shared read.
 */
import { Response } from 'express';
import { AuthReq } from '../../services/scheduling';
import { getRangeDayTypes } from '../../utils/businessCalendar';
import { respondWithError } from './respond';

/** A year of days is the most any view asks for; refuse more so the range cannot be abused. */
const MAX_RANGE_DAYS = 400;

export const getCalendarDayTypes = async (req: AuthReq, res: Response) => {
  try {
    const from = req.query.from as string;
    const to = req.query.to as string;
    const spanDays = (Date.parse(to) - Date.parse(from)) / 86_400_000;
    if (!Number.isFinite(spanDays) || spanDays < 0 || spanDays > MAX_RANGE_DAYS) {
      res.status(400).json({ success: false, error: { message: 'Invalid or too-large date range' } });
      return;
    }
    const dayTypes = await getRangeDayTypes(from, to);
    res.json({ success: true, data: { dayTypes } });
  } catch (error) {
    respondWithError(res, 'getCalendarDayTypes', error);
  }
};
