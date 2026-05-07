import nodemailer, { type Transporter, type SendMailOptions } from 'nodemailer';
import { htmlToText } from 'html-to-text';
import crypto from 'crypto';
import { mailConfig } from '../../config/environment';
import logger from '../../config/logger';

/**
 * Industry-standard internal-mailer transport for QTIP.
 *
 * Design notes:
 * - Singleton transport, lazily constructed. When `mailConfig.enabled` is
 *   false (SMTP_HOST blank) every call becomes a logged no-op so a
 *   half-configured environment can never silently drop a password-reset.
 * - Headers we set on every send:
 *     Auto-Submitted: auto-generated   (RFC 3834 — kills OOO loops)
 *     List-ID + Precedence: bulk       (clean inbox filtering)
 *     X-QTIP-Template + X-QTIP-Entity  (debugging)
 *     Message-ID + In-Reply-To/References when threadKey provided
 * - Retries transient failures 3x with exponential backoff (1s/2s/4s).
 * - Auto-derives plaintext via html-to-text if caller didn't provide one.
 * - When `MAIL_OVERRIDE_RECIPIENT` is set (stage), every outbound `To` is
 *   rewritten to that address with the original recipient prepended to the
 *   subject. Standard "envelope rewrite" so testers can't spam real users.
 */

export interface EmailSendInput {
  to: string;
  subject: string;
  html: string;
  text?: string;
  /** Per-entity threading key, e.g. "dispute:42". Optional. */
  threadKey?: string;
  /** First Message-ID for the thread; second+ sends will In-Reply-To this. */
  inReplyTo?: string;
  /** Headers we attach for debugging / inbox filtering. */
  templateKey: string;
  entityRef?: { type: string; id: number | string };
  /**
   * When true, bypass the global EMAIL_DRY_RUN flag and actually deliver
   * the message through SMTP. Used by the admin "Send Test" action so
   * deliverability can be verified before flipping dry-run off in prod.
   * Has no effect when the transport itself is not configured.
   */
  forceLive?: boolean;
}

export interface EmailSendResult {
  ok: boolean;
  messageId?: string;
  error?: string;
}

const HOSTNAME_FOR_MESSAGE_ID = 'qtip.dm-us.com';

class EmailService {
  private transport: Transporter | null = null;
  private initAttempted = false;

  private ensureTransport(): Transporter | null {
    if (!mailConfig.enabled) return null;
    if (this.transport || this.initAttempted) return this.transport;
    this.initAttempted = true;

    try {
      this.transport = nodemailer.createTransport({
        host: mailConfig.host,
        port: mailConfig.port,
        secure: false,
        auth: mailConfig.user && mailConfig.password
          ? { user: mailConfig.user, pass: mailConfig.password }
          : undefined,
        tls: { rejectUnauthorized: false },
      });
      logger.info('[EmailService] Transport initialized', {
        host: mailConfig.host, port: mailConfig.port, dryRun: mailConfig.dryRun,
      });
    } catch (err) {
      logger.error('[EmailService] Failed to initialize transport', err);
      this.transport = null;
    }
    return this.transport;
  }

  isConfigured(): boolean {
    return mailConfig.enabled;
  }

  isDryRun(): boolean {
    return mailConfig.dryRun;
  }

  private buildHeaders(input: EmailSendInput): Record<string, string> {
    const headers: Record<string, string> = {
      'Auto-Submitted': 'auto-generated',
      'List-ID': '<qtip-notifications.dm-us.com>',
      'Precedence': 'bulk',
      'X-QTIP-Template': input.templateKey,
    };
    if (input.entityRef) {
      headers['X-QTIP-Entity'] = `${input.entityRef.type}:${input.entityRef.id}`;
    }
    if (input.inReplyTo) {
      headers['In-Reply-To'] = input.inReplyTo;
      headers['References'] = input.inReplyTo;
    }
    return headers;
  }

  private buildMessageId(threadKey?: string): string {
    const seed = threadKey || crypto.randomBytes(8).toString('hex');
    const safe = seed.replace(/[^a-z0-9._:-]/gi, '_');
    const nano = crypto.randomBytes(6).toString('hex');
    return `<${safe}.${nano}@${HOSTNAME_FOR_MESSAGE_ID}>`;
  }

  private rewriteRecipientForOverride(
    to: string,
    subject: string,
  ): { to: string; subject: string } {
    if (!mailConfig.overrideRecipient) return { to, subject };
    return {
      to: mailConfig.overrideRecipient,
      subject: `[stage->${to}] ${subject}`,
    };
  }

  /**
   * Sends an email. Always resolves; never throws. Caller is responsible
   * for writing email_log rows.
   */
  async send(input: EmailSendInput): Promise<EmailSendResult> {
    const transport = this.ensureTransport();
    const messageId = this.buildMessageId(input.threadKey);
    const text = input.text ?? htmlToText(input.html, { wordwrap: 100, selectors: [
      { selector: 'a', options: { hideLinkHrefIfSameAsText: true } },
      { selector: 'img', format: 'skip' },
    ]});

    const { to, subject } = this.rewriteRecipientForOverride(input.to, input.subject);

    const mailOptions: SendMailOptions = {
      from: { name: mailConfig.fromName, address: mailConfig.fromAddress },
      replyTo: mailConfig.fromAddress,
      to,
      subject,
      html: input.html,
      text,
      messageId,
      headers: this.buildHeaders(input),
    };

    if (!transport) {
      logger.warn('[EmailService] not_configured — dropping send', {
        templateKey: input.templateKey, to,
      });
      return { ok: false, error: 'not_configured' };
    }

    if (mailConfig.dryRun && !input.forceLive) {
      logger.info('[EmailService][DRY_RUN] would send', {
        templateKey: input.templateKey,
        to,
        subject,
        messageId,
        bodyPreview: text.slice(0, 240),
      });
      return { ok: true, messageId };
    }

    if (mailConfig.dryRun && input.forceLive) {
      logger.warn('[EmailService][FORCE_LIVE] bypassing DRY_RUN for test send', {
        templateKey: input.templateKey, to, subject,
      });
    }

    return await this.sendWithRetry(mailOptions, messageId, input.templateKey);
  }

  private async sendWithRetry(
    options: SendMailOptions,
    messageId: string,
    templateKey: string,
    attempt = 0,
  ): Promise<EmailSendResult> {
    const delays = [1000, 2000, 4000];
    try {
      const info = await this.transport!.sendMail(options);
      logger.info('[EmailService] sent', {
        templateKey, to: options.to, messageId: info.messageId || messageId,
      });
      return { ok: true, messageId: info.messageId || messageId };
    } catch (err: any) {
      const transient = this.isTransientError(err);
      if (transient && attempt < delays.length) {
        const delay = delays[attempt];
        logger.warn('[EmailService] transient send failure, retrying', {
          templateKey, attempt: attempt + 1, delay, error: err?.message,
        });
        await new Promise(r => setTimeout(r, delay));
        return this.sendWithRetry(options, messageId, templateKey, attempt + 1);
      }
      logger.error('[EmailService] send failed', {
        templateKey, to: options.to, error: err?.message, attempt,
      });
      return { ok: false, error: err?.message || 'send_failed' };
    }
  }

  private isTransientError(err: any): boolean {
    if (!err) return false;
    const code = String(err.code || '').toUpperCase();
    if (['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'ESOCKET', 'EAI_AGAIN'].includes(code)) return true;
    const responseCode = Number(err.responseCode);
    if (Number.isFinite(responseCode) && responseCode >= 400 && responseCode < 500) return true;
    if (Number.isFinite(responseCode) && responseCode >= 500 && responseCode < 510) return true;
    return false;
  }

  /** Quick health probe — verifies the SMTP connection. */
  async verify(): Promise<{ ok: boolean; error?: string }> {
    const transport = this.ensureTransport();
    if (!transport) return { ok: false, error: 'not_configured' };
    if (mailConfig.dryRun) return { ok: true };
    try {
      await transport.verify();
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err?.message || 'verify_failed' };
    }
  }
}

export const emailService = new EmailService();
export default emailService;
