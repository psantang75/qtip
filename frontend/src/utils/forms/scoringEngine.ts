/**
 * Frontend QA scoring engine.
 *
 * Runs the same scoring algorithm as the backend's `backend/src/utils/scoringUtil.ts`
 * against an in-memory `Form` object so the form builder Preview, the live
 * Submission UI, and the read-only Completed-form view can show category and
 * total scores without round-tripping the API on every keystroke.
 *
 * The backend remains the system of record — its score is what gets persisted
 * to `submissions.total_score`, `critical_fail_count`, and `score_capped`. Any
 * change to the algorithm (per-question scoring, conditional visibility, N/A
 * handling, weighting, or the critical-fail cap rule) MUST be made in both
 * places to keep the live preview consistent with the saved score.
 *
 * Critical-fail rule: if any visible, scored question marked `is_critical` is
 * answered "no", the final score is capped at `form.critical_cap_percent`
 * (default 79). The cap is a ceiling, never a floor.
 */
import type { Form, Answer, FormQuestion, RadioOption } from '../../types/form.types';
import { processConditionalLogic } from './formConditions';

export interface CategoryScoreBreakdown {
  raw: number;
  weighted: number;
  earnedPoints: number;
  possiblePoints: number;
  weightedNumerator: number;
  weightedDenominator: number;
}

export interface FormScoreResult {
  totalScore: number;
  rawScore: number;
  criticalFailCount: number;
  scoreCapped: boolean;
  criticalCapPercent: number;
  categoryScores: Record<number, CategoryScoreBreakdown>;
}

const DEFAULT_CRITICAL_CAP = 79.0;
const NA_ANSWERS = new Set(['na', 'n/a']);
const NO_ANSWERS = new Set(['no', 'false']);

const isNonScoringType = (type: string): boolean =>
  type === 'info_block' || type === 'text' || type === 'sub_category';

const resolveCriticalCap = (form: Form): number =>
  form?.critical_cap_percent !== undefined && form?.critical_cap_percent !== null
    ? Number(form.critical_cap_percent)
    : DEFAULT_CRITICAL_CAP;

export const calculateFormScore = (
  form: Form,
  answers: Record<number, Answer>,
): FormScoreResult => {
  const criticalCapPercent = resolveCriticalCap(form);

  if (!form?.categories || !Array.isArray(form.categories) || form.categories.length === 0) {
    return {
      totalScore: 0,
      rawScore: 0,
      criticalFailCount: 0,
      scoreCapped: false,
      criticalCapPercent,
      categoryScores: {},
    };
  }

  const answerStrings: Record<number, string> = {};
  Object.entries(answers).forEach(([id, a]) => {
    answerStrings[Number(id)] = a.answer || '';
  });
  const visibilityMap = processConditionalLogic(form, answerStrings);

  const categoryScores: Record<number, CategoryScoreBreakdown> = {};
  let totalWeightedNumerator = 0;
  let totalWeightedDenominator = 0;
  let criticalFailCount = 0;

  form.categories.forEach((category, index) => {
    const categoryId = category.id ?? (index + 1) * -1000;
    if (!category.id) category.id = categoryId;

    let earnedPoints = 0;
    let possiblePoints = 0;

    (category.questions || []).forEach((question, questionIndex) => {
      if (!question.id) {
        question.id = -(categoryId * 1000 + questionIndex + 1);
      }

      if (isNonScoringType(question.question_type.toLowerCase())) return;
      if (!visibilityMap[question.id]) return;

      const answer = answers[question.id];
      const answerLower = (answer?.answer || '').toLowerCase();
      if (answer && NA_ANSWERS.has(answerLower) && question.is_na_allowed) return;

      possiblePoints += getMaxPossibleScore(question);
      if (!answer) return;

      earnedPoints += getQuestionScore(question, answer.answer || '');

      if (question.is_critical && NO_ANSWERS.has(answerLower)) {
        criticalFailCount += 1;
      }
    });

    const rawScore = possiblePoints > 0 ? (earnedPoints / possiblePoints) * 100 : 0;
    const categoryWeight = Number(category.weight) || 0;
    const weightedNumerator = earnedPoints * categoryWeight;
    const weightedDenominator = possiblePoints * categoryWeight;

    categoryScores[categoryId] = {
      raw: rawScore,
      weighted: rawScore * categoryWeight,
      earnedPoints,
      possiblePoints,
      weightedNumerator,
      weightedDenominator,
    };

    if (possiblePoints > 0) {
      totalWeightedNumerator += weightedNumerator;
      totalWeightedDenominator += weightedDenominator;
    }
  });

  let rawScore = totalWeightedDenominator > 0
    ? (totalWeightedNumerator / totalWeightedDenominator) * 100
    : 0;
  rawScore = Math.round(rawScore * 100) / 100;

  let totalScore = rawScore;
  let scoreCapped = false;
  if (criticalFailCount > 0 && rawScore > criticalCapPercent) {
    totalScore = criticalCapPercent;
    scoreCapped = true;
  }

  return {
    totalScore,
    rawScore,
    criticalFailCount,
    scoreCapped,
    criticalCapPercent,
    categoryScores,
  };
};

export const getQuestionScore = (question: FormQuestion, answer: string): number => {
  if (!answer) return 0;
  const questionType = question.question_type.toLowerCase();
  const answerLower = answer.toLowerCase();

  switch (questionType) {
    case 'yes_no':
      if (answerLower === 'yes' || answer === 'true') {
        return question.yes_value !== undefined
          ? Number(question.yes_value)
          : (question.score_if_yes !== undefined ? Number(question.score_if_yes) : 0);
      }
      if (answerLower === 'no' || answer === 'false') {
        return question.no_value !== undefined
          ? Number(question.no_value)
          : (question.score_if_no !== undefined ? Number(question.score_if_no) : 0);
      }
      return 0;

    case 'scale': {
      const numericAnswer = parseInt(answer, 10);
      return !isNaN(numericAnswer) ? numericAnswer : 0;
    }

    case 'radio': {
      const radioOptions = question.radio_options || [];
      const selectedOption = radioOptions.find((opt: RadioOption) =>
        opt.option_value === answer || opt.option_text === answer,
      );
      return selectedOption?.score || 0;
    }

    case 'multi_select': {
      const multiOptions = question.radio_options || [];
      if (multiOptions.length === 0 || !answer) return 0;
      const selected = answer.split(',').map((v: string) => v.trim()).filter(Boolean);
      return selected.reduce((sum: number, val: string) => {
        const opt = multiOptions.find((o: RadioOption) => o.option_value === val || o.option_text === val);
        return sum + (opt?.score || 0);
      }, 0);
    }

    default:
      return 0;
  }
};

export const getMaxPossibleScore = (question: FormQuestion): number => {
  const questionType = question.question_type.toLowerCase();

  switch (questionType) {
    case 'yes_no':
      return question.yes_value !== undefined
        ? Number(question.yes_value)
        : (question.score_if_yes !== undefined ? Number(question.score_if_yes) : 0);

    case 'scale':
      return question.max_scale ?? question.scale_max ?? 5;

    case 'radio': {
      const radioOptions = question.radio_options || [];
      if (radioOptions.length === 0) return 0;
      return Math.max(...radioOptions.map((opt: RadioOption) => opt.score || 0));
    }

    case 'multi_select': {
      const multiOpts = question.radio_options || [];
      return multiOpts.reduce((sum: number, opt: RadioOption) => sum + Math.max(0, opt.score || 0), 0);
    }

    default:
      return 0;
  }
};
