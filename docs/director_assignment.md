# Director Assignment

## 📜 Purpose
The Director Assignment screen enables Admins to assign directors to departments in the QTIP platform, establishing a clear hierarchy where directors oversee managers assigned to those departments. This functionality supports cross-team performance tracking and dispute resolution by linking managers to directors through department assignments.

## 🖥️ UI Components
### Director Assignment Form
- **Fields**:
  - `director_id`: Dropdown of users with the Director role from `users` (filtered by `role_id` for Director).
  - `department_id`: Dropdown of departments from `departments`.
- **Add Button**: Adds the assignment to a temporary list for review.
- **Clear Button**: Resets form fields.

### Pending Assignments List
- **Table**: Displays unsaved director-department assignments.
  - Columns: Director Name, Department Name.
  - Actions: Edit, Remove.
- **Save All Button**: Saves assignments to `director_departments`.

### Active Assignments List
- **Table**: Displays existing assignments from `director_departments`.
  - Columns: Director Name, Department Name, Created Date.
  - Actions: Remove.
- **Search Bar**: Search by director or department name.
- **Pagination**: 20 assignments per page.

### Confirmation Modal
- **Remove**: Confirms removal of an assignment.

## 🔄 Workflow
1. **View Assignments**  
   - Admin navigates to Director Assignment from the dashboard (linked from `admin_dashboard.md`).
   - Browses active assignments, applies filters, or searches.

2. **Add Assignment**  
   - Selects a director and department in the form, clicks “Add” to queue the assignment.
   - Repeats for multiple assignments, reviews in the Pending Assignments List.

3. **Save Assignments**  
   - Clicks “Save All” to store assignments in `director_departments`.
   - Logs action in `audit_logs`.

4. **Remove Assignment**  
   - Clicks “Remove” on an active assignment, confirms in modal.
   - Deletes the assignment from `director_departments`, logs action.

## 🗄️ Backend Integration
- **Tables**:
  - `director_departments`: Stores director-department assignments.
  - `users`: Fetches directors (filtered by `role_id` for Director) and manager names for display.
  - `departments`: Fetches department details.
  - `audit_logs`: Logs assignment actions.
- **Endpoints**:
  - `POST /api/departments/directors`: Create a new director-department assignment.
    - Payload: `{ director_id: number, department_id: number }`.
    - Response: `{ id: number, director_id: number, department_id: number }`.
  - `GET /api/departments/directors`: List all assignments with pagination and filters.
    - Query Params: `director_id`, `department_id`, `page`, `limit`.
    - Response: `[{ id: number, director_id: number, department_id: number, director_name: string, department_name: string, created_at: string }, ...]`.
  - `GET /api/departments/directors/:director_id`: List assignments for a specific director.
    - Response: `[{ id: number, department_id: number, department_name: string, created_at: string }, ...]`.
  - `DELETE /api/departments/directors/:id`: Remove an assignment.
    - Response: `{ success: boolean }`.
- **Validation**:
  - Ensure `director_id` corresponds to a user with the Director role.
  - Ensure `department_id` is valid and not already assigned to the same director (enforced by `UNIQUE KEY unique_director_department`).
  - Restrict access to Admin role.

## 💻 Frontend Implementation
- **React Components**:
  - `DirectorAssignmentForm`: Form with dropdowns for director and department selection.
  - `PendingAssignmentsTable`: Temporary table for unsaved assignments.
  - `ActiveAssignmentsTable`: Paginated table for existing assignments with search and actions.
  - `ConfirmationModal`: Reusable modal for removal confirmation.
- **State Management**: Use React Hook Form for form state and React Query for data fetching and mutations.
- **Styling**: Tailwind CSS for form, table, and modal styling.

## ✅ Testing Notes
- Verify only users with the Director role appear in the `director_id` dropdown.
- Test that assignments are saved to `director_departments` and logged in `audit_logs`.
- Ensure the `UNIQUE KEY` constraint prevents duplicate assignments for the same director-department pair.
- Confirm removal updates `director_departments` and creates an audit log entry.
- Validate Admin-only access to the screen.
- Test integration with `director_dashboard.md` to display managers from assigned departments.

## 🔗 Integration with Other Modules
- **Admin Dashboard** (`admin_dashboard.md`): Add a quick action link to “Assign Directors” navigating to this screen.
- **Director Dashboard** (`director_dashboard.md`): Update to query `director_departments` to list departments and their managers.
- **Manager Performance Reports** (`manager_performance_reports.md`): Filter reports by departments assigned to the director via `director_departments`.
- **Navigation** (`navigation_overview.md`): Add the Director Assignment screen to the Admin navigation menu.