import prisma from '../../config/prisma';
import logger from '../../config/logger';
import emailService from '../email/EmailService';
import { renderTemplate } from '../email/TemplateRenderer';
import { logEmail } from '../email/EmailLogger';
import { resolveRecipients, type Recipient } from './RoleResolver';
import { enrichPayload } from './contextEnricher';
import { dedupeKey } from './idempotency';
import { shouldRateLimit } from './rateLimit';
import { recordSend, isTripped, shouldNotifyAdminsOnTrip } from './circuitBreaker';
import { isQuietHour } from './quietHours';

/**
 * Single entry-point every controller / service uses to fire a
 * notification. Never throws — all failures are logged to email_log so
 * a transient mail issue cannot break the underlying business action
 * (saving a write-up, finalizing a submission, etc.).
 *
 * Pipeline:
 *   1. Resolve template (renderer handles DB-first/file fallback).
 *   2. Resolve recipients (RoleResolver).
 *   3. For each recipient:
 *      a. Check is_enabled, OFF cadence
 *      b. Check rate-limit, circuit-breaker, quiet-hours (locked bypasses)
 *      c. Render with merged payload
 *      d. IMMEDIATE → send now; DAILY/WEEKLY → enqueue
 *   4. Every outcome (sent / skipped / failed) logged to email_log.
 */

export interface NotifyContext {
  /** Optional: stable id of the underlying entity for threading + dedupe. */
  entityId?: number | string;
  entityType?: string;
  /** Path appended to APP_BASE_URL in the email's CTA button. */
  deepLinkPath?: string;
}

export interface NotifyResult {
  attempted: number;
  sent: number;
  queued: number;
  skipped: number;
  failed: number;
}

const LOCKED_BYPASS_TEMPLATE_PREFIXES = [
  'auth.password_reset',
  'auth.password_changed',
  'auth.account_locked',
  'auth.welcome',
  'submission.critical_fail_',
  'ai.review_low_confidence',
  'ai.review_routed_to_qa',
  'writeup.',
  'system.',
];

function isCriticalTemplate(templateKey: string, isLocked: boolean): boolean {
  if (isLocked) return true;
  return LOCKED_BYPASS_TEMPLATE_PREFIXES.some(p => templateKey.startsWith(p));
}

class NotificationService {
  async notify(
    event: string,
    payload: Record<string, any>,
    ctx: NotifyContext = {},
  ): Promise<NotifyResult> {
    const result: NotifyResult = { attempted: 0, sent: 0, queued: 0, skipped: 0, failed: 0 };

    let recipients: Recipient[] = [];
    try {
      recipients = await resolveRecipients(event, payload);
    } catch (err: any) {
      logger.error('[NotificationService] recipient resolution failed', { event, error: err?.message });
      return result;
    }
    if (recipients.length === 0) {
      logger.debug('[NotificationService] no recipients', { event });
      return result;
    }

    // Derive variables that controllers shouldn't have to know about
    // (passLabel, criticalFailQuestions, routingReasonLabel, etc.).
    try {
      payload = await enrichPayload(event, payload);
    } catch (err: any) {
      logger.warn('[NotificationService] context enrichment failed', { event, error: err?.message });
    }

    let rendered;
    try {
      rendered = await renderTemplate({ templateKey: event, data: { ...payload, deepLinkPath: ctx.deepLinkPath ?? '/' } });
    } catch (err: any) {
      logger.error('[NotificationService] template render failed', { event, error: err?.message });
      return result;
    }
    if (!rendered) {
      logger.warn('[NotificationService] template not found', { event });
      return result;
    }

    if (!rendered.isEnabled) {
      for (const r of recipients) {
        await this.logSkip(event, r, rendered.subject, 'SKIPPED_DISABLED', ctx);
      }
      result.skipped = recipients.length;
      return result;
    }

    const critical = isCriticalTemplate(event, rendered.isLocked);

    if (rendered.cadence === 'IMMEDIATE') {
      for (const recipient of recipients) {
        result.attempted++;
        const outcome = await this.sendOne(event, recipient, payload, rendered, ctx, critical);
        if (outcome === 'sent')   result.sent++;
        else if (outcome === 'skipped') result.skipped++;
        else                       result.failed++;
      }
    } else {
      for (const recipient of recipients) {
        result.attempted++;
        const queued = await this.enqueue(event, recipient, payload, rendered.cadence, ctx);
        if (queued) result.queued++;
        else result.skipped++;
      }
    }

    return result;
  }

  private async sendOne(
    event: string,
    recipient: Recipient,
    payload: Record<string, any>,
    rendered: Awaited<ReturnType<typeof renderTemplate>>,
    ctx: NotifyContext,
    critical: boolean,
  ): Promise<'sent' | 'failed' | 'skipped'> {
    if (!rendered) return 'failed';

    const dKey = dedupeKey(event, ctx.entityId ?? recipient.id, recipient.id);

    if (shouldRateLimit(recipient.email)) {
      await this.logSkip(event, recipient, rendered.subject, 'SKIPPED_RATE_LIMIT', ctx);
      return 'skipped';
    }
    if (!critical && isTripped()) {
      await this.logSkip(event, recipient, rendered.subject, 'SKIPPED_CIRCUIT_BREAKER', ctx);
      this.maybeNotifyAdminsOfTrip().catch(err => logger.warn('[NotificationService] trip alert failed', err));
      return 'skipped';
    }
    if (!critical && isQuietHour()) {
      await this.logSkip(event, recipient, rendered.subject, 'SKIPPED_QUIET_HOURS', ctx);
      return 'skipped';
    }
    if (!emailService.isConfigured()) {
      await logEmail({
        templateKey: event, toEmail: recipient.email, toUserId: recipient.id,
        subject: rendered.subject, status: 'SKIPPED_NOT_CONFIGURED',
        dedupeKey: dKey,
        relatedEntityType: ctx.entityType ?? null,
        relatedEntityId: typeof ctx.entityId === 'number' ? ctx.entityId : null,
      });
      return 'skipped';
    }

    // Re-render with the recipient merged into the data so {{recipient.username}} works.
    const recipientRendered = await renderTemplate({
      templateKey: event,
      data: {
        ...payload,
        recipient: {
          ...recipient,
          roleLabel: recipient.matchedRoleLabel ?? 'a recipient',
        },
        eventEntityLabel: deriveEventEntityLabel(event),
        deepLinkPath: ctx.deepLinkPath ?? '/',
      },
    });
    if (!recipientRendered) return 'failed';

    const sendResult = await emailService.send({
      to: recipient.email,
      subject: recipientRendered.subject,
      html: recipientRendered.html,
      threadKey: ctx.entityType && ctx.entityId ? `${ctx.entityType}:${ctx.entityId}` : undefined,
      templateKey: event,
      entityRef: ctx.entityType && ctx.entityId ? { type: ctx.entityType, id: ctx.entityId } : undefined,
    });

    recordSend();

    if (sendResult.ok) {
      await logEmail({
        templateKey: event, toEmail: recipient.email, toUserId: recipient.id,
        subject: recipientRendered.subject, status: 'SENT', messageId: sendResult.messageId,
        dedupeKey: dKey, sentAt: new Date(),
        relatedEntityType: ctx.entityType ?? null,
        relatedEntityId: typeof ctx.entityId === 'number' ? ctx.entityId : null,
      });
      return 'sent';
    }

    await logEmail({
      templateKey: event, toEmail: recipient.email, toUserId: recipient.id,
      subject: recipientRendered.subject, status: 'FAILED',
      errorMessage: sendResult.error,
      dedupeKey: dKey,
      relatedEntityType: ctx.entityType ?? null,
      relatedEntityId: typeof ctx.entityId === 'number' ? ctx.entityId : null,
    });
    return 'failed';
  }

  private async enqueue(
    event: string,
    recipient: Recipient,
    payload: Record<string, any>,
    cadence: 'DAILY' | 'WEEKLY',
    ctx: NotifyContext,
  ): Promise<boolean> {
    const dKey = dedupeKey(`queue:${event}`, ctx.entityId ?? `${Date.now()}`, recipient.id);
    const scheduledFor = nextDigestWindow(cadence);
    try {
      await prisma.notificationQueueEntry.create({
        data: {
          user_id: recipient.id,
          template_key: event,
          payload: payload as any,
          scheduled_for: scheduledFor,
          dedupe_key: dKey,
        },
      });
      return true;
    } catch (err: any) {
      if (err?.code === 'P2002') return false;
      logger.error('[NotificationService] enqueue failed', { event, error: err?.message });
      return false;
    }
  }

  private async logSkip(
    event: string,
    recipient: Recipient,
    subject: string,
    status: 'SKIPPED_DISABLED' | 'SKIPPED_OFF' | 'SKIPPED_RATE_LIMIT' | 'SKIPPED_QUIET_HOURS' | 'SKIPPED_CIRCUIT_BREAKER' | 'SKIPPED_INACTIVE_USER' | 'SKIPPED_NOT_CONFIGURED',
    ctx: NotifyContext,
  ): Promise<void> {
    const dKey = dedupeKey(`${event}:${status.toLowerCase()}`, ctx.entityId ?? recipient.id, recipient.id);
    await logEmail({
      templateKey: event, toEmail: recipient.email, toUserId: recipient.id,
      subject, status, dedupeKey: dKey,
      relatedEntityType: ctx.entityType ?? null,
      relatedEntityId: typeof ctx.entityId === 'number' ? ctx.entityId : null,
    });
  }

  private async maybeNotifyAdminsOfTrip(): Promise<void> {
    if (!shouldNotifyAdminsOnTrip()) return;
    await this.notify('system.circuit_tripped', {
      threshold: 1000,
      count: 0,
      trippedAt: new Date(),
    }, { deepLinkPath: '/app/admin/email-templates' });
  }
}

/**
 * Computes the next digest delivery moment in the configured timezone.
 * - DAILY: today's 17:00 ET if before 17:00, else tomorrow's 17:00 ET
 * - WEEKLY: next Monday 08:00 ET
 *
 * Note: works in UTC for storage but resolves the wall-clock hour in
 * `mailConfig.timezone`. Slightly approximate around DST boundaries
 * (off by an hour at most) which is acceptable for digest emails.
 */
import { mailConfig as _mailConfig } from '../../config/environment';
function nextDigestWindow(cadence: 'DAILY' | 'WEEKLY'): Date {
  const now = new Date();
  const tz = _mailConfig.timezone;
  const localNowStr = now.toLocaleString('en-US', { timeZone: tz, hour12: false });
  const localNow = new Date(localNowStr);
  const offsetMs = localNow.getTime() - now.getTime();
  if (cadence === 'DAILY') {
    const target = new Date(localNow);
    target.setHours(17, 0, 0, 0);
    if (target <= localNow) target.setDate(target.getDate() + 1);
    return new Date(target.getTime() - offsetMs);
  }
  const target = new Date(localNow);
  target.setHours(8, 0, 0, 0);
  const day = target.getDay();
  const daysToMonday = (8 - day) % 7 || 7;
  target.setDate(target.getDate() + daysToMonday);
  return new Date(target.getTime() - offsetMs);
}

/**
 * Maps a template key to the user-facing entity name used in the footer
 * "you're receiving this because..." line. Keeps copy honest about what
 * the email is about without forcing every controller to thread the
 * label through.
 */
function deriveEventEntityLabel(event: string): string {
  if (event.startsWith('submission.') || event.startsWith('ai.review_')) return 'submission';
  if (event.startsWith('coaching.')) return 'coaching session';
  if (event.startsWith('writeup.')) return 'write-up';
  if (event.startsWith('dispute.')) return 'dispute';
  if (event.startsWith('digest.')) return 'digest';
  if (event.startsWith('auth.')) return 'account';
  return 'notification';
}

export const notificationService = new NotificationService();
export default notificationService;
