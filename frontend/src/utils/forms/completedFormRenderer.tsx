import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../services/authService';
import { prepareFormForRender } from './formRenderPrep';
import { FormRenderer } from './formRendererComponents';
import { calculateFormScore } from './scoringAdapter';
import { processConditionalLogic } from './formConditions';
import type { Form as FormType, Answer as AnswerType } from '../../types';

interface CompletedFormProps {
  submissionId?: number;
  submissionData?: any;
  formId?: number;
  showScore?: boolean;
  onError?: (error: string) => void;
}

/**
 * Read-only renderer for a completed QA submission.
 * Accepts either pre-loaded `submissionData` or fetches by `submissionId`/`formId`.
 */
const CompletedFormRenderer: React.FC<CompletedFormProps> = ({
  submissionId,
  formId,
  submissionData: initialData,
  showScore = true,
  onError,
}) => {
  // ── Fetch submission if not pre-loaded ───────────────────────────────────
  const { data: fetchedSubmission, isLoading: subLoading, isError: subError } = useQuery({
    queryKey: ['completed-form-submission', submissionId],
    queryFn: () => api.get(`/qa/completed/${submissionId}?includeFullForm=true`).then(r => r.data),
    enabled: !!submissionId && !initialData,
    staleTime: 5 * 60 * 1000,
  });

  const rawSubmission = initialData ?? fetchedSubmission;
  const formIdToFetch = rawSubmission?.form_id ?? formId;

  // ── Fetch form structure if not included in submission ───────────────────
  const { data: fetchedForm, isLoading: formLoading, isError: formError } = useQuery({
    queryKey: ['form-for-renderer', formIdToFetch],
    queryFn: () => api.get(`/forms/${formIdToFetch}`).then(r => r.data),
    enabled: !!formIdToFetch && !rawSubmission?.form,
    staleTime: 10 * 60 * 1000,
  });

  const isLoading = subLoading || formLoading;
  const isError   = subError || formError;

  // ── Process answers + build render data ─────────────────────────────────
  const { formRenderData, form } = useMemo(() => {
    const formData: FormType | undefined = rawSubmission?.form ?? fetchedForm;
    if (!formData?.categories?.length) return { formRenderData: null, form: null };

    const answersByQuestionId: Record<number, AnswerType> = {};

    if (Array.isArray(rawSubmission?.answers)) {
      rawSubmission.answers.forEach((answer: any) => {
        if (!answer?.question_id) return;

        const questionObj = formData.categories
          .flatMap((cat: any) => cat.questions || [])
          .find((q: any) => q.id === answer.question_id);

        let answerScore = answer.score ?? 0;

        // Derive score for yes/no questions where backend stored 0
        if (
          questionObj?.question_type?.toLowerCase() === 'yes_no' &&
          answer.answer?.toLowerCase() === 'yes' &&
          (answerScore === 0 || answerScore === undefined)
        ) {
          answerScore = questionObj.yes_value ?? questionObj.score_if_yes ?? 1;
        }

        answersByQuestionId[answer.question_id] = {
          question_id: answer.question_id,
          answer: answer.answer || '',
          score:  answerScore,
          notes:  answer.notes || '',
        };
      });
    }

    const answerStrings: Record<number, string> = {};
    Object.entries(answersByQuestionId).forEach(([id, a]) => {
      answerStrings[Number(id)] = typeof a === 'string' ? a : a.answer || '';
    });

    const visibilityMap = processConditionalLogic(formData, answerStrings);
    const { totalScore, categoryScores } = calculateFormScore(formData, answersByQuestionId);
    const renderData = prepareFormForRender(formData, answersByQuestionId, visibilityMap, categoryScores, totalScore);

    return { formRenderData: renderData, form: formData };
  }, [rawSubmission, fetchedForm]);

  // Propagate errors to parent if needed
  if (isError && onError) {
    onError('Failed to load form data');
  }

  if (isLoading) {
    return (
      <div className="flex justify-center items-center py-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="bg-red-50 p-4 rounded-lg border border-red-200 text-red-700">
        <p>Failed to load form data. Please try again.</p>
      </div>
    );
  }

  if (!formRenderData) {
    return (
      <div className="bg-amber-50 p-4 rounded-lg border border-amber-200 text-amber-700">
        <p>No form data available.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Form header */}
      <div className="bg-white rounded-lg border border-slate-200 p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold text-slate-800">{formRenderData.name}</h2>
          {form && (
            <span className="text-[13px] text-slate-500 bg-slate-50 px-3 py-1 rounded-full border border-slate-200">
              Version {(form as any).version || 1}
            </span>
          )}
        </div>
      </div>

      {/* Form questions — read-only */}
      <div className="bg-white rounded-lg border border-slate-200 p-6">
        <FormRenderer
          formRenderData={formRenderData}
          isDisabled={true}
          onAnswerChange={() => {}}
          onNotesChange={() => {}}
        />
      </div>

      {/* Score summary */}
      {showScore && formRenderData.totalScore !== undefined && (
        <div className="bg-white rounded-lg border border-slate-200 p-6">
          <h3 className="text-[15px] font-semibold text-slate-800 mb-4">Score Summary</h3>
          <div className="text-[36px] font-bold text-slate-900 leading-none">
            {formRenderData.totalScore.toFixed(1)}%
          </div>
        </div>
      )}
    </div>
  );
};

export default CompletedFormRenderer;
