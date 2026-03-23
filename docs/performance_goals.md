# Performance Goals

## 📜 Purpose
The Performance Goals screen allows Admins to define and manage performance minimums for QA scores, audit rates, and dispute rates, either globally or by department. These goals are displayed on CSR, Manager, and Director dashboards to track performance in the QTIP platform.

## 🖥️ UI Components
### Goal List
- **Table**: Displays existing goals from `performance_goals`.
  - Columns: Goal Type (QA Score, Audit Rate, Dispute Rate), Target Value, Scope (Global/Department), Created Date, Status (Active/Inactive).
  - Actions: Edit, Deactivate/Activate.
- **Search Bar**: Search by goal type or department.
- **Pagination**: 10 goals per page.

### Add/Edit Goal Form
- **Fields**:
  - `goal_type`: Dropdown (QA Score, Audit Rate, Dispute Rate).
  - `target_value`: Number input (e.g., 85 for QA Score, 5 for Audit Rate, 2 for Dispute Rate).
  - `scope`: Radio buttons (Global/Department).
  - `department_id`: Dropdown of departments from `departments` (if scope is Department).
  - `description`: Textarea (optional, for goal details).
- **Save Button**: Creates or updates goal.
- **Cancel Button**: Discards changes.

### Confirmation Modal
- **Deactivate/Activate**: Confirms status change.
- **Delete**: Confirms soft deletion (marks goal as inactive).

## 🔄 Workflow
1. **View Goals**  
   - Admin navigates to Performance Goals from the dashboard.
   - Browses goal list, applies filters, or searches.

2. **Add Goal**  
   - Clicks “Add Goal”, fills out form, selects scope, and saves.
   - New goal is created in `performance_goals`, logged in `audit_logs`.

3. **Edit Goal**  
   - Selects a goal, edits fields (e.g., change `target_value`), and saves.
   - Updates `performance_goals`, logs action.

4. **Deactivate/Activate**  
   - Clicks “Deactivate” or “Activate”, confirms in modal.
   - Sets `is_active` in `performance_goals` (default column, not shown in schema).

## 🗄️ Backend Integration
- **Tables**:
  - `performance_goals`: Store goal data.
  - `departments`: Fetch department options.
  - `audit_logs`: Log goal management actions.
- **Endpoints**:
  - `GET /api/performance-goals`: Fetch all goals with pagination and filters.
  - `POST /api/performance-goals`: Create new goal.
  - `PUT /api/performance-goals/:goal_id`: Update goal.
  - `DELETE /api/performance-goals/:goal_id`: Deactivate goal.
- **Validation**:
  - Ensure `target_value` is valid for `goal_type` (e.g., 0–100 for QA Score, positive integer for Audit Rate).
  - Validate `department_id` if scope is Department.
  - Restrict access to Admin role.

## 💻 Frontend Implementation
- **React Components**:
  - `GoalTable`: Paginated table with filters and action buttons.
  - `GoalForm`: Form for adding/editing goals with dynamic fields.
  - `ConfirmationModal`: Reusable modal for deactivate/activate/delete.
- **State Management**: Use React Query for goal data fetching and mutations.
- **Styling**: Tailwind CSS for table and form styling.

## ✅ Testing Notes
- Verify goal creation for all goal types and scopes.
- Test display of goals on `csr_dashboard.md`, `manager_dashboard.md`, and `director_dashboard.md`.
- Ensure deactivation updates `is_active` correctly.
- Confirm only one active goal per type and scope (e.g., one QA Score goal per department).
- Validate Admin-only access to the screen.