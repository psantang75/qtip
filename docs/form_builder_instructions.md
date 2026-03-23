# QA Form Builder Instructions

## 📜 Purpose
This document details the QA Form Builder, a tool for Admins to create and edit versioned QA forms used in audits. The builder supports specific question types (Yes/No, Scale, N/A, Text Box, Informational Block) with weighted categories and conditional logic.

## 🖥️ UI Components
### Form Builder Dashboard
- **Form List**: Table of existing forms (`form_name`, `version`, `is_active`, `created_at`).
  - Actions: Edit, Duplicate, Deactivate.
- **New Form Button**: Opens the form creation wizard.
- **Search/Filter**: Search by form name or filter by active/inactive status.

### Form Creation/Edit Wizard
- **Step 1: Form Metadata**  
  - Fields: `form_name` (text), `version` (auto-incremented), `is_active` (checkbox).
- **Step 2: Add Categories**  
  - Add category: `category_name` (text), `weight` (decimal, e.g., 0.25 for 25%).
  - List of categories with edit/delete options.
- **Step 3: Add Questions**  
  - For each category, add questions with:
    - `question_text` (textarea).
    - `question_type` (dropdown: Yes/No, Scale, Text, Info).
    - `is_na_allowed` (checkbox, enables N/A option).
    - For Scale: `scale_min` (number), `scale_max` (number).
    - `weight` (decimal, optional for question-level scoring).
  - Conditional Logic: Add rules (e.g., “If Q1 = Yes, show Q2”).
- **Step 4: Preview & Save**  
  - Preview form as QA Analysts would see it.
  - Save or cancel.

## 🔄 Workflow
1. **Create New Form**  
   - Admin clicks “New Form” and enters metadata.
   - Adds categories with weights summing to 1.0.
 Secondary adds questions with weights and conditional logic.
   - Adds questions, specifying type, N/A option, and scale ranges (if applicable).
   - Saves form, which is stored in `forms`, `form_categories`, `form_questions`.

2. **Edit Existing Form**  
   - Select form from list, edit categories/questions.
   - Save as new version (increment `version`).

3. **Deactivate Form**  
   - Set `is_active` to false; form is no longer assignable but remains for historical audits.

## 📊 Question Types
| Type       | Description                              | Scoring Behavior                     |
|------------|------------------------------------------|--------------------------------------|
| **Yes/No** | Binary choice (Yes/No).                  | Scores as 1 (Yes) or 0 (No).         |
| **Scale**  | Numeric range (e.g., 1–5).               | Scores as selected value.            |
| **N/A**    | Optional for Yes/No or Scale questions.  | Excluded from scoring if selected.   |
| **Text**   | Free-text input for QA notes.            | Not scored, stored for reference.    |
| **Info**   | Instructional text, no input required.   | Not scored, displayed in form.       |

## 🗄️ Backend Integration
- **Tables**:
  - `forms`: Stores `form_id`, `form_name`, `version`, `is_active`, `created_by`.
  - `form_categories`: Stores `category_id`, `form_id`, `category_name`, `weight`.
  - `form_questions`: Stores `question_id`, `category_id`, `question_text`, `question_type`, `is_na_allowed`, `scale_min`, `scale_max`, `weight`.
- **Endpoints**:
  - `POST /api/forms`: Create new form.
  - `PUT /api/forms/:form_id`: Update form (creates new version).
  - `GET /api/forms`: List all forms.
  - `DELETE /api/forms/:form_id`: Deactivate form.
- **Validation**:
  - Ensure category weights sum to 1.0.
  - Validate scale ranges (e.g., `scale_min < scale_max`).
  - Check for duplicate `form_name` within active forms.

## 💻 Frontend Implementation
- **React Components**:
  - `FormList`: Renders table of forms with pagination.
  - `FormWizard`: Multi-step form for creating/editing.
  - `QuestionEditor`: Dynamic form for question types (e.g., dropdown for type, number inputs for scale).
- **State Management**: Use React Context or Redux to manage form state during creation.
- **Styling**: Tailwind CSS for responsive, clean UI.

## ✅ Testing Notes
- Test form creation with all question types.
- Validate N/A option excludes question from score calculation.
- Ensure conditional logic works (e.g., show/hide questions based on answers).
- Verify version increment on edit and historical form retention.