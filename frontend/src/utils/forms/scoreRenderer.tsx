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
  
  console.log('backendScore:', backendScore, 'calculatedTotalScore:', calculatedTotalScore, 'totalScore:', totalScore, 'typeof totalScore:', typeof totalScore);
  
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
  
  
  return (
    <div className="score-summary mt-8 space-y-8">
      {/* Category Breakdown */}
      {showCategoryBreakdown && (
        <div>
          <h3 className="text-xl font-semibold mb-4 text-gray-800">
            Category Breakdown
          </h3>
          
          <table className="w-full border-collapse mb-6 rounded-lg overflow-hidden shadow-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left p-3 border border-gray-200">Category</th>
                <th className="text-center p-3 border border-gray-200">Weight</th>
                <th className="text-center p-3 border border-gray-200">Normalized Weight</th>
                <th className="text-right p-3 border border-gray-200">Weighted Points</th>
                <th className="text-right p-3 border border-gray-200">Weighted Possible</th>
                <th className="text-right p-3 border border-gray-200">Score</th>
              </tr>
            </thead>
            <tbody>
              {/* Category rows */}
              {categoryScores.map((category: CategoryScore) => (
                <tr key={category.id} className="hover:bg-gray-50">
                  <td className="p-3 border border-gray-200 font-medium">{category.name}</td>
                  <td className="p-3 border border-gray-200 text-center">{((category as any).originalWeight * 100).toFixed(0)}%</td>
                  <td className="p-3 border border-gray-200 text-center">{(category.weight * 100).toFixed(0)}%</td>
                  <td className="p-3 border border-gray-200 text-right">
                    {category.pointsPossible === 0 ? 'N/A' : category.weightedPointsEarned.toFixed(2)}
                  </td>
                  <td className="p-3 border border-gray-200 text-right">
                    {category.pointsPossible === 0 ? 'N/A' : category.weightedPointsPossible.toFixed(2)}
                  </td>
                  <td className="p-3 border border-gray-200 text-right">
                    {category.pointsPossible === 0 ? 'N/A' : `${category.score.toFixed(1)}%`}
                  </td>
                </tr>
              ))}
              
              {/* Total row */}
              <tr className="bg-blue-50 font-semibold">
                <td className="p-3 border border-gray-200">FORM TOTAL</td>
                <td className="p-3 border border-gray-200 text-center">100%</td>
                <td className="p-3 border border-gray-200 text-center">100%</td>
                <td className="p-3 border border-gray-200 text-right">{totalWeightedPointsEarned.toFixed(2)}</td>
                <td className="p-3 border border-gray-200 text-right">{totalWeightedPointsPossible.toFixed(2)}</td>
                <td className="p-3 border border-gray-200 text-right">
                  <span className={`font-bold ${
                    formScore >= 90 ? 'text-green-600' : 
                    formScore >= 70 ? 'text-blue-600' : 
                    formScore >= 50 ? 'text-yellow-600' : 'text-red-600'
                  }`}>
                    {formScore.toFixed(2)}%
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
      
      {/* Detailed Category Score Tables */}
      {showDetailedScores && (
        <div className="mt-6">
          <h3 className="text-xl font-semibold mb-4 text-gray-800">
            Detailed Scores
          </h3>
          
          {categoryScores.map((category: CategoryScore) => (
            <div key={category.id} className="mb-8">
              <table className="w-full border-collapse mb-4 rounded-lg overflow-hidden shadow-sm">
                <thead className="bg-blue-50">
                  <tr>
                    <th colSpan={4} className="text-left p-3 border border-gray-200 text-lg font-semibold text-primary-blue">
                      <div className="flex justify-between items-center">
                        <span>{category.name}</span>
                        <span className="text-sm text-gray-500">Category Weight: {(category.weight * 100).toFixed(0)}%</span>
                      </div>
                    </th>
                  </tr>
                  <tr className="bg-gray-50">
                    <th className="text-left p-3 border border-gray-200 w-1/2">Question</th>
                    <th className="text-left p-3 border border-gray-200 w-1/4">Answer</th>
                    <th className="text-right p-3 border border-gray-200">Points</th>
                    <th className="text-right p-3 border border-gray-200">Possible</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(category.subCategories).map(([subCatName, questions]) => {
                    // Skip empty subcategories
                    if (questions.length === 0) return null;
                    
                    return (
                      <React.Fragment key={subCatName}>
                        {/* Show subcategory header if it's not the default category */}
                        {subCatName !== 'default' && (
                          <tr className="bg-gray-100">
                            <td colSpan={4} className="p-3 border border-gray-200 font-bold text-center">
                              {subCatName}
                            </td>
                          </tr>
                        )}
                        
                        {/* Show questions under this subcategory */}
                        {questions.map((question: QuestionWithScore) => (
                          <tr key={question.id} className="hover:bg-gray-50">
                            <td className="p-3 border border-gray-200">{question.text}</td>
                            <td className="p-3 border border-gray-200">{question.answer === 'No answer' ? '' : question.answer}</td>
                            <td className="p-3 border border-gray-200 text-right">
                              {question.pointsEarned === 0 && question.pointsPossible === 0 ? '' : question.pointsEarned.toFixed(1)}
                            </td>
                            <td className="p-3 border border-gray-200 text-right">
                              {question.pointsEarned === 0 && question.pointsPossible === 0 ? '' : question.pointsPossible.toFixed(1)}
                            </td>
                          </tr>
                        ))}
                      </React.Fragment>
                    );
                  })}
                  
                  {/* Category totals row */}
                  <tr className="bg-gray-100 font-medium">
                    <td colSpan={2} className="p-3 border border-gray-200">
                      Category Total
                    </td>
                    <td className="p-3 border border-gray-200 text-right">{category.pointsEarned.toFixed(1)}</td>
                    <td className="p-3 border border-gray-200 text-right">{category.pointsPossible.toFixed(1)}</td>
                  </tr>
                  
                  {/* Category score percentage */}
                  <tr className="bg-blue-50 font-semibold">
                    <td colSpan={3} className="p-3 border border-gray-200">
                      Category Score
                    </td>
                    <td className="p-3 border border-gray-200 text-right">
                      {category.score.toFixed(1)}%
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default ScoreRenderer; 