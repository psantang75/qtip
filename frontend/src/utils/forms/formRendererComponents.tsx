/**
 * Form Renderer Components
 *
 * React components for rendering QA form questions, categories, and the full form.
 * Data preparation (prepareFormForRender etc.) lives in formRenderPrep.ts.
 * Shared types live in formRenderTypes.ts.
 */

import React from 'react';
import { cn } from '../../lib/utils';
import type { QuestionRenderData, CategoryRenderData, FormRenderData } from './formRenderTypes';

// ── Shared prop interface ─────────────────────────────────────────────────────

interface QuestionProps {
  question:       QuestionRenderData;
  isDisabled?:    boolean;
  onAnswerChange: (id: number, value: string, type: string) => void;
  onNotesChange:  (id: number, notes: string) => void;
}

// ── Shared button style helper ────────────────────────────────────────────────

const optionCls = (selected: boolean) =>
  selected
    ? 'bg-[#00aeef] text-white border-[#00aeef]'
    : 'bg-white text-slate-600 border-slate-200 hover:border-[#00aeef] hover:text-[#00aeef]';

// ── Yes / No ──────────────────────────────────────────────────────────────────

export const YesNoQuestion: React.FC<QuestionProps> = ({ question, isDisabled = false, onAnswerChange }) => {
  if (!question.isVisible) return null;
  const { id, text, currentValue, isNaAllowed } = question;
  const options = [
    { value: 'yes', label: 'Yes' },
    { value: 'no',  label: 'No'  },
    ...(isNaAllowed ? [{ value: 'na', label: 'N/A' }] : []),
  ];
  return (
    <div className="flex items-start gap-3">
      <p className="flex-1 text-[13px] text-slate-800 leading-snug pt-0.5">{text}</p>
      <div className="flex items-center gap-1 shrink-0">
        {options.map(opt => (
          <button key={opt.value} type="button" disabled={isDisabled}
            onClick={() => onAnswerChange(id, opt.value, 'yes_no')}
            className={cn('h-7 px-3 text-[12px] rounded border font-medium transition-all', optionCls(currentValue === opt.value))}>
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
  if (!question.isVisible) return null;
  const { id, text, currentValue } = question;
  return (
    <div>
      <p className="text-[13px] text-slate-800 leading-snug mb-1.5">{text}</p>
      <textarea rows={2} value={currentValue || ''} disabled={isDisabled}
        onChange={e => onAnswerChange(id, e.target.value, 'text')}
        className="w-full text-[13px] border border-slate-200 rounded-md px-2.5 py-1.5 resize-none text-slate-700 focus:outline-none focus:ring-1 focus:ring-[#00aeef]"
      />
    </div>
  );
};

// ── Radio ─────────────────────────────────────────────────────────────────────

export const RadioQuestion: React.FC<QuestionProps> = ({ question, isDisabled = false, onAnswerChange }) => {
  if (!question.isVisible) return null;
  const { id, text, currentValue } = question;
  const radioOptions = question.radio_options || (question as any).RADIO_OPTIONS || (question as any).RadioOptions || [];
  if (radioOptions.length === 0) return <p className="text-[12px] text-red-500">Error: No options for this question.</p>;
  return (
    <div>
      <p className="text-[13px] text-slate-800 leading-snug mb-2">{text}</p>
      <div className="flex flex-wrap gap-1.5">
        {radioOptions.map((option: any) => {
          const val = String(option.option_value || option.value || '');
          return (
            <button key={val} type="button" disabled={isDisabled}
              onClick={() => onAnswerChange(id, val, 'radio')}
              className={cn('h-7 px-3 text-[12px] rounded border font-medium transition-all', optionCls(String(currentValue || '') === val))}>
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
  const options = question.radio_options || (question as any).RADIO_OPTIONS || (question as any).RadioOptions || [];
  if (options.length === 0) return <p className="text-[12px] text-red-500">Error: No options for this question.</p>;

  const selectedValues = new Set((currentValue || '').split(',').map((v: string) => v.trim()).filter(Boolean));
  const handleToggle = (val: string) => {
    const next = new Set(selectedValues);
    if (next.has(val)) next.delete(val); else next.add(val);
    onAnswerChange(id, Array.from(next).join(','), 'multi_select');
  };

  return (
    <div>
      <p className="text-[13px] text-slate-800 leading-snug mb-2">{text}</p>
      <div className="flex flex-wrap gap-1.5">
        {options.map((option: any) => {
          const val = String(option.option_value || option.value || '');
          return (
            <button key={val} type="button" disabled={isDisabled} onClick={() => handleToggle(val)}
              className={cn('h-7 px-3 text-[12px] rounded border font-medium transition-all', optionCls(selectedValues.has(val)))}>
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
    <div className="pt-1 pb-0">
      <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">{question.text}</p>
    </div>
  );
};

// ── Question Row Wrapper ──────────────────────────────────────────────────────

export const QuestionRenderer: React.FC<QuestionProps> = (props) => {
  if (!props.question.isVisible) return null;
  const isSubCat = props.question.type === 'sub_category';
  const isInfo   = props.question.type === 'info' || props.question.type === 'info_block';
  return (
    <div id={`question-${props.question.id}`}
      className={cn('px-4 py-2.5 transition-colors',
        isSubCat ? 'bg-slate-50 border-b border-slate-100' : 'border-b border-slate-100 last:border-0',
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
    <div className="flex items-center gap-2.5 bg-slate-50 border border-slate-200 rounded-t-lg px-4 py-2.5">
      <span className="w-[3px] h-4 rounded-full bg-[#00aeef] shrink-0" />
      <h3 className="text-[12px] font-semibold text-slate-600 uppercase tracking-wider">{category.name}</h3>
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
