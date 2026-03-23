# CSR Dashboard

## 📜 Purpose
The CSR Dashboard is the main interface for Customer Service Representatives (CSRs), providing an overview of their QA scores, performance goals, assigned training, and recent audits. It helps CSRs track their progress and access key features like dispute submission and training.

## 🖥️ UI Components
### Performance Summary
- **QA Score Card**: Displays average QA score (last 30 days) from `submissions`.
- **Goal Progress**: Shows progress toward `performance_goals` (e.g., “QA Score: 88/85%”).
- **Training Status**: Counts completed vs. assigned courses from `enrollments`.

### Recent Audits
- **Table**: Lists recent audits from `submissions`.
  - Columns: Audit ID, Form Name, Score, Submitted Date, Status (Disputable/Disputed).
  - Actions: View Details (links to `csr_my_audits.md`).
  - Pagination: 5 audits per page.

### Training Progress
- **List**: Displays assigned courses from `enrollments`.
  - Fields: Course Name, Progress (e.g., “2/3 pages”), Due Date, Status (In Progress/Completed).
  - Actions: Continue Course (links to `csr_training_dashboard.md`).

### Quick Actions
- **View All Audits**: Link to `csr_my_audits.md`.
- **Submit Dispute**: Link to `csr_dispute_history.md`.
- **View Training**: Link to `csr_training_dashboard.md`.
- **View Certificates**: Link to `csr_certificates.md`.

## 🔄 Workflow
1. **View Summary**  
   - CSR logs in and sees dashboard with performance metrics.
   - Stats are fetched from `submissions`, `performance_goals`, and `enrollments`.

2. **Review Audits**  
   - Browses recent audits, clicks “View Details” to see full audit.
   - Checks if audits are disputable.

3. **Track Training**  
   - Views assigned courses, clicks “Continue Course” to resume training.
   - Monitors completion status and due dates.

4. **Perform Actions**  
   - Uses quick action buttons to navigate to audits, disputes, or training.

## 🗄️ Backend Integration
- **Tables**:
  - `submissions`: Fetch QA scores and recent audits.
  - `performance_goals`: Display goal progress.
  - `enrollments`, `courses`: Show training status.
- **Endpoints**:
  - `GET /api/csr/stats`: Fetch performance summary.
  - `GET /api/csr/audits`: Fetch recent audits.
  - `GET /api/csr/enrollments`: Fetch assigned courses.
- **Validation**:
  - Restrict data to the logged-in CSR’s `user_id`.
  - Ensure only disputable audits are actionable.

## 💻 Frontend Implementation
- **React Components**:
  - `PerformanceCards`: Grid of stat cards for QA score, goals, and training.
  - `AuditTable`: Paginated table for recent audits.
  - `TrainingList`: List of courses with progress bars.
  - `QuickActions`: Button group for navigation.
- **State Management**: Use React Query for fetching dashboard data.
- **Styling**: Tailwind CSS for card-based layout and responsive lists.

## ✅ Testing Notes
- Verify QA score calculation matches `submissions` data.
- Test goal progress display against `performance_goals`.
- Ensure training list shows correct progress and due dates.
- Confirm CSR-only access to the dashboard.
- Test navigation links to other CSR screens.