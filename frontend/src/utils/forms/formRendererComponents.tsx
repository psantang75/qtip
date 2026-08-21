/**
 * Form Renderer Components
 *
 * React components for rendering QA form questions, categories, and the full form.
 * Data preparation (prepareFormForRender etc.) lives in formRenderPrep.ts.
 * Shared types live in formRenderTypes.ts.
 */

import React, { useEffect, useLayoutEffect, useRef } from 'react';
import { cn } from '../../lib/utils';
import { RichTextDisplay } from '../../components/common/RichTextDisplay';
import type { QuestionRenderData, CategoryRenderData, FormRenderData } from './formRenderTypes';
import type { RadioOption } from '../../types/form.types';

/** Canonical title of the auto-managed AI Reviewer feedback question — kept in sync with backend AI_REVIEWER_FEEDBACK_QUESTION_TEXT. */
const AI_REVIEWER_FEEDBACK_QUESTION_TEXT = 'AI Reviewer Feedback';

/**
 * Auto-grows the textarea to fit its content so long answers (e.g. the
 * AI Reviewer Feedback narrative) don't end up trapped in an inner
 * scrollbar. The outer pane (`overflow-y-auto`) handles scrolling for
 * the whole form. Falls back gracefully when SSR'd (no `window`).
 */
function useAutoGrowTextarea(value: string, minRows: number) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    // 22px line height matches our text-[13px] leading-snug; min height
    // keeps short fields from collapsing below their normal size.
    const minHeight = minRows * 22 + 12; // + vertical padding
    el.style.height = Math.max(minHeight, el.scrollHeight) + 'px';
  }, [value, minRows]);
  // Re-measure once on mount in case the initial value is hydrated late.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    const minHeight = minRows * 22 + 12;
    el.style.height = Math.max(minHeight, el.scrollHeight) + 'px';
  }, [minRows]);
  return ref;
}

// ── Shared prop interface ─────────────────────────────────────────────────────

interface QuestionProps {
  question:       QuestionRenderData;
  isDisabled?:    boolean;
  onAnswerChange: (id: number, value: string, type: string) => void;
  onNotesChange:  (id: number, notes: string) => void;
}

// ── Shared button style helper ────────────────────────────────────────────────

/** Canonical QTIP "pick one of N" pill classes. Exported so other segmented
 *  pickers (e.g. writeup QA-search answer chips) reuse the exact style rather
 *  than reimplementing it. */
export const optionCls = (selected: boolean) =>
  selected
    ? 'bg-[#00aeef] text-white border-[#00aeef]'
    : 'bg-white text-slate-600 border-slate-200 hover:border-[#00aeef] hover:text-[#00aeef]';

// ── Yes / No ──────────────────────────────────────────────────────────────────

export const YesNoQuestion: React.FC<QuestionProps> = ({ question, isDisabled = false, onAnswerChange }) => {
  if (!question.isVisible) return null;
  const { id, text, currentValue, isNaAllowed, isCritical, role, rollupReason } = question;
  const isRollup = role === 'ROLLUP';
  const options = [
    { value: 'yes', label: 'Yes' },
    { value: 'no',  label: 'No'  },
    ...(isNaAllowed ? [{ value: 'na', label: 'N/A' }] : []),
  ];
  return (
    <div>
      <p className="text-[13px] text-slate-800 leading-snug mb-3 inline-flex items-start gap-2 flex-wrap">
        {isCritical && (
          <span
            aria-label="Critical question"
            title="Critical: a 'No' answer triggers the form's critical-fail cap"
            className="inline-flex items-center rounded-full bg-red-100 text-red-700 border border-red-200 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
          >
            !
          </span>
        )}
        <span>{text}</span>
        {isRollup && (
          <span
            title={rollupReason || 'Auto-computed from this category\u2019s sub-questions.'}
            className="inline-flex items-center rounded-full bg-[#00aeef]/10 text-[#00aeef] border border-[#00aeef]/30 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
          >
            Auto
          </span>
        )}
      </p>
      <div className="flex flex-col gap-1.5 pl-4">
        {options.map(opt => (
          // Roll-up questions are derived by code (rollupEngine) - the
          // human / AI does not get to edit them directly. We force
          // disabled and ignore clicks so the user always sees the
          // engine's canonical value next to the auto-NA badge.
          <button key={opt.value} type="button" disabled={isDisabled || isRollup}
            onClick={() => { if (!isRollup) onAnswerChange(id, opt.value, 'yes_no'); }}
            title={isRollup ? (rollupReason || 'Auto-computed') : undefined}
            className={cn(
              'h-7 px-3 text-[12px] rounded border font-medium transition-all self-start text-left',
              optionCls(currentValue === opt.value),
              isRollup && 'cursor-not-allowed opacity-90',
            )}>
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
};

// ── Scale ─────────────────────────────────────────────────────────────────────

export const ScaleQuestion: React.FC<QuestionProps> = ({ question, isDisabled = false, onAnswerChange }) => {
  if (!question.isVisible) return null;
  const { id, text, min = 0, max = 5, currentValue } = question;
  return (
    <div className="flex items-start gap-3">
      <p className="flex-1 text-[13px] text-slate-800 leading-snug pt-0.5">{text}</p>
      <div className="flex items-center gap-0.5 flex-wrap shrink-0">
        {Array.from({ length: (max - min) + 1 }, (_, i) => {
          const val = (min + i).toString();
          return (
            <button key={val} type="button" disabled={isDisabled}
              onClick={() => onAnswerChange(id, val, 'scale')}
              className={cn('w-7 h-7 text-[12px] rounded border font-medium transition-all', optionCls(currentValue === val))}>
              {val}
            </button>
          );
        })}
      </div>
    </div>
  );
};

// ── Text ──────────────────────────────────────────────────────────────────────

export const TextQuestion: React.FC<QuestionProps> = ({ question, isDisabled = false, onAnswerChange }) => {
  const { id, text, currentValue } = question;
  const value = currentValue || '';
  // Hook must run before any early return to keep hook order stable.
  const ref = useAutoGrowTextarea(value, 2);
  if (!question.isVisible) return null;

  // Auto-managed AI Reviewer Feedback question: the AI is the only writer
  // (per backend ensureAiReviewerFeedbackQuestion). Render its HTML payload
  // as rich text with clickable KB links instead of dumping the raw HTML
  // into a textarea where reviewers see <p>/<a>/&#39; markup. Per-category
  // "Feedback — <Category>" questions now also receive an HTML "AI Review
  // Notes - …" block from the AI reviewer, so we apply the same rich-text
  // pass-through to any TEXT answer whose payload starts with an HTML tag.
  const isAiReviewerFeedback = (text || '').trim() === AI_REVIEWER_FEEDBACK_QUESTION_TEXT;
  const looksLikeHtml = value.trimStart().startsWith('<');
  if (isAiReviewerFeedback || looksLikeHtml) {
    return (
      <div>
        <p className="text-[13px] text-slate-800 leading-snug mb-1.5">{text}</p>
        <div className="w-full border border-slate-200 rounded-md px-2.5 py-1.5 bg-slate-50">
          <RichTextDisplay html={value} placeholder="(no AI narrative yet)" />
        </div>
      </div>
    );
  }

  return (
    <div>
      <p className="text-[13px] text-slate-800 leading-snug mb-1.5">{text}</p>
      <textarea
        ref={ref}
        value={value}
        disabled={isDisabled}
        onChange={e => onAnswerChange(id, e.target.value, 'text')}
        className="w-full text-[13px] border border-slate-200 rounded-md px-2.5 py-1.5 resize-none text-slate-700 leading-snug focus:outline-none focus:ring-1 focus:ring-[#00aeef] overflow-hidden"
      />
    </div>
  );
};

// ── Radio ─────────────────────────────────────────────────────────────────────

export const RadioQuestion: React.FC<QuestionProps> = ({ question, isDisabled = false, onAnswerChange }) => {
  if (!question.isVisible) return null;
  const { id, text, currentValue } = question;
  const radioOptions = question.radio_options || [];
  if (radioOptions.length === 0) return <p className="text-[12px] text-red-500">Error: No options for this question.</p>;
  return (
    <div>
      <p className="text-[13px] text-slate-800 leading-snug mb-3">{text}</p>
      <div className="flex flex-col gap-1.5 pl-4">
        {radioOptions.map((option: RadioOption & { value?: string; label?: string }) => {
          const val = String(option.option_value || option.value || '');
          return (
            <button key={val} type="button" disabled={isDisabled}
              onClick={() => onAnswerChange(id, val, 'radio')}
              className={cn('h-7 px-3 text-[12px] rounded border font-medium transition-all self-start text-left', optionCls(String(currentValue || '') === val))}>
              {option.option_text || option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
};

// ── Multi-Select ──────────────────────────────────────────────────────────────

export const MultiSelectQuestion: React.FC<QuestionProps> = ({ question, isDisabled = false, onAnswerChange }) => {
  if (!question.isVisible) return null;
  const { id, text, currentValue } = question;
  const options = question.radio_options || [];
  if (options.length === 0) return <p className="text-[12px] text-red-500">Error: No options for this question.</p>;

  const selectedValues = new Set((currentValue || '').split(',').map((v: string) => v.trim()).filter(Boolean));
  const handleToggle = (val: string) => {
    const next = new Set(selectedValues);
    if (next.has(val)) next.delete(val); else next.add(val);
    onAnswerChange(id, Array.from(next).join(','), 'multi_select');
  };

  return (
    <div>
      <p className="text-[13px] text-slate-800 leading-snug mb-3">{text}</p>
      <div className="flex flex-col gap-1.5 pl-4">
        {options.map((option: RadioOption & { value?: string; label?: string }) => {
          const val = String(option.option_value || option.value || '');
          return (
            <button key={val} type="button" disabled={isDisabled} onClick={() => handleToggle(val)}
              className={cn('h-7 px-3 text-[12px] rounded border font-medium transition-all self-start text-left', optionCls(selectedValues.has(val)))}>
              {option.option_text || option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
};

// ── Info Block ────────────────────────────────────────────────────────────────

export const InfoQuestion: React.FC<QuestionProps> = ({ question }) => {
  if (!question.isVisible) return null;
  return <p className="text-[13px] text-slate-500 italic">{question.text}</p>;
};

// ── Sub-category Divider ──────────────────────────────────────────────────────

export const SubCategoryQuestion: React.FC<QuestionProps> = ({ question }) => {
  if (!question.isVisible) return null;
  return (
    <p className="text-[12px] font-bold text-slate-900 uppercase tracking-wider border-b-2 border-slate-400 bg-slate-100 pl-[29px] pr-4 py-1.5">{question.text}</p>
  );
};

// ── Question Row Wrapper ──────────────────────────────────────────────────────

export const QuestionRenderer: React.FC<QuestionProps> = (props) => {
  if (!props.question.isVisible) return null;
  const isSubCat = props.question.type === 'sub_category';
  const isInfo   = props.question.type === 'info' || props.question.type === 'info_block';
  return (
    <div id={`question-${props.question.id}`}
      className={cn('transition-colors',
        isSubCat ? '' : 'pl-[29px] pr-4 py-2.5 border-b border-slate-100 last:border-0',
        isInfo ? 'py-2' : ''
      )}>
      {props.question.type === 'yes_no'       && <YesNoQuestion       {...props} />}
      {props.question.type === 'scale'        && <ScaleQuestion        {...props} />}
      {props.question.type === 'text'         && <TextQuestion         {...props} />}
      {props.question.type === 'radio'        && <RadioQuestion        {...props} />}
      {props.question.type === 'multi_select' && <MultiSelectQuestion  {...props} />}
      {isInfo                                 && <InfoQuestion         {...props} />}
      {isSubCat                               && <SubCategoryQuestion  {...props} />}
    </div>
  );
};

// ── Category ──────────────────────────────────────────────────────────────────

interface CategoryProps {
  category:       CategoryRenderData;
  isDisabled?:    boolean;
  onAnswerChange: (id: number, value: string, type: string) => void;
  onNotesChange:  (id: number, notes: string) => void;
}

export const CategoryRenderer: React.FC<CategoryProps> = ({ category, isDisabled = false, onAnswerChange, onNotesChange }) => (
  <div className="mb-4">
    <div className="flex items-center gap-2.5 bg-primary/10 border border-primary/30 rounded-t-lg px-4 py-2.5">
      <span className="w-[3px] h-4 rounded-full bg-[#00aeef] shrink-0" />
      <h3 className="text-[13px] font-semibold text-primary uppercase tracking-wider">{category.name}</h3>
    </div>
    <div className="border border-t-0 border-slate-200 rounded-b-lg overflow-hidden bg-white">
      {category.description && (
        <p className="px-4 py-2 text-[12px] text-slate-500 border-b border-slate-100">{category.description}</p>
      )}
      {category.questions.map((question, index) => (
        <QuestionRenderer key={question.id || `question-${index}`}
          question={question} isDisabled={isDisabled}
          onAnswerChange={onAnswerChange} onNotesChange={onNotesChange}
        />
      ))}
    </div>
  </div>
);

// ── Form Renderer ─────────────────────────────────────────────────────────────

interface FormRendererProps {
  formRenderData: FormRenderData;
  isDisabled?:    boolean;
  onAnswerChange: (id: number, value: string, type: string) => void;
  onNotesChange:  (id: number, notes: string) => void;
}

export const FormRenderer: React.FC<FormRendererProps> = ({ formRenderData, isDisabled = false, onAnswerChange, onNotesChange }) => (
  <div className="space-y-1">
    {formRenderData.categories.map((category, i) => (
      <CategoryRenderer key={category.id || `category-${i}`}
        category={category} isDisabled={isDisabled}
        onAnswerChange={onAnswerChange} onNotesChange={onNotesChange}
      />
    ))}
  </div>
);
