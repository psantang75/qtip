# Trainer Feedback Review

## 📜 Purpose
The Trainer Feedback Review screen enables Trainers to view and analyze feedback and ratings submitted by CSRs for completed courses in the QTIP platform’s LMS. This screen helps Trainers assess course effectiveness and identify areas for improvement.

## 🖥️ UI Components
### Feedback List
- **Table**: Displays feedback from `enrollments` or a related feedback table for completed courses.
  - Columns: Course Name, CSR Name, Rating (1–5), Comment, Submission Date.
  - Filters: By course, CSR, or rating.
  - Actions: View Details.
- **Search Bar**: Search by course or CSR name.
- **Pagination**: 20 feedback entries per page.

### Feedback Details Modal
- **Details**:
  - **Feedback Info**: Course Name, CSR Name, Rating, Submission Date.
  - **Comment**: Full text of the feedback comment.
- **Close Button**: Closes the modal.

### Summary Stats
- **Average Rating Card**: Average rating across all feedback for selected course(s).
- **Feedback Count Card**: Total number of feedback entries.

## 🔄 Workflow
1. **View Feedback**  
   - Trainer navigates to Feedback Review from the dashboard.
   - Browses feedback list, applies filters, or searches.

2. **Review Details**  
   - Clicks “View Details” to open modal with full feedback comment.
   - Reviews rating and comment for context.

3. **Analyze Summary**  
   - Views summary stats to assess overall course performance.
   - Returns to list or applies new filters.

## 🗄️ Backend Integration
- **Tables**:
  - `enrollments`: Fetch feedback data (assumes feedback stored here or in a related table).
  - `courses`: Fetch course names.
  - `users`: Fetch CSR names.
- **Endpoints**:
  - `GET /api/trainer/feedback`: Fetch feedback with pagination and filters.
  - `GET /api/trainer/feedback/:feedback_id`: Fetch feedback details.
  - `GET /api/trainer/feedback/stats`: Fetch average rating and feedback count.
- **Validation**:
  - Restrict feedback to completed courses.
  - Ensure access is limited to Trainer role.

## 💻 Frontend Implementation
- **React Components**:
  - `FeedbackTable`: Paginated table with filters and action buttons.
  - `FeedbackDetailsModal`: Modal for full feedback comment.
  - `SummaryCards`: Cards for average rating and feedback count.
- **State Management**: Use React Query for fetching feedback data.
- **Styling**: Tailwind CSS for table, modal, and card styling.

## ✅ Testing Notes
- Verify feedback list shows only completed course feedback.
- Test filters for course, CSR, and rating.
- Ensure modal displays correct rating and comment.
- Confirm summary stats match feedback data.
- Validate Trainer-only access to the screen.