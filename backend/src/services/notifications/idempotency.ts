/**
 * Recipient-scoped dedupe keys for the email_log + notification_queue
 * UNIQUE constraints. Same event firing twice for the same recipient is
 * silently dropped at the DB layer; different recipients receive their
 * own copies (so a dispute opens email goes to QA AND to manager
 * without one blocking the other).
 *
 * Format: "<event>:<entity-id>:user_id=<recipient>"
 *   e.g. "dispute.opened:42:user_id=87"
 *
 * For events without a clean entity id (digests), include a window key
 * so each window's send has its own dedupe row.
 */

export function dedupeKey(event: string, entityId: number | string, userId: number): string {
  return `${event}:${entityId}:user_id=${userId}`;
}

export function digestDedupeKey(event: string, userId: number, windowStart: Date): string {
  return `${event}:user_id=${userId}:window=${windowStart.toISOString().slice(0, 13)}`;
}

export function resendKey(originalKey: string): string {
  return `${originalKey}:resend:${Date.now()}`;
}
