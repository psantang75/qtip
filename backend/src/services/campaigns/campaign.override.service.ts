/**
 * Campaign per-day OVERRIDES — the manager's manual tweaks vs the auto-generated
 * set. The day popover sends a desired on/off state for a campaign on a date;
 * this service stores the MINIMAL override needed:
 *   desired ON  & not generated → ADD      (manual placement)
 *   desired OFF & generated     → REMOVE    (hide a generated one)
 *   desired matches the default → no row    (clear any stale override)
 * so the stored data never drifts from the library rules more than necessary.
 */
import prisma from '../../config/prisma';
import { AuthReq, ScheduleServiceError } from '../scheduling/schedule.types';
import { resolveScope } from '../scheduling/schedule.permissions';
import { assertCanWriteSchedule } from './campaign.permissions';
import { buildGenerated } from './campaign.projection.service';
import { getMonthDayTypes } from '../../utils/businessCalendar';

function parseMonth(date: string): { year: number; month: number } {
  const [y, m] = date.split('-').map(Number);
  return { year: y, month: m };
}

/**
 * Toggle a single campaign on/off for one date, persisting the minimal override.
 * Returns the resulting projected state for that date is left to the caller
 * re-fetching the month; here we just report what was stored.
 */
export async function setDayCampaign(
  req: AuthReq,
  scheduleId: number,
  date: string,
  campaignItemId: number,
  desiredOn: boolean,
): Promise<{ action: 'ADD' | 'REMOVE' | 'NONE' }> {
  const scope = await resolveScope(req);
  await assertCanWriteSchedule(scope, scheduleId);

  const item = await prisma.campaignItem.findUnique({ where: { id: campaignItemId } });
  if (!item || !item.is_active) throw new ScheduleServiceError('Campaign not found or inactive', 404, 'ITEM_NOT_FOUND');

  const { year, month } = parseMonth(date);

  // A campaign can only be placed on a working business day.
  if (desiredOn) {
    const dayTypes = await getMonthDayTypes(year, month);
    const t = dayTypes.get(date);
    if (t && t !== 'WORKDAY' && t !== 'ADJUSTMENT') {
      throw new ScheduleServiceError('Campaigns can only be scheduled on business days', 400, 'NOT_WORKDAY');
    }
  }

  const { generated } = await buildGenerated(scheduleId, year, month);
  const isGenerated = generated.get(date)?.has(campaignItemId) ?? false;

  // Clear any existing override for this cell first — we recompute from scratch.
  await prisma.campaignScheduleOverride.deleteMany({
    where: { schedule_id: scheduleId, occurrence_date: new Date(`${date}T00:00:00Z`), campaign_item_id: campaignItemId },
  });

  let action: 'ADD' | 'REMOVE' | 'NONE' = 'NONE';
  if (desiredOn && !isGenerated) action = 'ADD';
  else if (!desiredOn && isGenerated) action = 'REMOVE';

  if (action !== 'NONE') {
    await prisma.campaignScheduleOverride.create({
      data: {
        schedule_id: scheduleId,
        occurrence_date: new Date(`${date}T00:00:00Z`),
        campaign_item_id: campaignItemId,
        action,
        created_by: scope.viewerId,
      },
    });
  }
  return { action };
}
