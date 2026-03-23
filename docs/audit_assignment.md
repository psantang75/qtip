# Audit Assignment

## 📜 Purpose
The Audit Assignment screen enables Admins to schedule manual audits by selecting QA forms, assigning them to CSRs or departments, and defining audit schedules. This screen is critical for managing the QA process in the QTIP platform.

## 🖥️ UI Components
### Assignment Form
- **Fields**:
  - `form_id`: Dropdown of active forms from `forms`.
  - `target_type`: Radio buttons (User/Department).
  - `target_id`: Dropdown of users (CSRs) or departments, based on `target_type`.
  - `schedule`: Text input for schedule (e.g., "5 audits/week" or "3 audits/month").
  - `qa_id`: Dropdown of QA Analysts from `users` (optional, for specific assignment).
  - `start_date`: Date picker for audit start.
  - `end_date`: Date picker for audit end (optional).
- **Add Button**: Adds assignment to a temporary list for review.
- **Clear Button**: Resets form fields.

### Assignment List
- **Table**: Displays pending assignments before saving.
  - Columns: Form Name, Target (CSR/Department), Schedule, QA Analyst, Start Date, End Date.
  - Actions: Edit, Remove.
- **Save All Button**: Saves all assignments to `audit_assignments`.

### Active Assignments
- **Table**: Displays existing assignments from `audit_assignments`.
  - Columns: Form Name, Target, Schedule, QA Analyst, Start Date, End Date, Status (Active/Inactive).
  - Actions: Edit, Deactivate.
- **Search Bar**: Search by form or target name.
- **Pagination**: 10 assignments per page.

## 🔄 Workflow
1. **Create Assignment**  
   - Admin navigates to Audit Assignment from the dashboard.
   - Fills out the form, selects form, target, and schedule, then clicks "Add".
   - Repeats for multiple assignments, reviews in the Assignment List.

2. **Save Assignments**  
   - Clicks "Save All" to store assignments in `audit_assignments`.
   - Logs action in `audit_logs`.

3. **Edit Assignment**  
   - Selects an active assignment, edits fields, and saves.
   - Updates `audit_assignments`, logs action.

4. **Deactivate Assignment**  
   - Clicks "Deactivate" on an active assignment, confirms in modal.
   - Sets `is_active=false` in `audit_assignments`.

## 🗄️ Backend Integration
- **Tables**:
  - `forms`: Fetch active QA forms.
  - `users`: Fetch CSRs and QA Analysts.
  - `departments`: Fetch department options.
  - `audit_assignments`: Store assignments with the following fields:
    - `id`: Auto-incrementing primary key
    - `form_id`: ID of the form to be used (FK to forms.id)
    - `target_id`: ID of the user or department for audit
    - `target_type`: ENUM('USER', 'DEPARTMENT') indicating target type
    - `schedule`: Schedule description (e.g., "5 audits/week")
    - `qa_id`: Optional ID of QA Analyst assigned (FK to users.id)
    - `start_date`: When the audit assignment begins
    - `end_date`: Optional date when the assignment should end
    - `is_active`: Boolean indicating if assignment is active
    - `created_by`: ID of the user who created the assignment
    - `created_at`: Timestamp when the assignment was created
  - `audit_logs`: Log assignment actions.
- **Endpoints**:
  - `GET /api/audit-assignments`: Fetch active assignments with pagination.
  - `POST /api/audit-assignments`: Create new assignments.
  - `PUT /api/audit-assignments/:assignment_id`: Update assignment.
  - `DELETE /api/audit-assignments/:assignment_id`: Deactivate assignment.
- **Validation**:
  - Ensure `form_id` corresponds to an active form.
  - Validate `target_id` matches `target_type` (User/Department).
  - Check `schedule` format (e.g., "X audits/Y").
  - Restrict access to Admin role.
  - Validate `qa_id` is an existing QA analyst.

## 💻 Frontend Implementation
- **React Components**:
  - `AssignmentForm`: Form with dynamic dropdowns based on `target_type`.
  - `PendingAssignmentTable`: Temporary table for unsaved assignments.
  - `ActiveAssignmentTable`: Paginated table for existing assignments.
  - `ConfirmationModal`: Reusable modal for deactivation.
- **State Management**: Use React Hook Form for form state and React Query for data fetching.
- **Styling**: Tailwind CSS for form and table styling.

## ✅ Testing Notes
- Verify assignment creation for both CSR and department targets.
- Test schedule format validation.
- Ensure deactivation updates `is_active` correctly.
- Confirm assignments appear in QA Analyst's `qa_dashboard.md`.
- Validate Admin-only access to the screen.
- Test date filtering for assignments.