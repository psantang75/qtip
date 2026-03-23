# CSR My Audits

## 📜 Purpose
The CSR My Audits screen enables Customer Service Representatives (CSRs) to view their completed audits, including scores, form answers, and call details, and to check if an audit is disputable. This screen supports transparency and accountability in the QTIP platform.

## 🖥️ UI Components
### Audit List
- **Table**: Displays completed audits from `submissions` where `csr_id` matches the logged-in user.
  - Columns: Audit ID, Form Name, Score, Submitted Date, Status (Disputable/Disputed/Resolved).
  - Filters: By form, date range, or status.
  - Actions: View Details, Submit Dispute (if disputable).
- **Search Bar**: Search by audit ID or form name.
- **Pagination**: 10 audits per page.

### Audit Details Modal
- **Details**:
  - **Audit Info**: Audit ID, Form Name, QA Analyst Name, Score, Submitted Date.
  - **Form Answers**: List of questions and answers from `submission_answers`, with N/A indicators.
  - **Call Info**: Call ID, Call Date, Transcript, Audio Player (from `calls`).
- **Dispute Button**: Opens dispute submission form (disabled if not disputable).
- **Close Button**: Closes the modal.

### Dispute Submission Form (in Modal)
- **Fields**:
  - `dispute_text`: Textarea for dispute reasoning.
  - `attachment`: File upload for supporting evidence (optional, e.g., screenshots).
- **Submit Button**: Creates a new dispute in `disputes`.
- **Cancel Button**: Closes the form.

## 🔄 Workflow
1. **View Audits**  
   - CSR navigates to My Audits from the dashboard.
   - Browses audit list, applies filters, or searches.

2. **Review Audit**  
   - Clicks “View Details” to open modal with audit answers and call data.
   - Checks if audit is disputable (no existing dispute in `disputes`).

3. **Submit Dispute**  
   - Clicks “Submit Dispute”, enters `dispute_text`, attaches evidence (optional).
   - Submits dispute, creating a `disputes` entry with `status=PENDING`.

## 🗄️ Backend Integration
- **Tables**:
  - `submissions`, `submission_answers`: Fetch audit details.
  - `forms`: Fetch form names.
  - `users`: Fetch QA Analyst names.
  - `calls`: Fetch call details.
  - `disputes`: Check dispute status and store new disputes.
- **Endpoints**:
  - `GET /api/csr/audits`: Fetch CSR’s completed audits.
  - `GET /api/csr/submissions/:submission_id`: Fetch audit details.
  - `POST /api/disputes`: Submit new dispute.
- **Validation**:
  - Restrict audits to the logged-in CSR’s `csr_id`.
  - Prevent duplicate disputes for the same `submission_id`.
  - Limit `dispute_text` to 1000 characters.
  - Restrict file uploads to 5MB and supported formats (PDF, PNG, JPG).

## 💻 Frontend Implementation
- **React Components**:
  - `AuditTable`: Paginated table with filters and action buttons.
  - `AuditDetailsModal`: Modal for audit and call details.
  - `DisputeForm`: Form for submitting disputes with file upload.
- **State Management**: Use React Query for audit data and React Hook Form for dispute submission.
- **Styling**: Tailwind CSS for table, modal, and form styling.

## ✅ Testing Notes
- Verify only the CSR’s audits are shown.
- Test dispute button visibility for disputable audits only.
- Ensure dispute submission with and without attachments works.
- Confirm modal displays correct answers and call data.
- Validate CSR-only access to the screen.