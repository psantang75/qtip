/**
 * Genesys conversation ids reach QTIP by copy/paste, and what gets pasted is
 * often the whole Genesys Cloud URL the reviewer was looking at:
 *
 *   https://apps.usw2.pure.cloud/directory/#/analytics/interactions/4c397ac5-ec9a-40ed-9235-c046f2e6f927/admin%22
 *
 * (the trailing `%22` is a stray quote the copy picked up). Stored or looked up
 * verbatim, that string matches no call, no recording and no transcript.
 */

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

/**
 * Reduce pasted text to the conversation id inside it. Input with no id in it —
 * a legacy numeric call id, a half-typed id — is returned trimmed, so this only
 * ever strips surrounding noise and never rejects an entry.
 */
export function normalizeConversationId(raw: string): string {
  const trimmed = raw.trim()
  return UUID.exec(trimmed)?.[0] ?? trimmed
}
