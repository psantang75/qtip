import React from 'react';
import { calculateFormScore, getMaxPossibleScore, getQuestionScore } from './scoringAdapter';
import { processConditionalLogic } from './formConditions';

// Type definitions
interface QuestionWithScore {
  id: number;
  text: string;
  answer: string;
  pointsEarned: number;
  pointsPossible: number;
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
  userRole?: number; // Add user role prop
  backendScore?: number; // Add backend score prop
  scoreBreakdown?: any; // Add score breakdown prop
}

/**
 * A reusable component for rendering detailed score summaries
 * This can be used in multiple places where score visualization is needed
 */
export const ScoreRenderer: React.FC<ScoreRendererProps> = ({
  formData,
  answers,
  showCategoryBreakdown = true,
  showDetailedScores = true,
  userRole, // Add user role parameter
  backendScore, // Add backend score parameter
  scoreBreakdown // Add score breakdown parameter
}) => {
  if (!formData?.categories) return null;
  
  // Always calculate category scores from form data for display
  const { totalScore: calculatedTotalScore, categoryScores: calculatedCategoryScores } = calculateFormScore(formData, answers);
  
  // Use backend score if available, otherwise use calculated score
  const totalScore = backendScore !== undefined ? backendScore : calculatedTotalScore;
  
  // Calculate visibility map to exclude hidden conditional questions
  const answerStrings: Record<number, string> = {};
  Object.entries(answers).forEach(([questionId, answer]) => {
    answerStrings[Number(questionId)] = answer.answer || '';
  });
  const visibilityMap = processConditionalLogic(formData, answerStrings);
  
  // Filter out categories with zero weight ONLY for CSRs (role_id 3)
  // All other roles (QA, managers, directors, trainers) should see all categories
  const visibleCategories = userRole === 3
    ? formData.categories.filter((category: any) => (category.weight || 0) > 0)
    : formData.categories;
  
  // Process each category to get formatted score data
  const categoryScores = visibleCategories.map((category: any) => {
    // Get the calculated score for this category from the scoring adapter result
    const calculatedScore = calculatedCategoryScores[category.id] || {
      raw: 0,
      weighted: 0,
      earnedPoints: 0,
      possiblePoints: 0
    };
    
    // Use backend normalized data if available, otherwise use calculated values
    const backendCategoryData = scoreBreakdown && scoreBreakdown.categoryBreakdown && scoreBreakdown.categoryBreakdown[category.id];
    
    // If backend data is available and valid, use it
    if (backendCategoryData && 
        typeof backendCategoryData.category_weight === 'number' && 
        typeof backendCategoryData.weighted_score === 'number' && 
        typeof backendCategoryData.weighted_possible === 'number') {
      var normalizedWeight = backendCategoryData.category_weight;
      var weightedScore = backendCategoryData.weighted_score;
      var weightedPossible = backendCategoryData.weighted_possible;
    } else {
      // Fallback to local calculation
      normalizedWeight = category.weight || 0;
      weightedScore = calculatedScore.earnedPoints * (category.weight || 0);
      weightedPossible = calculatedScore.possiblePoints * (category.weight || 0);
    }
    
    
    // Group questions by sub-category
    const subCategories: Record<string, QuestionWithScore[]> = {
      'default': []
    };
    
    // Process all questions in this category for display
    category.questions.forEach((question: any) => {
      if (!question.id) return;
      
      // Skip non-scoring questions
      if (question.question_type === 'info' || question.question_type === 'info_block') {
        return;
      }
      
      // Hide text input questions for CSR users (role_id 3) unless visible_to_csr is true
      if (userRole === 3 && question.question_type === 'TEXT' && question.visible_to_csr !== true) {
        return;
      }
      
      // If it's a sub-category header, just record it and skip processing
      const questionType = (question.question_type || '').toLowerCase();
      if (questionType === 'sub_category') {
        subCategories[question.question_text] = [];
        return;
      }
      
      // Skip ALL questions that are not visible (due to conditional logic)
      // This matches the form preview logic exactly
      const isVisible = visibilityMap[question.id] !== false;
      if (!isVisible) {
        return;
      }
      
      // Hide questions not visible to CSR (if user is CSR)
      if (userRole === 3 && question.visible_to_csr === false) {
        return;
      }
      
      const answer = answers[question.id];
      
      // Calculate points for this question using the same logic as the scoring adapter
      let pointsEarned = 0;
      let pointsPossible = 0;
      
      // Try to get the score from the answer directly
      if (answer && answer.score !== undefined) {
        pointsEarned = Number(answer.score);
      }
      
      // Check if this is an NA answer on an NA-allowed question
      const isNaAnswer = answer && (answer.answer?.toLowerCase() === 'na' || answer.answer?.toLowerCase() === 'n/a');
      const isNaAllowed = question.is_na_allowed;
      
      if (isNaAnswer && isNaAllowed) {
        // NA questions show 0 points possible and 0 points earned
        pointsPossible = 0;
        pointsEarned = 0;
      } else {
        // Use the getMaxPossibleScore function to get accurate points possible from database
        // This function uses the same logic as the form preview and scoring calculation
        pointsPossible = getMaxPossibleScore(question);
        
        // Get the actual earned points for this question
        if (answer && answer.score !== undefined) {
          pointsEarned = Number(answer.score);
        } else {
          // Use getQuestionScore to calculate points based on answer
          pointsEarned = answer ? getQuestionScore(question, answer.answer || '') : 0;
        }
      }
      
      // Determine which subcategory this question belongs to
      let subCategoryKey = 'default';
      const subCategoryKeys = Object.keys(subCategories);
      for (let i = subCategoryKeys.length - 1; i >= 0; i--) {
        if (subCategoryKeys[i] !== 'default') {
          subCategoryKey = subCategoryKeys[i];
          break;
        }
      }
      
      // Format answer for display with proper capitalization
      let displayAnswer = answer?.answer || 'No answer';
      if (displayAnswer && displayAnswer !== 'No answer') {
        // Handle radio questions - show option text instead of value
        const questionType = (question.question_type || '').toLowerCase();
        if (questionType === 'radio' && question.radio_options) {
          const selectedOption = question.radio_options.find(option => option.option_value === displayAnswer);
          if (selectedOption) {
            displayAnswer = selectedOption.option_text;
          }
        } else {
          // Handle other question types with proper capitalization
          const answerLower = displayAnswer.toLowerCase();
          if (answerLower === 'yes') {
            displayAnswer = 'Yes';
          } else if (answerLower === 'no') {
            displayAnswer = 'No';
          } else if (answerLower === 'n/a' || answerLower === 'na') {
            displayAnswer = 'N/A';
          }
        }
      }

      // Add question to appropriate subcategory
      subCategories[subCategoryKey].push({
        id: question.id,
        text: question.question_text,
        answer: displayAnswer,
        pointsEarned: pointsEarned,
        pointsPossible: pointsPossible
      });
    });
    
    return {
      id: category.id,
      name: category.category_name || category.name || `Category ${category.id}`,
      weight: normalizedWeight,
      originalWeight: category.weight || 0,
      pointsEarned: calculatedScore.earnedPoints,
      pointsPossible: calculatedScore.possiblePoints,
      weightedPointsEarned: Math.round(weightedScore * 100) / 100,
      weightedPointsPossible: Math.round(weightedPossible * 100) / 100,
      score: calculatedScore.raw,
      subCategories
    };
  }) as CategoryScore[];
  
  // Calculate totals for display using normalized weights
  let totalWeightedPointsEarned = 0;
  let totalWeightedPointsPossible = 0;
  
  // Calculate totals using normalized weights from backend
  categoryScores.forEach(category => {
    // Only include categories that have possible points (exclude zero-point categories)
    if (category.pointsPossible > 0) {
      totalWeightedPointsEarned += category.weightedPointsEarned;
      totalWeightedPointsPossible += category.weightedPointsPossible;
    }
  });
  
  // Round totals to avoid floating-point precision issues
  totalWeightedPointsEarned = Math.round(totalWeightedPointsEarned * 100) / 100;
  totalWeightedPointsPossible = Math.round(totalWeightedPointsPossible * 100) / 100;
  
  // Calculate score from weighted totals to get exact 82.30%
  const formScore = totalWeightedPointsPossible > 0 
    ? (totalWeightedPointsEarned / totalWeightedPointsPossible) * 100 
    : 0;
  
  
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
                          const hasScore = !(q.pointsEarned === 0 && q.pointsPossible === 0);
                          const answerClass = 'text-slate-600';
                          return (
                            <tr key={q.id} className="hover:bg-slate-50/60 transition-colors">
                              <td className="px-4 py-2.5 text-slate-700 leading-snug">{q.text}</td>
                              <td className={`px-3 py-2.5 ${answerClass}`}>
                                {q.answer === 'No answer' ? <span className="text-slate-300">—</span> : q.answer}
                              </td>
                              <td className="px-3 py-2.5 text-right text-slate-700 font-medium">
                                {hasScore ? q.pointsEarned.toFixed(1) : <span className="text-slate-300">—</span>}
                              </td>
                              <td className="px-4 py-2.5 text-right text-slate-500">
                                {hasScore ? q.pointsPossible.toFixed(1) : <span className="text-slate-300">—</span>}
                              </td>
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