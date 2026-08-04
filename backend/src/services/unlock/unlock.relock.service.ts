/**
 * Auto re-lock sweep for admin unlocks.
 *
 * A reopened record that nobody acts on is worse than one that was never
 * reopened: its score sits withdrawn indefinitely and every report that
 * filters on FINALIZED silently loses a row. So each unlock carries a
 * `relock_due_at`, and this sweep restores anything past it.
 *
 * Restore is cheap because unlocking is non-destructive — answers and score
 * are untouched, and the only fields cleared (the dispute resolution trio)
 * were stashed in `prior_snapshot` first. Restoring is a status flip plus,
 * for disputes, writing those three fields back.
 *
 * `reopen_count` is deliberately NOT decremented. The reopen happened; the
 * cap is meant to count attempts, not successes.
 *
 * Same module-level `running` guard + setTimeout warmup + setInterval shape
 * as DigestScheduler so operators have one mental model for background jobs.
 */
import prisma from '../../config/prisma';
import logger from '../../config/logger';
import type { DisputePriorSnapshot } from './unlock.types';

const TICK_MS = 15 * 60 * 1000;

let intervalHandle: NodeJS.Timeout | null = null;
let running = false;

export interface RelockSweepResult {
  restored: number;
  failed: number;
}

/**
 * Restore every unlock whose deadline has passed. Failures on one row are
 * logged and skipped so a single bad record cannot stall the batch — the
 * next tick retries it.
 */
export async function runRelockSweep(): Promise<RelockSweepResult> {
  const due = await prisma.recordUnlock.findMany({
    where: { state: 'OPEN', relock_due_at: { lt: new Date() } },
    orderBy: { relock_due_at: 'asc' },
  });
  if (due.length === 0) return { restored: 0, failed: 0 };

  let restored = 0;
  let failed = 0;

  for (const unlock of due) {
    try {
      await prisma.$transaction(async (tx) => {
        if (unlock.entity_type === 'SUBMISSION') {
          // Only restore if it is still sitting in DRAFT. If it moved on,
          // something else already resolved it and we must not stomp that.
          const current = await tx.submission.findUnique({
            where: { id: unlock.entity_id },
            select: { status: true },
          });
          if (current?.status === 'DRAFT') {
            await tx.submission.update({
              where: { id: unlock.entity_id },
              data: { status: unlock.prior_status as 'SUBMITTED' | 'FINALIZED' },
            });
          }
        } else {
          const snapshot = (unlock.prior_snapshot ?? null) as unknown as DisputePriorSnapshot | null;
          const current = await tx.dispute.findUnique({
            where: { id: unlock.entity_id },
            select: { status: true },
          });
          if (current?.status === 'OPEN' && snapshot) {
            await tx.dispute.update({
              where: { id: unlock.entity_id },
              data: {
                status: snapshot.dispute_status as 'UPHELD' | 'REJECTED' | 'ADJUSTED',
                resolved_by: snapshot.resolved_by,
                resolved_at: snapshot.resolved_at ? new Date(snapshot.resolved_at) : null,
                resolution_notes: snapshot.resolution_notes,
              },
            });
            // A closed dispute means the parent review is complete again.
            await tx.submission.update({
              where: { id: unlock.submission_id },
              data: { status: 'FINALIZED' },
            });
          }
        }

        await tx.recordUnlock.update({
          where: { id: unlock.id },
          data: { state: 'AUTO_RELOCKED', closed_at: new Date() },
        });

        await tx.auditLog.create({
          data: {
            user_id: unlock.unlocked_by,
            action: 'record.auto_relock',
            target_id: unlock.entity_id,
            target_type: unlock.entity_type,
            details: JSON.stringify({
              unlock_id: unlock.id,
              submission_id: unlock.submission_id,
              restored_status: unlock.prior_status,
              relock_due_at: unlock.relock_due_at.toISOString(),
              reason: 'reopened record was not re-submitted before its deadline',
            }),
          },
        });
      });
      restored += 1;
    } catch (err) {
      failed += 1;
      logger.error(`[UnlockRelock] failed to restore unlock_id=${unlock.id}`, err);
    }
  }

  logger.info(`[UnlockRelock] sweep complete: ${restored} restored, ${failed} failed`);
  return { restored, failed };
}

async function safeTick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    await runRelockSweep();
  } catch (err) {
    logger.error('[UnlockRelock] tick failed', err);
  } finally {
    running = false;
  }
}

export function startUnlockRelockScheduler(): void {
  if (intervalHandle) return;
  setTimeout(() => { void safeTick(); }, 60_000);
  intervalHandle = setInterval(() => { void safeTick(); }, TICK_MS);
  logger.info('[UnlockRelock] started, tick every 15min');
}

export function stopUnlockRelockScheduler(): void {
  if (intervalHandle) clearInterval(intervalHandle);
  intervalHandle = null;
}
