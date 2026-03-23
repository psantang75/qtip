# Audit Logging

## 📜 Purpose
The Audit Logging screen provides a shared interface for Admins, QA Analysts, Trainers, Managers, and Directors to view system events, such as audit submissions, dispute resolutions, and training assignments. It ensures transparency and traceability of actions in the QTIP platform.

## 🖥️ UI Components
### Log List
- **Table**: Displays system events from `audit_logs` based on user role and scope.
  - Columns: Log ID, User Name, Action (e.g., “Submitted Audit”), Target (e.g., Audit ID), Details, Timestamp.
  - Filters: By user, action type, date range, or target type (e.g., Audit, Dispute).
  - Actions: View Details.
- **Search Bar**: Search by user name or action.
- **Pagination**: 50 logs per page.

### Log Details Modal
- **Details**:
  - **Log Info**: Log ID, User Name, Action, Target ID, Target Type, Timestamp.
  - **Details Field**: Full text of the log details (e.g., “Score adjusted from 80 to 85”).
- **Close Button**: Closes the modal.

## 🔄 Workflow
1. **View Logs**  
   - User navigates to Audit Logging from their dashboard (available to all roles except CSR).
   - Browses log list, applies filters, or searches.

2. **Review Log Details**  
   - Clicks “View Details” to open modal with full log information.
   - Reviews action and context (e.g., audit or dispute details).

3. **Return to List**  
   - Closes modal to return to the log list or applies new filters.

## 🗄️ Backend Integration
- **Tables**:
  - `audit_logs`: Fetch log data.
  - `users`: Fetch user names.
- **Endpoints**:
  - `GET /api/audit-logs`: Fetch logs with pagination and filters, scoped by role.
  - `GET /api/audit-logs/:log_id`: Fetch log details.
- **Validation**:
  - Scope logs by role:
    - Admins/Trainers/QA Analysts: All logs.
    - Managers: Logs for their department’s CSRs.
    - Directors: Logs for CSRs under their managers.
  - Ensure filter options are valid (e.g., action types match system events).

## 💻 Frontend Implementation
- **React Components**:
  - `LogTable`: Paginated table with filters and action buttons.
  - `LogDetailsModal`: Modal for full log details.
- **State Management**: Use React Query for fetching log data.
- **Styling**: Tailwind CSS for table and modal styling.

## ✅ Testing Notes
- Verify logs are scoped correctly by role (e.g., Managers see only team logs).
- Test filters for user, action, date range, and target type.
- Ensure modal displays correct log details.
- Confirm high-volume logs (e.g., 1000+) paginate efficiently.
- Validate access for Admins, QA Analysts, Trainers, Managers, and Directors only.