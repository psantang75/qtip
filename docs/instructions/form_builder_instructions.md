# Form Builder Instructions

## Purpose
This document outlines the Admin UI and backend logic for the Form Builder in the QA & Training Insight Platform (QTIP), enabling Admins to create and manage dynamic QA forms for auditing customer interactions (calls, tickets, emails, chats). The Form Builder supports weighted categories, conditional questions, and metadata fields, storing data in the "qtip" MySQL database. This guide provides detailed UI wireframes, JSON payloads, validation rules, and Cursor prompts to implement the feature.

---

## Overview
- **Users**: Admins (full access to create/edit forms).
- **Features**:
  - Create/edit forms with name, interaction type (call, ticket, email, chat, universal), and active status.
  - Add/edit categories with names, descriptions, and weights (summing to 1.0).
  - Add/edit questions with types (yes/no, scale, text, info), scores, and conditional logic.
  - Support metadata fields (e.g., ticket number, call date).
  - Preview forms before saving.
  - List and manage existing forms with edit/delete options.
-

---

## Form Builder Workflow

### Step 1: Access Form Builder

- **Action**: Loads a blank form template or existing form for editing (GET /forms/:id).
- 

### Step 2: Define Form Details
- **Fields**:
  - Name (e.g., “Call Audit v1”).
  - Interaction Type (dropdown: call, ticket, email, chat, universal).
  - Active Status (checkbox, default: true).
- **UI**: Input fields at the top of the Form Builder page.
- **Validation**:
  - Name: Required, 1–255 characters.
  - Interaction Type: Must be one of the enum values.
- **API**: POST /forms or PATCH /forms/:id.

### Step 3: Add Categories
- **Fields**:
  - Name (e.g., “Greeting”).
  - Description (optional, rich text).
  - Weight (number, 0.0–1.0, e.g., 0.2 for 20%).
- **UI**: “Add Category” button opens a modal with input fields.
- **Validation**:
  - Name: Required, 1–255 characters.
  - Weight: Required, 0.0–1.0, sum of all category weights must equal 1.0.
  - At least one category required per form.
- **API**: Included in POST /forms payload.

### Step 4: Add Questions
- **Fields**:
  - Question Text (e.g., “Did CSR greet by name?”).
  - Type (dropdown: yes_no, scale, text, info).
  - Scores (for yes_no: score_if_yes, score_if_no, score_na; for scale: max_scale).
  - Conditional Logic (optional):
    - Is Conditional (checkbox).
    - Condition Type (dropdown: equals, not_equals, exists, not_exists).
    - Target Question ID (dropdown of prior questions in form).
    - Target Value (text or dropdown based on target question type).
    - Exclude if Unmet (checkbox, default: false).
- **UI**: “Add Question” button per category opens a modal with fields.
- **Validation**:
  - Question Text: Required, 1–1000 characters.
  - Type: Must be one of the enum values.
  - Scores: Required for yes_no (integers), max_scale for scale (1–10).
  - Conditional Logic: Target Question ID must exist and precede the current question; Target Value must match target question’s type.
-
### Step 6: Preview and Save
- **UI**:
  - “Preview” button renders the form as QA auditors would see it, with categories, questions, and metadata fields.
  - “Save” button submits the form to POST /forms or PATCH /forms/:id.
- **Validation**:
  - Ensure category weights sum to 1.0.
  - At least one category and one question per form.
  - No circular conditional logic (e.g., Q2 depends on Q3, Q3 on Q2).
- **API Response**: Returns form ID and confirmation.



---

## UI Wireframe (Markdown Table)
```
+-------------------+-----------------------------------+-------------------+
| Form Details      | Category List                     | Actions           |
+-------------------+-----------------------------------+-------------------+
| Name: [Input]     | [Greeting (20%)]                  | [Preview]         |
| Type: [Dropdown]  | - Q1: Did CSR greet? [Yes/No]     | [Save]            |
| Active: [Checkbox]| - Q2: Tone friendly? [Scale 0-5]  | [Add Category]    |
|                   | [Compliance (30%)]                | [Add Metadata]    |
|                   | - Q3: Policy followed? [Yes/No]   |                   |
+-------------------+-----------------------------------+-------------------+
```

-

## Validation Rules
- **Form**:
  - Name: 1–255 characters, unique per interaction type.
  - Interaction Type: Must be valid enum value.
- **Categories**:
  - Name: 1–255 characters.
  - Weight: 0.0–1.0, sum across categories = 1.0 (±0.01 tolerance).
  - At least one category required.
- **Questions**:
  - Question Text: 1–1000 characters.
  - Type: Valid enum (yes_no, scale, text, info).
  - Scores: Integers for yes_no (0–100), max_scale for scale (1–10).
  - Conditional Logic: Target question must exist, precede current question, and have compatible target value.
- **Metadata**:
  - Field Name: 1–100 characters, unique per form.
  - Type: text, number, date.

---
