# Manager Team Training

## 📜 Purpose
The Manager Team Training screen enables Managers to track the training progress of their team’s CSRs, including course completion, quiz results, and due dates. This screen supports oversight of training compliance in the QTIP platform’s LMS.

## 🖥️ UI Components
### Training List
- **Table**: Displays training enrollments for team CSRs from `enrollments` where `csr_id` belongs to the Manager’s `department_id`.
  - Columns: CSR Name, Course Name, Progress (e.g., “2/3 pages”), Due Date, Status (In Progress/Completed).
  - Filters: By CSR, course, or status.
  - Actions: View Details.
- **Search Bar**: Search by CSR or course name.
- **Pagination**: 20 enrollments per page.

### Training Details Modal
- **Details**:
  - **Enrollment Info**: CSR Name, Course Name, Progress, Due Date, Status.
  - **Course Pages**: List of pages from `course_pages` with completion status.
  - **Quiz Results**: Quiz title, score, and pass/fail status from `quizzes` (if applicable).
  - **Certificate**: Certificate ID and issue date from `certificates` (if completed).
- **Close Button**: Closes the modal.

## 🔄 Workflow
1. **View Team Training**  
   - Manager navigates to Team Training from the dashboard.
   - Browses training list, applies filters, or searches.

2. **Review Training Details**  
   - Clicks “View Details” to open modal with enrollment, page, quiz, and certificate data.
   - Assesses CSR’s progress and compliance.

3. **Return to List**  
   - Closes modal to return to the training list or applies new filters.

## 🗄️ Backend Integration
- **Tables**:
  - `enrollments`: Fetch training progress and status.
  - `courses`, `course_pages`: Fetch course and page details.
  - `quizzes`: Fetch quiz results.
  - `certificates`: Fetch certificate data.
  - `users`: Fetch CSR names.
  - `departments`: Restrict to Manager’s department.
- **Endpoints**:
  - `GET /api/manager/enrollments`: Fetch team training enrollments with pagination and filters.
  - `GET /api/manager/enrollments/:enrollment_id`: Fetch enrollment details, including pages and quizzes.
- **Validation**:
  - Restrict enrollments to CSRs in the Manager’s `department_id`.
  - Ensure quiz and certificate data are shown only if applicable.

## 💻 Frontend Implementation
- **React Components**:
  - `TrainingTable`: Paginated table with filters and action buttons.
  - `TrainingDetailsModal`: Modal for enrollment, page, quiz, and certificate details.
- **State Management**: Use React Query for fetching training data.
- **Styling**: Tailwind CSS for table and modal styling.

## ✅ Testing Notes
- Verify only team CSRs’ enrollments are shown.
- Test filters for CSR, course, and status.
- Ensure modal displays correct progress, quiz results, and certificate data.
- Confirm data updates when a CSR completes a course.
- Validate Manager-only access to the screen.