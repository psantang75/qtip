# Director Dashboard

## 📜 Purpose
The Director Dashboard is the main interface for Directors, providing a high-level overview of performance across all CSRs under their assigned managers, including QA scores, training progress, and disputes. It enables Directors to monitor cross-team metrics and access key features in the QTIP platform.

## 🖥️ UI Components
### Cross-Team Performance Summary
- **QA Score Card**: Average QA score across all CSRs (last 30 days) from `submissions`.
- **Training Completion Card**: Percentage of completed courses from `enrollments`.
- **Dispute Status Card**: Count of open/resolved/escalated disputes from `disputes`.
- **Team Performance Card**: Average QA score by department from `submissions`.

### Recent Audits
- **Table**: Lists recent audits for CSRs under assigned managers from `submissions`.
  - Columns: Audit ID, CSR Name, Department, Form Name, Score, Submitted Date.
  - Actions: View Details (links to `manager_team_audits.md` for context).
  - Pagination: 5 audits per page.

### Department Performance
- **Table**: Lists performance metrics by department from `departments`.
  - Columns: Department Name, Manager Name, Average QA Score, Training Completion Rate.
  - Actions: View Report (links to `manager_performance_reports.md`).
  - Pagination: 5 departments per page.

### Quick Actions
- **View Performance Reports**: Link to `manager_performance_reports.md`.
- **Resolve Disputes**: Link to `director_dispute_resolution.md`.
- **View Performance Goals**: Link to `performance_goals.md` (read-only).
- **View Analytics**: Link to `analytics_builder.md`.

## 🔄 Workflow
1. **View Summary**  
   - Director logs in and sees dashboard with cross-team metrics.
   - Stats are fetched from `submissions`, `enrollments`, `disputes`, and `departments`.

2. **Review Audits**  
   - Browses recent audits, clicks “View Details” for full audit context.
   - Navigates to `manager_team_audits.md` for details.

3. **Analyze Departments**  
   - Views department performance, clicks “View Report” for detailed comparison.
   - Navigates to `manager_performance_reports.md`.

4. **Perform Actions**  
   - Uses quick action buttons to access reports, disputes, goals, or analytics.

## 🗄️ Backend Integration
- **Tables**:
  - `submissions`: Fetch QA scores.
  - `enrollments`: Fetch training progress.
  - `disputes`: Fetch dispute counts.
  - `departments`: Fetch department and manager data.
  - `users`: Fetch CSRs under assigned managers.
- **Endpoints**:
  - `GET /api/director/stats`: Fetch cross-team performance summary.
  - `GET /api/director/audits`: Fetch recent audits for CSRs.
  - `GET /api/director/departments`: Fetch department performance metrics.
- **Validation**:
  - Restrict data to CSRs under the Director’s assigned managers (via `departments.manager_id`).
  - Ensure Director-only access.

## 💻 Frontend Implementation
- **React Components**:
  - `PerformanceCards`: Grid of stat cards for QA, training, disputes, and teams.
  - `AuditTable`: Paginated table for recent audits.
  - `DepartmentTable`: Paginated table for department metrics.
  - `QuickActions`: Button group for navigation.
- **State Management**: Use React Query for fetching dashboard data.
- **Styling**: Tailwind CSS for card-based layout and responsive tables.

## ✅ Testing Notes
- Verify stats reflect only CSRs under assigned managers.
- Test navigation to `manager_performance_reports.md` and other linked screens.
- Ensure audit and department tables show correct data.
- Confirm Director-only access to the dashboard.
- Test responsiveness on mobile and desktop.