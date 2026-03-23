# Manager Dashboard

## 📜 Purpose
The Manager Dashboard is the main interface for Managers, providing an overview of their team’s QA scores, training progress, disputes, and coaching activities. It enables Managers to monitor and support their CSRs effectively in the QTIP platform.

## 🖥️ UI Components
### Team Performance Summary
- **QA Score Card**: Average QA score for team CSRs (last 30 days) from `submissions`.
- **Training Completion Card**: Percentage of completed courses from `enrollments`.
- **Dispute Status Card**: Count of open/resolved disputes from `disputes`.
- **Coaching Sessions Card**: Count of recent coaching sessions from `coaching_sessions`.

### Team Audits
- **Table**: Lists recent audits for team CSRs from `submissions`.
  - Columns: Audit ID, CSR Name, Form Name, Score, Submitted Date.
  - Actions: View Details (links to `manager_team_audits.md`).
  - Pagination: 5 audits per page.

### Team Training
- **Table**: Lists training progress for team CSRs from `enrollments`.
  - Columns: CSR Name, Course Name, Progress, Status (In Progress/Completed).
  - Actions: View Details (links to `manager_team_training.md`).
  - Pagination: 5 courses per page.

### Quick Actions
- **View Team Audits**: Link to `manager_team_audits.md`.
- **View Team Training**: Link to `manager_team_training.md`.
- **Resolve Disputes**: Link to `manager_dispute_resolution.md`.
- **Log Coaching Session**: Link to `manager_coaching_sessions.md`.

## 🔄 Workflow
1. **View Summary**  
   - Manager logs in and sees dashboard with team performance metrics.
   - Stats are fetched from `submissions`, `enrollments`, `disputes`, and `coaching_sessions`.

2. **Review Audits**  
   - Browses team audits, clicks “View Details” for full audit.
   - Navigates to `manager_team_audits.md`.

3. **Track Training**  
   - Views team training progress, clicks “View Details” for details.
   - Navigates to `manager_team_training.md`.

4. **Perform Actions**  
   - Uses quick action buttons to access audits, training, disputes, or coaching.

## 🗄️ Backend Integration
- **Tables**:
  - `submissions`: Fetch team QA scores.
  - `enrollments`: Fetch team training progress.
  - `disputes`: Fetch dispute counts.
  - `coaching_sessions`: Fetch coaching data.
  - `users`: Fetch team CSR data (where `department_id` matches Manager’s department).
- **Endpoints**:
  - `GET /api/manager/stats`: Fetch team performance summary.
  - `GET /api/manager/audits`: Fetch recent team audits.
  - `GET /api/manager/enrollments`: Fetch team training progress.
- **Validation**:
  - Restrict data to CSRs in the Manager’s `department_id`.
  - Ensure Manager-only access.

## 💻 Frontend Implementation
- **React Components**:
  - `PerformanceCards`: Grid of stat cards for QA, training, disputes, and coaching.
  - `AuditTable`: Paginated table for team audits.
  - `TrainingTable`: Paginated table for team training.
  - `QuickActions`: Button group for navigation.
- **State Management**: Use React Query for fetching dashboard data.
- **Styling**: Tailwind CSS for card-based layout and responsive tables.

## ✅ Testing Notes
- Verify stats reflect only the Manager’s team.
- Test navigation to `manager_team_audits.md` and other linked screens.
- Ensure audit and training tables show correct data.
- Confirm Manager-only access to the dashboard.
- Test responsiveness on mobile and desktop.