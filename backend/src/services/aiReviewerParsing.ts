/**
 * AIReviewerService — pure parsing / formatting utilities.
 *
 * Leaf-level, side-effect-free helpers extracted from `AIReviewerService.ts`
 * so the orchestrator shrinks and these stay independently testable. Nothing
 * here touches Prisma, the CRM, the model clients, or module state.
 */

/** Merge two arrays of strings, dropping duplicates, preserving order. */
export function mergeUniqueStrings(a: string[] | undefined, b: string[] | undefined): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of [...(a ?? []), ...(b ?? [])]) {
    if (!seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}

/**
 * Parse a model response into JSON, tolerating ```json fences and JSON
 * embedded in prose. Returns null when nothing parseable is found.
 */
export function tryParseJson(text: string): any | null {
  const stripped = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
  try {
    return JSON.parse(stripped);
  } catch {
    // Sometimes the model puts JSON inside a paragraph — try the first {...} span.
    const match = stripped.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        return null;
      }
    }
    return null;
  }
}

/** Clamp a raw confidence to [0,1] at two-decimal precision (DECIMAL(3,2)). */
export function clampConfidence(raw: unknown): number | null {
  if (raw == null) return null;
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) return null;
  if (n < 0) return 0;
  if (n > 1) return 1;
  // Two-decimal storage matches the DECIMAL(3,2) column.
  return Math.round(n * 100) / 100;
}

/** Clamp a raw signed delta to [min,max] at two-decimal precision; non-finite → 0. */
export function clampDelta(raw: unknown, min: number, max: number): number {
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) return 0;
  if (n < min) return min;
  if (n > max) return max;
  return Math.round(n * 100) / 100;
}

/** Escape a string for safe interpolation into HTML feedback. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
