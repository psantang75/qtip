import { Request, Response } from 'express';
import { getCalendarMonth, upsertCalendarDay, saveMonthDefaults, type BusinessDayType } from '../services/calendarAdminService';
import { getBusinessDaySummary } from '../utils/businessCalendar';

const VALID_DAY_TYPES = new Set(['WORKDAY', 'WEEKEND', 'HOLIDAY', 'CLOSURE', 'ADJUSTMENT']);

/**
 * GET /api/insights/admin/calendar?year=YYYY&month=M
 */
export const getCalendar = async (req: Request, res: Response): Promise<void> => {
  try {
    const year  = parseInt(req.query.year  as string);
    const month = parseInt(req.query.month as string);
    if (isNaN(year) || isNaN(month) || month < 1 || month > 12) {
      res.status(400).json({ error: 'year and month (1–12) are required' });
      return;
    }
    const [days, summary] = await Promise.all([
      getCalendarMonth(year, month),
      getBusinessDaySummary(year, month),
    ]);
    res.json({ days, summary });
  } catch (error) {
    console.error('getCalendar error:', error);
    res.status(500).json({ error: 'Failed to load calendar' });
  }
};

/**
 * PUT /api/insights/admin/calendar/:date
 * Body: { day_type: BusinessDayType, note?: string | null }
 */
export const updateCalendarDay = async (req: Request, res: Response): Promise<void> => {
  try {
    const { date } = req.params;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      res.status(400).json({ error: 'date must be YYYY-MM-DD' });
      return;
    }
    const { day_type, note } = req.body;
    if (!day_type || !VALID_DAY_TYPES.has(day_type)) {
      res.status(400).json({ error: `day_type must be one of: ${[...VALID_DAY_TYPES].join(', ')}` });
      return;
    }
    await upsertCalendarDay(date, day_type as BusinessDayType, note ?? null);
    res.json({ date, day_type, note: note ?? null });
  } catch (error) {
    console.error('updateCalendarDay error:', error);
    res.status(500).json({ error: 'Failed to update calendar day' });
  }
};

/**
 * POST /api/insights/admin/calendar/save-month
 * Body: { year: number, month: number }
 */
export const saveCalendarMonth = async (req: Request, res: Response): Promise<void> => {
  try {
    const year  = parseInt(req.body.year);
    const month = parseInt(req.body.month);
    if (isNaN(year) || isNaN(month) || month < 1 || month > 12) {
      res.status(400).json({ error: 'year and month (1–12) are required' });
      return;
    }
    const { created } = await saveMonthDefaults(year, month);
    const summary = await getBusinessDaySummary(year, month);
    res.json({ year, month, daysCreated: created, summary });
  } catch (error) {
    console.error('saveCalendarMonth error:', error);
    res.status(500).json({ error: 'Failed to save month defaults' });
  }
};
