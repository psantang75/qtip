import type { QuizBuilderData, QuizBuilderErrors } from './QuizBuilder'

/**
 * Validate a quiz-builder payload. Extracted from `QuizBuilder.tsx` so that
 * component file only exports a component (keeps Vite fast-refresh working).
 */
export function validateQuizBuilder(data: QuizBuilderData): QuizBuilderErrors {
  const errors: QuizBuilderErrors = {}
  if (!data.quiz_title.trim()) errors.quiz_title = 'Quiz title is required'
  if (!data.pass_score || data.pass_score < 1 || data.pass_score > 100)
    errors.pass_score = 'Pass score must be between 1 and 100'
  if (data.questions.length === 0) errors.questions = 'Add at least one question'
  data.questions.forEach((q, idx) => {
    if (!q.question_text.trim()) { errors[`q_${idx}`] = 'Question text is required'; return }
    const filled = q.options.filter(o => o.trim())
    if (filled.length < 2) errors[`q_${idx}`] = 'At least 2 non-empty options required'
  })
  return errors
}
