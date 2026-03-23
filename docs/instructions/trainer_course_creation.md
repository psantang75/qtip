# Trainer Course Creation

## 📜 Purpose
The Trainer Course Creation screen enables Trainer users (`role_id=4`) to create new training courses in the QTIP platform’s Learning Management System (LMS) by entering metadata, adding pages, and configuring a quiz. Courses can be saved as Draft (not visible to CSRs) or Published (available for assignment), storing data in `courses`, `course_pages`, `quizzes`, and `quiz_questions`. This functionality is a core part of the Course Builder, focusing specifically on the course creation workflow.

## 🖥️ UI Components
### Course Creation Wizard
- **Steps**:
  1. **Metadata**:
     - `course_name`: Text input (required, max 100 characters).
     - `description`: Textarea (optional, max 1000 characters).
  2. **Pages**:
     - **Table**: Lists added pages.
       - **Columns**: Page Title, Content Type (Text, Video, PDF), Order.
       - **Actions**: Edit, Remove, Reorder (drag-and-drop).
     - **Add Page Button**: Opens a form:
       - `page_title`: Text input (required, max 100 characters).
       - `content_type`: Dropdown (Text, Video, PDF, required).
       - `content_url`: Text input (required for Video/PDF, valid URL).
       - `content_text`: Textarea (required for Text, max 5000 characters).
       - `page_order`: Number input (auto-incremented, starting at 1).
  3. **Quiz**:
     - **Quiz Details**:
       - `quiz_title`: Text input (required, max 100 characters).
       - `pass_score`: Number input (0–100, required, default 80).
     - **Questions Table**: Lists quiz questions.
       - **Columns**: Question Text, Correct Option (1–4).
       - **Actions**: Edit, Remove.
     - **Add Question Button**: Opens a form:
       - `question_text`: Text input (required, max 255 characters).
       - `options`: Four text inputs (required, max 255 characters each).
       - `correct_option`: Dropdown (1–4, required).
  4. **Review**:
     - Displays course metadata, pages, and quiz details.
     - **Save as Draft Button**: Saves with `is_draft=1`.
     - **Publish Button**: Saves with `is_draft=0`.
     - **Cancel Button**: Discards changes.
- **Navigation**: Stepper to move between steps (Metadata, Pages, Quiz, Review).

### Course List Integration
- **Button**: “New Course” button on the Course List (`trainer_course_builder.md`) opens the Course Creation Wizard.
- **Draft Indicator**: Courses with `is_draft=1` are marked as Draft in the Course List.

## 🔄 Workflow
1. **Initiate Course Creation**:
   - Trainer navigates to Course Builder (`/trainer/courses`) and clicks “New Course” to open the Course Creation Wizard.

2. **Enter Metadata**:
   - Inputs `course_name` and `description`, proceeds to the Pages step.

3. **Add Pages**:
   - Adds one or more pages, specifying `page_title`, `content_type`, `content_url` (for Video/PDF) or `content_text` (for Text), and `page_order`.
   - Reorders pages via drag-and-drop, edits or removes as needed.

4. **Configure Quiz**:
   - Inputs `quiz_title` and `pass_score`.
   - Adds one or more questions with `question_text`, four `options`, and `correct_option`.
   - Edits or removes questions as needed.

5. **Review and Save**:
   - Reviews metadata, pages, and quiz in the Review step.
   - Chooses “Save as Draft” (`is_draft=1`, not visible to CSRs) or “Publish” (`is_draft=0`, available for assignment).
   - Saves data to `courses`, `course_pages`, `quizzes`, and `quiz_questions`, logging the action in `audit_logs`.

## 🗄️ Backend Integration
- **Tables**:
  - `courses`: Stores course metadata (`id`, `course_name`, `description`, `created_by`, `created_at`, `is_draft`).
  - `course_pages`: Stores page content (`course_id`, `page_title`, `content_type`, `content_url`, `content_text`, `page_order`).
  - `quizzes`: Stores quiz details (`course_id`, `quiz_title`, `pass_score`).
  - `quiz_questions`: Stores questions (`quiz_id`, `question_text`, `options`, `correct_option`).
  - `users`: Links `created_by` to Trainer users (`role_id=4`).
  - `audit_logs`: Logs course creation and status changes.
- **Endpoints**:
  - `POST /api/courses`: Create a new course with pages and quiz.
    - **Payload**: `{ course_name: string, description: string, created_by: number, is_draft: boolean, pages: [{ page_title: string, content_type: string, content_url: string, content_text: string, page_order: number }], quiz: { quiz_title: string, pass_score: number, questions: [{ question_text: string, options: string[], correct_option: number }] } }`.
    - **Response**: `{ id: number, course_name: string, is_draft: boolean }`.
  - `GET /api/courses`: List courses, including drafts, with pagination.
    - **Query Params**: `search` (course name/description), `is_draft`, `page`, `limit`.
    - **Response**: `[{ id: number, course_name: string, description: string, created_by: number, created_at: string, is_draft: boolean }, ...]`.
- **Validation**:
  - Restrict access to Trainer role (`role_id=4`).
  - Ensure `course_name` is unique, `content_url` is valid for Video/PDF, and `pass_score` is 0–100.
  - Require at least one page and one quiz question.
  - Validate `correct_option` (1–4) for quiz questions.

## 💻 Frontend Implementation
- **React Components**:
  - `CourseCreationWizard`: Multi-step wizard for metadata, pages, quiz, and review.
  - `PageTable`: Table for managing pages with drag-and-drop reordering.
  - `QuizForm`: Form for quiz details and questions.
  - `ReviewPanel`: Summary of course data with Draft/Publish options.
- **State Management**: Use React Hook Form for wizard state, React Query for data submission, React Sortable for page reordering.
- **Styling**: Tailwind CSS for wizard, table, and form styling.

## ✅ Testing Notes
- Verify only Trainers (`role_id=4`) can access the Course Creation Wizard.
- Test course creation with metadata, multiple pages (Text, Video, PDF), and a quiz with multiple questions.
- Ensure Draft courses (`is_draft=1`) are not visible in assignment UI (`trainer_assign_training.md`).
- Confirm Published courses (`is_draft=0`) appear in assignment UI.
- Validate data saves correctly to `courses`, `course_pages`, `quizzes`, and `quiz_questions`.
- Check `audit_logs` for creation events:
  ```
  SELECT * FROM audit_logs WHERE target_type = 'courses' AND action = 'CREATE';
  ```
- Test validation (e.g., unique `course_name`, valid `content_url`, required fields).

## 🔗 Integration with Other Modules
- **Trainer Course Builder** (`trainer_course_builder.md`): Integrates with the Course List, where “New Course” triggers this wizard.
- **LMS Trainer Workflow** (`lms_trainer_workflow.md`): Aligns with the course creation step in the LMS workflow.
- **Trainer Dashboard** (`trainer_dashboard.md`): Links to Course Builder, which includes this creation functionality.
- **Navigation** (`navigation_overview.md`): Accessible via `/trainer/courses` (Course Builder).
- **Assign Training** (`trainer_assign_training.md`): Ensures Published courses are available for assignment.
- **Audit Logging** (`audit_logging.md`): Logs course creation and status changes.

## 🛠️ Schema Update
To support Draft vs. Published courses, add an `is_draft` column to `courses`:
```sql
ALTER TABLE courses ADD COLUMN is_draft TINYINT(1) DEFAULT 1;
```
- **Apply**: Run in MySQL:
  ```
  mysql -u <username> -p qtip -e "ALTER TABLE courses ADD COLUMN is_draft TINYINT(1) DEFAULT 1;"
  ```
- **Validation**: Confirm the column:
  ```
  DESCRIBE courses;
  ```