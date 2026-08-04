/**
 * Campaign PUBLISHING — a calendar reaches agents only when it is released, one
 * month at a time, because a manager builds next month while this month is
 * already out. A schedule nobody has released any month of stays DRAFT and is
 * invisible in full; releasing a month lifts that too.
 *
 * Months are still projected on read; campaign_schedule_month only records
 * releasability, so a month nobody published has no row and does not exist for
 * an agent — they cannot open it or even navigate to it.
 *
 * Publishing is gated on sched_campaigns EDIT (Admin + Manager) at the route.
 */
import prisma from '../../config/prisma';
import { AuthReq, ScheduleScope, ScheduleServiceError } from '../scheduling/schedule.types';
import { resolveScope } from '../scheduling/schedule.permissions';
import { assertCanWriteSchedule } from './campaign.permissions';

export type PublishStatus = 'DRAFT' | 'PUBLISHED';

export const monthKey = (year: number, month: number): string =>
  `${year}-${String(month).padStart(2, '0')}`;

/**
 * Who may see unpublished work. canViewAll is exactly the non-agent set here
 * (Admin, Director, Manager); agents only ever see released months. Directors
 * see drafts without being able to publish them, matching shift scheduling.
 */
export const canSeeDrafts = (scope: ScheduleScope): boolean => scope.canViewAll;

/** Published months per schedule as 'YYYY-MM', ascending. */
export async function publishedMonthsBySchedule(scheduleIds: number[]): Promise<Map<number, string[]>> {
  const out = new Map<number, string[]>();
  if (scheduleIds.length === 0) return out;
  const rows = await prisma.campaignScheduleMonth.findMany({
    where: { schedule_id: { in: scheduleIds }, status: 'PUBLISHED' },
    select: { schedule_id: true, year: true, month: true },
    orderBy: [{ year: 'asc' }, { month: 'asc' }],
  });
  for (const r of rows) {
    if (!out.has(r.schedule_id)) out.set(r.schedule_id, []);
    out.get(r.schedule_id)!.push(monthKey(r.year, r.month));
  }
  return out;
}

export async function isMonthPublished(scheduleId: number, year: number, month: number): Promise<boolean> {
  const row = await prisma.campaignScheduleMonth.findUnique({
    where: { schedule_id_year_month: { schedule_id: scheduleId, year, month } },
    select: { status: true },
  });
  return row?.status === 'PUBLISHED';
}

/**
 * Gate month data on publish state. 404 rather than 403 on purpose: to an agent
 * an unpublished month does not exist, and saying "forbidden" would leak that
 * one is being drafted.
 */
export async function assertMonthVisible(
  scope: ScheduleScope,
  schedule: { id: number; status: PublishStatus },
  year: number,
  month: number,
): Promise<void> {
  if (canSeeDrafts(scope)) return;
  if (schedule.status !== 'PUBLISHED' || !(await isMonthPublished(schedule.id, year, month))) {
    throw new ScheduleServiceError('That month has not been published', 404, 'NOT_PUBLISHED');
  }
}

const stamp = (published: boolean, actorId: number) => ({
  status: (published ? 'PUBLISHED' : 'DRAFT') as PublishStatus,
  published_at: published ? new Date() : null,
  published_by: published ? actorId : null,
});

/**
 * Publish / unpublish one month. Upserts, so the first publish creates the row.
 *
 * Releasing a month also releases the schedule, because the schedule flag is
 * plumbing for assertMonthVisible rather than a second decision the manager
 * should have to make. Unpublishing a month leaves the other months alone.
 */
export async function setMonthPublished(
  req: AuthReq, id: number, year: number, month: number, published: boolean,
) {
  const scope = await resolveScope(req);
  await assertCanWriteSchedule(scope, id);
  const data = stamp(published, scope.viewerId);
  await prisma.$transaction(async tx => {
    await tx.campaignScheduleMonth.upsert({
      where: { schedule_id_year_month: { schedule_id: id, year, month } },
      create: { schedule_id: id, year, month, ...data },
      update: data,
    });
    if (published) await tx.campaignSchedule.update({ where: { id }, data });
  });
  return { success: true, year, month, status: data.status };
}
