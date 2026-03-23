# QA Completed Reviews

## 📜 Purpose
The QA Completed Reviews screen enables QA users to view and manage completed audit submissions in the QTIP platform, including finalized and disputed audits. It displays submission details, metadata fields (e.g., Auditor Name, CSR, Call Date), associated calls with transcripts and recording links, and dispute information, with filtering, searching, and export capabilities.

## 🖥️ UI Components
### Completed Reviews List
- **Table**: Displays completed submissions from `submissions` with `status` of `FINALIZED` or `DISPUTED`.
  - **Columns**:
    - Form Name (`forms.form_name`)
    - Auditor Name (`users.username` via `submitted_by`)
    - CSR Name (`users.username` via `submission_metadata` for CSR field)
    - Submission Date (`submitted_at`)
    - Total Score (`total_score`)
    - Status (`FINALIZED`, `DISPUTED`)
  - **Actions**:
    - View Details: Opens a modal with submission details.
    - Export: Downloads submission as CSV (form data, metadata, calls).
- **Search Bar**: Search by form name, auditor, CSR, or customer ID.
- **Filters**:
  - Form (`forms.id`)
  - Date Range (`submitted_at`)
  - Status (`FINALIZED`, `DISPUTED`)
- **Pagination**: 20 submissions per page.

### Submission Details Modal
- **Form Information**:
  - Form Name, Interaction Type, Version (`forms`).
- **Metadata Fields**:
  - Displays fields from `form_metadata_fields` (e.g., Auditor Name, CSR, Call Date) with values from `submission_metadata`.
- **Calls**:
  - Accordion list of calls from `submission_calls`, ordered by `sort_order`.
  - For each call:
    - Call ID, Call Date, Customer ID (`calls`).
    - Transcript (`calls.transcript`).
    - Recording Link (`calls.recording_url`, clickable).
- **Answers**:
  - Table of questions (`form_questions`) and answers (`submission_answers`).
  - Columns: Question Text, Answer, Notes.
- **Dispute Information** (if `status='DISPUTED'`):
  - Dispute Reason, Status, Resolution Notes (`disputes`).
- **Actions**:
  - Close Modal.
  - Export Submission (CSV).

## 🔄 Workflow
1. **View Completed Reviews**:
   - QA user navigates to QA Completed Reviews from the QA dashboard.
   - Browses the table, applies filters (e.g., form, date), or searches by CSR or customer ID.

2. **Review Submission Details**:
   - Clicks “View Details” on a submission.
   - Modal displays form info, metadata, calls in an accordion, answers, and dispute details (if applicable).

3. **Export Data**:
   - Clicks “Export” on a submission or the table to download a CSV with form data, metadata, call details, and answers.

## 🗄️ Backend Integration
- **Tables**:
  - `submissions`: Stores submission details (`form_id`, `submitted_by`, `submitted_at`, `total_score`, `status`).
  - `submission_calls`: Links multiple calls to a submission (`submission_id`, `call_id`, `sort_order`).
  - `submission_metadata`: Stores metadata values (e.g., Auditor Name, CSR).
  - `form_metadata_fields`: Defines metadata fields for forms.
  - `calls`: Provides call details (`call_id`, `csr_id`, `customer_id`, `call_date`, `recording_url`, `transcript`).
  - `forms`: Stores form details (`form_name`, `interaction_type`).
  - `users`: Provides auditor and CSR names (`username`, `role_id`).
  - `form_questions`, `submission_answers`: Store questions and answers.
  - `disputes`: Stores dispute details (`reason`, `status`, `resolution_notes`).
- **Endpoints**:
  - `GET /api/qa/completed`: List completed submissions with pagination and filters.
    - **Query Params**: `form_id`, `date_start`, `date_end`, `status`, `search` (form name, auditor, CSR, customer ID), `page`, `limit`.
    - **Response**: `[{ id: number, form_name: string, auditor_name: string, csr_name: string, submitted_at: string, total_score: number, status: string }, ...]`.
  - `GET /api/qa/completed/:id`: Fetch submission details.
    - **Response**: `{ id: number, form: { id: number, form_name: string, interaction_type: string }, metadata: [{ field_name: string, value: string }], calls: [{ call_id: string, call_date: string, customer_id: string, recording_url: string, transcript: string }], answers: [{ question_text: string, answer: string, notes: string }], dispute: { reason: string, status: string, resolution_notes: string } | null }`.
  - `GET /api/qa/completed/:id/export`: Export submission as CSV.
    - **Response**: CSV file with form, metadata, calls, and answers.
- **Validation**:
  - Restrict access to QA role (`role_id=2`).
  - Ensure `status` is `FINALIZED` or `DISPUTED` for completed submissions.

## 💻 Frontend Implementation
- **React Components**:
  - `CompletedReviewsTable`: Paginated table with search and filters.
  - `SubmissionDetailsModal`: Modal for submission details, with accordion for calls.
  - `ExportButton`: Triggers CSV download.
- **State Management**: Use React Query for data fetching and mutations, React Hook Form for search/filter inputs.
- **Styling**: Tailwind CSS for table, modal, and accordion styling.

## ✅ Testing Notes
- Verify only `FINALIZED` or `DISPUTED` submissions appear in the table.
- Test filtering by form, date, and status, and searching by CSR or customer ID.
- Ensure the modal displays metadata fields, multiple calls in an accordion (with transcripts and recording links), answers, and dispute details.
- Confirm CSV export includes all submission data (form, metadata, calls, answers).
- Validate QA-only access (`role_id=2`).
- Test integration with `submission_calls` for multiple call display.

## 🔗 Integration with Other Modules
- **QA Dashboard** (`qa_dashboard.md`): Link to QA Completed Reviews in the navigation menu.
- **Navigation** (`navigation_overview.md`): Ensure QA Completed Reviews is accessible at `/qa/completed`.
- **Form Builder** (`form_builder_instructions.md`): Ensure forms and metadata fields are correctly linked.
- **Dispute Resolution** (`manager_dispute_resolution.md`, `director_dispute_resolution.md`): Link to disputes for `DISPUTED` submissions.