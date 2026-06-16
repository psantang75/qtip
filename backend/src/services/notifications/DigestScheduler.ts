import prisma from '../../config/prisma';
import logger from '../../config/logger';
import emailService from '../email/EmailService';
import { renderTemplate } from '../email/TemplateRenderer';
import { logEmail } from '../email/EmailLogger';
import { digestDedupeKey } from './idempotency';
import { mailConfig } from '../../config/environment';

/**
 * Drains the `notification_queue` on a 5-minute tick. Same `setInterval`
 * shape as TokenBlacklistService (item #43) so operators have one
 * mental model for background workers.
 *
 * For each due (`scheduled_for <= now AND processed_at IS NULL`) row:
 *   - Group rows by (user_id, template_key) so a user gets ONE digest
 *     per template per window (not 47 individual rows).
 *   - Resolve the recipient via prisma.user (handle the inactive-user
 *     edge case the same way RoleResolver does).
 *   - Render the digest template with `items` (array) + `itemCount`.
 *   - Apply the template's `digest_filter` to suppress items that don't
 *     meet the admin's threshold (e.g. AI-routed-to-QA only, or below
 *     score X).
 *   - Send + log + mark all source rows as processed atomically.
 *
 * Failures on a single user/template group are logged and that group is
 * left unprocessed so the next tick can retry. We never let one user's
 * SMTP error stop the entire batch.
 */

const TICK_MS = 5 * 60 * 1000;
const MAX_ITEMS_PER_DIGEST = 50;

let intervalHandle: NodeJS.Timeout | null = null;
let running = false;

export function startDigestScheduler(): void {
  if (intervalHandle) return;
  // First tick on a short delay so smoke signals show up in stdout.
  setTimeout(() => { void runOnce().catch(err => logger.error('[DigestScheduler] tick failed', err)); }, 30_000);
  intervalHandle = setInterval(() => {
    void runOnce().catch(err => logger.error('[DigestScheduler] tick failed', err));
  }, TICK_MS);
  logger.info('[DigestScheduler] started, tick every 5min');
}

export function stopDigestScheduler(): void {
  if (intervalHandle) clearInterval(intervalHandle);
  intervalHandle = null;
}

interface QueueRow {
  id: number;
  user_id: number;
  template_key: string;
  payload: any;
  scheduled_for: Date;
  dedupe_key: string;
}

export async function runOnce(): Promise<{ groups: number; sent: number; skipped: number }> {
  if (running) return { groups: 0, sent: 0, skipped: 0 };
  running = true;
  try {
    const now = new Date();
    const due = await prisma.notificationQueueEntry.findMany({
      where: { processed_at: null, scheduled_for: { lte: now } },
      orderBy: { scheduled_for: 'asc' },
      take: 5000,
    }) as unknown as QueueRow[];
    if (due.length === 0) return { groups: 0, sent: 0, skipped: 0 };

    const groups = new Map<string, QueueRow[]>();
    for (const row of due) {
      const key = `${row.user_id}:${row.template_key}`;
      const arr = groups.get(key) ?? [];
      arr.push(row);
      groups.set(key, arr);
    }

    let sent = 0;
    let skipped = 0;

    for (const [key, rows] of groups) {
      const [userIdStr, templateKey] = key.split(':') as [string, string];
      const userId = Number(userIdStr);
      try {
        const outcome = await processGroup(userId, templateKey, rows);
        if (outcome === 'sent') sent++;
        else skipped++;
      } catch (err) {
        logger.error('[DigestScheduler] group failed', { key, error: (err as Error)?.message });
      }
    }
    if (sent > 0 || skipped > 0) {
      logger.info('[DigestScheduler] tick complete', { groups: groups.size, sent, skipped });
    }
    return { groups: groups.size, sent, skipped };
  } finally {
    running = false;
  }
}

async function processGroup(
  userId: number,
  templateKey: string,
  rows: QueueRow[],
): Promise<'sent' | 'skipped'> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, username: true, email: true, is_active: true },
  });
  if (!user || !user.is_active || !user.email) {
    await prisma.notificationQueueEntry.updateMany({
      where: { id: { in: rows.map(r => r.id) } },
      data: { processed_at: new Date() },
    });
    return 'skipped';
  }

  const tpl = await prisma.emailTemplate.findUnique({ where: { template_key: templateKey } });
  const filter = tpl?.digest_filter ?? 'ALL';

  const filteredItems = rows
    .map(r => buildDigestItem(r.payload))
    .filter(item => passesFilter(item, filter))
    .slice(0, MAX_ITEMS_PER_DIGEST);

  if (filteredItems.length === 0) {
    await prisma.notificationQueueEntry.updateMany({
      where: { id: { in: rows.map(r => r.id) } },
      data: { processed_at: new Date() },
    });
    return 'skipped';
  }

  const recipient = { id: user.id, username: user.username, email: user.email, role_id: 0 };
  const digestKey = templateKey.startsWith('digest.')
    ? templateKey
    : pickDigestTemplate(templateKey);

  // Land each digest on the dashboard it summarizes, not the generic home.
  const digestDeepLink = digestKey === 'digest.manager_weekly'
    ? '/app/insights/team'
    : '/app/insights/dashboard';

  const rendered = await renderTemplate({
    templateKey: digestKey,
    data: {
      recipient,
      items: filteredItems,
      itemCount: filteredItems.length,
      hasMore: rows.length > filteredItems.length,
      deepLinkPath: digestDeepLink,
    },
  });
  if (!rendered) return 'skipped';

  if (!emailService.isConfigured()) {
    await logEmail({
      templateKey: digestKey, toEmail: user.email, toUserId: user.id,
      subject: rendered.subject, status: 'SKIPPED_NOT_CONFIGURED',
      dedupeKey: digestDedupeKey(digestKey, user.id, new Date()),
    });
    await prisma.notificationQueueEntry.updateMany({
      where: { id: { in: rows.map(r => r.id) } },
      data: { processed_at: new Date() },
    });
    return 'skipped';
  }

  const dKey = digestDedupeKey(digestKey, user.id, new Date());
  const result = await emailService.send({
    to: user.email,
    subject: rendered.subject,
    html: rendered.html,
    templateKey: digestKey,
  });

  await logEmail({
    templateKey: digestKey, toEmail: user.email, toUserId: user.id,
    subject: rendered.subject,
    status: result.ok ? 'SENT' : 'FAILED',
    messageId: result.messageId, errorMessage: result.error, dedupeKey: dKey,
    sentAt: result.ok ? new Date() : null,
  });

  await prisma.notificationQueueEntry.updateMany({
    where: { id: { in: rows.map(r => r.id) } },
    data: { processed_at: new Date() },
  });
  return result.ok ? 'sent' : 'skipped';
}

function buildDigestItem(payload: any): {
  formName: string; csrName: string; score: number | string; status: string;
  ai_overall_confidence?: number | null;
  routed_to_qa?: boolean;
} {
  return {
    formName: payload?.form?.form_name ?? 'Unknown form',
    csrName: payload?.csr?.username ?? 'Unknown',
    score: payload?.submission?.total_score ?? '—',
    status: payload?.submission?.status ?? 'finalized',
    ai_overall_confidence: payload?.submission?.ai_overall_confidence ?? null,
    routed_to_qa: payload?.routedToQa ?? false,
  };
}

function passesFilter(item: ReturnType<typeof buildDigestItem>, filter: string): boolean {
  if (filter === 'ALL') return true;
  if (filter === 'ROUTED_TO_QA') return !!item.routed_to_qa;
  if (filter === 'BELOW_THRESHOLD') {
    const score = Number(item.score);
    return Number.isFinite(score) && score < 80;
  }
  return true;
}

/**
 * Maps a queued event's template_key back to the digest template that
 * should bundle it. Right now the only batched event is AI submission
 * finalize. New batched events should add a row here.
 */
function pickDigestTemplate(templateKey: string): string {
  if (templateKey === 'submission.audit_finalized_by_ai') return 'digest.csr_daily';
  return templateKey;
}

export const _internalForTest = { runOnce, processGroup, buildDigestItem, passesFilter };
// `mailConfig` import keeps this file's tz behavior tied to the rest of the system.
void mailConfig;
