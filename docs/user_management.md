# User Management

## 📜 Purpose
The User Management screen enables Admins to create, edit, and deactivate users in the QTIP platform, assigning them roles and departments. This screen is critical for maintaining user access and organizational structure.

## 🖥️ UI Components
### User List
- **Table**: Displays all users from `users`.
  - Columns: Username, Email, Role, Department, Status (Active/Inactive), Created Date.
  - Filters: By role, department, or status.
  - Actions: Edit, Deactivate/Activate, Delete (soft delete).
- **Search Bar**: Search by username or email.
- **Pagination**: 20 users per page.

### Add/Edit User Form
- **Fields**:
  - `username`: Text input (unique).
  - `email`: Text input (unique, email format).
  - `password`: Password input (min 8 characters, for new users).
  - `role_id`: Dropdown of roles from `roles`.
  - `department_id`: Dropdown of departments from `departments`.
  - `manager_id`: Dropdown of users with Manager role (optional, for hierarchical structure).
- **Save Button**: Creates or updates user.
- **Cancel Button**: Discards changes.

### Confirmation Modal
- **Deactivate/Activate**: Confirms status change.
- **Delete**: Confirms soft deletion (marks user as inactive).

## 🔄 Workflow
1. **View Users**  
   - Admin navigates to User Management from the dashboard.
   - Browses user list, applies filters, or searches.

2. **Add User**  
   - Clicks “Add User”, fills out form, and saves.
   - New user is created in `users` with `password_hash`.

3. **Edit User**  
   - Selects a user, edits fields (e.g., change role), and saves.
   - Updates `users` table, logs action in `audit_logs`.

4. **Deactivate/Activate**  
   - Clicks “Deactivate” or “Activate”, confirms in modal.
   - Sets `is_active` in `users` (default column, not shown in schema).

5. **Delete User**  
   - Clicks “Delete”, confirms in modal.
   - Soft deletes by setting `is_active=false`.

## 🗄️ Backend Integration
- **Tables**:
  - `users`: Store user data.
  - `roles`: Fetch role options.
  - `departments`: Fetch department options.
  - `audit_logs`: Log user management actions.
- **Endpoints**:
  - `GET /api/users`: Fetch all users with pagination and filters.
  - `POST /api/users`: Create new user.
  - `PUT /api/users/:user_id`: Update user details.
  - `DELETE /api/users/:user_id`: Soft delete user.
- **Validation**:
  - Ensure `username` and `email` are unique.
  - Validate `password` strength for new users.
  - Restrict access to Admin role.

## 💻 Frontend Implementation
- **React Components**:
  - `UserTable`: Paginated table with filters and action buttons.
  - `UserForm`: Form for adding/editing users with dropdowns.
  - `ConfirmationModal`: Reusable modal for deactivate/activate/delete.
- **State Management**: Use React Query for user data fetching and mutations.
- **Styling**: Tailwind CSS for table and form styling.

## ✅ Testing Notes
- Verify user creation with all role and department combinations.
- Test edit functionality for updating `role_id` and `department_id`.
- Ensure deactivate/activate toggles `is_active` correctly.
- Confirm soft delete does not remove user from `users`.
- Validate Admin-only access to the screen.