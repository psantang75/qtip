# QA Assigned Reviews

## 📜 Purpose
The QA Assigned Reviews screen allows QA Analysts to score assigned audits using a split-screen interface, displaying call transcript/audio on the left and the QA form on the right. This screen is critical for the manual audit process in QTIP.

## 🖥️ UI Components
### Split-Screen Layout
- **Left Panel**: Call Details
  - **Call Info**: Call ID, CSR name, call date, duration.
  - **Transcript**: Scrollable text of the call transcript (from `calls.transcript`).
  - **Audio Player**: Embedded player for call recording (from `calls.audio_url`).
- **Right Panel**: QA Form
  - **Form Name**: Displays `forms.form_name` and `version`.
  - **Categories**: Accordion of `form_categories` with weighted questions.
  - **Questions**: Dynamic inputs based on `form_questions.question_type`:
    - Yes/No: Radio buttons (Yes, No, N/A if `is_na_allowed`).
    - Scale: Slider or number input (`scale_min` to `scale_max`).
    - Text: Textarea for notes.
    - Info: Read-only text block.
  - **Score Preview**: Real-time score calculation (excluding N/A answers).
  - **Submit Button**: Saves answers and final score.

### Toolbar
- **Back to Dashboard**: Link to `qa_dashboard.md`.
- **Next Audit**: Load the next assigned audit.
- **Flag for Review**: Mark audit for Manager/Director review.

## 🔄 Workflow
1. **Select Audit**  
   - QA Analyst navigates to Assigned Audits from the dashboard.
   - Selects an audit from `audit_assignments` (linked to `submissions`).

2. **Score Call**  
   - View transcript/audio in the left panel.
   - Answer questions in the right panel, with real-time score updates.
   - Apply N/A where allowed to exclude from scoring.

3. **Submit Audit**  
   - Click “Submit” to save answers to `submission_answers` and score to `submissions`.
   - Link submission to `calls` via `submission_id`.

4. **Flag or Proceed**  
   - Flag for review if needed (creates `disputes` entry with `status=ESCALATED`).
   - Move to the next audit or return to dashboard.

## 🗄️ Backend Integration
- **Tables**:
  - `audit_assignments`: List assigned audits.
  - `calls`: Fetch transcript and audio.
  - `forms`, `form_categories`, `form_questions`: Render QA form.
  - `submissions`, `submission_answers`: Store results.
- **Endpoints**:
  - `GET /api/audits/assigned`: Fetch assigned audits for QA Analyst.
  - `GET /api/calls/:call_id`: Fetch call details.
  - `POST /api/submissions`: Submit audit answers and score.
  - `POST /api/disputes`: Flag audit for review.
- **Validation**:
  - Ensure all required questions are answered (except N/A or Info).
  - Validate scale answers within `scale_min` and `scale_max`.

## 💻 Frontend Implementation
- **React Components**:
  - `SplitScreen`: Flex layout for left/right panels.
  - `CallPanel`: Displays call info, transcript, and audio player.
  - `FormPanel`: Renders dynamic form with question types.
  - `ScorePreview`: Calculates and displays score in real-time.
- **State Management**: Use React Hook Form for form state and validation.
- **Styling**: Tailwind CSS for split-screen responsiveness and accordion styling.

## ✅ Testing Notes
- Test split-screen layout on various screen sizes.
- Verify audio player functionality and transcript display.
- Ensure N/A answers are excluded from score calculation.
- Test submission saves correctly to database.
- Confirm flagging creates an escalated dispute.