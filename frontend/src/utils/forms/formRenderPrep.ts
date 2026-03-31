/**
 * Data preparation functions that transform raw form/answer data into
 * the render-ready structures consumed by FormRenderer components.
 */

import type { Form, Answer, FormSubmission, FormQuestion, FormCategory, FormQuestionCondition, RadioOption } from '../../types/form.types';
import { processConditionalLogic } from './formConditions';
import { calculateFormScore } from './scoringAdapter';
import type { QuestionRenderData, CategoryRenderData, FormRenderData } from './formRenderTypes';

// ── generateFormPreview ───────────────────────────────────────────────────────

export const generateFormPreview = (form: Form, withSampleAnswers: boolean = false): FormSubmission => {
  // Assign temporary IDs to questions without IDs (for new forms)
  form.categories.forEach((category, categoryIndex) => {
    if (!category.id) {
      category.id = (categoryIndex + 1) * -1000;
    }
    category.questions.forEach((question, questionIndex) => {
      if (!question.id) {
        question.id = -(category.id! * 1000 + questionIndex + 1);
      }
    });
  });

  const answers: Record<number, Answer> = {};

  if (withSampleAnswers) {
    form.categories.forEach((category) => {
      category.questions.forEach((question) => {
        if (!question.id) return;
        const questionType = question.question_type.toLowerCase();

        if (questionType === 'yes_no') {
          const yesValue = question.yes_value !== undefined
            ? Number(question.yes_value)
            : (question.score_if_yes !== undefined ? Number(question.score_if_yes) : 0);
          answers[question.id] = { question_id: question.id, answer: 'yes', score: yesValue, notes: '' };
        } else if (questionType === 'scale') {
          const max = question.max_scale ?? question.scale_max ?? 5;
          answers[question.id] = { question_id: question.id, answer: String(max), score: max, notes: '' };
        } else if (questionType === 'text') {
          answers[question.id] = { question_id: question.id, answer: 'Sample text answer', score: 0, notes: '' };
        } else if (questionType === 'radio') {
          const options = question.radio_options || [];
          const best = options.reduce(
            (b: RadioOption, c: RadioOption) => (c.score || 0) > (b.score || 0) ? c : b,
            options[0] as RadioOption
          );
          answers[question.id] = {
            question_id: question.id,
            answer: best?.option_value || best?.option_text || '',
            score: best?.score || 0,
            notes: '',
          };
        } else {
          answers[question.id] = { question_id: question.id, answer: '', score: 0, notes: '' };
        }
      });
    });
  }

  const answerStrings: Record<number, string> = {};
  Object.entries(answers).forEach(([id, a]) => { answerStrings[Number(id)] = a.answer || ''; });

  const visibilityMap = processConditionalLogic(form, answerStrings, false);
  const { totalScore, categoryScores } = calculateFormScore(form, answers);

  return {
    form_id:      form.id || 0,
    submitted_by: 0,
    status:       'preview',
    total_score:  totalScore,
    form,
    answers:      Object.values(answers),
    visibilityMap,
    score:        totalScore,
    categoryScores: Object.values(categoryScores).map((score, index) => ({
      categoryId:    index,
      categoryName:  `Category ${index + 1}`,
      earnedPoints:  score.earnedPoints || 0,
      possiblePoints: score.possiblePoints || 0,
      rawScore:      score.raw,
      weightedScore: score.weighted,
    })),
  };
};

// ── prepareQuestionForRender ──────────────────────────────────────────────────

export const prepareQuestionForRender = (
  question: FormQuestion,
  currentAnswer?: Answer,
  isVisible: boolean = true
): QuestionRenderData => {
  const questionType = (question.question_type || '').toLowerCase() as QuestionRenderData['type'];

  const baseData: QuestionRenderData = {
    id:            question.id || 0,
    text:          question.question_text || '',
    type:          questionType,
    isConditional: !!question.is_conditional,
    isVisible,
    isNaAllowed:   !!question.is_na_allowed,
    isRequired:    !!question.is_required,
    weight:        question.weight,
    currentValue:  currentAnswer?.answer,
    notes:         currentAnswer?.notes,
    score:         currentAnswer?.score,
    conditionalLogic: question.conditional_logic ? {
      targetQuestionId: question.conditional_logic.target_question_id,
      conditionType:    question.conditional_logic.condition_type,
      targetValue:      question.conditional_logic.target_value,
      excludeIfUnmet:   question.conditional_logic.exclude_if_unmet,
    } : (question.is_conditional ? {
      targetQuestionId: question.conditional_question_id,
      conditionType:    question.condition_type,
      targetValue:      question.conditional_value,
      excludeIfUnmet:   question.exclude_if_unmet,
    } : undefined),
    conditions: question.conditions?.map((c: FormQuestionCondition) => ({
      id:               c.id,
      targetQuestionId: c.target_question_id,
      conditionType:    c.condition_type,
      targetValue:      c.target_value,
      logicalOperator:  c.logical_operator,
      groupId:          c.group_id,
      sortOrder:        c.sort_order,
    })),
  };

  switch (questionType) {
    case 'yes_no': {
      const yesScore = question.yes_value !== undefined
        ? Number(question.yes_value)
        : (question.score_if_yes !== undefined ? Number(question.score_if_yes) : 1);
      let actualScore = currentAnswer?.score;
      if (currentAnswer?.answer?.toLowerCase() === 'yes' && (actualScore === undefined || actualScore === 0)) {
        actualScore = yesScore;
      }
      return { ...baseData, options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }], maxScore: yesScore, score: actualScore };
    }
    case 'scale':
      return { ...baseData, min: question.scale_min || 0, max: question.scale_max || question.max_scale || 5, maxScore: question.scale_max || question.max_scale || 5 };
    case 'radio':
    case 'multi_select': {
      const opts = question.radio_options || [];
      return { ...baseData, radio_options: opts };
    }
    default:
      return baseData;
  }
};

// ── prepareCategoryForRender ──────────────────────────────────────────────────

export const prepareCategoryForRender = (
  category: FormCategory,
  answers: Record<number, Answer>,
  visibilityMap: Record<number, boolean>,
  categoryScore?: { raw: number; weighted: number; earnedPoints?: number; possiblePoints?: number; trainingPenaltyApplied?: boolean },
  userRole?: number
): CategoryRenderData => {
  const allQuestionData = category.questions.map(question => {
    const qData = prepareQuestionForRender(question, answers[question.id], !!visibilityMap[question.id]);
    const qtype = question.question_type?.toLowerCase();
    if ((qtype === 'radio' || qtype === 'multi_select') && question.radio_options) {
      qData.radio_options = question.radio_options;
    }
    return qData;
  });

  const visibleQuestions = allQuestionData.filter(q => {
    if (!q.isVisible) return false;
    if (userRole === 3) {
      const orig = category.questions.find(oq => oq.id === q.id);
      if (orig && orig.visible_to_csr === false) return false;
    }
    return true;
  });

  const weight = category.weight || 1;
  const weightFormatted = category.weight === 1 ? '100%' : `${(weight * 100).toFixed(0)}%`;
  const rawPercentage = categoryScore?.possiblePoints && categoryScore.possiblePoints > 0
    ? (categoryScore.earnedPoints || 0) / categoryScore.possiblePoints * 100
    : categoryScore?.raw || 0;

  return {
    id:              category.id || 0,
    name:            category.category_name || '',
    description:     category.description,
    weight,
    weightPercentage: weightFormatted,
    score: categoryScore ? {
      raw:        categoryScore.raw || rawPercentage,
      weighted:   categoryScore.weighted,
      percentage: `${(categoryScore.raw || rawPercentage).toFixed(1)}%`,
    } : undefined,
    questions:    visibleQuestions,
    allQuestions: allQuestionData,
  };
};

// ── prepareFormForRender ──────────────────────────────────────────────────────

export const prepareFormForRender = (
  form: Form,
  answers: Record<number, Answer>,
  visibilityMap: Record<number, boolean>,
  categoryScores?: Record<number, { raw: number; weighted: number; earnedPoints?: number; possiblePoints?: number; trainingPenaltyApplied?: boolean }>,
  totalScore?: number,
  userRole?: number
): FormRenderData => {
  if (!form?.categories || !Array.isArray(form.categories)) {
    return { id: form?.id || 0, name: form?.form_name || 'Unknown Form', interactionType: form?.interaction_type || 'UNIVERSAL', totalScore: 0, categories: [], visibleQuestions: {} };
  }

  // Ensure all categories and questions have IDs
  form.categories.forEach((category, index) => {
    if (!category.id) category.id = (index + 1) * -1000;
    category.questions.forEach((question, qi) => {
      if (!question.id) question.id = -(category.id! * 1000 + qi + 1);
    });
  });

  const visibleCategories = userRole === 3
    ? form.categories.filter(c => (c.weight || 0) > 0)
    : form.categories;

  const categories = visibleCategories.map(category => {
    const categoryScore = category.id && categoryScores ? categoryScores[category.id] : undefined;
    return prepareCategoryForRender(category, answers, visibilityMap, categoryScore, userRole);
  });

  return {
    id:              form.id,
    name:            form.form_name,
    interactionType: form.interaction_type,
    totalScore:      totalScore || 0,
    categories,
    visibleQuestions: visibilityMap,
    categoryScores,
  };
};
