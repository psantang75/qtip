/**
 * Backend QA scoring engine — system of record for submission scores.
 *
 * Two layers in this file:
 *
 *   1. The pure algorithm (`scoreForm`, `getQuestionScore`, `getMaxPossibleScore`,
 *      `buildVisibilityMap`) — operates on plain in-memory data. No DB access.
 *      Mirrors `frontend/src/utils/forms/scoringEngine.ts` so the live preview
 *      and the persisted score stay in lockstep. Any change to scoring rules
 *      (per-question math, conditional visibility, N/A handling, weighting, or
 *      the critical-fail cap rule) MUST be made in both files.
 *
 *   2. Prisma-backed wrappers (`calculateFormScore`,
 *      `calculateFormScoreBySubmissionId`, `recalculateScores`,
 *      `getScoreBreakdown`) — load the form/categories/questions/options/
 *      conditions out of the DB, hand them to the pure algorithm, and persist
 *      the result back to `submissions` and `score_snapshots`.
 *
 * Critical-fail rule: if any visible, scored question marked `is_critical`
 * receives a "no" answer, the final score is capped at the form's
 * `critical_cap_percent` (default 79). The cap is a ceiling, never a floor.
 */

import prisma from '../config/prisma';

interface Category {
  id: number;
  form_id: number;
  category_name: string;
  weight: number;
}

interface Question {
  id: number;
  category_id: number;
  question_text: string;
  question_type: 'YES_NO' | 'SCALE' | 'TEXT' | 'INFO_BLOCK' | 'RADIO' | 'SUB_CATEGORY' | 'MULTI_SELECT' | 'N_A';
  yes_value?: number;
  no_value?: number;
  na_value?: number;
  is_na_allowed?: boolean;
  scale_max?: number;
  sort_order?: number;
  is_critical?: boolean;
  conditions?: QuestionCondition[];
}

interface RadioOption {
  id: number;
  question_id: number;
  option_text: string;
  option_value: string;
  score: number;
  sort_order?: number;
}

interface QuestionCondition {
  id: number;
  question_id: number;
  target_question_id: number;
  condition_type: 'EQUALS' | 'NOT_EQUALS' | 'EXISTS' | 'NOT_EXISTS';
  target_value: string;
  logical_operator: 'AND' | 'OR';
  group_id: number;
}

interface Answer {
  question_id: number;
  answer: string;
  score?: number;
  notes?: string;
}

interface CategoryScore {
  raw: number;
  weighted: number;
  earnedPoints: number;
  possiblePoints: number;
  weightedNumerator: number;
  weightedDenominator: number;
}

interface FormScoreResult {
  total_score: number;
  raw_score: number;
  categoryScores: Record<number, CategoryScore>;
  critical_fail_count: number;
  score_capped: boolean;
  critical_cap_percent: number;
}

const DEFAULT_CRITICAL_CAP = 79.0;
const NON_SCORING_TYPES = new Set(['info', 'text', 'info_block', 'sub_category']);
const NA_ANSWERS = new Set(['na', 'n/a']);
const NO_ANSWERS = new Set(['no', 'false']);
const YES_LIKE = new Set(['yes', 'true', '1', 'on']);
const NO_LIKE = new Set(['no', 'false', '0', 'off']);

// ── Pure algorithm ──────────────────────────────────────────────────────────

function buildVisibilityMap(
  questions: Question[],
  answersMap: Record<number, Answer>,
  conditionsByQuestion: Record<number, QuestionCondition[]>,
): Record<number, boolean> {
  const excluded = new Set<number>();

  Object.entries(conditionsByQuestion).forEach(([questionIdStr, questionConditions]) => {
    const question_id = parseInt(questionIdStr);

    const groups: Record<number, QuestionCondition[]> = {};
    questionConditions.forEach((c) => {
      const g = c.group_id || 0;
      if (!groups[g]) groups[g] = [];
      groups[g].push(c);
    });

    const groupResults = Object.values(groups).map((groupConditions) =>
      groupConditions.every((condition) => {
        const targetAnswer = answersMap[condition.target_question_id];
        if (!targetAnswer) {
          return condition.condition_type === 'NOT_EXISTS';
        }
        const normalizedAnswer = String(targetAnswer.answer || '').trim().toLowerCase();
        const normalizedValue = String(condition.target_value || '').trim().toLowerCase();

        switch (condition.condition_type) {
          case 'EQUALS': {
            const answerIsYes = YES_LIKE.has(normalizedAnswer);
            const answerIsNo = NO_LIKE.has(normalizedAnswer);
            const expectsYes = YES_LIKE.has(normalizedValue);
            const expectsNo = NO_LIKE.has(normalizedValue);
            if ((answerIsYes && expectsYes) || (answerIsNo && expectsNo)) return true;
            return normalizedAnswer === normalizedValue;
          }
          case 'NOT_EQUALS': return normalizedAnswer !== normalizedValue;
          case 'EXISTS':     return normalizedAnswer !== '';
          case 'NOT_EXISTS': return normalizedAnswer === '';
          default:           return false;
        }
      }),
    );

    if (!groupResults.some((r) => r)) excluded.add(question_id);
  });

  const visibility: Record<number, boolean> = {};
  questions.forEach((q) => { visibility[q.id] = !excluded.has(q.id); });
  return visibility;
}

function getQuestionScore(
  question: Question,
  answer: string,
  radioOptionsMap: Record<number, RadioOption[]>,
): number {
  if (!answer) return 0;
  const questionType = question.question_type.toLowerCase();
  const answerLower = answer.toLowerCase();

  switch (questionType) {
    case 'yes_no':
      if (answerLower === 'yes' || answer === 'true') return question.yes_value !== undefined ? Number(question.yes_value) : 0;
      if (answerLower === 'no'  || answer === 'false') return question.no_value  !== undefined ? Number(question.no_value)  : 0;
      return 0;
    case 'scale': {
      const numericAnswer = parseInt(answer, 10);
      return !isNaN(numericAnswer) ? numericAnswer : 0;
    }
    case 'radio': {
      const opts = radioOptionsMap[question.id] || [];
      const selected = opts.find((o) => o.option_value === answer || o.option_text === answer);
      return selected?.score || 0;
    }
    case 'multi_select': {
      const opts = radioOptionsMap[question.id] || [];
      if (opts.length === 0 || !answer) return 0;
      const selected = answer.split(',').map((v) => v.trim()).filter(Boolean);
      return selected.reduce((sum, val) => {
        const opt = opts.find((o) => o.option_value === val || o.option_text === val);
        return sum + (opt?.score || 0);
      }, 0);
    }
    default:
      return 0;
  }
}

function getMaxPossibleScore(question: Question, radioOptionsMap: Record<number, RadioOption[]>): number {
  const questionType = question.question_type.toLowerCase();

  switch (questionType) {
    case 'yes_no':
      return question.yes_value !== undefined ? Number(question.yes_value) : 0;
    case 'scale':
      return question.scale_max || 5;
    case 'radio': {
      const opts = radioOptionsMap[question.id] || [];
      return opts.length > 0 ? Math.max(...opts.map((o) => o.score || 0)) : 0;
    }
    case 'multi_select': {
      const opts = radioOptionsMap[question.id] || [];
      return opts.reduce((sum, o) => sum + Math.max(0, o.score || 0), 0);
    }
    default:
      return 0;
  }
}

/**
 * Pure scoring algorithm. Takes already-loaded form structure and answers,
 * returns the score breakdown and the critical-fail cap result.
 */
function scoreForm(
  categories: Category[],
  questions: Question[],
  radioOptionsMap: Record<number, RadioOption[]>,
  conditionsByQuestion: Record<number, QuestionCondition[]>,
  answers: Answer[],
  criticalCapPercent: number,
): FormScoreResult {
  const answersMap: Record<number, Answer> = {};
  answers.forEach((a) => { answersMap[a.question_id] = a; });

  const visibilityMap = buildVisibilityMap(questions, answersMap, conditionsByQuestion);

  const questionsByCategory: Record<number, Question[]> = {};
  questions.forEach((q) => {
    if (!questionsByCategory[q.category_id]) questionsByCategory[q.category_id] = [];
    questionsByCategory[q.category_id].push(q);
  });

  const categoryScores: Record<number, CategoryScore> = {};
  let totalWeightedNumerator = 0;
  let totalWeightedDenominator = 0;
  let critical_fail_count = 0;

  categories.forEach((category) => {
    let earnedPoints = 0;
    let possiblePoints = 0;

    (questionsByCategory[category.id] || []).forEach((question) => {
      if (NON_SCORING_TYPES.has(question.question_type.toLowerCase())) return;
      if (!visibilityMap[question.id]) return;

      const answer = answersMap[question.id];
      const answerLower = (answer?.answer || '').toLowerCase();
      if (answer && NA_ANSWERS.has(answerLower) && question.is_na_allowed) return;

      possiblePoints += getMaxPossibleScore(question, radioOptionsMap);
      if (!answer) return;

      earnedPoints += getQuestionScore(question, answer.answer || '', radioOptionsMap);

      if (question.is_critical && NO_ANSWERS.has(answerLower)) {
        critical_fail_count += 1;
      }
    });

    const rawScore = possiblePoints > 0 ? (earnedPoints / possiblePoints) * 100 : 0;
    const categoryWeight = Number(category.weight) || 0;
    const weightedNumerator = earnedPoints * categoryWeight;
    const weightedDenominator = possiblePoints * categoryWeight;

    categoryScores[category.id] = {
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

  let raw_score = totalWeightedDenominator > 0
    ? (totalWeightedNumerator / totalWeightedDenominator) * 100
    : 0;
  raw_score = Math.round(raw_score * 100) / 100;

  let total_score = raw_score;
  let score_capped = false;
  if (critical_fail_count > 0 && raw_score > criticalCapPercent) {
    total_score = criticalCapPercent;
    score_capped = true;
  }

  return {
    total_score,
    raw_score,
    categoryScores,
    critical_fail_count,
    score_capped,
    critical_cap_percent: criticalCapPercent,
  };
}

// ── Prisma-backed wrappers ──────────────────────────────────────────────────

/**
 * Loads the form structure for `form_id` from the database and runs the pure
 * scoring algorithm against `answers`. The system-of-record entry point.
 */
export async function calculateFormScore(
  _connectionOrPrisma: any,
  form_id: number,
  answers: Answer[]
): Promise<FormScoreResult> {
  const categoriesRows = await prisma.formCategory.findMany({
    where: { form_id: form_id },
    orderBy: { sort_order: 'asc' },
  });
  const categories = categoriesRows as unknown as Category[];
  const categoryIds = categories.map((c) => c.id);

  const questionsRows = await prisma.formQuestion.findMany({
    where: { category_id: { in: categoryIds } },
    orderBy: [{ category_id: 'asc' }, { sort_order: 'asc' }],
  });
  const questions = questionsRows as unknown as Question[];
  const questionIds = questions.map((q) => q.id);

  const radioOptionsRows = await prisma.radioOption.findMany({
    where: { question_id: { in: questionIds } },
    orderBy: [{ question_id: 'asc' }, { sort_order: 'asc' }],
  });
  const radioOptionsMap: Record<number, RadioOption[]> = {};
  (radioOptionsRows as unknown as RadioOption[]).forEach((o) => {
    if (!radioOptionsMap[o.question_id]) radioOptionsMap[o.question_id] = [];
    radioOptionsMap[o.question_id].push(o);
  });

  const conditionsRows = await prisma.formQuestionCondition.findMany({
    where: { question_id: { in: questionIds } },
  });
  const conditionsByQuestion: Record<number, QuestionCondition[]> = {};
  conditionsRows.forEach((c) => {
    if (!conditionsByQuestion[c.question_id]) conditionsByQuestion[c.question_id] = [];
    conditionsByQuestion[c.question_id].push(c as unknown as QuestionCondition);
  });

  const formRow = await prisma.form.findUnique({
    where: { id: form_id },
    select: { critical_cap_percent: true },
  });
  const criticalCapPercent = formRow?.critical_cap_percent !== undefined && formRow?.critical_cap_percent !== null
    ? Number(formRow.critical_cap_percent)
    : DEFAULT_CRITICAL_CAP;

  return scoreForm(categories, questions, radioOptionsMap, conditionsByQuestion, answers, criticalCapPercent);
}

export async function calculateFormScoreBySubmissionId(
  _connection: any,
  submission_id: number
): Promise<{ total_score: number; scoreSnapshot: any[]; critical_fail_count: number; score_capped: boolean }> {
  try {
    const submission = await prisma.submission.findUnique({
      where: { id: submission_id },
      include: { submission_answers: { select: { question_id: true, answer: true, notes: true } } },
    });

    if (!submission) throw new Error(`Submission with ID ${submission_id} not found`);

    const answers = submission.submission_answers.map((a) => ({
      question_id: a.question_id,
      answer: a.answer || '',
      notes: a.notes || undefined,
    }));

    const categories = await prisma.formCategory.findMany({
      where: { form_id: submission.form_id },
      select: { id: true, category_name: true, weight: true },
    });

    const result = await calculateFormScore(null, submission.form_id, answers);

    const scoreSnapshot = Object.entries(result.categoryScores).map(([category_id, scores]) => {
      const category = categories.find((c) => c.id === parseInt(category_id));
      const categoryWeight = category ? Number(category.weight) : 0;

      return {
        category_id: parseInt(category_id),
        raw_score: scores.raw,
        weighted_score: scores.weightedNumerator,
        weighted_possible: scores.weightedDenominator,
        earned_points: scores.earnedPoints,
        possible_points: scores.possiblePoints,
        category_weight: categoryWeight,
      };
    });

    await saveScoreData(submission_id, result.total_score, scoreSnapshot, result.critical_fail_count, result.score_capped);

    return {
      total_score: result.total_score,
      scoreSnapshot,
      critical_fail_count: result.critical_fail_count,
      score_capped: result.score_capped,
    };
  } catch (error) {
    console.error('Error calculating form score by submission ID:', error);
    throw error;
  }
}

async function saveScoreData(
  submission_id: number,
  total_score: number,
  scoreSnapshot: any[],
  critical_fail_count: number = 0,
  score_capped: boolean = false,
): Promise<void> {
  try {
    const submission = await prisma.submission.findUnique({
      where: { id: submission_id },
      select: { submitted_by: true },
    });

    if (!submission) throw new Error('Submission not found');

    const scoreSnapshotJson = JSON.stringify(scoreSnapshot);

    await prisma.$transaction(async (tx) => {
      await tx.submission.update({
        where: { id: submission_id },
        data: {
          total_score: total_score,
          critical_fail_count,
          score_capped,
        },
      });

      const existing = await tx.scoreSnapshot.findFirst({ where: { submission_id: submission_id } });

      if (existing) {
        await tx.scoreSnapshot.update({
          where: { id: existing.id },
          data: { score: total_score, snapshot_data: scoreSnapshotJson },
        });
      } else {
        await tx.scoreSnapshot.create({
          data: {
            csr_id: submission.submitted_by,
            score: total_score,
            snapshot_date: new Date(),
            submission_id: submission_id,
            snapshot_data: scoreSnapshotJson,
          },
        });
      }
    });
  } catch (error) {
    console.error('Error saving score data:', error);
    throw error;
  }
}

export const recalculateScores = async (
  _connection: any,
  submissionIds: number[]
): Promise<Record<number, number>> => {
  const results: Record<number, number> = {};
  for (const submission_id of submissionIds) {
    try {
      const { total_score } = await calculateFormScoreBySubmissionId(null, submission_id);
      results[submission_id] = total_score;
    } catch (error) {
      console.error(`Error recalculating score for submission ${submission_id}:`, error);
      results[submission_id] = -1;
    }
  }
  return results;
};

export const getScoreBreakdown = async (
  _connection: any,
  submission_id: number
): Promise<{ total_score: number; categoryBreakdown: Record<string, any> }> => {
  try {
    const snapshot = await prisma.scoreSnapshot.findFirst({ where: { submission_id: submission_id } });

    if (!snapshot) {
      const { total_score, scoreSnapshot } = await calculateFormScoreBySubmissionId(null, submission_id);
      const categoryBreakdown = scoreSnapshot.reduce((acc, category) => {
        acc[category.category_id] = {
          raw_score: category.raw_score,
          weighted_score: category.weighted_score,
          weighted_possible: category.weighted_possible,
          earned_points: category.earned_points,
          possible_points: category.possible_points,
          category_weight: category.category_weight,
          training_penalty_applied: false,
        };
        return acc;
      }, {} as Record<string, any>);
      return { total_score, categoryBreakdown };
    }

    let snapshot_data: any[] = [];
    try {
      snapshot_data = JSON.parse(snapshot.snapshot_data || '[]');
    } catch {
      snapshot_data = [];
    }

    const categoryBreakdown = snapshot_data.reduce((acc, category) => {
      acc[category.category_id] = {
        raw_score: category.raw_score,
        weighted_score: category.weighted_score,
        weighted_possible: category.weighted_possible,
        earned_points: category.earned_points,
        possible_points: category.possible_points,
        category_weight: category.category_weight,
        training_penalty_applied: false,
      };
      return acc;
    }, {} as Record<string, any>);

    return { total_score: Number(snapshot.score), categoryBreakdown };
  } catch (error) {
    console.error('Error getting score breakdown:', error);
    throw error;
  }
};

export { calculateFormScore as default };
