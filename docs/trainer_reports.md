# Trainer Reports

## 📜 Purpose
The Trainer Reports screen provides Trainers with detailed analytics on training completion, quiz performance, and trainee feedback, enabling them to track LMS effectiveness and identify improvement areas in the QTIP platform.

## 🖥️ UI Components
### Report Filters
- **Filter Panel**:
  - **Date Range**: Select start/end dates or presets (e.g., Last 30 Days).
  - **Course Filter**: Dropdown of published courses from `courses`.
  - **CSR Filter**: Multi-select dropdown of CSRs from `users`.
  - **Department Filter**: Dropdown of departments from `departments`.
- **Apply Button**: Generates report based on filters.

### Report Types
- **Completion Rates**:
  - Bar chart showing percentage of completed courses (from `enrollments`).
  - Group by: Course, CSR, or Department.
- **Quiz Performance**:
  - Table of quiz scores (from `quizzes` and `enrollments`).
  - Columns: CSR Name, Course Name, Quiz Title, Score, Pass/Fail.
- **Trainee Feedback**:
  - List of feedback comments and ratings (from `enrollments` or related table).
  - Group by: Course or CSR.
- **Progress Trends**:
  - Line chart showing course progress over time (from `enrollments`).
  - Group by: Course or Department.

### Export Options
- **Download Button**: Exports report as CSV or PDF.

## 🔄 Workflow
1. **Configure Filters**  
   - Trainer navigates to Reports from the dashboard.
   - Selects filters (e.g., specific course, department).

2. **Generate Report**  
   - Clicks “Apply” to fetch and render report data.
   - Views charts, tables, or lists based on report type.

3. **Export Report**  
   - Clicks “Download” to export report as CSV or PDF.

## 🗄️ Backend Integration
- **Tables**:
  - `enrollments`: Fetch completion and progress data.
  - `courses`, `quizzes`: Fetch course and quiz details.
  - `users`: Fetch CSR names.
  - `departments`: Fetch department options.
  - `training_logs`: Store pre-aggregated training data (if applicable).
- **Endpoints**:
  - `GET /api/trainer/filters`: Fetch available filter options.
  - `POST /api/trainer/reports`: Generate report based on filters.
  - `GET /api/trainer/export/:report_id`: Export report as CSV/PDF.
- **Validation**:
  - Ensure filter options are valid (e.g., only published courses).
  - Restrict data to Trainer’s scope (all CSRs/departments).
  - Validate date ranges.

## 💻 Frontend Implementation
- **React Components**:
  - `FilterPanel`: Form with dropdowns and date pickers.
  - `ReportViewer`: Dynamic component for charts, tables, or lists.
  - `ExportButton`: Triggers CSV/PDF download.
- **State Management**: Use React Query for fetching report data.
- **Styling**: Tailwind CSS for filter panel and report styling.
- **Chart Library**: Use Chart.js or Recharts for visualizations.

## ✅ Testing Notes
- Verify report data matches `enrollments` and `quizzes`.
- Test filter combinations for courses, CSRs, and departments.
- Ensure charts and tables render correctly for all report types.
- Confirm export generates valid CSV/PDF files.
- Validate Trainer-only access to the screen.