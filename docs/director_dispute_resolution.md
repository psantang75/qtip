# Director Dispute Resolution

## 📜 Purpose
The Director Dispute Resolution screen allows Directors to review and resolve escalated or unresolved disputes from CSRs under their assigned managers, ensuring fair and authoritative dispute handling in the QTIP platform.

## 🖥️ UI Components
### Dispute List
- **Table**: Displays disputes from `disputes` where `csr_id` belongs to CSRs under the Director’s managers and `status=ESCALATED` or `status=PENDING`.
  - Columns: Dispute ID, CSR Name, Department, Audit ID, Form Name, Dispute Date.
  - Filters: By CSR, department, audit ID, or status.
  - Actions: Resolve Dispute.
- **Search Bar**: Search by CSR name or dispute ID.
- **Pagination**: 10 disputes per page.

### Dispute Resolution Modal
- **Details**:
  - **Dispute Info**: Dispute ID, CSR Name, Department, Dispute Text, Attachment (if any).
  - **Audit Info**: Form Name, Score, Answers from `submission_answers`, Call Transcript/Audio from `calls`.
  - **Previous Resolution**: Manager’s resolution notes (if applicable, from `disputes`).
- **Resolution Form**:
  - `resolution_action`: Dropdown (Uphold Score, Adjust Score, Assign Training).
  - `new_score`: Number input (if Adjust Score selected).
  - `training_id`: Dropdown of courses from `courses` (if Assign Training selected).
  - `resolution_notes`: Textarea for resolution explanation.
- **Submit Button**: Saves resolution.
- **Cancel Button**: Closes the modal without saving.

## 🔄 Workflow
1. **View Disputes**  
   - Director navigates to Dispute Resolution from the dashboard.
   - Browses dispute list, applies filters, or searches.

2. **Review Dispute**  
   - Clicks “Resolve Dispute” to open modal with dispute, audit, and prior resolution details.
   - Reviews CSR’s dispute text, audit answers, and call data.

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
  - `users`, `departments`: Restrict to CSRs under Director’s managers.
- **Endpoints**:
  - `GET /api/director/disputes`: Fetch escalated/pending disputes with pagination and filters.
  - `GET /api/director/disputes/:dispute_id`: Fetch dispute and audit details.
  - `POST /api/director/disputes/:dispute_id/resolve`: Submit resolution.
- **Validation**:
  - Restrict disputes to CSRs under the Director’s managers.
  - Validate `new_score` (if provided) is within form’s scoring range.
  - Ensure `training_id` is a published course.
  - Limit `resolution_notes` to 1000 characters.

## 💻 Frontend Implementation
- **React Components**:
  - `DisputeTable`: Paginated table with filters and action buttons.
  - `DisputeResolutionModal`: Modal with dispute details and resolution form.
- **State Management**: Use React Query for fetching dispute data and React Hook Form for resolution form.
- **Styling**: Tailwind CSS for table, modal, and form styling.

## ✅ Testing Notes
- Verify only escalated/pending disputes for relevant CSRs are shown.
- Test resolution actions (Uphold, Adjust, Assign Training) update correct tables.
- Ensure modal displays dispute text, audit answers, and prior resolution.
- Confirm audit log entry is created for each resolution.
- Validate Director-only access to the screen.