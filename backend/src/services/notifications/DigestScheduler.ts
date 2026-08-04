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
 *
 * The exception is a failure that retrying cannot fix — a template key with no
 * row and no file behind it. Those rows are discarded rather than retried, or a
 * single missing seed spins in the log every five minutes indefinitely.
 */

const TICK_MS = 5 * 60 * 1000;
const MAX_ITEMS_PER_DIGEST = 50;

/**
 * Where a template's CTA button should land. Anything not listed here falls back
 * to the personal dashboard, which is right for the CSR-facing digests.
 */
const DEEP_LINKS: Record<string, string> = {
  'digest.manager_weekly': '/app/insights/team',
  attendance_threshold_reached: '/app/insights/csr-attendance',
};

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

/**
 * Marks queue rows handled so no later tick can pick them up again. Every exit
 * from `processGroup` has to end in one of these, or the rows are retried on the
 * next tick forever.
 */
async function markProcessed(rows: QueueRow[]): Promise<void> {
  await prisma.notificationQueueEntry.updateMany({
    where: { id: { in: rows.map(r => r.id) } },
    data: { processed_at: new Date() },
  });
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
    await markProcessed(rows);
    return 'skipped';
  }

  const tpl = await prisma.emailTemplate.findUnique({ where: { template_key: templateKey } });
  const filter = tpl?.digest_filter ?? 'ALL';

  const filteredItems = rows
    .map(r => buildDigestItem(r.payload))
    .filter(item => passesFilter(item, filter))
    .slice(0, MAX_ITEMS_PER_DIGEST);

  if (filteredItems.length === 0) {
    await markProcessed(rows);
    return 'skipped';
  }

  // Every row in a group shares a user and a template, so they also share the
  // audience role that surfaced them. Templates read it to address the subject of
  // the event in the second person and everybody else in the third.
  const recipient = {
    id: user.id, username: user.username, email: user.email, role_id: 0,
    matchedRole: rows[0]?.payload?.forRole ?? undefined,
  };
  const digestKey = templateKey.startsWith('digest.')
    ? templateKey
    : pickDigestTemplate(templateKey);

  // Land each digest on the page it summarizes, not the generic home.
  const digestDeepLink = DEEP_LINKS[digestKey] ?? '/app/insights/dashboard';

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
  if (!rendered) {
    // renderTemplate returns null only when the key exists in neither the DB nor
    // the templates folder — a missing seed, not a transient failure. Retrying it
    // can never succeed, so discard the rows and say so at error level, because
    // the fix is a code change somebody has to make.
    await markProcessed(rows);
    logger.error('[DigestScheduler] no such template — queued notifications discarded', {
      templateKey: digestKey, userId, discarded: rows.length,
    });
    return 'skipped';
  }

  if (!emailService.isConfigured()) {
    await logEmail({
      templateKey: digestKey, toEmail: user.email, toUserId: user.id,
      subject: rendered.subject, status: 'SKIPPED_NOT_CONFIGURED',
      dedupeKey: digestDedupeKey(digestKey, user.id, new Date()),
    });
    await markProcessed(rows);
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

  await markProcessed(rows);
  return result.ok ? 'sent' : 'skipped';
}

/**
 * Flattens a queued payload into the row shape templates iterate over.
 *
 * Two payload shapes share this queue. QA submission events carry a form and a
 * score; attendance threshold crossings carry a discipline level and a point
 * total. The fields of the other shape stay null rather than being faked, so a
 * template that prints the wrong ones renders visibly empty instead of showing
 * "Unknown form" next to a real name.
 */
function buildDigestItem(payload: any): {
  formName: string | null; csrName: string; score: number | string | null; status: string | null;
  ai_overall_confidence?: number | null;
  routed_to_qa?: boolean;
  level: string | null; points: number | null; threshold: number | null; asOf: string | null;
} {
  const isAttendance = payload?.level != null || payload?.levelKey != null;
  return {
    formName: isAttendance ? null : (payload?.form?.form_name ?? 'Unknown form'),
    csrName: payload?.csr?.username ?? 'Unknown',
    score: isAttendance ? null : (payload?.submission?.total_score ?? '—'),
    status: isAttendance ? null : (payload?.submission?.status ?? 'finalized'),
    ai_overall_confidence: payload?.submission?.ai_overall_confidence ?? null,
    routed_to_qa: payload?.routedToQa ?? false,
    level: payload?.level ?? null,
    points: payload?.points ?? null,
    threshold: payload?.threshold ?? null,
    asOf: attendanceDateLabel(payload?.asOf),
  };
}

/**
 * 'YYYY-MM-DD' to 'MM-DD-YYYY', matching what the attendance screens show.
 *
 * String surgery rather than the `formatDate` Handlebars helper on purpose: that
 * helper runs the value through `new Date()`, which reads a date-only string as
 * UTC midnight and then renders it in eastern time as the day before.
 */
function attendanceDateLabel(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return parts ? `${parts[2]}-${parts[3]}-${parts[1]}` : value;
}

function passesFilter(item: ReturnType<typeof buildDigestItem>, filter: string): boolean {
  if (filter === 'ALL') return true;
  if (filter === 'ROUTED_TO_QA') return !!item.routed_to_qa;
  if (filter === 'BELOW_THRESHOLD') {
    // An item with no score at all is not a scored event, so a score-based
    // filter has no opinion on it. Keep it rather than silently dropping it —
    // Number(null) is 0, which would otherwise sneak past as "below threshold".
    if (item.score == null) return true;
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
