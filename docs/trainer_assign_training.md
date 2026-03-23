# Trainer Assign Training

## 📜 Purpose
The Trainer Assign Training screen enables Trainers to assign courses or training paths to CSRs or departments, facilitating targeted training in the QTIP platform’s LMS. This screen supports manual assignment for personalized training plans.

## 🖥️ UI Components
### Assignment Form
- **Fields**:
  - `assignment_type`: Radio buttons (Course/Training Path).
  - `target_type`: Radio buttons (User/Department).
  - `target_id`: Multi-select dropdown of CSRs or departments, based on `target_type`.
  - `course_id` or `path_id`: Dropdown of published courses (`courses`) or paths (`training_paths`), based on `assignment_type`.
  - `due_date`: Date picker (optional).
- **Add Button**: Adds assignment to a temporary list.
- **Clear Button**: Resets form fields.

### Pending Assignments
- **Table**: Displays unsaved assignments.
  - Columns: Course/Path Name, Target (CSR/Department), Due Date.
  - Actions: Edit, Remove.
- **Save All Button**: Saves assignments to `enrollments`.

### Active Assignments
- **Table**: Lists existing assignments from `enrollments`.
  - Columns: Course/Path Name, Target, Due Date, Status (In Progress/Completed).
  - Actions: Cancel Assignment.
- **Search Bar**: Search by course or target name.
- **Pagination**: 10 assignments per page.

## 🔄 Workflow
1. **Create Assignment**  
   - Trainer navigates to Assign Training from the dashboard.
   - Fills out the form, selects course/path and target, then clicks “Add”.
   - Repeats for multiple assignments, reviews in Pending Assignments.

2. **Save Assignments**  
   - Clicks “Save All” to store assignments in `enrollments`.
   - Logs action in `audit_logs`.

3. **Cancel Assignment**  
   - Selects an active assignment, clicks “Cancel”, confirms in modal.
   - Removes assignment from `enrollments`, logs action.

## 🗄️ Backend Integration
- **Tables**:
  - `courses`: Fetch published courses.
  - `training_paths`: Fetch training paths.
  - `users`: Fetch CSRs.
  - `departments`: Fetch departments.
  - `enrollments`: Store assignments.
  - `audit_logs`: Log assignment actions.
- **Endpoints**:
  - `GET /api/trainer/courses`: Fetch published courses.
  - `GET /api/trainer/paths`: Fetch training paths.
  - `GET /api/trainer/targets`: Fetch CSRs and departments.
  - `POST /api/enrollments`: Create new assignments.
  - `DELETE /api/enrollments/:enrollment_id`: Cancel assignment.
- **Validation**:
  - Ensure `course_id` or `path_id` is valid and published.
  - Validate `target_id` matches `target_type`.
  - Restrict access to Trainer role.

## 💻 Frontend Implementation
- **React Components**:
  - `AssignmentForm`: Form with dynamic dropdowns based on `assignment_type` and `target_type`.
  - `PendingAssignmentTable`: Temporary table for unsaved assignments.
  - `ActiveAssignmentTable`: Paginated table for existing assignments.
  - `ConfirmationModal`: Reusable modal for cancellation.
- **State Management**: Use React Hook Form for form state and React Query for data fetching.
- **Styling**: Tailwind CSS for form and table styling.

## ✅ Testing Notes
- Verify assignment creation for both courses and paths.
- Test multi-select functionality for assigning to multiple CSRs.
- Ensure cancellation removes assignment from `enrollments`.
- Confirm assignments appear in CSR’s `csr_training_dashboard.md`.
- Validate Trainer-only access to the screen.