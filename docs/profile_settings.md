# Profile Settings

## 📜 Purpose
The Profile Settings screen provides a shared interface for all user roles (Admin, QA Analyst, CSR, Trainer, Manager, Director) in the QTIP platform to update their account details, such as email, password, and notification preferences, ensuring personalized and secure account management.

## 🖥️ UI Components
### Profile Form
- **Fields**:
  - `username`: Text input (read-only, displays current username).
  - `email`: Text input (editable, must be unique).
  - `password`: Password input (for updating password, min 8 characters).
  - `confirm_password`: Password input (must match `password`).
  - `notification_preferences`: Checkbox group (e.g., Email Notifications for Audits, Training, Disputes).
- **Save Button**: Updates profile changes.
- **Cancel Button**: Discards changes.

### Account Information
- **Display Section**:
  - Role: Displays user’s role from `roles` (read-only).
  - Department: Displays user’s department from `departments` (read-only).
  - Created Date: Displays account creation date from `users` (read-only).

### Security Notice
- **Static Text**: Informs users to use strong passwords and contact support for account issues.

## 🔄 Workflow
1. **Access Profile Settings**  
   - User navigates to Profile Settings from the top bar or sidebar (available to all roles).
   - Views current account details and notification preferences.

2. **Update Profile**  
   - Edits `email`, `password`, or `notification_preferences` as needed.
   - Clicks “Save” to update changes, or “Cancel” to discard.

3. **Verify Changes**  
   - Receives confirmation message on successful update.
   - Logs action in `audit_logs` (e.g., “Updated email”).

## 🗄️ Backend Integration
- **Tables**:
  - `users`: Fetch and update user data (`email`, `password_hash`, `notification_preferences`).
  - `roles`: Fetch role name.
  - `departments`: Fetch department name.
  - `audit_logs`: Log profile updates.
- **Endpoints**:
  - `GET /api/profile`: Fetch current user’s profile data.
  - `PUT /api/profile`: Update email, password, or notification preferences.
- **Validation**:
  - Ensure `email` is unique and valid.
  - Validate `password` strength (min 8 characters, mix of letters/numbers).
  - Confirm `confirm_password` matches `password`.
  - Restrict updates to the logged-in user’s `user_id`.

## 💻 Frontend Implementation
- **React Components**:
  - `ProfileForm`: Form for editing email, password, and preferences.
  - `AccountInfo`: Display section for role, department, and created date.
  - `SecurityNotice`: Static text for security guidance.
- **State Management**: Use React Hook Form for form validation and React Query for profile data.
- **Styling**: Tailwind CSS for form and display styling.

## ✅ Testing Notes
- Verify only the logged-in user’s data is shown and editable.
- Test email and password updates, ensuring validation (unique email, strong password).
- Confirm notification preferences are saved correctly.
- Ensure audit log entry is created for updates.
- Validate access for all roles (Admin, QA, CSR, Trainer, Manager, Director).