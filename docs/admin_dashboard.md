# Admin Dashboard

## 📜 Purpose
The Admin Dashboard is the central interface for Admin users to manage the QTIP platform, providing an overview of system activity and quick access to key functions like user management, QA form creation, audit assignments, and performance goal setup.

## 🖥️ UI Components
### Overview Panel
- **User Stats**: Total users, active users, users by role (Admin, QA, CSR, etc.).
- **Audit Stats**: Pending audits, completed audits (last 30 days), average QA score.
- **Training Stats**: Active courses, enrollments, completion rate.
- **Dispute Stats**: Open disputes, resolved disputes (last 30 days).

### Quick Actions
- **Create User**: Link to `user_management.md` for adding a new user.
- **Build QA Form**: Link to `form_builder_instructions.md` for form creation.
- **Assign Audits**: Link to `audit_assignment.md` for scheduling audits.
- **Set Goals**: Link to `performance_goals.md` for defining performance minimums.
- **View Analytics**: Link to `analytics_builder.md` for system-wide reports.

### Recent Activity Feed
- **Table**: Lists recent actions (e.g., “User created”, “Audit assigned”, “Form updated”).
  - Columns: Action, User, Timestamp, Details (link to relevant screen).
  - Pagination: 10 entries per page.

## 🔄 Workflow
1. **View Summary**  
   - Admin logs in and sees the dashboard with real-time stats.
   - Stats are fetched from `users`, `submissions`, `courses`, and `disputes` tables.

2. **Perform Actions**  
   - Click quick action buttons to navigate to specific management screens.
   - Example: Click “Build QA Form” to start creating a form.

3. **Monitor Activity**  
   - Scroll through the activity feed to review recent system events.
   - Click “Details” to jump to related screens (e.g., view a specific audit).

## 🗄️ Backend Integration
- **Tables**:
  - `users`: For user stats.
  - `submissions`: For audit stats and scores.
  - `courses`, `enrollments`: For training stats.
  - `disputes`: For dispute stats.
  - `audit_logs`: For activity feed.
- **Endpoints**:
  - `GET /api/admin/stats`: Fetch overview stats.
  - `GET /api/admin/activity`: Fetch recent activity with pagination.
- **Validation**:
  - Restrict endpoint access to `role_id` for Admin.

## 💻 Frontend Implementation
- **React Components**:
  - `OverviewPanel`: Grid of stat cards (e.g., “Total Users: 150”).
  - `QuickActions`: Button group with links to other screens.
  - `ActivityFeed`: Table with pagination and clickable rows.
- **State Management**: Use React Query to fetch and cache stats/activity data.
- **Styling**: Tailwind CSS for card-based layout and responsive tables.

## ✅ Testing Notes
- Verify stats accuracy against database records.
- Test quick action links for correct navigation.
- Ensure activity feed paginates and filters correctly.
- Confirm Admin-only access to the dashboard.