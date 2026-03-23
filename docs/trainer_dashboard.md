# Trainer Dashboard

## 📜 Purpose
The Trainer Dashboard is the main interface for Trainers, providing an overview of course performance, trainee progress, and quick access to key features like course creation, training assignment, and analytics. It helps Trainers manage the LMS effectively.

## 🖥️ UI Components
### Training Summary
- **Active Courses Card**: Count of published courses from `courses`.
- **Enrollments Card**: Total enrollments from `enrollments`.
- **Completion Rate Card**: Percentage of completed enrollments (last 30 days).

### Active Courses
- **Table**: Lists published courses from `courses`.
  - Columns: Course Name, Enrollments, Completion Rate, Created Date.
  - Actions: Edit Course (links to `lms_trainer_workflow.md`), View Feedback (links to `trainer_feedback_review.md`).
  - Pagination: 10 courses per page.

### Trainee Progress
- **Table**: Lists enrolled CSRs from `enrollments`.
  - Columns: CSR Name, Course Name, Progress (e.g., “2/3 pages”), Status (In Progress/Completed).
  - Actions: View Details (links to `trainer_reports.md`).
  - Pagination: 10 trainees per page.

### Quick Actions
- **Create Course**: Link to `lms_trainer_workflow.md`.
- **Assign Training**: Link to `trainer_assign_training.md`.
- **View Reports**: Link to `trainer_reports.md`.
- **View Feedback**: Link to `trainer_feedback_review.md`.

## 🔄 Workflow
1. **View Summary**  
   - Trainer logs in and sees dashboard with training metrics.
   - Stats are fetched from `courses` and `enrollments`.

2. **Manage Courses**  
   - Browses active courses, clicks “Edit Course” to update content.
   - Navigates to `lms_trainer_workflow.md` for editing.

3. **Track Trainees**  
   - Views trainee progress, clicks “View Details” to see detailed reports.
   - Navigates to `trainer_reports.md`.

4. **Perform Actions**  
   - Uses quick action buttons to create courses, assign training, or view analytics.

## 🗄️ Backend Integration
- **Tables**:
  - `courses`: Fetch course data.
  - `enrollments`: Fetch enrollment and progress data.
  - `users`: Fetch CSR names.
- **Endpoints**:
  - `GET /api/trainer/stats`: Fetch training summary stats.
  - `GET /api/trainer/courses`: Fetch active courses.
  - `GET /api/trainer/enrollments`: Fetch trainee progress.
- **Validation**:
  - Restrict data to the logged-in Trainer’s `user_id`.
  - Ensure only published courses are displayed.

## 💻 Frontend Implementation
- **React Components**:
  - `TrainingSummaryCards`: Grid of stat cards for courses and enrollments.
  - `CourseTable`: Paginated table for active courses.
  - `TraineeTable`: Paginated table for trainee progress.
  - `QuickActions`: Button group for navigation.
- **State Management**: Use React Query for fetching dashboard data.
- **Styling**: Tailwind CSS for card-based layout and responsive tables.

## ✅ Testing Notes
- Verify course and enrollment counts match `courses` and `enrollments`.
- Test “Edit Course” navigation to `lms_trainer_workflow.md`.
- Ensure trainee progress displays correct status and progress.
- Confirm Trainer-only access to the dashboard.
- Test navigation links to other Trainer screens.