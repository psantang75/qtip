/**
 * Roll-up answer derivation for `role=ROLLUP` form questions.
 *
 * The form scoring engine (scoringEngine.ts) is unchanged. This module is a
 * pure transform that runs BEFORE scoring on the answers map:
 *
 *   raw answers (human typing or AI draft)
 *     -> processConditionalLogic (visibility map, unchanged)
 *     -> deriveRollupAnswers (this file - new)
 *     -> calculateFormScore (unchanged)
 *
 * For each role=ROLLUP question, we look at its rollup_member_question_ids,
 * filter to members currently visible per the supplied visibility map
 * (hidden members - e.g. an action question whose gate is NO - are skipped
 * so the rule naturally degrades to N/A when no gates fired), and apply the
 * configured rule.
 *
 * Mirrored byte-for-byte by backend/src/utils/rollupEngine.ts; any change
 * to the derivation rules MUST be made in both files. The shared fixture
 * __tests__/rollupEngine.fixture.json is consumed by both test suites to
 * keep them in lockstep.
 */

import type { Answer, Form, FormQuestion, FormRollupRule } from '../../types/form.types';

const NA_ANSWERS = new Set(['na', 'n/a']);
const NO_ANSWERS = new Set(['no', 'false']);
const YES_ANSWERS = new Set(['yes', 'true']);

export interface RollupNote {
  questionId: number;
  rule: FormRollupRule;
  derivedAnswer: 'yes' | 'no' | 'na';
  visibleMemberIds: number[];
  /** Human-readable explanation rendered in the audit form's tooltip. */
  reason: string;
}

export interface DeriveResult {
  /** A NEW answers map with rollup answers filled in / overwritten. */
  answers: Record<number, Answer>;
  /** Per-rollup-question audit trail of why the engine produced its value. */
  notes: RollupNote[];
}

/** Normalises any answer string into 'yes' | 'no' | 'na' | ''. */
function classifyAnswer(raw: string | undefined | null): 'yes' | 'no' | 'na' | '' {
  if (!raw) return '';
  const lower = String(raw).trim().toLowerCase();
  if (YES_ANSWERS.has(lower) || lower === '1' || lower === 'on') return 'yes';
  if (NO_ANSWERS.has(lower) || lower === '0' || lower === 'off') return 'no';
  if (NA_ANSWERS.has(lower)) return 'na';
  return '';
}

function indexQuestions(form: Form): Map<number, FormQuestion> {
  const out = new Map<number, FormQuestion>();
  form.categories.forEach((c) => {
    (c.questions || []).forEach((q) => {
      if (q.id !== undefined && q.id !== null) out.set(q.id, q);
    });
  });
  return out;
}

/**
 * Pure, idempotent. Producing the same input twice yields the same output.
 *
 * `visibilityMap` is supplied by the caller (the audit form already
 * computes it once per render via processConditionalLogic); a missing entry
 * for a member is treated as "visible" so callers that haven't run
 * processConditionalLogic still get sensible behaviour.
 */
export function deriveRollupAnswers(
  form: Form,
  rawAnswers: Record<number, Answer>,
  visibilityMap: Record<number, boolean>,
): DeriveResult {
  const out: Record<number, Answer> = { ...rawAnswers };
  const notes: RollupNote[] = [];
  if (!form?.categories) return { answers: out, notes };

  const byId = indexQuestions(form);

  form.categories.forEach((category) => {
    (category.questions || []).forEach((question) => {
      if (!question || question.id === undefined || question.role !== 'ROLLUP') return;
      const rule: FormRollupRule = question.rollup_rule || 'ANY_NO_TO_NO';
      const memberIds: number[] = Array.isArray(question.rollup_member_question_ids)
        ? question.rollup_member_question_ids
        : [];

      // Filter to members that (a) exist on this form and (b) are visible.
      const visibleMembers = memberIds.filter((mid) => {
        if (!byId.has(mid)) return false;
        const visible = visibilityMap[mid];
        // Default to visible when no entry exists - same fallback used by
        // formConditions.ts when a question has no conditions.
        return visible !== false;
      });

      const result = applyRule(rule, visibleMembers, out, question);

      out[question.id] = {
        question_id: question.id,
        answer: result.derivedAnswer,
        notes: result.reason,
      };

      notes.push({
        questionId: question.id,
        rule,
        derivedAnswer: result.derivedAnswer,
        visibleMemberIds: visibleMembers,
        reason: result.reason,
      });
    });
  });

  return { answers: out, notes };
}

/**
 * Rule application. Today only ANY_NO_TO_NO exists; the switch is here so
 * future rules slot in without restructuring the caller.
 */
function applyRule(
  rule: FormRollupRule,
  visibleMemberIds: number[],
  answers: Record<number, Answer>,
  rollupQuestion: FormQuestion,
): { derivedAnswer: 'yes' | 'no' | 'na'; reason: string } {
  const naAllowed = rollupQuestion.is_na_allowed === true;

  switch (rule) {
    case 'ANY_NO_TO_NO':
    default: {
      if (visibleMemberIds.length === 0) {
        return {
          derivedAnswer: naAllowed ? 'na' : 'yes',
          reason: naAllowed
            ? 'Auto-N/A: no sub-questions were applicable on this call.'
            : 'Auto-YES: no sub-questions were applicable on this call (N/A not allowed on this roll-up).',
        };
      }

      let anyNo = false;
      let allNa = true;
      let firstNoMember: number | undefined;
      for (const mid of visibleMemberIds) {
        const k = classifyAnswer(answers[mid]?.answer);
        if (k === 'no') { anyNo = true; if (firstNoMember === undefined) firstNoMember = mid; }
        if (k !== 'na') allNa = false;
      }

      if (anyNo) {
        return {
          derivedAnswer: 'no',
          reason: `Auto-NO: sub-question Q${firstNoMember} (and possibly others) answered NO.`,
        };
      }
      if (allNa) {
        return {
          derivedAnswer: naAllowed ? 'na' : 'yes',
          reason: naAllowed
            ? 'Auto-N/A: every visible sub-question was N/A.'
            : 'Auto-YES: every visible sub-question was N/A (N/A not allowed on this roll-up).',
        };
      }
      return {
        derivedAnswer: 'yes',
        reason: `Auto-YES: all ${visibleMemberIds.length} visible sub-questions are YES (or YES + N/A) with no NOs.`,
      };
    }
  }
}
