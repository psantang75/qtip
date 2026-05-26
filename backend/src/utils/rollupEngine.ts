/**
 * Roll-up answer derivation for `role=ROLLUP` form questions.
 *
 * Server-side mirror of frontend/src/utils/forms/rollupEngine.ts. The two
 * files must stay byte-for-byte equivalent in algorithm; the shared test
 * fixture (`__tests__/rollupEngine.fixture.json` on both sides) is loaded
 * by both suites so they fail in lockstep if anyone drifts.
 *
 * The scoring engine (scoringUtil.ts) is unchanged. This module is a pure
 * transform that runs BEFORE scoring on the answers map:
 *
 *   raw answers (human or AI)
 *     -> buildVisibilityMap (unchanged, inside scoringUtil)
 *     -> deriveRollupAnswers (this file)
 *     -> scoreForm (unchanged)
 *
 * The submission write path (SubmissionService) calls this just before
 * persisting answers so the DB stores the engine's canonical value for
 * every ROLLUP question.
 */

export type RollupRule = 'ANY_NO_TO_NO';

export interface RollupQuestionShape {
  id: number;
  role?: 'DETAIL' | 'ROLLUP' | string | null;
  rollup_rule?: RollupRule | string | null;
  rollup_member_question_ids?: number[] | null;
  is_na_allowed?: boolean;
}

export interface RollupAnswerShape {
  question_id: number;
  answer: string;
  notes?: string;
}

export interface RollupNote {
  questionId: number;
  rule: RollupRule;
  derivedAnswer: 'yes' | 'no' | 'na';
  visibleMemberIds: number[];
  reason: string;
}

export interface DeriveResult {
  answers: Record<number, RollupAnswerShape>;
  notes: RollupNote[];
}

const NA_ANSWERS = new Set(['na', 'n/a']);
const NO_ANSWERS = new Set(['no', 'false']);
const YES_ANSWERS = new Set(['yes', 'true']);

function classifyAnswer(raw: string | undefined | null): 'yes' | 'no' | 'na' | '' {
  if (!raw) return '';
  const lower = String(raw).trim().toLowerCase();
  if (YES_ANSWERS.has(lower) || lower === '1' || lower === 'on') return 'yes';
  if (NO_ANSWERS.has(lower) || lower === '0' || lower === 'off') return 'no';
  if (NA_ANSWERS.has(lower)) return 'na';
  return '';
}

/**
 * Pure, idempotent. Producing the same input twice yields the same output.
 *
 * `visibilityMap` is supplied by the caller (callers usually run
 * buildVisibilityMap from scoringUtil first); a missing entry for a member
 * is treated as visible.
 */
export function deriveRollupAnswers(
  questions: RollupQuestionShape[],
  rawAnswers: Record<number, RollupAnswerShape>,
  visibilityMap: Record<number, boolean>,
): DeriveResult {
  const out: Record<number, RollupAnswerShape> = { ...rawAnswers };
  const notes: RollupNote[] = [];

  const byId = new Map<number, RollupQuestionShape>();
  questions.forEach((q) => { if (q && typeof q.id === 'number') byId.set(q.id, q); });

  for (const question of questions) {
    if (!question || question.role !== 'ROLLUP') continue;
    const rule: RollupRule = (question.rollup_rule as RollupRule) || 'ANY_NO_TO_NO';
    const memberIds: number[] = Array.isArray(question.rollup_member_question_ids)
      ? question.rollup_member_question_ids
      : [];

    const visibleMembers = memberIds.filter((mid) => {
      if (!byId.has(mid)) return false;
      const visible = visibilityMap[mid];
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
  }

  return { answers: out, notes };
}

function applyRule(
  rule: RollupRule,
  visibleMemberIds: number[],
  answers: Record<number, RollupAnswerShape>,
  rollupQuestion: RollupQuestionShape,
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
