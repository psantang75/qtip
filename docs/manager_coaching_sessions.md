# Manager Coaching Sessions

## 📜 Purpose
The Manager Coaching Sessions screen enables Managers to log, track, and review one-on-one coaching sessions with their team’s CSRs, documenting performance discussions and improvement plans. This screen supports personalized development in the QTIP platform.

## 🖥️ UI Components
### Session List
- **Table**: Displays coaching sessions from `coaching_sessions` for CSRs in the Manager’s `department_id`.
  - Columns: Session ID, CSR Name, Session Date, Topic, Status (Scheduled/Completed).
  - Filters: By CSR, date range, or status.
  - Actions: View Details, Edit (for Scheduled), Mark Completed (for Scheduled).
- **Search Bar**: Search by CSR name or topic.
- **Pagination**: 10 sessions per page.

### Add/Edit Session Form
- **Fields**:
  - `csr_id`: Dropdown of team CSRs from `users`.
  - `session_date`: Date picker.
  - `topic`: Text input (e.g., “QA Score Improvement”).
  - `notes`: Textarea for session details or outcomes.
  - `status`: Dropdown (Scheduled/Completed).
- **Save Button**: Creates or updates session.
- **Cancel Button**: Discards changes.

### Session Details Modal
- **Details**:
  - **Session Info**: Session ID, CSR Name, Session Date, Topic, Status.
  - **Notes**: Full text of session notes.
- **Edit Button**: Opens edit form (if Scheduled).
- **Mark Completed Button**: Updates status to Completed.
- **Close Button**: Closes the modal.

## 🔄 Workflow
1. **View Sessions**  
   - Manager navigates to Coaching Sessions from the dashboard.
   - Browses session list, applies filters, or searches.

2. **Add Session**  
   - Clicks “Add Session”, fills out form, and saves.
   - New session is created in `coaching_sessions`, logged in `audit_logs`.

3. **Edit or Complete Session**  
   - Selects a session, clicks “View Details”, then “Edit” or “Mark Completed”.
   - Updates `coaching_sessions`, logs action.

4. **Review Details**  
   - Views session details in modal, closes to return to list.

## 🗄️ Backend Integration
- **Tables**:
  - `coaching_sessions`: Store session data.
  - `users`: Fetch team CSRs.
  - `departments`: Restrict to Manager’s department.
  - `audit_logs`: Log session actions.
- **Endpoints**:
  - `GET /api/manager/coaching-sessions`: Fetch sessions with pagination and filters.
  - `POST /api/manager/coaching-sessions`: Create new session.
  - `PUT /api/manager/coaching-sessions/:session_id`: Update session.
  - `PATCH /api/manager/coaching-sessions/:session_id/complete`: Mark session as Completed.
- **Validation**:
  - Restrict `csr_id` to CSRs in the Manager’s `department_id`.
  - Ensure `session_date` is not in the past for Scheduled status.
  - Limit `notes` to 2000 characters.

## 💻 Frontend Implementation
- **React Components**:
  - `SessionTable`: Paginated table with filters and action buttons.
  - `SessionForm`: Form for adding/editing sessions.
  - `SessionDetailsModal`: Modal for session details and actions.
- **State Management**: Use React Query for fetching session data and React Hook Form for session form.
- **Styling**: Tailwind CSS for table, form, and modal styling.

## ✅ Testing Notes
- Verify only team CSRs’ sessions are shown.
- Test session creation and editing for Scheduled status.
- Ensure “Mark Completed” updates status correctly.
- Confirm audit log entries for session actions.
- Validate Manager-only access to the screen.