# QA Manual Reviews

## 📜 Purpose
The QA Manual Reviews screen allows QA Analysts to initiate ad-hoc audits by selecting a QA form and a CSR or call, enabling flexible auditing outside of assigned schedules. This screen supports the manual audit process in QTIP.

## 🖥️ UI Components
### Audit Initiation Form
- **Fields**:
  - `form_id`: Dropdown of active forms from `forms`.
  - `csr_id`: Dropdown of CSRs from `users`.
  - `call_id`: Dropdown of calls for the selected CSR from `calls` (optional, for specific call).
- **Start Audit Button**: Opens split-screen view for scoring.
- **Clear Button**: Resets form fields.

### Recent Manual Audits
- **Table**: Lists recently initiated manual audits from `submissions`.
  - Columns: Audit ID, CSR Name, Form Name, Score, Submitted Date.
  - Actions: View Details (links to `qa_completed_reviews.md`).
  - Pagination: 10 audits per page.

### Split-Screen View
- **Left Panel**: Call Details
  - **Call Info**: Call ID, CSR name, call date, duration (from `calls`).
  - **Transcript**: Scrollable text (from `calls.transcript`).
  - **Audio Player**: Embedded player (from `calls.audio_url`).
- **Right Panel**: QA Form
  - **Form Name**: Displays `forms.form_name` and `version`.
  - **Categories**: Accordion of `form_categories` with questions.
  - **Questions**: Dynamic inputs based on `form_questions.question_type`:
    - Yes/No: Radio buttons (Yes, No, N/A if `is_na_allowed`).
    - Scale: Slider or number input (`scale_min` to `scale_max`).
    - Text: Textarea for notes.
    - Info: Read-only text block.
  - **Score Preview**: Real-time score calculation (excluding N/A answers).
  - **Submit Button**: Saves answers and score.

## 🔄 Workflow
1. **Initiate Audit**  
   - QA Analyst navigates to Manual Reviews from the dashboard.
   - Selects a form, CSR, and optionally a call, then clicks “Start Audit”.

2. **Score Audit**  
   - Uses split-screen view to review transcript/audio and answer questions.
   - Sees real-time score updates, applies N/A where allowed.

3. **Submit Audit**  
   - Clicks “Submit” to save answers to `submission_answers` and score to `submissions`.
   - Links submission to `calls` via `submission_id`.

4. **Review Recent Audits**  
   - Views recent manual audits in the table, clicks “View Details” for full audit.

## 🗄️ Backend Integration
- **Tables**:
  - `forms`: Fetch active forms.
  - `users`: Fetch CSRs.
  - `calls`: Fetch call details.
  - `submissions`, `submission_answers`: Store audit results.
- **Endpoints**:
  - `GET /api/qa/forms`: Fetch active forms.
  - `GET /api/qa/csrs`: Fetch CSRs.
  - `GET /api/qa/calls/:csr_id`: Fetch calls for a CSR.
  - `POST /api/submissions`: Submit manual audit.
  - `GET /api/qa/manual-audits`: Fetch recent manual audits.
- **Validation**:
  - Ensure all required questions are answered (except N/A or Info).
  - Validate scale answers within `scale_min` and `scale_max`.
  - Restrict access to QA Analyst role.

## 💻 Frontend Implementation
- **React Components**:
  - `AuditForm`: Form for selecting form, CSR, and call.
  - `SplitScreen`: Flex layout for call details and QA form.
  - `RecentAuditTable`: Paginated table for manual audits.
- **State Management**: Use React Hook Form for form state and React Query for data fetching.
- **Styling**: Tailwind CSS for split-screen and table styling.

## ✅ Testing Notes
- Verify form and CSR dropdowns populate correctly.
- Test split-screen layout with transcript and audio.
- Ensure N/A answers are excluded from score calculation.
- Confirm submission saves to `submissions` and `submission_answers`.
- Validate QA Analyst-only access to the screen.