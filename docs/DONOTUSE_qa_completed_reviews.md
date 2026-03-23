# QA Completed Reviews

## 📜 Purpose
The QA Completed Reviews screen allows QA Analysts to view and review their completed audits, including scores, answers, and associated call details. This screen supports audit history tracking and analysis in the QTIP platform.

## 🖥️ UI Components
### Audit List
- **Table**: Displays completed audits from `submissions` where `qa_id` matches the logged-in user.
  - Columns: Audit ID, CSR Name, Form Name, Score, Submitted Date, Dispute Status (None/Pending/Resolved).
  - Filters: By CSR, form, date range, or dispute status.
  - Actions: View Details.
- **Search Bar**: Search by CSR name or audit ID.
- **Pagination**: 20 audits per page.

### Audit Details Modal
- **Details**:
  - **Audit Info**: Audit ID, Form Name, CSR Name, Score, Submitted Date.
  - **Form Answers**: List of questions and answers from `submission_answers`, with N/A indicators.
  - **Call Info**: Call ID, Call Date, Transcript, Audio Player (from `calls`).
  - **Dispute Info**: Dispute status, text, and resolution notes (from `disputes`, if applicable).
- **Close Button**: Closes the modal.

## 🔄 Workflow
1. **View Completed Audits**  
   - QA Analyst navigates to Completed Reviews from the dashboard.
   - Browses audit list, applies filters, or searches.

2. **Review Audit Details**  
   - Clicks “View Details” to open modal.
   - Reviews form answers, call transcript/audio, and dispute status (if any).

3. **Return to List**  
   - Closes modal to return to the audit list or applies new filters.

## 🗄️ Backend Integration
- **Tables**:
  - `submissions`, `submission_answers`: Fetch audit details and answers.
  - `forms`: Fetch form names.
  - `users`: Fetch CSR names.
  - `calls`: Fetch call details.
  - `disputes`: Fetch dispute status and notes.
- **Endpoints**:
  - `GET /api/qa/completed`: Fetch completed audits with pagination and filters.
  - `GET /api/qa/submissions/:submission_id`: Fetch audit details, including answers and call data.
- **Validation**:
  - Restrict audits to the logged-in QA Analyst’s `qa_id`.
  - Ensure dispute data is only shown if a dispute exists.

## 💻 Frontend Implementation
- **React Components**:
  - `AuditTable`: Paginated table with filters and action buttons.
  - `AuditDetailsModal`: Modal for displaying audit, call, and dispute details.
- **State Management**: Use React Query for fetching audit data.
- **Styling**: Tailwind CSS for table and modal styling.

## ✅ Testing Notes
- Verify audit list shows only the QA Analyst’s completed audits.
- Test filters for CSR, form, date range, and dispute status.
- Ensure modal displays correct answers, transcript, and audio.
- Confirm dispute details are shown only when applicable.
- Validate QA Analyst-only access to the screen.