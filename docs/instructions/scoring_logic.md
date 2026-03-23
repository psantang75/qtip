# Scoring Logic

## Purpose
This document defines the scoring logic for the QA & Training Insight Platform (QTIP), which calculates scores for quality assurance (QA) forms used to evaluate customer interactions (calls, tickets, emails, chats) stored in the "qtip" MySQL database. The system supports weighted categories, conditional question logic, N/A exclusions, and optional training-weighted scoring to ensure fair and accurate performance metrics for CSRs.

---

## Scoring Overview
- **Form Structure**:
  - **Categories**: Grouped sections (e.g., Greeting, Compliance), each with a weight (0.0–1.0, summing to 1.0).
  - **Questions**: Within categories, with types: `yes_no`, `scale` (0–5), `text`, `info` (non-scored).
- **Scoring Rules**:
  - Questions have point values (e.g., 0/5 for yes/no, 0–5 for scales).
  - Questions can be marked N/A, excluding them from scoring.
  - Conditional logic shows/hides questions based on prior answers (e.g., “If Q1 = No, skip Q2”).
  - Category score = (sum of earned points / sum of possible points) * category weight.
  - Form score = sum of weighted category scores.
  - Optional: Training-weighted scoring reduces scores if required training is incomplete.
- **Output**:
  - Per-category scores (e.g., Greeting: 85%).
  - Total form score (e.g., 82.5%).
  - Stored in `score_snapshots` for analytics and reporting.

---

## Scoring Algorithm

### Step 1: Collect Applicable Questions
For each question in a category:
- Check if `is_conditional = true`.
- If condition is unmet (e.g., `target_question_id` answer doesn’t match `target_value`), mark as N/A if `exclude_if_unmet = true`.
- Exclude `info` type questions (e.g., ticket number, call date).
- If `score_na` is set, treat as 0 points and exclude from possible points.

### Step 2: Calculate Category Score
For each category:
- **Earned Points**: Sum `score` from `answers` for applicable questions.
- **Possible Points**: Sum max possible points (e.g., `score_if_yes`, max scale value).
- **Raw Score**: (earned points / possible points) * 100.
- **Weighted Score**: raw score * category.weight.

### Step 3: Apply Training-Weighted Scoring (Optional)
- Check `training_events` for required courses (linked via `course_id` or `category_id`).
- If incomplete, apply a penalty (configurable, e.g., -10% to category score).
- Store penalty details in `score_snapshots` (e.g., `training_penalty_applied`).

### Step 4: Calculate Form Score
- Sum all weighted category scores.
- Store in `score_snapshots.total_score`.

### Pseudocode
```javascript
function calculateFormScore(submissionId) {
  const submission = db.submissions.find(submissionId);
  const form = db.forms.find(submission.form_id);
  const categories = db.categories.where({ form_id: form.id });
  let totalScore = 0;
  let scoreSnapshot = [];

  for (const category of categories) {
    const questions = db.questions.where({ category_id: category.id });
    let earnedPoints = 0;
    let possiblePoints = 0;

    for (const question of questions) {
      const answer = db.answers.find({ submission_id: submissionId, question_id: question.id });
      if (!answer || question.type === 'info') continue;

      // Check conditional logic
      if (question.is_conditional) {
        const targetAnswer = db.answers.find({ submission_id: submissionId, question_id: question.target_question_id });
        if (targetAnswer && targetAnswer.answer !== question.target_value && question.exclude_if_unmet) {
          continue; // Skip if condition unmet
        }
      }

      // Add points
      if (answer.score !== question.score_na) {
        earnedPoints += answer.score;
        possiblePoints += question.type === 'yes_no' ? question.score_if_yes : question.max_scale;
      }
    }

    // Calculate category score
    const rawScore = possiblePoints > 0 ? (earnedPoints / possiblePoints) * 100 : 0;
    let weightedScore = rawScore * category.weight;

    // Apply training penalty (if enabled)
    const requiredTraining = db.training_events.where({ csr_id: submission.csr_id, category_id: category.id, status: 'incomplete' });
    if (requiredTraining.length > 0 && config.training_penalty_enabled) {
      weightedScore *= (1 - config.training_penalty); // e.g., 0.9 for 10% penalty
    }

    totalScore += weightedScore;
    scoreSnapshot.push({ category_id: category.id, category_score: rawScore, weighted_score: weightedScore });
  }

  // Save snapshot
  db.score_snapshots.insert({
    submission_id: submissionId,
    score_snapshot: scoreSnapshot,
    total_score: totalScore
  });

  return totalScore;
}
```
