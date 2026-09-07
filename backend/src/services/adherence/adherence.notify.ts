/**
 * adherence.notify — queues a notification when somebody crosses an adherence
 * discipline rung. Same machinery and dedupe discipline as attendance.notify.
 *
 * Two extra guards specific to adherence:
 *   - REPORT-ONLY SILENCE. Points that have not been switched on
 *     (adherence_points_active_from in the future) never fire a crossing. The
 *     notifier sums points from the SAME points-active floor the roster uses, so
 *     an alert can never disagree with the number an agent sees.
 *   - UPWARD ONLY, ONCE PER RUNG, HIGHEST RUNG ONLY — via the unique dedupe_key
 *     `adherence_level:<user>:<level>`.
 */
import prisma from '../../config/prisma';
import logger from '../../config/logger';
import { loadWarningThresholds } from './adherence.config';
import { resolveWarningLevel } from './adherence.rules';
import { windowForFloored } from './adherence.rollup.service';
import { dateOnlyValue } from '../scheduling/schedule.dates';
import { resolveRecipients } from '../notifications/RoleResolver';
import { isPunchExempt } from '../attendance/punchExempt.settings';

export const ADHERENCE_LEVEL_TEMPLATE = 'adherence_threshold_reached';

function dedupeKeyFor(claimKey: string, recipientId: number, csrId: number): string {
  return recipientId === csrId ? claimKey : `${claimKey}:u${recipientId}`;
}

/**
 * Queue notifications for everyone at or above a rung. Called at the tail of a
 * recompute. Never throws into the caller — a failed notification must not fail
 * an import.
 */
export async function queueThresholdCrossings(asOf: string): Promise<number> {
  try {
    const { pointsFrom, pointsActive } = await windowForFloored(asOf);
    if (!pointsActive) return 0;

    const thresholds = await loadWarningThresholds();

    const totals = await prisma.adherenceOccurrence.groupBy({
      by: ['user_id'],
      where: { work_date: { gte: dateOnlyValue(pointsFrom), lte: dateOnlyValue(asOf) } },
      _sum: { points: true },
    });

    let queued = 0;
    for (const t of totals) {
      const points = Number(t._sum.points ?? 0);
      const level = resolveWarningLevel(thresholds, points, asOf);
      if (!level) continue;

      const claimKey = `adherence_level:${t.user_id}:${level.levelKey}`;
      const claimed = await prisma.notificationQueueEntry.findUnique({ where: { dedupe_key: claimKey } });
      if (claimed) continue;

      if (await isPunchExempt(t.user_id)) continue;

      const csr = await prisma.user.findUnique({
        where: { id: t.user_id },
        select: { id: true, username: true },
      });
      if (!csr) continue;

      const recipients = await resolveRecipients(ADHERENCE_LEVEL_TEMPLATE, { csr });
      for (const recipient of recipients) {
        const dedupe_key = dedupeKeyFor(claimKey, recipient.id, t.user_id);
        const existing = await prisma.notificationQueueEntry.findUnique({ where: { dedupe_key } });
        if (existing) continue;

        await prisma.notificationQueueEntry.create({
          data: {
            user_id: recipient.id,
            template_key: ADHERENCE_LEVEL_TEMPLATE,
            payload: {
              level: level.label, levelKey: level.levelKey, points, asOf,
              threshold: level.pointsThreshold,
              csr: { id: csr.id, username: csr.username },
              forRole: recipient.matchedRole ?? null,
            },
            scheduled_for: new Date(),
            dedupe_key,
          },
        });
        queued++;
      }
    }

    if (queued > 0) logger.info(`adherence: queued ${queued} threshold-crossing notification(s)`);
    return queued;
  } catch (err) {
    logger.error('adherence: failed to queue threshold crossings', err);
    return 0;
  }
}
