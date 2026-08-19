/**
 * AI Reviewer — answer validation & NA-gate guards.
 *
 * Post-parse answer normalization for the AI grading pipeline:
 *   - `validateAnswerForQuestion` coerces one model-emitted value into the
 *     canonical persisted form for its question type (or null to skip).
 *   - `applyNaGateGuards` flips a parent "summary" YES_NO answer from NO → NA
 *     when all of its sibling opportunity gates resolved to NO.
 *
 * Both depend only on the submission/form TYPES plus `logger` (no prisma, no
 * LLM clients, no module state). Extracted verbatim from `AIReviewerService.ts`
 * to keep that engine file focused on orchestration; `applyNaGateGuards` is
 * re-exported via `AIReviewerService._internal` so the existing unit tests
 * keep their import path.
 */

import logger from '../config/logger';
import type { CreateSubmissionAnswerDTO } from '../models/Submission';
import type { FormForPrompt } from './aiReviewerPrompt';

/**
 * Pattern-driven NA gate guard. Identifies parent "summary" questions
 * whose rubric defines an N/A precondition keyed off a small set of
 * sibling "opportunity" questions, and flips the parent to 'na' when
 * all of its gates resolved to 'no'. Works across form versions
 * (99018, 99019, future revisions) because we match on question text
 * + category, not on hardcoded question IDs that change every save.
 *
 * Current parents covered:
 *   - Contact Management → "Were all required contact-management actions handled correctly?"
 *     Gates: questions in same category whose text starts with
 *     "Did the call provide an opportunity",
 *     "Did the customer reference a person not currently in the CRM",
 *     "Did the customer indicate someone has left",
 *     "Did the call indicate a contact owner/role change"
 *   - Hold / Transfer → "Were all hold and transfer procedures followed correctly?"
 *     Gates: questions in same category whose text starts with
 *     "Did the agent place the customer on hold at any point",
 *     "Did a call transfer take place"
 *
 * Returns a list of flips for logging / surfacing as self-consistency
 * warnings. Mutates the answers array in place — caller's `out` is
 * updated when a flip applies.
 */
interface NaGateConfig {
  parentTextPrefix: string;
  categoryNameContains: string;
  gateTextPrefixes: string[];
}
const NA_GATE_CONFIGS: readonly NaGateConfig[] = [
  {
    parentTextPrefix: 'were all required contact-management actions',
    categoryNameContains: 'contact',
    gateTextPrefixes: [
      'did the call provide an opportunity',
      'did the customer reference a person not currently in the crm',
      'did the customer indicate someone has left',
      'did the call indicate a contact owner',
    ],
  },
  {
    parentTextPrefix: 'were all hold and transfer procedures',
    categoryNameContains: 'transfer',
    gateTextPrefixes: [
      'did the agent place the customer on hold at any point',
      'did a call transfer take place',
    ],
  },
  // Workstream C1: clarifying-questions parent gated on troubleshooting.
  // When the call wasn't a troubleshooting call (gate q "Did the call
  // require troubleshooting?" = no), there's no diagnostic exchange to
  // grade — flip the parent from NO -> NA so direct-action calls
  // (password reset, remote-code retrieval, billing-only) don't get
  // penalized for skipping diagnostics they didn't need.
  //
  // Single-gate variant: the helper's "all gates NO -> flip parent NA"
  // semantics work correctly for a one-element gate set (the set of one
  // is all-NO iff that one is NO).
  {
    parentTextPrefix: 'did the agent ask clarifying questions',
    categoryNameContains: 'problem',
    gateTextPrefixes: ['did the call require troubleshooting'],
  },
];

interface NaGateFlip {
  qid: number;
  reason: string;
}

export function applyNaGateGuards(
  answers: CreateSubmissionAnswerDTO[],
  form: FormForPrompt
): NaGateFlip[] {
  const flips: NaGateFlip[] = [];
  const answerByQid = new Map(answers.map((a) => [a.question_id, a]));

  for (const cfg of NA_GATE_CONFIGS) {
    const parentQuestion = form.questions.find((q) => {
      const txt = q.question_text.trim().toLowerCase();
      const cat = (q.category_name || '').toLowerCase();
      return (
        q.question_type === 'YES_NO' &&
        q.is_na_allowed &&
        txt.startsWith(cfg.parentTextPrefix) &&
        cat.includes(cfg.categoryNameContains)
      );
    });
    if (!parentQuestion) continue;

    const parentAnswer = answerByQid.get(parentQuestion.id);
    if (!parentAnswer || parentAnswer.answer !== 'no') continue;

    const gateQuestions = form.questions.filter((q) => {
      if (q.id === parentQuestion.id) return false;
      if (q.question_type !== 'YES_NO') return false;
      if ((q.category_name || '') !== parentQuestion.category_name) return false;
      const txt = q.question_text.trim().toLowerCase();
      return cfg.gateTextPrefixes.some((prefix) => txt.startsWith(prefix));
    });
    if (gateQuestions.length === 0) continue;

    const allGatesNo = gateQuestions.every((gq) => {
      const ga = answerByQid.get(gq.id);
      return ga != null && ga.answer === 'no';
    });
    if (!allGatesNo) continue;

    parentAnswer.answer = 'na';
    parentAnswer.ai_confidence = Math.max(parentAnswer.ai_confidence ?? 0, 0.95);
    flips.push({
      qid: parentQuestion.id,
      reason: `all ${gateQuestions.length} opportunity gate(s) answered 'no' in category "${parentQuestion.category_name}"`,
    });
  }

  return flips;
}

export function validateAnswerForQuestion(value: unknown, question: FormForPrompt['questions'][number]): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  switch (question.question_type) {
    case 'YES_NO': {
      const lower = s.toLowerCase();
      if (lower === 'yes' || lower === '1' || lower === 'true') return 'yes';
      if (lower === 'no' || lower === '0' || lower === 'false') return 'no';
      if (lower === 'na' || lower === 'n/a') {
        // Persist lowercase 'na' to match the lowercase 'yes' / 'no' convention
        // emitted above. The editable form renderer compares against lowercase
        // option values, so uppercase 'NA' rendered as unmarked. Other consumers
        // (analytics, scoreRenderer) already compare case-insensitively.
        if (question.is_na_allowed) return 'na';
        // Graceful fallback: model picked NA on a question that doesn't allow it.
        // Treat as "no" rather than crashing the whole review — documented evidence
        // of the step is what we asked for, and the model couldn't find it.
        logger.warn(
          `[AI REVIEWER] question_id=${question.id} returned "NA" but is_na_allowed=false; coercing to "no".`
        );
        return 'no';
      }
      return null;
    }
    case 'TEXT':
      return s;
    case 'SCALE': {
      const n = Number(s);
      return Number.isFinite(n) ? String(n) : null;
    }
    case 'RADIO': {
      // Strict contract: the value MUST be one of the form's defined
      // options. Accept either option_value or option_text, case-
      // insensitively (pure format normalisation, not inference).
      // Authors often use opaque values like "1"/"2" with meaningful
      // labels ("Inbound"/"Outbound"); the model may return either
      // form. Always normalise back to option_value on persist.
      // On miss, return null -> graceful skip + reviewer warning in
      // mapClaudeOutputToAnswers. No heuristic inference.
      const needle = s.toLowerCase();
      const opt = question.radio_options.find(
        (o) => o.value.toLowerCase() === needle || (o.text ?? '').toLowerCase() === needle
      );
      return opt ? opt.value : null;
    }
    case 'MULTI_SELECT': {
      const parts = s.split(',').map((p) => p.trim().toLowerCase()).filter(Boolean);
      const matched = parts
        .map((p) =>
          question.radio_options.find(
            (o) => o.value.toLowerCase() === p || (o.text ?? '').toLowerCase() === p
          )?.value
        )
        .filter((v): v is string => !!v);
      return matched.length > 0 ? matched.join(',') : null;
    }
    default:
      return s;
  }
}
