# QTIP Navigation Overview

## 📜 Purpose
This document outlines the navigation structure and screen flows for the Quality and Training Insight Platform (QTIP), organized by user role. It serves as a reference for developers using Cursor to implement role-specific interfaces and ensure consistent user experience across the React frontend.

## 🧭 Navigation Structure
The QTIP platform uses a role-based navigation model, with each role accessing a tailored dashboard and menu. The frontend is built with React + Vite + Tailwind CSS, featuring a sidebar for navigation and a main content area for screens.

### Admin Navigation
- **Dashboard** (`admin_dashboard.md`): Overview of users, audits, and goals.
- **Users & Departments** (`user_management.md`, `department_management.md`): Manage users and department assignments.
- **QA Form Builder** (`form_builder_instructions.md`): Create/edit QA forms.
- **Assign Audits** (`audit_assignment.md`): Schedule audits for CSRs/departments.
- **Set Performance Minimums** (`performance_goals.md`): Define QA score, audit rate, and dispute rate goals.
- **Analytics** (`analytics_builder.md`): Full access to system-wide reports.
- **Profile Settings** (`profile_settings.md`): Update account details.

### QA Analyst Navigation
- **Dashboard** (`qa_dashboard.md`): Summary of assigned and manual reviews.
- **Assigned Audits** (`qa_assigned_reviews.md`): Score assigned audits with split-screen view.
- **Manual Reviews** (`qa_manual_reviews.md`): Initiate ad-hoc audits.
- **Completed Audits** (`qa_completed_reviews.md`): View audit history.
- **Form Library** (`qa_form_reference.md`): Read-only access to QA forms.
- **Analytics** (`analytics_builder.md`): Full analytics access.
- **Profile Settings** (`profile_settings.md`): Update account details.

### CSR Navigation
- **My Dashboard** (`csr_dashboard.md`): Scores, goals, and training progress.
- **View Audits** (`csr_my_audits.md`): Review completed audits.
- **Submit Disputes** (`csr_dispute_history.md`): Submit/track disputes.
- **Training Progress** (`csr_training_dashboard.md`): View assigned courses and quiz results.
- **Certificates** (`csr_certificates.md`): View/download course certificates.
- **Profile Settings** (`profile_settings.md`): Update account details.

### Trainer Navigation
- **Dashboard** (`trainer_dashboard.md`): Course performance and trainee status.
- **Course Builder** (`lms_trainer_workflow.md`): Create courses, pages, and quizzes.
- **Assign Training** (`trainer_assign_training.md`): Assign courses to CSRs/departments.
- **View Feedback** (`trainer_feedback_review.md`): Review CSR course feedback.
- **Team Analytics** (`trainer_reports.md`): Training completion and performance trends.
- **Profile Settings** (`profile_settings.md`): Update account details.

### Manager Navigation
- **Dashboard** (`manager_dashboard.md`): Team performance overview.
- **Team Audits** (`manager_team_audits.md`): Review team audit history.
- **Team Training** (`manager_team_training.md`): Track team course progress.
- **Resolve Disputes** (`manager_dispute_resolution.md`): Handle CSR disputes.
- **Coaching Sessions** (`manager_coaching_sessions.md`): Log 1-on-1 coaching.
- **Team Goals** (`performance_goals.md`): View team performance targets.
- **Profile Settings** (`profile_settings.md`): Update account details.

### Director Navigation
- **Dashboard** (`director_dashboard.md`): Cross-team performance tracking.
- **Cross-Manager Reports** (`manager_performance_reports.md`): Compare departments/managers.
- **Resolve Disputes** (`director_dispute_resolution.md`): Handle escalated disputes.
- **Performance Goals** (`performance_goals.md`): View system-wide targets.
- **Profile Settings** (`profile_settings.md`): Update account details.

## 🔄 Shared Components
- **Sidebar**: Role-specific menu with links to available screens.
- **Top Bar**: Displays user name, role, and logout button.
- **Help Center** (`help_center.md`): Accessible from all roles, contains FAQs and support links.
- **Analytics Filters** (`analytics_builder.md`): Shared component for configuring reports.

## 💻 Frontend Implementation
- **React Router**: Use `react-router-dom` to map routes to screens (e.g., `/admin/dashboard`, `/qa/assigned-reviews`).
- **Role-Based Rendering**: Check `role_id` from JWT to render appropriate sidebar and routes.
- **Tailwind CSS**: Style sidebar and content areas for responsiveness.
- **State Management**: Use React Context to manage user role and navigation state.

## ✅ Testing Notes
- Verify role-based access control (e.g., CSR cannot access Admin screens).
- Test navigation responsiveness on mobile and desktop.
- Ensure sidebar highlights active route.
- Validate that `profile_settings.md` and `help_center.md` are accessible to all roles.