# Department Management

## 📜 Purpose
The Department Management screen allows Admins to create, edit, and manage departments within the QTIP platform, assigning managers and linking users or audits to departments. This screen is essential for organizing the call center’s structure and facilitating team-based workflows.

## 🖥️ UI Components
### Department List
- **Table**: Displays all departments from `departments`.
  - Columns: Department Name, Manager, User Count, Created Date, Status (Active/Inactive).
  - Filters: By manager or status.
  - Actions: Edit, Deactivate/Activate, Delete (soft delete).
- **Search Bar**: Search by department name.
- **Pagination**: 20 departments per page.

### Add/Edit Department Form
- **Fields**:
  - `department_name`: Text input (unique).
  - `manager_id`: Dropdown of users with Manager role from `users` (optional).
  - `description`: Textarea (optional, for department details).
- **Save Button**: Creates or updates department.
- **Cancel Button**: Discards changes.

### User Assignment Modal
- **Interface**: Multi-select dropdown to assign users to the department.
- **Fields**: List of users from `users`, with checkboxes for selection.
- **Save Button**: Updates `department_id` in `users` for selected users.

### Confirmation Modal
- **Deactivate/Activate**: Confirms status change.
- **Delete**: Confirms soft deletion (marks department as inactive).

## 🔄 Workflow
1. **View Departments**  
   - Admin navigates to Department Management from the dashboard.
   - Browses department list, applies filters, or searches.

2. **Add Department**  
   - Clicks “Add Department”, fills out form, assigns a manager (optional), and saves.
   - New department is created in `departments`.

3. **Edit Department**  
   - Selects a department, edits fields (e.g., change manager), and saves.
   - Updates `departments` table, logs action in `audit_logs`.

4. **Assign Users**  
   - Opens User Assignment modal, selects users, and saves.
   - Updates `department_id` in `users` for selected users.

5. **Deactivate/Activate**  
   - Clicks “Deactivate” or “Activate”, confirms in modal.
   - Sets `is_active` in `departments` (default column, not shown in schema).

6. **Delete Department**  
   - Clicks “Delete”, confirms in modal.
   - Soft deletes by setting `is_active=false`.

## 🗄️ Backend Integration
- **Tables**:
  - `departments`: Store department data.
  - `users`: Fetch manager options and assign users.
  - `audit_logs`: Log department management actions.
- **Endpoints**:
  - `GET /api/departments`: Fetch all departments with pagination and filters.
  - `POST /api/departments`: Create new department.
  - `PUT /api/departments/:department_id`: Update department details.
  - `POST /api/departments/:department_id/users`: Assign users to department.
  - `DELETE /api/departments/:department_id`: Soft delete department.
- **Validation**:
  - Ensure `department_name` is unique.
  - Validate `manager_id` is a user with Manager role.
  - Restrict access to Admin role.

## 💻 Frontend Implementation
- **React Components**:
  - `DepartmentTable`: Paginated table with filters and action buttons.
  - `DepartmentForm`: Form for adding/editing departments with dropdowns.
  - `UserAssignmentModal`: Multi-select interface for user assignment.
  - `ConfirmationModal`: Reusable modal for deactivate/activate/delete.
- **State Management**: Use React Query for department and user data fetching.
- **Styling**: Tailwind CSS for table, form, and modal styling.

## ✅ Testing Notes
- Verify department creation with and without a manager.
- Test user assignment updates `department_id` correctly.
- Ensure deactivate/activate toggles `is_active` correctly.
- Confirm soft delete does not remove department from `departments`.
- Validate Admin-only access to the screen.