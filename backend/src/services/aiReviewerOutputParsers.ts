/**
 * AI Reviewer — output parsers & post-parse normalization.
 *
 * Pure, side-effect-free helpers that turn the model's raw JSON output into
 * sanitized, typed structures (playbook steps, coaching, timeline,
 * observations) and enforce the post-parse grading invariants
 * (evidence floor, self-consistency). Extracted verbatim from
 * `AIReviewerService.ts` to keep that engine file focused on orchestration;
 * these functions depend only on the submission/form TYPES (no prisma, no LLM
 * clients, no module state), which is exactly why they live here and are
 * trivially unit-testable — same rationale as the sibling
 * `aiReviewerParsing.ts`.
 *
 * Two functions MUTATE their `answers` argument in place
 * (`enforceEvidenceFloor` caps `ai_confidence`); that behavior is preserved
 * exactly as it was inline. `AIReviewerService` re-exports these via its
 * `_internal` object so the existing unit tests keep their import path.
 */

import type {
  CreateSubmissionAnswerDTO,
  AiTimelineItem,
  AiObservation,
  AiObservationKind,
  AiObservationSeverity,
  AiPlaybookStep,
  AiCoaching,
} from '../models/Submission';
import type { FormForPrompt } from './aiReviewerPrompt';

const PLAYBOOK_STATUSES: ReadonlySet<AiPlaybookStep['status']> = new Set([
  'done',
  'missing',
  'out_of_order',
  'not_applicable',
]);

/**
 * Parse and normalize the model's `playbook_steps[]` output.
 *
 * Backstop for a recurring failure mode where the model emits
 * `{ status: "done", evidence_note_date: null }` even after the prompt's
 * explicit self-validation rule. The schema invariant is: `done` REQUIRES a
 * real evidence anchor (note date, transcript timestamp, or attachment).
 * When the model breaks that invariant, we flip the row to `not_applicable`
 * — by far the most common correct status when evidence is absent because
 * the issue resolved earlier in the troubleshooting sequence (see the
 * RESOLUTION-STOP RULE in the universal Base prompt, `ai_base_prompt`
 * row keyed `base.v1`). Reviewers
 * can edit the verdict if `missing` was actually intended; we'd rather
 * default to "the agent legitimately stopped" than surface a phantom gap.
 */
export function parsePlaybookSteps(raw: unknown): AiPlaybookStep[] {
  if (!Array.isArray(raw)) return [];
  const out: AiPlaybookStep[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const step = String((item as any).step ?? '').trim();
    if (!step) continue;
    const statusRaw = String((item as any).status ?? '').trim().toLowerCase() as AiPlaybookStep['status'];
    let status = PLAYBOOK_STATUSES.has(statusRaw) ? statusRaw : 'done';
    const evRaw = (item as any).evidence_note_date;
    const evidence_note_date = evRaw == null || evRaw === '' ? null : String(evRaw).trim();
    if (status === 'done' && evidence_note_date === null) {
      status = 'not_applicable';
    }
    out.push({ step, evidence_note_date, status });
  }
  return out;
}

export function parseCoachingBlock(raw: unknown): AiCoaching {
  const empty: AiCoaching = { wins: [], gaps: [], next_actions: [] };
  if (!raw || typeof raw !== 'object') return empty;
  const arr = (k: string): string[] => {
    const v = (raw as any)[k];
    if (!Array.isArray(v)) return [];
    return v
      .map((x) => (typeof x === 'string' ? x.trim() : ''))
      .filter((s) => s.length > 0);
  };
  return {
    wins: arr('wins'),
    gaps: arr('gaps'),
    next_actions: arr('next_actions'),
  };
}

/**
 * Detect parse-time grade ↔ reasoning mismatches. Today this only catches
 * the "Steps followed = no with no missing playbook step" case (the most
 * common AI failure mode on process audits), but it's the right place to
 * grow more rules into.
 */
export function detectSelfConsistencyWarnings(
  answers: CreateSubmissionAnswerDTO[],
  playbookSteps: AiPlaybookStep[],
  form: FormForPrompt
): string[] {
  const warnings: string[] = [];
  const questionsById = new Map(form.questions.map((q) => [q.id, q]));
  const stepsFollowedNo = answers.filter((a) => {
    const q = questionsById.get(a.question_id);
    if (!q) return false;
    if (q.question_type !== 'YES_NO') return false;
    if (a.answer !== 'no') return false;
    // Best-effort match: any question whose text mentions "step" or
    // "process" and is graded "no" by the AI. This is intentionally
    // broad — a missed step is the highest-stakes parse-time mismatch
    // we have today.
    const text = q.question_text.toLowerCase();
    return text.includes('step') || text.includes('follow process') || text.includes('process');
  });
  if (stepsFollowedNo.length === 0) return warnings;
  const hasMissingStep = playbookSteps.some((s) => s.status === 'missing' || s.status === 'out_of_order');
  if (!hasMissingStep) {
    warnings.push(
      `Answer says "${stepsFollowedNo[0].answer}" on question_id=${stepsFollowedNo[0].question_id} (steps/process question) but playbook_steps[] has no missing/out_of_order row.`
    );
  }
  return warnings;
}

/**
 * Tier-2 evidence-floor enforcement (Phase F).
 *
 * Rule: any "positive verdict" (YES on YES_NO, RADIO/MULTI_SELECT options
 * with score > 0, SCALE > 0) MUST be backed by an evidence_quote that
 * is at least 20 chars AND contains a date or transcript-timestamp
 * anchor. Otherwise we cap that answer's `ai_confidence` at 0.5 and
 * push a self-consistency warning so the orchestrator's verification
 * trigger fires for that case.
 *
 * Why code, not prompt: the universal Base prompt has long carried
 * "AI graders are biased toward yes — when the evidence_quote is empty
 * for a yes verdict, prefer no", but the model routinely violates it
 * (this is the single biggest source of overconfident "yes" answers
 * we saw on closed cases). Moving the rule into post-parse code makes
 * it unconditional.
 *
 * Negative verdicts (NO on YES_NO, score-0 options on RADIO/MULTI_SELECT,
 * SCALE === 0) are intentionally left alone — an empty-evidence "no" is
 * the documented absent-evidence pattern in the Base prompt's
 * "Notes: Incomplete" guidance, so capping it would be wrong.
 *
 * MUTATES `answers` in place — same pattern as existing `parsePlaybookSteps`
 * which auto-corrects rows. Returns the per-answer warnings so the
 * caller can fold them into `selfConsistencyWarnings`.
 */
export function enforceEvidenceFloor(
  answers: CreateSubmissionAnswerDTO[],
  evidence: Record<number, { evidence_source?: string; evidence_quote?: string }>,
  form: FormForPrompt
): string[] {
  const warnings: string[] = [];
  const questionsById = new Map(form.questions.map((q) => [q.id, q]));
  // Anchor patterns: month-day ("Apr 28"), ISO date ("2026-05-13"),
  // numeric date ("4/28" or "04-28-2026"), or transcript timestamp
  // ("03:14" / "1:23:45"). Any of these proves the model pinned the
  // quote to a specific moment in evidence rather than paraphrasing.
  const anchorRe = /\b(\d{1,2}[:/-]\d{1,2}|\d{4}-\d{2}-\d{2}|\d{1,2}:\d{2}|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i;
  const MIN_QUOTE_CHARS = 20;
  for (const a of answers) {
    if (!isPositiveVerdict(a, questionsById.get(a.question_id))) continue;
    const ev = evidence[a.question_id];
    const quote = (ev?.evidence_quote ?? '').trim();
    const quoteLooksReal = quote.length >= MIN_QUOTE_CHARS && anchorRe.test(quote);
    // The evidence_source field (e.g. "Apr 28 by Bethany") often carries
    // the date even when the quote itself doesn't. Treat it as a valid
    // anchor when present so we don't false-positive on quotes that are
    // intrinsically dateless ("Customer requested refund.") but are
    // pinned to a specific note via evidence_source.
    const sourceLooksAnchored = anchorRe.test((ev?.evidence_source ?? '').trim());
    if (quoteLooksReal || (quote.length > 0 && sourceLooksAnchored)) continue;
    const before = a.ai_confidence ?? 1;
    if (before > 0.5) a.ai_confidence = 0.5;
    warnings.push(
      `Q${a.question_id} positive verdict "${a.answer}" lacks anchored evidence (quote_len=${quote.length}, anchored=${sourceLooksAnchored}); confidence capped from ${before.toFixed(2)} to 0.50`
    );
  }
  return warnings;
}

/**
 * Whether an answer represents a "positive" / scored verdict for its
 * question type. Used by `enforceEvidenceFloor` to decide which answers
 * need anchored evidence (negative verdicts get a free pass — empty
 * evidence on a "no" is the documented absent-evidence pattern).
 */
export function isPositiveVerdict(
  a: CreateSubmissionAnswerDTO,
  q: FormForPrompt['questions'][number] | undefined
): boolean {
  if (!q) return false;
  const v = String(a.answer ?? '').trim();
  if (!v) return false;
  switch (q.question_type) {
    case 'YES_NO':
      // NA always gets a pass (not a positive grade); only "yes" is
      // graded as positive evidence-bearing here.
      return v.toLowerCase() === 'yes';
    case 'RADIO':
      return (q.radio_options.find((o) => o.value === v)?.score ?? 0) > 0;
    case 'MULTI_SELECT':
      return v
        .split(',')
        .map((p) => p.trim())
        .some((p) => (q.radio_options.find((o) => o.value === p)?.score ?? 0) > 0);
    case 'SCALE': {
      const n = Number(v);
      return Number.isFinite(n) && n > 0;
    }
    default:
      return false;
  }
}

/**
 * Parse the AI's `timeline` array into a sanitized AiTimelineItem[].
 * Bad shapes log a warn and return [] — the timeline is advisory and
 * must never break the AI run.
 */
export function parseTimelineArray(raw: unknown): AiTimelineItem[] {
  if (!Array.isArray(raw)) return [];
  const out: AiTimelineItem[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const when = String((item as any).when ?? '').trim();
    const who = String((item as any).who ?? '').trim();
    const action = String((item as any).action ?? '').trim();
    if (!action) continue; // an empty action is meaningless
    const kbStepRaw = (item as any).kb_step;
    const kb_step = kbStepRaw == null || kbStepRaw === '' ? null : String(kbStepRaw).trim();
    out.push({ when, who, action, kb_step });
  }
  return out;
}

const OBSERVATION_KINDS: ReadonlySet<AiObservationKind> = new Set([
  'documentation',
  'best_practice',
  'cadence',
  'process_drift',
  'pii',
  'other',
]);

const OBSERVATION_SEVERITIES: ReadonlySet<AiObservationSeverity> = new Set(['info', 'warn']);

/**
 * Parse the AI's `observations` array into sanitized AiObservation[].
 * Unknown kinds bucket to 'other'; unknown severities default to 'info'.
 * Empty messages are dropped.
 */
export function parseObservationsArray(raw: unknown): AiObservation[] {
  if (!Array.isArray(raw)) return [];
  const out: AiObservation[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const message = String((item as any).message ?? '').trim();
    if (!message) continue;
    const kindRaw = String((item as any).kind ?? 'other').trim().toLowerCase() as AiObservationKind;
    const kind = OBSERVATION_KINDS.has(kindRaw) ? kindRaw : 'other';
    const sevRaw = String((item as any).severity ?? 'info').trim().toLowerCase() as AiObservationSeverity;
    const severity = OBSERVATION_SEVERITIES.has(sevRaw) ? sevRaw : 'info';
    const evidence = String((item as any).evidence ?? '').trim() || undefined;
    out.push({ kind, severity, message, evidence });
  }
  return out;
}
