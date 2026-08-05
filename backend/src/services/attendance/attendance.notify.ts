/**
 * attendance.notify — queues a notification when somebody crosses a discipline
 * rung. Reuses the existing notification_queue and email template machinery; no
 * new delivery path.
 *
 * Two guards keep this from becoming noise, and both are enforced by the unique
 * dedupe_key rather than by bookkeeping we could get wrong:
 *
 *   - UPWARD ONLY, ONCE PER RUNG. The key is `attendance_level:<user>:<level>`, so
 *     points rolling off and being re-crossed later cannot re-fire. In a rolling
 *     window that would otherwise happen routinely and destroy trust in the alert.
 *   - HIGHEST RUNG ONLY. Reaching Written queues Written, not Coaching + Verbal +
 *     Written.
 *
 * RECIPIENTS. DigestScheduler mails the user named on the queue row, one row to
 * one mailbox, so a crossing that needs to reach several people needs a row per
 * person. Who those people are comes from the template's `recipient_roles`, the
 * same admin-editable list every other notification reads, so changing the
 * audience is a checkbox rather than a deploy.
 *
 * `attendance_level:<user>:<level>` stays the CSR's key and doubles as the rung's
 * CLAIM. If it already exists the rung has been announced and the whole crossing
 * is skipped — including copies to anyone added to the audience later. That is
 * deliberate: adding an admin to the list should not mail them a backlog of
 * crossings that were announced months ago.
 */
import prisma from '../../config/prisma';
import logger from '../../config/logger';
import { loadWarningThresholds } from './attendance.config';
import { resolveWarningLevel } from './attendance.rules';
import { windowForFloored } from './attendance.rollup.service';
import { dateOnlyValue } from '../scheduling/schedule.dates';
import { resolveRecipients } from '../notifications/RoleResolver';

export const ATTENDANCE_LEVEL_TEMPLATE = 'attendance_threshold_reached';

/** The CSR's row keeps the historical key; everyone else is suffixed by user id. */
function dedupeKeyFor(claimKey: string, recipientId: number, csrId: number): string {
  return recipientId === csrId ? claimKey : `${claimKey}:u${recipientId}`;
}

/**
 * Queue notifications for everyone who now sits at or above a rung. Called at the
 * tail of a recompute. Never throws into the caller: a failed notification must
 * not fail an import.
 */
export async function queueThresholdCrossings(asOf: string): Promise<number> {
  try {
    const { from } = await windowForFloored(asOf);
    const thresholds = await loadWarningThresholds();

    const totals = await prisma.attendanceOccurrence.groupBy({
      by: ['user_id'],
      where: { work_date: { gte: dateOnlyValue(from), lte: dateOnlyValue(asOf) } },
      _sum: { points: true },
    });

    let queued = 0;
    for (const t of totals) {
      const points = Number(t._sum.points ?? 0);
      const level = resolveWarningLevel(thresholds, points, asOf);
      if (!level) continue;

      const claimKey = `attendance_level:${t.user_id}:${level.levelKey}`;
      const claimed = await prisma.notificationQueueEntry.findUnique({ where: { dedupe_key: claimKey } });
      if (claimed) continue;

      const csr = await prisma.user.findUnique({
        where: { id: t.user_id },
        select: { id: true, username: true },
      });
      if (!csr) continue;

      const recipients = await resolveRecipients(ATTENDANCE_LEVEL_TEMPLATE, { csr });
      for (const recipient of recipients) {
        const dedupe_key = dedupeKeyFor(claimKey, recipient.id, t.user_id);
        const existing = await prisma.notificationQueueEntry.findUnique({ where: { dedupe_key } });
        if (existing) continue;

        await prisma.notificationQueueEntry.create({
          data: {
            user_id: recipient.id,
            template_key: ATTENDANCE_LEVEL_TEMPLATE,
            payload: {
              level: level.label, levelKey: level.levelKey, points, asOf,
              threshold: level.pointsThreshold,
              csr: { id: csr.id, username: csr.username },
              // Lets the template address the CSR directly but describe the CSR
              // in the third person to everyone else.
              forRole: recipient.matchedRole ?? null,
            },
            scheduled_for: new Date(),
            dedupe_key,
          },
        });
        queued++;
      }
    }

    if (queued > 0) logger.info(`attendance: queued ${queued} threshold-crossing notification(s)`);
    return queued;
  } catch (err) {
    logger.error('attendance: failed to queue threshold crossings', err);
    return 0;
  }
}
