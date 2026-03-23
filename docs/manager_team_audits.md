# Manager Team Audits

## 📜 Purpose
The Manager Team Audits screen allows Managers to review the audit history for their team’s Customer Service Representatives (CSRs), including scores, form answers, and call details. This screen supports team oversight and performance monitoring in the QTIP platform.

## 🖥️ UI Components
### Audit List
- **Table**: Displays audits for team CSRs from `submissions` where `csr_id` belongs to the Manager’s `department_id`.
  - Columns: Audit ID, CSR Name, Form Name, Score, Submitted Date, Dispute Status (None/Pending/Resolved).
  - Filters: By CSR, form, date range, or dispute status.
  - Actions: View Details.
- **Search Bar**: Search by CSR name or audit ID.
- **Pagination**: 20 audits per page.

### Audit Details Modal
- **Details**:
  - **Audit Info**: Audit ID, CSR Name, QA Analyst Name, Form Name, Score, Submitted Date.
  - **Form Answers**: List of questions and answers from `submission_answers`, with N/A indicators.
  - **Call Info**: Call ID, Call Date, Transcript, Audio Player (from `calls`).
  - **Dispute Info**: Dispute status, text, and resolution notes (from `disputes`, if applicable).
- **Resolve Dispute Button**: Links to `manager_dispute_resolution.md` (if dispute is Pending).
- **Close Button**: Closes the modal.

## 🔄 Workflow
1. **View Team Audits**  
   - Manager navigates to Team Audits from the dashboard.
   - Browses audit list, applies filters, or searches.

2. **Review Audit Details**  
   - Clicks “View Details” to open modal with audit answers, call data, and dispute status.
   - Checks if a dispute is pending and actionable.

3. **Resolve Dispute**  
   - Clicks “Resolve Dispute” (if applicable) to navigate to `manager_dispute_resolution.md`.
   - Returns to list or applies new filters.

## 🗄️ Backend Integration
- **Tables**:
  - `submissions`, `submission_answers`: Fetch audit details and answers.
  - `forms`: Fetch form names.
  - `users`: Fetch CSR and QA Analyst names.
  - `calls`: Fetch call details.
  - `disputes`: Fetch dispute status and notes.
  - `departments`: Restrict to Manager’s department.
- **Endpoints**:
  - `GET /api/manager/audits`: Fetch team audits with pagination and filters.
  - `GET /api/manager/submissions/:submission_id`: Fetch audit details, including answers and call data.
- **Validation**:
  - Restrict audits to CSRs in the Manager’s `department_id`.
  - Ensure dispute data is shown only if a dispute exists.

## 💻 Frontend Implementation
- **React Components**:
  - `AuditTable`: Paginated table with filters and action buttons.
  - `AuditDetailsModal`: Modal for displaying audit, call, and dispute details.
- **State Management**: Use React Query for fetching audit data.
- **Styling**: Tailwind CSS for table and modal styling.

## ✅ Testing Notes
- Verify only team CSRs’ audits are shown.
- Test filters for CSR, form, date range, and dispute status.
- Ensure modal displays correct answers, transcript, and audio.
- Confirm “Resolve Dispute” button appears only for pending disputes.
- Validate Manager-only access to the screen.