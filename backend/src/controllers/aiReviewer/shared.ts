/**
 * Shared request-parsing helpers for the AI Reviewer controllers/routes.
 *
 * Extracted from `ai-reviewer.routes.ts` so the (large) route file and the
 * per-domain controllers being split out of it share ONE definition rather
 * than duplicating it. Keep this to tiny, pure, dependency-free helpers.
 */

/** Parse a value into a positive integer, or `null` when it isn't one. */
export function parsePositiveInt(raw: unknown): number | null {
  if (raw == null) return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}
