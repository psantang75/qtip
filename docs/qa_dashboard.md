# QA Dashboard

## 📜 Purpose
The QA Dashboard is the main interface for QA Analysts, providing an overview of assigned and manual audits, recent audit activity, and quick access to key features like scoring audits and viewing analytics. It helps QA Analysts manage their workflow efficiently.

## 🖥️ UI Components
### Audit Summary
- **Assigned Audits Card**: Count of pending audits from `audit_assignments`.
- **Completed Audits Card**: Count of completed audits (last 30 days) from `submissions`.
- **Average Score Card**: Average QA score for completed audits.

### Assigned Audits
- **Table**: Lists pending audits from `audit_assignments`.
  - Columns: Audit ID, CSR Name, Form Name, Call Date, Due Date.
  - Actions: Start Audit (links to `qa_assigned_reviews.md`).
  - Pagination: 10 audits per page.

### Recent Audits
- **Table**: Lists recently completed audits from `submissions`.
  - Columns: Audit ID, CSR Name, Form Name, Score, Submitted Date.
  - Actions: View Details (links to `qa_completed_reviews.md`).
  - Pagination: 5 audits per page.

### Quick Actions
- **Start Manual Audit**: Link to `qa_manual_reviews.md`.
- **View Completed Audits**: Link to `qa_completed_reviews.md`.
- **View Form Library**: Link to `qa_form_reference.md`.
- **View Analytics**: Link to `analytics_builder.md`.

## 🔄 Workflow
1. **View Summary**  
   - QA Analyst logs in and sees dashboard with audit metrics.
   - Stats are fetched from `audit_assignments` and `submissions`.

2. **Start Assigned Audit**  
   - Browses assigned audits, clicks “Start Audit” to open split-screen view.
   - Navigates to `qa_assigned_reviews.md` for scoring.

3. **Review Recent Audits**  
   - Views recent audits, clicks “View Details” to see full audit.
   - Navigates to `qa_completed_reviews.md`.

4. **Perform Actions**  
   - Uses quick action buttons to start manual audits, view forms, or access analytics.

## 🗄️ Backend Integration
- **Tables**:
  - `audit_assignments`: Fetch pending audits.
  - `submissions`: Fetch completed audits and scores.
  - `users`: Fetch CSR names.
  - `forms`: Fetch form names.
- **Endpoints**:
  - `GET /api/qa/stats`: Fetch audit summary stats.
  - `GET /api/qa/assigned`: Fetch assigned audits.
  - `GET /api/qa/completed`: Fetch recent audits.
- **Validation**:
  - Restrict data to the logged-in QA Analyst’s `user_id`.
  - Ensure only assigned audits are actionable.

## 💻 Frontend Implementation
- **React Components**:
  - `AuditSummaryCards`: Grid of stat cards for audit counts and scores.
  - `AssignedAuditTable`: Paginated table for pending audits.
  - `RecentAuditTable`: Paginated table for completed audits.
  - `QuickActions`: Button group for navigation.
- **State Management**: Use React Query for fetching dashboard data.
- **Styling**: Tailwind CSS for card-based layout and responsive tables.

## ✅ Testing Notes
- Verify audit counts and scores match `audit_assignments` and `submissions`.
- Test “Start Audit” navigation to `qa_assigned_reviews.md`.
- Ensure recent audits display correct details.
- Confirm QA Analyst-only access to the dashboard.
- Test navigation links to other QA screens.