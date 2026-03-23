# QTIP Test Plan

## 📜 Purpose
This document outlines the test plan for the Quality and Training Insight Platform (QTIP), including test cases, acceptance criteria, and seed data logic to ensure comprehensive QA coverage. It is designed for developers using Cursor to validate system functionality across all modules.

## 🧪 Test Scope
- **Modules**: QA Form Management, Manual Audit Assignment, QA Review Process, Dispute Management, LMS Training, Performance Minimums, Reporting & Analytics.
- **Roles**: Admin, QA Analyst, CSR, Trainer, Manager, Director.
- **Components**: Frontend (React), Backend (Node.js/Express), Database (MySQL `qtip` schema).

## 📊 Seed Data Logic
To test the system, populate the `qtip` database with the following seed data:
- **Roles**: Insert 6 roles (`Admin`, `QA`, `CSR`, `Trainer`, `Manager`, `Director`) into `roles`.
- **Users**: Create 10 users (2 Admins, 2 QAs, 3 CSRs, 1 Trainer, 1 Manager, 1 Director) in `users`, linked to `roles` and `departments`.
- **Departments**: Add 2 departments (e.g., “Sales”, “Support”) in `departments`, each with a Manager.
- **Forms**: Create 2 QA forms with 2 categories each, containing 5 questions (1 Yes/No, 1 Scale, 1 Text, 1 Info, 1 Yes/No with N/A) in `forms`, `form_categories`, `form_questions`.
- **Calls**: Insert 10 call records with dummy transcripts and audio URLs in `calls`, linked to CSRs.
- **Audit Assignments**: Assign 5 audits to QAs for CSRs in `audit_assignments`.
- **Submissions**: Create 5 completed audits in `submissions` and `submission_answers`.
- **Disputes**: Add 2 disputes (1 Pending, 1 Resolved) in `disputes`.
- **Courses**: Create 2 courses with 3 pages each (Text, Video, PDF) and 1 quiz in `courses`, `course_pages`, `quizzes`.
- **Enrollments**: Enroll 3 CSRs in courses with varying completion statuses in `enrollments`.
- **Performance Goals**: Set 1 global goal (e.g., QA score ≥ 85%) in `performance_goals`.

**Seed Script Example**:
```sql
INSERT INTO roles (role_name) VALUES ('Admin'), ('QA'), ('CSR'), ('Trainer'), ('Manager'), ('Director');
INSERT INTO departments (department_name, manager_id) VALUES ('Sales', NULL), ('Support', NULL);
INSERT INTO users (username, email, password_hash, role_id, department_id) VALUES
  ('admin1', 'admin1@qtip.com', 'hashed_password', 1, 1),
  ('qa1', 'qa1@qtip.com', 'hashed_password', 2, 1),
  ('csr1', 'csr1@qtip.com', 'hashed_password', 3, 1);
-- Add more seed data for forms, calls, etc.
```

## 🧪 Test Cases
### 1. QA Form Management
- **Test Case**: Create a new QA form with all question types.
  - **Steps**:
    1. Log in as Admin, navigate to QA Form Builder.
    2. Create a form with 2 categories and 5 questions (Yes/No, Scale 1–5, Text, Info, Yes/No with N/A).
    3. Save and verify form appears in `forms`, `form_categories`, `form_questions`.
  - **Acceptance Criteria**: Form is saved, questions are correctly stored, N/A option is enabled for specified question.
- **Test Case**: Edit and deactivate a form.
  - **Steps**:
    1. Edit an existing form, add a new question, save as new version.
    2. Deactivate the form.
  - **Acceptance Criteria**: New version is created, `is_active=false` in `forms`.

### 2. Manual Audit Assignment
- **Test Case**: Assign audits to a QA Analyst.
  - **Steps**:
    1. Log in as Admin, navigate to Assign Audits.
    2. Assign a form to a CSR with schedule “3 audits/week”.
    3. Verify assignment in `audit_assignments`.
  - **Acceptance Criteria**: Assignment is saved with correct `form_id`, `target_id`, and `schedule`.

### 3. QA Review Process
- **Test Case**: Score an assigned audit.
  - **Steps**:
    1. Log in as QA, navigate to Assigned Audits.
    2. Select an audit, score using split-screen (transcript/audio + form).
    3. Submit and verify score in `submissions` and answers in `submission_answers`.
  - **Acceptance Criteria**: Score is calculated correctly, N/A answers are excluded, submission is linked to `calls`.

### 4. Dispute Management
- **Test Case**: Submit and resolve a dispute.
  - **Steps**:
    1. Log in as CSR, submit a dispute for an audit.
    2. Log in as Manager, resolve the dispute (adjust score).
    3. Verify dispute status and audit log in `disputes` and `audit_logs`.
  - **Acceptance Criteria**: Dispute is saved, resolution updates score, log is created.

### 5. LMS Training
- **Test Case**: Create and complete a course.
  - **Steps**:
    1. Log in as Trainer, create a course with 2 pages and a quiz.
    2. Assign to a CSR, log in as CSR, complete the course and quiz.
    3. Verify completion in `enrollments` and certificate in `certificates`.
  - **Acceptance Criteria**: Course is saved, CSR completes quiz, certificate is issued.

### 6. Performance Minimums
- **Test Case**: Set and display performance goals.
  - **Steps**:
    1. Log in as Admin, set a QA score goal of 85%.
    2. Log in as CSR, verify goal displays on dashboard.
  - **Acceptance Criteria**: Goal is saved in `performance_goals`, visible to CSR.

### 7. Reporting & Analytics
- **Test Case**: Generate a role-based report.
  - **Steps**:
    1. Log in as Manager, filter analytics for team QA scores.
    2. Verify data matches `score_snapshots` and `submissions`.
  - **Acceptance Criteria**: Report shows correct data, respects role-based scope.

## ✅ Testing Notes
- Use Cursor’s terminal (`Ctrl + \``) to run seed scripts and verify database state.
- Generate unit tests in Cursor by querying: “Create Jest tests for QA form submission.”
- Test role-based access control (e.g., CSR cannot access QA screens).
- Validate responsiveness of all screens on mobile and desktop.
- Ensure all database operations (e.g., inserts, updates) are logged in `audit_logs`.

## 💻 Cursor Integration
- Import `test_plan.md` into Cursor’s `/docs` folder.
- Use Cursor’s Composer (`Ctrl + K`) to query test cases: “What are the steps to test QA form creation?”
- Generate test scripts by asking Cursor: “Write a Jest test for audit submission endpoint.”