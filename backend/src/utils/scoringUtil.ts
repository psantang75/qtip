/**
 * Scoring Utility - Backend Implementation using Prisma
 *
 * Handles calculation of scores for QA forms.
 * THIS IMPLEMENTATION MATCHES THE WORKING FRONTEND LOGIC EXACTLY
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
  categoryScores: Record<number, CategoryScore>;
}

/**
 * Calculate form score - matches frontend scoringAdapter.ts calculateFormScore
 */
export async function calculateFormScore(
  _connectionOrPrisma: any,
  form_id: number,
  answers: Answer[]
): Promise<FormScoreResult> {
  const answersMap: Record<number, Answer> = {};
  answers.forEach((answer) => { answersMap[answer.question_id] = answer; });

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
  const allQuestions = questionsRows as unknown as Question[];

  const questionIds = allQuestions.map((q) => q.id);

  const radioOptionsRows = await prisma.radioOption.findMany({
    where: { question_id: { in: questionIds } },
    orderBy: [{ question_id: 'asc' }, { sort_order: 'asc' }],
  });
  const radioOptions = radioOptionsRows as unknown as RadioOption[];

  const radioOptionsMap: Record<number, RadioOption[]> = {};
  radioOptions.forEach((option) => {
    if (!radioOptionsMap[option.question_id]) radioOptionsMap[option.question_id] = [];
    radioOptionsMap[option.question_id].push(option);
  });

  const conditionsRows = await prisma.formQuestionCondition.findMany({
    where: { question_id: { in: questionIds } },
  });

  const conditionsByQuestion: Record<number, QuestionCondition[]> = {};
  conditionsRows.forEach((condition) => {
    if (!conditionsByQuestion[condition.question_id]) conditionsByQuestion[condition.question_id] = [];
    conditionsByQuestion[condition.question_id].push(condition as unknown as QuestionCondition);
  });

  const excludedQuestions = new Set<number>();

  Object.entries(conditionsByQuestion).forEach(([questionIdStr, questionConditions]) => {
    const question_id = parseInt(questionIdStr);

    const conditionGroups: Record<number, QuestionCondition[]> = {};
    questionConditions.forEach((condition) => {
      const group_id = condition.group_id || 0;
      if (!conditionGroups[group_id]) conditionGroups[group_id] = [];
      conditionGroups[group_id].push(condition);
    });

    const groupResults = Object.values(conditionGroups).map((groupConditions) => {
      return groupConditions.every((condition) => {
        const targetAnswer = answersMap[condition.target_question_id];
        let conditionMet = false;

        if (targetAnswer) {
          const normalizedTargetAnswer = String(targetAnswer.answer || '').trim().toLowerCase();
          const normalizedTargetValue = String(condition.target_value || '').trim().toLowerCase();

          switch (condition.condition_type) {
            case 'EQUALS': {
              const isYesValue = ['yes', 'true', '1', 'on'].includes(normalizedTargetAnswer);
              const isNoValue = ['no', 'false', '0', 'off'].includes(normalizedTargetAnswer);
              const expectedYes = ['yes', 'true', '1', 'on'].includes(normalizedTargetValue);
              const expectedNo = ['no', 'false', '0', 'off'].includes(normalizedTargetValue);
              if ((isYesValue && expectedYes) || (isNoValue && expectedNo)) {
                conditionMet = true;
              } else {
                conditionMet = normalizedTargetAnswer === normalizedTargetValue;
              }
              break;
            }
            case 'NOT_EQUALS':
              conditionMet = normalizedTargetAnswer !== normalizedTargetValue;
              break;
            case 'EXISTS':
              conditionMet = normalizedTargetAnswer !== '';
              break;
            case 'NOT_EXISTS':
              conditionMet = normalizedTargetAnswer === '';
              break;
          }
        } else if (condition.condition_type === 'NOT_EXISTS') {
          conditionMet = true;
        }
        return conditionMet;
      });
    });

    const isQuestionVisible = groupResults.some((result) => result);
    if (!isQuestionVisible) excludedQuestions.add(question_id);
  });

  const visibilityMap: Record<number, boolean> = {};
  allQuestions.forEach((question) => {
    visibilityMap[question.id] = !excludedQuestions.has(question.id);
  });

  const questionsByCategory: Record<number, Question[]> = {};
  allQuestions.forEach((question) => {
    if (!questionsByCategory[question.category_id]) questionsByCategory[question.category_id] = [];
    questionsByCategory[question.category_id].push(question);
  });

  let totalWeightedNumerator = 0;
  let totalWeightedDenominator = 0;
  const categoryScores: Record<number, CategoryScore> = {};

  categories.forEach((category) => {
    let earnedPoints = 0;
    let possiblePoints = 0;

    const categoryQuestions = questionsByCategory[category.id] || [];

    categoryQuestions.forEach((question) => {
      const questionType = question.question_type.toLowerCase();
      if (['info', 'text', 'info_block', 'sub_category'].includes(questionType)) return;
      if (!visibilityMap[question.id]) return;

      const answer = answersMap[question.id];
      if (answer && (answer.answer?.toLowerCase() === 'na' || answer.answer?.toLowerCase() === 'n/a')) {
        if (question.is_na_allowed) return;
      }

      const possibleScore = getMaxPossibleScore(question, radioOptionsMap);
      possiblePoints += possibleScore;
      if (!answer) return;

      const answerScore = getQuestionScore(question, answer.answer || '', radioOptionsMap);
      earnedPoints += answerScore;
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

  let total_score = 0;
  if (totalWeightedDenominator > 0) {
    total_score = (totalWeightedNumerator / totalWeightedDenominator) * 100;
  }
  total_score = Math.round(total_score * 100) / 100;

  return { total_score, categoryScores };
}

function getQuestionScore(
  question: Question,
  answer: string,
  radioOptionsMap: Record<number, RadioOption[]>
): number {
  if (!answer) return 0;
  const questionType = question.question_type.toLowerCase();
  const answerLower = answer.toLowerCase();

  switch (questionType) {
    case 'yes_no':
      if (answerLower === 'yes' || answer === 'true') return question.yes_value !== undefined ? Number(question.yes_value) : 0;
      if (answerLower === 'no' || answer === 'false') return question.no_value !== undefined ? Number(question.no_value) : 0;
      return 0;
    case 'scale': {
      const numericAnswer = parseInt(answer, 10);
      return !isNaN(numericAnswer) ? numericAnswer : 0;
    }
    case 'radio': {
      const radioOptions = radioOptionsMap[question.id] || [];
      if (radioOptions.length > 0) {
        const selectedOption = radioOptions.find((opt) => opt.option_value === answer || opt.option_text === answer);
        return selectedOption?.score || 0;
      }
      return 0;
    }
    case 'multi_select': {
      const multiOpts = radioOptionsMap[question.id] || [];
      if (multiOpts.length > 0 && answer) {
        const selected = answer.split(',').map((v: string) => v.trim()).filter(Boolean);
        return selected.reduce((sum: number, val: string) => {
          const opt = multiOpts.find((o) => o.option_value === val || o.option_text === val);
          return sum + (opt?.score || 0);
        }, 0);
      }
      return 0;
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
      const radioOptions = radioOptionsMap[question.id] || [];
      if (radioOptions.length > 0) return Math.max(...radioOptions.map((opt) => opt.score || 0));
      return 0;
    }
    case 'multi_select': {
      const multiOpts = radioOptionsMap[question.id] || [];
      return multiOpts.reduce((sum: number, opt) => sum + Math.max(0, opt.score || 0), 0);
    }
    default:
      return 0;
  }
}

export async function calculateFormScoreBySubmissionId(
  _connection: any,
  submission_id: number
): Promise<{ total_score: number; scoreSnapshot: any[] }> {
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

    await saveScoreData(submission_id, result.total_score, scoreSnapshot);

    return { total_score: result.total_score, scoreSnapshot };
  } catch (error) {
    console.error('Error calculating form score by submission ID:', error);
    throw error;
  }
}

async function saveScoreData(submission_id: number, total_score: number, scoreSnapshot: any[]): Promise<void> {
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
        data: { total_score: total_score },
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
