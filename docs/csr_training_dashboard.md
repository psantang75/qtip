# CSR Training Dashboard

## 📜 Purpose
The CSR Training Dashboard allows Customer Service Representatives (CSRs) to view, track, and complete assigned training courses and quizzes in the QTIP platform’s Learning Management System (LMS). It provides a clear overview of training progress and deadlines.

## 🖥️ UI Components
### Training Summary
- **Assigned Courses Card**: Count of assigned courses from `enrollments`.
- **Completed Courses Card**: Count of completed courses.
- **Overdue Courses Card**: Count of courses past due date.

### Course List
- **Table**: Lists assigned courses from `enrollments`.
  - Columns: Course Name, Progress (e.g., “2/3 pages”), Due Date, Status (In Progress/Completed).
  - Actions: Continue Course, View Certificate (if completed).
  - Filters: By status or due date.
  - Pagination: 10 courses per page.

### Course View
- **Course Header**: Displays `course_name` and `description` from `courses`.
- **Page Navigation**: Sidebar or tabs for pages from `course_pages`.
- **Page Content**:
  - Text: Rendered as HTML (from `content_text`).
  - Video: Embedded player (from `content_url`).
  - PDF: Embedded viewer or download link (from `content_url`).
- **Quiz Section** (if applicable):
  - Questions from `quizzes` with multiple-choice options.
  - Submit Button: Submits answers for scoring.
- **Next/Previous Buttons**: Navigate between pages.
- **Complete Button**: Marks course as completed (after all pages/quizzes).

## 🔄 Workflow
1. **View Training**  
   - CSR navigates to Training Dashboard from the dashboard.
   - Sees summary and browses assigned courses.

2. **Start/Continue Course**  
   - Clicks “Continue Course” to open the course view.
   - Navigates through pages, views content, and completes quizzes.

3. **Complete Course**  
   - Finishes all pages and quizzes, clicks “Complete”.
   - Updates `enrollments` status, issues certificate in `certificates`.

4. **View Certificates**  
   - For completed courses, clicks “View Certificate” to navigate to `csr_certificates.md`.

## 🗄️ Backend Integration
- **Tables**:
  - `enrollments`: Fetch assigned courses and progress.
  - `courses`, `course_pages`: Fetch course content.
  - `quizzes`: Fetch quiz questions and scoring.
  - `certificates`: Store completion certificates.
- **Endpoints**:
  - `GET /api/csr/enrollments`: Fetch assigned courses.
  - `GET /api/courses/:course_id`: Fetch course details and pages.
  - `POST /api/quizzes/:quiz_id`: Submit quiz answers.
  - `PUT /api/enrollments/:enrollment_id`: Update course progress/completion.
- **Validation**:
  - Restrict data to the logged-in CSR’s `user_id`.
  - Ensure quiz answers are valid before submission.
  - Prevent completion until all pages/quizzes are done.

## 💻 Frontend Implementation
- **React Components**:
  - `TrainingSummaryCards`: Grid of stat cards for course counts.
  - `CourseTable`: Paginated table with filters and actions.
  - `CourseViewer`: Dynamic component for rendering pages and quizzes.
  - `QuizForm`: Form for quiz questions and submission.
- **State Management**: Use React Query for course data and React Hook Form for quizzes.
- **Styling**: Tailwind CSS for table, course viewer, and quiz styling.

## ✅ Testing Notes
- Verify course counts and progress match `enrollments`.
- Test page navigation and content rendering for all types (Text, Video, PDF).
- Ensure quiz submission calculates score correctly.
- Confirm certificate is issued upon completion.
- Validate CSR-only access to the screen.