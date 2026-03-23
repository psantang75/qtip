# QTIP Scoring Visualization for Form Preview

This document explains how to use the enhanced scoring visualization feature in the form preview screen.

## Overview

The form preview screen now includes a detailed scoring panel that shows:

1. **Per-Category Scoring**
   - Raw scores for each category (points earned vs. total possible)
   - Visual progress bars showing percentage scores
   - Weighted scores based on category weights

2. **Total Score Calculation**
   - Aggregate score across all categories
   - Visual progress bar for overall performance
   - Color-coded indicators (red, yellow, blue, green) based on score ranges

3. **Scoring Information**
   - Applied scoring rules and conditions
   - Category weight application
   - Conditional logic status
   - N/A handling information

## How to Use

1. Navigate to the form editor in the admin section
2. Make changes to your form as needed
3. Click "Preview Form" to open the preview screen
4. Test the form by filling out answers
5. Watch the scoring panel update in real-time as you answer questions

## Scoring Algorithm

The scoring visualization uses the enhanced QTIP scoring algorithm which implements:

- **Weighted Categories**: Each category's raw score is weighted according to its assigned importance
- **Conditional Logic**: Questions that are hidden due to conditional logic are excluded from scoring
- **N/A Handling**: Questions marked as N/A (when allowed) are excluded from score calculation
- **Question-Type Specific Scoring**:
  - Yes/No questions: Scored based on yes_value and no_value
  - Scale questions: Scored based on the selected value within scale_min to scale_max
  - Radio questions: Scored based on the selected option's score value

## Technical Implementation

The scoring visualization is implemented with these components:

- `FormPreviewScreen.tsx`: Contains the UI for the scoring panel
- `formScoring.ts`: Enhanced scoring utility that calculates detailed scores
- `formRendererComponents.tsx`: Provides the component framework for rendering forms

## Troubleshooting

If scores don't update correctly:

1. Check the browser console for errors
2. Verify question weights and category weights are set correctly
3. Ensure conditional logic is properly configured
4. Check that N/A values are properly marked 