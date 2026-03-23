/**
 * Utility functions for handling score values that may come as strings or numbers from the API
 */

/**
 * Safely converts a score value (string or number) to a number
 * @param score - The score value which may be a string or number
 * @param defaultValue - Default value to return if conversion fails (default: 0)
 * @returns A number value for the score
 */
export const parseScore = (score: string | number | undefined | null, defaultValue: number = 0): number => {
  if (score === null || score === undefined) {
    return defaultValue;
  }
  
  if (typeof score === 'number') {
    return isNaN(score) ? defaultValue : score;
  }
  
  if (typeof score === 'string') {
    const parsed = parseFloat(score);
    return isNaN(parsed) ? defaultValue : parsed;
  }
  
  return defaultValue;
};

/**
 * Formats a score value for display with proper decimal places
 * @param score - The score value which may be a string or number
 * @param decimals - Number of decimal places to show (default: 1)
 * @param suffix - Suffix to add (default: '%')
 * @returns Formatted score string
 */
export const formatScore = (score: string | number | undefined | null, decimals: number = 1, suffix: string = '%'): string => {
  const numericScore = parseScore(score);
  return `${numericScore.toFixed(decimals)}${suffix}`;
};

/**
 * Gets the appropriate CSS class for score-based color coding
 * @param score - The score value which may be a string or number
 * @param colorScheme - Color scheme to use ('text' for text colors, 'bg' for background colors)
 * @returns CSS class string
 */
export const getScoreColorClass = (
  score: string | number | undefined | null, 
  colorScheme: 'text' | 'bg' = 'text'
): string => {
  const numericScore = parseScore(score);
  
  if (colorScheme === 'text') {
    if (numericScore >= 90) return 'text-green-600';
    if (numericScore >= 70) return 'text-blue-600';
    if (numericScore >= 50) return 'text-yellow-600';
    return 'text-red-600';
  } else {
    if (numericScore >= 90) return 'bg-green-100 text-green-800';
    if (numericScore >= 70) return 'bg-yellow-100 text-yellow-800';
    return 'bg-red-100 text-red-800';
  }
}; 