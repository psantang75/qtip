import React from 'react';
import { processConditionalLogic } from './formConditions';
import { getMaxPossibleScore, getQuestionScore } from './scoringAdapter';

interface QuestionWithScore {
  id: number;
  text: string;
  answer: string;
  pointsEarned: number;
  pointsPossible: number;
  questionType: string;
}

interface CategoryScore {
  id: number;
  name: string;
  weight: number;
  pointsEarned: number;
  pointsPossible: number;
  weightedPointsEarned: number;
  weightedPointsPossible: number;
  score: number;
  subCategories: Record<string, QuestionWithScore[]>;
}

interface ScoreRendererProps {
  formData: any;
  answers: Record<number, any>;
  showCategoryBreakdown?: boolean;
  showDetailedScores?: boolean;
  userRole?: number;
  backendScore?: number;
  scoreBreakdown?: any;
}

/**
 * Renders score summaries using data from the backend scoring engine.
 * All scores come from the database — no client-side score calculation.
 */
export const ScoreRenderer: React.FC<ScoreRendererProps> = ({
  formData,
  answers,
  showCategoryBreakdown = true,
  showDetailedScores = true,
  userRole,
  backendScore,
  scoreBreakdown,
}) => {
  if (!formData?.categories) return null;

  const answerStrings: Record<number, string> = {};
  Object.entries(answers).forEach(([questionId, answer]) => {
    answerStrings[Number(questionId)] = answer.answer || '';
  });
  const visibilityMap = processConditionalLogic(formData, answerStrings);

  const visibleCategories = userRole === 3
    ? formData.categories.filter((category: any) => (category.weight || 0) > 0)
    : formData.categories;

  const categoryScores = visibleCategories.map((category: any) => {
    const bd = scoreBreakdown?.categoryBreakdown?.[category.id];

    const earnedPoints     = bd?.earned_points    ?? 0;
    const possiblePoints   = bd?.possible_points  ?? 0;
    const categoryWeight   = bd?.category_weight  ?? (category.weight || 0);
    const weightedEarned   = bd?.weighted_score   ?? earnedPoints * categoryWeight;
    const weightedPossible = bd?.weighted_possible ?? possiblePoints * categoryWeight;
    const rawScore         = bd?.raw_score ?? (possiblePoints > 0 ? (earnedPoints / possiblePoints) * 100 : 0);

    const subCategories: Record<string, QuestionWithScore[]> = { 'default': [] };

    (category.questions || []).forEach((question: any) => {
      if (!question.id) return;
      const qType = (question.question_type || '').toLowerCase();

      if (qType === 'info' || qType === 'info_block') return;
      if (userRole === 3 && qType === 'text' && question.visible_to_csr !== true) return;

      if (qType === 'sub_category') {
        subCategories[question.question_text] = [];
        return;
      }

      if (visibilityMap[question.id] === false) return;
      if (userRole === 3 && question.visible_to_csr === false) return;

      const answer = answers[question.id];
      const isNaAnswer = answer && (answer.answer?.toLowerCase() === 'na' || answer.answer?.toLowerCase() === 'n/a');

      let pointsEarned = 0;
      let pointsPossible = 0;

      if (isNaAnswer && question.is_na_allowed) {
        pointsPossible = 0;
        pointsEarned = 0;
      } else {
        pointsPossible = getMaxPossibleScore(question);
        pointsEarned = answer?.score !== undefined
          ? Number(answer.score)
          : (answer ? getQuestionScore(question, answer.answer || '') : 0);
      }

      let subCategoryKey = 'default';
      const keys = Object.keys(subCategories);
      for (let i = keys.length - 1; i >= 0; i--) {
        if (keys[i] !== 'default') { subCategoryKey = keys[i]; break; }
      }

      let displayAnswer = answer?.answer || 'No answer';
      if (displayAnswer !== 'No answer') {
        if (qType === 'radio' && question.radio_options) {
          const opt = question.radio_options.find((o: any) => o.option_value === displayAnswer);
          if (opt) displayAnswer = opt.option_text;
        } else if (qType === 'multi_select' && question.radio_options) {
          const selected = displayAnswer.split(',').map((v: string) => v.trim()).filter(Boolean);
          const labels = selected.map((val: string) => {
            const opt = question.radio_options.find((o: any) => o.option_value === val || o.option_text === val);
            return opt ? opt.option_text : val;
          });
          displayAnswer = labels.join(', ');
        } else {
          const lower = displayAnswer.toLowerCase();
          if (lower === 'yes') displayAnswer = 'Yes';
          else if (lower === 'no') displayAnswer = 'No';
          else if (lower === 'n/a' || lower === 'na') displayAnswer = 'N/A';
        }
      }

      subCategories[subCategoryKey].push({
        id: question.id,
        text: question.question_text,
        answer: displayAnswer,
        pointsEarned,
        pointsPossible,
        questionType: qType,
      });
    });

    return {
      id: category.id,
      name: category.category_name || category.name || `Category ${category.id}`,
      weight: categoryWeight,
      pointsEarned: earnedPoints,
      pointsPossible: possiblePoints,
      weightedPointsEarned: Math.round(weightedEarned * 100) / 100,
      weightedPointsPossible: Math.round(weightedPossible * 100) / 100,
      score: rawScore,
      subCategories,
    };
  }) as CategoryScore[];

  let totalWeightedPointsEarned = 0;
  let totalWeightedPointsPossible = 0;
  categoryScores.forEach(cat => {
    if (cat.pointsPossible > 0) {
      totalWeightedPointsEarned += cat.weightedPointsEarned;
      totalWeightedPointsPossible += cat.weightedPointsPossible;
    }
  });
  totalWeightedPointsEarned = Math.round(totalWeightedPointsEarned * 100) / 100;
  totalWeightedPointsPossible = Math.round(totalWeightedPointsPossible * 100) / 100;

  const formScore = backendScore ?? (totalWeightedPointsPossible > 0
    ? (totalWeightedPointsEarned / totalWeightedPointsPossible) * 100
    : 0);
  
  
  const scoreClass = (_s: number) => 'text-slate-700';

  return (
    <div className="space-y-6 p-5">

      {/* ── Category summary table ── */}
      {showCategoryBreakdown && (
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400 mb-3">
            Category Breakdown
          </p>
          <div className="rounded-xl border border-slate-200 overflow-hidden">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="text-left px-4 py-2.5 font-semibold text-slate-600">Category</th>
                  <th className="text-center px-3 py-2.5 font-semibold text-slate-600">Weight</th>
                  <th className="text-right px-3 py-2.5 font-semibold text-slate-600">Earned</th>
                  <th className="text-right px-3 py-2.5 font-semibold text-slate-600">Possible</th>
                  <th className="text-right px-4 py-2.5 font-semibold text-slate-600">Score</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {categoryScores.map((category: CategoryScore) => (
                  <tr key={category.id} className="hover:bg-slate-50/60 transition-colors">
                    <td className="px-4 py-2.5 font-medium text-slate-800">{category.name}</td>
                    <td className="px-3 py-2.5 text-center text-slate-500">
                      {(category.weight * 100).toFixed(0)}%
                    </td>
                    <td className="px-3 py-2.5 text-right text-slate-600">
                      {category.pointsPossible === 0 ? <span className="text-slate-300">—</span> : category.weightedPointsEarned.toFixed(2)}
                    </td>
                    <td className="px-3 py-2.5 text-right text-slate-600">
                      {category.pointsPossible === 0 ? <span className="text-slate-300">—</span> : category.weightedPointsPossible.toFixed(2)}
                    </td>
                    <td className={`px-4 py-2.5 text-right font-semibold ${category.pointsPossible === 0 ? 'text-slate-300' : scoreClass(category.score)}`}>
                      {category.pointsPossible === 0 ? '—' : `${category.score.toFixed(1)}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-slate-100 border-t-2 border-slate-300">
                  <td className="px-4 py-2.5 font-bold text-slate-800 text-[13px]">Total</td>
                  <td className="px-3 py-2.5 text-center font-semibold text-slate-600">100%</td>
                  <td className="px-3 py-2.5 text-right font-semibold text-slate-700">{totalWeightedPointsEarned.toFixed(2)}</td>
                  <td className="px-3 py-2.5 text-right font-semibold text-slate-700">{totalWeightedPointsPossible.toFixed(2)}</td>
                  <td className={`px-4 py-2.5 text-right font-bold text-[15px] ${scoreClass(formScore)}`}>
                    {formScore.toFixed(1)}%
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* ── Per-category detailed question scores ── */}
      {showDetailedScores && (
        <div className="space-y-5">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">
            Detailed Scores
          </p>
          {categoryScores.map((category: CategoryScore) => (
            <div key={category.id} className="rounded-xl border border-slate-200 overflow-hidden">
              {/* Category header row */}
              <div className="flex items-center justify-between px-4 py-2.5 bg-primary/8 border-b border-primary/20">
                <div className="flex items-center gap-2">
                  <span className="w-[3px] h-4 rounded-full bg-primary shrink-0" />
                  <span className="text-[13px] font-bold text-slate-800">{category.name}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-[11px] text-slate-500">Weight: {(category.weight * 100).toFixed(0)}%</span>
                  <span className={`text-[13px] font-bold ${category.pointsPossible === 0 ? 'text-slate-400' : scoreClass(category.score)}`}>
                    {category.pointsPossible === 0 ? 'N/A' : `${category.score.toFixed(1)}%`}
                  </span>
                </div>
              </div>

              <table className="w-full text-[13px]">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="text-left px-4 py-2 font-semibold text-slate-500 w-1/2">Question</th>
                    <th className="text-left px-3 py-2 font-semibold text-slate-500">Answer</th>
                    <th className="text-right px-3 py-2 font-semibold text-slate-500">Points</th>
                    <th className="text-right px-4 py-2 font-semibold text-slate-500">Possible</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {Object.entries(category.subCategories).map(([subCatName, questions]) => {
                    if ((questions as QuestionWithScore[]).length === 0) return null;
                    return (
                      <React.Fragment key={subCatName}>
                        {subCatName !== 'default' && (
                          <tr className="bg-slate-50">
                            <td colSpan={4} className="px-4 py-2 text-[12px] font-semibold text-slate-600 uppercase tracking-wide">
                              {subCatName}
                            </td>
                          </tr>
                        )}
                        {(questions as QuestionWithScore[]).map((q: QuestionWithScore) => {
                          const isText = q.questionType === 'text';
                          const hasScore = !(q.pointsEarned === 0 && q.pointsPossible === 0);
                          return (
                            <tr key={q.id} className="hover:bg-slate-50/60 transition-colors">
                              <td className="px-4 py-2.5 text-slate-700 leading-snug">{q.text}</td>
                              {isText ? (
                                <td colSpan={3} className="px-3 py-2.5 text-slate-600">
                                  {q.answer === 'No answer' ? <span className="text-slate-300">—</span> : q.answer}
                                </td>
                              ) : (
                                <>
                                  <td className="px-3 py-2.5 text-slate-600">
                                    {q.answer === 'No answer' ? <span className="text-slate-300">—</span> : q.answer}
                                  </td>
                                  <td className="px-3 py-2.5 text-right text-slate-700 font-medium">
                                    {hasScore ? q.pointsEarned.toFixed(1) : <span className="text-slate-300">—</span>}
                                  </td>
                                  <td className="px-4 py-2.5 text-right text-slate-500">
                                    {hasScore ? q.pointsPossible.toFixed(1) : <span className="text-slate-300">—</span>}
                                  </td>
                                </>
                              )}
                            </tr>
                          );
                        })}
                      </React.Fragment>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-100 border-t border-slate-200">
                    <td colSpan={2} className="px-4 py-2 text-[12px] font-semibold text-slate-600">Category Total</td>
                    <td className="px-3 py-2 text-right text-[13px] font-bold text-slate-700">{category.pointsEarned.toFixed(1)}</td>
                    <td className="px-4 py-2 text-right text-[13px] font-semibold text-slate-500">{category.pointsPossible.toFixed(1)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default ScoreRenderer; 