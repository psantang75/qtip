# CSR Dispute History

## 📜 Purpose
The CSR Dispute History screen allows Customer Service Representatives (CSRs) to view their completed audits, submit disputes for specific audits, and track the status of their disputes. This screen supports the dispute resolution workflow in QTIP.

## 🖥️ UI Components
### Audit List
- **Table**: Lists completed audits from `submissions`.
  - Columns: Audit ID, Form Name, Score, Submitted Date, Status (Disputable, Disputed, Resolved).
  - Filters: By date range, form, or status.
  - Actions: View Details, Submit Dispute (if disputable).

### Audit Details Modal
- **Details**: Shows `form_name`, `score`, `submitted_at`, and answers from `submission_answers`.
- **Transcript/Audio**: Displays `calls.transcript` and `audio_url` (read-only).
- **Dispute Button**: Opens dispute submission form (disabled if already disputed).

### Dispute Submission Form
- **Fields**:
  - `dispute_text`: Textarea for CSR’s dispute reasoning.
  - `attachment` (optional): File upload for supporting evidence (e.g., screenshots).
- **Submit Button**: Creates a new dispute in `disputes`.

### Dispute History Table
- **Table**: Lists all disputes from `disputes`.
  - Columns: Dispute ID, Audit ID, Status (Pending, Resolved, Escalated), Created Date, Resolution Notes.
  - Actions: View Resolution Details.

## 🔄 Workflow
1. **View Audits**  
   - CSR navigates to Dispute History from the dashboard.
   - Browses audit list and filters as needed.

2. **Review Audit**  
   - Clicks “View Details” to open modal with audit answers and call data.
   - Checks if audit is disputable (no existing dispute in `disputes`).

3. **Submit Dispute**  
   - Opens dispute form, enters `dispute_text`, and attaches evidence (optional).
   - Submits dispute, creating a `disputes` entry with `status=PENDING`.

4. **Track Disputes**  
   - Views dispute history table to check status and resolution notes.
   - For resolved disputes, sees outcome (uphold, adjust, assign training).

## 🗄️ Backend Integration
- **Tables**:
  - `submissions`, `submission_answers`: Fetch audit details.
  - `calls`: Fetch transcript and audio.
  - `disputes`: Store and track disputes.
- **Endpoints**:
  - `GET /api/audits/csr`: Fetch CSR’s completed audits.
  - `GET /api/audits/:submission_id`: Fetch audit details.
  - `POST /api/disputes`: Submit new dispute.
  - `GET /api/disputes/csr`: Fetch CSR’s dispute history.
- **Validation**:
  - Prevent duplicate disputes for the same `submission_id`.
  - Limit `dispute_text` to 1000 characters.
  - Restrict file uploads to 5MB and supported formats (PDF, PNG, JPG).

## 💻 Frontend Implementation
- **React Components**:
  - `AuditTable`: Paginated table with filters and action buttons.
  - `AuditModal`: Displays audit details and dispute button.
  - `DisputeForm`: Form for submitting disputes with file upload.
  - `DisputeTable`: Lists dispute history with status indicators.
- **State Management**: Use React Query for audit and dispute data fetching.
- **Styling**: Tailwind CSS for tables, modals, and form styling.

## ✅ Testing Notes
- Verify only disputable audits show the dispute button.
- Test dispute submission with and without attachments.
- Ensure dispute history updates in real-time after submission.
- Confirm file upload restrictions are enforced.
- Validate CSR-only access to the screen.