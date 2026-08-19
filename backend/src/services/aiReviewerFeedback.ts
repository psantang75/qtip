/**
 * AI Reviewer — reviewer-facing feedback composition.
 *
 * Turns the model's `category_notes[]` + `kbCitations[]` into the HTML that
 * lands in the per-category `Feedback — <Category>` TEXT questions and the
 * bottom `AI Reviewer Feedback` box. Pure string/HTML assembly — depends only
 * on `escapeHtml`, the `CATEGORY_FEEDBACK_TEXT_PREFIX_RE` naming convention,
 * and the `FormForPrompt` TYPE (no prisma, no LLM clients, no module state).
 * Extracted verbatim from `AIReviewerService.ts` to keep that engine file
 * focused on orchestration; `AIReviewerService` re-exports the two composers
 * via its `_internal` object so the existing unit tests keep their import
 * path. `buildKbLinkifier` stays module-private (only the two composers use
 * it).
 */

import { escapeHtml } from './aiReviewerParsing';
import { CATEGORY_FEEDBACK_TEXT_PREFIX_RE } from '../repositories/MySQLFormRepository';
import type { FormForPrompt } from './aiReviewerPrompt';

/**
 * Linkify in-text mentions of any cited KB page name. Used by both the
 * per-category notes renderer and the bottom AI Reviewer Feedback
 * composer so KB references render as clickable links straight to the
 * BookStack page, regardless of which answer they land in.
 *
 * Matches the page name in quotes (the prompt instructs the model to
 * cite "by name" — e.g. *(per "Ticket Handling Process")*) and replaces
 * just the quoted name with an <a> tag. Longest names first so
 * "Ticket Handling Process" wins over a substring like "Process".
 *
 * Input MUST already be HTML-escaped — this function only rewrites
 * quoted name spans; it does not escape anything itself.
 */
function buildKbLinkifier(
  kbCitations: { id: number; name: string; url: string }[]
): (htmlEscaped: string) => string {
  const cites = kbCitations.filter((c) => c.name && c.url);
  const sortedByLen = [...cites].sort((a, b) => b.name.length - a.name.length);
  return (htmlEscaped: string): string => {
    let out = htmlEscaped;
    for (const c of sortedByLen) {
      const safeName = escapeHtml(c.name);
      const safeUrl = escapeHtml(c.url);
      const anchor = `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${safeName}</a>`;
      const escapedForRegex = safeName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // Match the quoted name in one of four ways:
      //  - Curly-quote pair  (… "Name" …, … 'Name' …)
      //  - HTML-escaped pair (&quot;Name&quot;) — the input is already
      //    escapeHtml'd in this pipeline, so straight ASCII quotes
      //    become &quot; before this regex runs. Matching the escape
      //    sequence lets KB citation linkification work end-to-end.
      const re = new RegExp(
        `(?:([\u2018\u2019\u201C\u201D])${escapedForRegex}\\1|(&quot;)${escapedForRegex}(&quot;))`,
        'g'
      );
      out = out.replace(re, (_m, q1: string | undefined, qOpen: string | undefined, qClose: string | undefined) => {
        if (q1) return `${q1}${anchor}${q1}`;
        return `${qOpen}${anchor}${qClose}`;
      });
    }
    return out;
  };
}

/**
 * Route the AI's `category_notes[]` to the correct per-category
 * `Feedback — <Category>` TEXT question on the form (when one exists).
 * Returns:
 *   - `perCategory`: Map<question_id, html> for each note we matched to
 *     a per-category Feedback TEXT question. The HTML is prefixed with
 *     "AI Review Notes — " so the human reviewer immediately recognises
 *     AI-authored content (matches the AI_REVIEW_NOTES_PREFIX constant
 *     in MySQLFormRepository).
 *   - `unmatched`: notes for categories that have no Feedback TEXT
 *     question. The bottom AI Reviewer Feedback composer renders these
 *     so no AI commentary is silently dropped on the floor.
 *
 * Matching is by (a) `category_name` equality (case-insensitive,
 * whitespace-trimmed) and (b) a TEXT question on that category whose
 * `question_text` starts with the `CATEGORY_FEEDBACK_TEXT_PREFIX_RE`
 * pattern (em-dash or hyphen tolerated). This is purely a naming
 * convention today — there is no `is_category_feedback` column on
 * `form_questions` — so the regex stays narrow on purpose. If the user
 * adds a schema flag later, swap the matching predicate without
 * changing the surrounding wiring.
 */
export function composeCategoryFeedback(
  categoryNotes: { category: string; notes: string }[],
  form: FormForPrompt,
  kbCitations: { id: number; name: string; url: string }[]
): {
  perCategory: Map<number, string>;
  unmatched: { category: string; notes: string }[];
} {
  const perCategory = new Map<number, string>();
  const unmatched: { category: string; notes: string }[] = [];
  const linkifyKb = buildKbLinkifier(kbCitations);

  // Pre-index TEXT feedback questions by lower-cased category_name. A
  // category can only have ONE feedback sink per form by convention —
  // if the form somehow has two we take the first sort-order match
  // (form.questions is already sorted by category sort_order then
  // question sort_order).
  const sinkByCategory = new Map<string, number>();
  for (const q of form.questions) {
    if ((q.question_type ?? '').toUpperCase() !== 'TEXT') continue;
    if (!CATEGORY_FEEDBACK_TEXT_PREFIX_RE.test(q.question_text ?? '')) continue;
    const key = (q.category_name ?? '').trim().toLowerCase();
    if (!key || sinkByCategory.has(key)) continue;
    sinkByCategory.set(key, q.id);
  }

  for (const note of categoryNotes) {
    const key = note.category.trim().toLowerCase();
    const qid = sinkByCategory.get(key);
    if (qid == null) {
      unmatched.push(note);
      continue;
    }
    const safeNotes = linkifyKb(escapeHtml(note.notes));
    // Plain paragraph layout — the per-category Feedback TEXT field is
    // small and reviewer-facing, so we avoid a heavy `<ul>` even when
    // the model emits multiple sentences. Newlines in the notes become
    // soft <br/>s so multi-sentence notes still render with breaks.
    const body = safeNotes.split(/\r?\n+/).join('<br/>');
    perCategory.set(qid, `<p><strong>AI Review Notes</strong> — ${body}</p>`);
  }

  return { perCategory, unmatched };
}

/**
 * Compose the bottom `AI Reviewer Feedback` HTML. Carries ONLY:
 *  - per-category notes whose category lacks a `Feedback — <Category>`
 *    TEXT question (so AI commentary never silently disappears).
 *  - the Knowledge Base Citations footer (cross-cutting clickable
 *    index; not "notes" per the 2026-05 reviewer ask "no other notes
 *    in the AI reviewer feedback at the bottom for now").
 *
 * The cross-cutting flat narrative the model emits in the text block
 * (Faithfulness / PII / Tone / Resolution one-liners) is intentionally
 * NOT rendered here — per the same ask. It remains accessible via the
 * call-log raw response for debugging; the visible audit surface lives
 * inside the per-category Feedback fields plus this fallback box.
 *
 * Escaping: every model-supplied string goes through escapeHtml()
 * before assembly. The downstream renderer (RichTextDisplay) also runs
 * DOMPurify, so this is belt-and-suspenders.
 */
export function composeBottomFeedback(parts: {
  unmatchedCategoryNotes: { category: string; notes: string }[];
  kbCitations: { id: number; name: string; url: string }[];
}): string {
  const cites = parts.kbCitations.filter((c) => c.name && c.url);
  const segments: string[] = [];
  const linkifyKb = buildKbLinkifier(cites);

  for (const note of parts.unmatchedCategoryNotes) {
    const safeCategory = escapeHtml(note.category);
    const safeNotes = linkifyKb(escapeHtml(note.notes)).split(/\r?\n+/).join('<br/>');
    segments.push(
      `<p><strong>AI Review Notes — ${safeCategory}</strong><br/>${safeNotes}</p>`
    );
  }

  if (segments.length === 0 && cites.length === 0) {
    // Empty-state safety net — the AI returned nothing routable to
    // this box. Tell the reviewer that explicitly rather than render a
    // blank field.
    segments.push(
      '<p><em>The AI Reviewer did not return any cross-category commentary or KB citations ' +
        'for this submission. See the per-category Feedback fields above and the Advisory ' +
        'Observations panel for the AI\'s per-category notes.</em></p>'
    );
  }

  if (cites.length > 0) {
    const citationItems = cites
      .map((c) => {
        const safeName = escapeHtml(c.name);
        const safeUrl = escapeHtml(c.url);
        return `<li><a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${safeName}</a></li>`;
      })
      .join('');
    segments.push(`<p><strong>Knowledge Base Citations:</strong></p><ul>${citationItems}</ul>`);
  }
  return segments.join('');
}
