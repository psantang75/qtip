import prisma from '../../config/prisma';
import logger from '../../config/logger';
import type { EmailSendStatus } from '../../generated/prisma/client';

/**
 * Append-only audit of every email send / deliberate skip.
 *
 * Why an explicit logger module instead of inlining `prisma.emailLog.create`
 * in the call sites: idempotency. The unique `dedupe_key` constraint
 * sometimes produces P2002 race errors when two notify() calls fire in
 * the same tick (e.g. webhook retried). We swallow those so the higher
 * layer treats it as "already sent" — exactly what we want.
 */

export interface LogEmailInput {
  templateKey: string;
  toEmail: string;
  toUserId: number | null;
  subject: string;
  status: EmailSendStatus;
  errorMessage?: string | null;
  messageId?: string | null;
  dedupeKey: string;
  relatedEntityType?: string | null;
  relatedEntityId?: number | null;
  sentAt?: Date | null;
}

export async function logEmail(input: LogEmailInput): Promise<void> {
  try {
    await prisma.emailLog.create({
      data: {
        template_key:        input.templateKey,
        to_email:            input.toEmail,
        to_user_id:          input.toUserId ?? null,
        subject:             input.subject.slice(0, 1000),
        status:              input.status,
        error_message:       input.errorMessage ?? null,
        message_id:          input.messageId ?? null,
        dedupe_key:          input.dedupeKey,
        related_entity_type: input.relatedEntityType ?? null,
        related_entity_id:   input.relatedEntityId ?? null,
        sent_at:             input.sentAt ?? null,
      },
    });
  } catch (err: any) {
    if (err?.code === 'P2002') {
      logger.debug('[EmailLogger] duplicate dedupe_key, ignoring', {
        templateKey: input.templateKey, dedupeKey: input.dedupeKey,
      });
      return;
    }
    logger.error('[EmailLogger] failed to write log row', {
      templateKey: input.templateKey, error: err?.message,
    });
  }
}

export async function dedupeKeyExists(dedupeKey: string): Promise<boolean> {
  const row = await prisma.emailLog.findUnique({
    where: { dedupe_key: dedupeKey }, select: { id: true },
  });
  return !!row;
}
