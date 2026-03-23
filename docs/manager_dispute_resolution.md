# Manager Dispute Resolution

## 📜 Purpose
The Manager Dispute Resolution screen allows Managers to review and resolve disputes submitted by their team's CSRs, deciding to uphold, adjust, or assign training. This screen supports fair and transparent dispute handling in the QTIP platform.

## 🖥️ UI Components
### Dispute List
- **Table**: Displays disputes from `disputes` where `csr_id` belongs to the Manager's `department_id` and `status=PENDING`.
  - Columns: Dispute ID, CSR Name, Audit ID, Form Name, Dispute Date, Status.
  - Filters: By CSR, Form, Date Range, and Status (matching team audits structure).
  - Actions: Resolve Dispute.
- **Search Bar**: Search by CSR name or dispute ID.
- **Filter Section**: 
  - **CSR Filter**: Dropdown of team CSRs
  - **Form Filter**: Dropdown of available forms
  - **Status Filter**: All, Open, Resolved
  - **Date Range**: Start Date and End Date inputs
  - **Search**: Text input for CSR name or dispute ID
  - **Clear Filters**: Button to reset all filters
- **Pagination**: 10 disputes per page.

### Dispute Resolution Modal
- **Details**:
  - **Dispute Info**: Dispute ID, CSR Name, Audit ID, Dispute Text, Attachment (if any).
  - **Audit Info**: Form Name, Score, Answers from `submission_answers`, Call Transcript/Audio from `calls`.
- **Resolution Form**:
  - `resolution_action`: Dropdown (Uphold Score, Adjust Score, Assign Training).
  - `new_score`: Number input (if Adjust Score selected).
  - `training_id`: Dropdown of courses from `courses` (if Assign Training selected).
  - `resolution_notes`: Textarea for resolution explanation.
- **Submit Button**: Saves resolution.
- **Cancel Button**: Closes the modal without saving.

## 🔄 Workflow
1. **View Disputes**  
   - Manager navigates to Dispute Resolution from the dashboard.
   - Browses dispute list, applies filters (CSR, Form, Status, Date Range), or searches.

2. **Review Dispute**  
   - Clicks "Resolve Dispute" to open modal with dispute and audit details.
   - Reviews CSR's dispute text, audit answers, and call data.

3. **Resolve Dispute**  
   - Selects resolution action, enters new score or training (if applicable), and adds notes.
   - Submits resolution, updating `disputes` and `submissions` (if score adjusted), creating `enrollments` (if training assigned), and logging in `audit_logs`.

4. **Return to List**  
   - Closes modal to return to the dispute list.

## 🗄️ Backend Integration
- **Tables**:
  - `disputes`: Fetch and update dispute data.
  - `submissions`, `submission_answers`: Fetch audit details.
  - `calls`: Fetch call transcript and audio.
  - `courses`: Fetch training options.
  - `enrollments`: Create training assignments.
  - `audit_logs`: Log resolution actions.
  - `users`, `departments`: Restrict to Manager's team.
- **Endpoints**:
  - `GET /api/manager/disputes`: Fetch pending disputes with pagination and filters.
  - `GET /api/manager/disputes/:dispute_id`: Fetch dispute and audit details.
  - `POST /api/manager/disputes/:dispute_id/resolve`: Submit resolution.
- **Validation**:
  - Restrict disputes to CSRs in the Manager's `department_id`.
  - Validate `new_score` (if provided) is within form's scoring range.
  - Ensure `training_id` is a published course.
  - Limit `resolution_notes` to 1000 characters.

## 💻 Frontend Implementation
- **React Components**:
  - `DisputeTable`: Paginated table with filters and action buttons.
  - `DisputeResolutionModal`: Modal with dispute details and resolution form.
- **State Management**: Use React Query for fetching dispute data and React Hook Form for resolution form.
- **Styling**: Tailwind CSS for table, modal, and form styling.
- **Filter Structure**: Match the ManagerTeamAudits component filter layout and functionality.

## ✅ Testing Notes
- Verify only pending disputes for team CSRs are shown.
- Test resolution actions (Uphold, Adjust, Assign Training) update correct tables.
- Ensure modal displays dispute text, audit answers, and call data.
- Confirm audit log entry is created for each resolution.
- Validate Manager-only access to the screen.
- Test all filter combinations (CSR, Form, Status, Date Range) work correctly.
- Verify search functionality works for CSR names and dispute IDs.