# Analytics Builder

## 📜 Purpose
The Analytics Builder provides a configurable interface for generating role-based reports and dashboards in the QTIP platform, allowing users to filter and visualize QA scores, training progress, and system activity. It supports scoped access based on user roles (e.g., Manager sees team data, QA sees global data).

## 🖥️ UI Components
### Dashboard Configuration
- **Filter Panel**:
  - **Date Range**: Select start/end dates or presets (e.g., Last 30 Days).
  - **Role Filter**: Dropdown of roles (Admin/QA only, for global reports).
  - **Department Filter**: Dropdown of departments (Manager/Director only, for scoped reports).
  - **CSR Filter**: Multi-select for specific CSRs (Manager/Director only).
  - **Form Filter**: Dropdown of QA forms from `forms`.
  - **Course Filter**: Dropdown of courses from `courses`.
- **Apply Button**: Generates report based on filters.

### Report Types
- **QA Score Trends**:
  - Line chart showing average QA scores over time (from `submissions`).
  - Group by: CSR, Department, or Form.
- **Training Progress**:
  - Bar chart showing course completion rates (from `enrollments`).
  - Group by: CSR or Course.
- **Audit Activity**:
  - Table of audit counts (from `submissions`) and dispute counts (from `disputes`).
  - Group by: CSR, Department, or QA Analyst.
- **Goal Tracking**:
  - Progress bars for `performance_goals` (e.g., QA score, audit rate).

### Export Options
- **Download Button**: Exports report as CSV or PDF.
- **Share Button**: Generates shareable link for report (Admin/Director only).

## 🔄 Workflow
1. **Configure Filters**  
   - User navigates to Analytics from their dashboard.
   - Selects filters based on role permissions (e.g., Manager selects team CSRs).

2. **Generate Report**  
   - Clicks “Apply” to fetch and render report data.
   - Views charts and tables based on selected report type.

3. **Export or Share**  
   - Downloads report as CSV/PDF or generates a shareable link.
   - Shared links are accessible only to authorized roles.

## 🗄️ Backend Integration
- **Tables**:
  - `submissions`, `submission_answers`: Fetch QA scores.
  - `enrollments`, `courses`: Fetch training progress.
  - `disputes`: Fetch dispute counts.
  - `performance_goals`: Fetch goal data.
  - `score_snapshots`: Store pre-aggregated score trends.
  - `agent_activity`: Track audit activity.
- **Endpoints**:
  - `GET /api/analytics/filters`: Fetch available filter options (roles, departments, etc.).
  - `POST /api/analytics/report`: Generate report based on filters.
  - `GET /api/analytics/export/:report_id`: Export report as CSV/PDF.
  - `POST /api/analytics/share`: Generate shareable link.
- **Validation**:
  - Restrict filter options based on role (e.g., Manager cannot select other departments).
  - Ensure date ranges are valid.
  - Limit shared link access to authorized roles.

## 💻 Frontend Implementation
- **React Components**:
  - `FilterPanel`: Form with dropdowns and date pickers.
  - `ReportViewer`: Dynamic component for rendering charts/tables.
  - `ExportButton`: Triggers CSV/PDF download.
  - `ShareButton`: Generates shareable link.
- **State Management**: Use React Query for fetching report data and filter options.
- **Styling**: Tailwind CSS for filter panel and chart styling.
- **Chart Library**: Use Chart.js or Recharts for visualizations.

## ✅ Testing Notes
- Verify filter options respect role-based scoping.
- Test report accuracy against `submissions`, `enrollments`, and `performance_goals`.
- Ensure charts render correctly for all report types.
- Confirm export generates valid CSV/PDF files.
- Validate shareable links are role-restricted.