# Manager Performance Reports

## 📜 Purpose
The Manager Performance Reports screen enables Directors to generate and compare performance reports across departments or managers, analyzing QA scores, training completion, and dispute trends. This screen supports strategic oversight in the QTIP platform.

## 🖥️ UI Components
### Report Filters
- **Filter Panel**:
  - **Date Range**: Select start/end dates or presets (e.g., Last 30 Days).
  - **Department Filter**: Multi-select dropdown of departments from `departments`.
  - **Manager Filter**: Multi-select dropdown of managers from `users`.
  - **Metric Filter**: Checkbox group (QA Scores, Training Completion, Dispute Trends).
- **Apply Button**: Generates report based on filters.

### Report Types
- **QA Score Comparison**:
  - Bar chart showing average QA scores by department or manager (from `submissions`).
  - Group by: Department or Manager.
- **Training Completion**:
  - Pie chart showing completion rates by department or manager (from `enrollments`).
  - Group by: Department or Manager.
- **Dispute Trends**:
  - Line chart showing dispute counts over time (from `disputes`).
  - Group by: Department or Manager.
- **Summary Table**:
  - Columns: Department/Manager, QA Score, Completion Rate, Dispute Count.
  - Sortable by any column.

### Export Options
- **Download Button**: Exports report as CSV or PDF.

## 🔄 Workflow
1. **Configure Filters**  
   - Director navigates to Performance Reports from the dashboard.
   - Selects filters (e.g., specific departments, metrics).

2. **Generate Report**  
   - Clicks “Apply” to fetch and render report data.
   - Views charts and summary table for selected metrics.

3. **Export Report**  
   - Clicks “Download” to export report as CSV or PDF.

## 🗄️ Backend Integration
- **Tables**:
  - `submissions`: Fetch QA scores.
  - `enrollments`: Fetch training completion data.
  - `disputes`: Fetch dispute counts.
  - `departments`: Fetch department data.
  - `users`: Fetch manager data.
- **Endpoints**:
  - `GET /api/director/filters`: Fetch available filter options.
  - `POST /api/director/reports`: Generate report based on filters.
  - `GET /api/director/export/:report_id`: Export report as CSV/PDF.
- **Validation**:
  - Restrict data to departments/managers under the Director’s scope.
  - Ensure valid date ranges and metric selections.
  - Limit access to Director role.

## 💻 Frontend Implementation
- **React Components**:
  - `FilterPanel`: Form with dropdowns, checkboxes, and date pickers.
  - `ReportViewer`: Dynamic component for charts and summary table.
  - `ExportButton`: Triggers CSV/PDF download.
- **State Management**: Use React Query for fetching report data.
- **Styling**: Tailwind CSS for filter panel and chart styling.
- **Chart Library**: Use Chart.js or Recharts for visualizations.

## ✅ Testing Notes
- Verify report data matches `submissions`, `enrollments`, and `disputes`.
- Test filter combinations for departments, managers, and metrics.
- Ensure charts and tables render correctly for all report types.
- Confirm export generates valid CSV/PDF files.
- Validate Director-only access to the screen.