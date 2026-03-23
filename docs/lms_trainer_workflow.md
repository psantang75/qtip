# LMS Trainer Workflow

## 📜 Purpose
The LMS Trainer Workflow screen enables Trainers to create, edit, and manage courses, pages, quizzes, and training paths in the QTIP platform’s Learning Management System (LMS). This screen supports the creation of multi-page courses with text, video, or PDF content and optional quizzes.

## 🖥️ UI Components
### Course List
- **Table**: Displays all courses from `courses`.
  - Columns: Course Name, Created By, Created Date, Status (Draft/Published).
  - Actions: Edit, Publish, Delete.
- **Search Bar**: Search by course name.
- **New Course Button**: Opens course creation wizard.

### Course Creation/Edit Wizard
- **Step 1: Course Metadata**  
  - Fields: `course_name` (text), `description` (textarea).
- **Step 2: Add Pages**  
  - Add page: `page_title` (text), `content_type` (dropdown: Text, Video, PDF), `content_text` (textarea for Text), `content_url` (text for Video/PDF), `page_order` (number).
  - List of pages with edit/delete options.
- **Step 3: Add Quiz (Optional)**  
  - Fields: `quiz_title` (text), `pass_score` (decimal, e.g., 0.8 for 80%).
  - Add questions: `question_text` (textarea), `options` (text inputs), `correct_option` (dropdown).
- **Step 4: Preview & Save**  
  - Preview course as CSR would see it.
  - Save as Draft or Publish.

### Training Path Builder
- **Interface**: Drag-and-drop UI to bundle multiple courses into a path.
- **Fields**: Path name, list of courses, order.
- **Save Button**: Stores path in `training_paths`.

## 🔄 Workflow
1. **Create Course**  
   - Trainer clicks “New Course”, enters metadata, adds pages and quiz.
   - Saves as Draft or Publishes, storing in `courses`, `course_pages`, `quizzes`.

2. **Edit Course**  
   - Selects a course, edits pages or quiz, saves or republishes.
   - Updates existing records in `courses`, `course_pages`, `quizzes`.

3. **Build Training Path**  
   - Creates a path, adds courses, sets order.
   - Saves to `training_paths`, links to `courses`.

4. **Assign Training**  
   - Links to `trainer_assign_training.md` to assign courses/paths to CSRs.

## 🗄️ Backend Integration
- **Tables**:
  - `courses`: Store course metadata.
  - `course_pages`: Store page content and order.
  - `quizzes`: Store quiz details and questions.
  - `training_paths`: Store bundled courses.
- **Endpoints**:
  - `GET /api/courses`: Fetch all courses.
  - `POST /api/courses`: Create new course.
  - `PUT /api/courses/:course_id`: Update course.
  - `POST /api/training-paths`: Create training path.
- **Validation**:
  - Ensure `content_url` is valid for Video/PDF.
  - Validate `pass_score` between 0 and 1.
  - Check for duplicate `course_name`.

## 💻 Frontend Implementation
- **React Components**:
  - `CourseTable`: Paginated table with search and actions.
  - `CourseWizard`: Multi-step form for course creation.
  - `PageEditor`: Dynamic form for page content types.
  - `QuizEditor`: Form for quiz questions and options.
  - `PathBuilder`: Drag-and-drop interface for training paths.
- **State Management**: Use React Hook Form for wizard state.
- **Styling**: Tailwind CSS for wizard and drag-and-drop UI.

## ✅ Testing Notes
- Test course creation with all content types (Text, Video, PDF).
- Verify quiz questions and pass score are saved correctly.
- Ensure training path creation links courses in order.
- Test publish/unpublish functionality.
- Confirm Trainer-only access to the screen.