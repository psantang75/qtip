# QA Form Reference

## 📜 Purpose
The QA Form Reference screen provides QA Analysts with read-only access to active QA form templates in the QTIP platform, allowing them to review form structures, questions, and weights before conducting audits. This screen supports preparation and consistency in the audit process.

## 🖥️ UI Components
### Form List
- **Table**: Displays active forms from `forms` where `is_active=true`.
  - Columns: Form Name, Version, Created By, Created Date, Category Count, Question Count.
  - Filters: By form name or creator.
  - Actions: View Details.
- **Search Bar**: Search by form name.
- **Pagination**: 20 forms per page.

### Form Details Modal
- **Details**:
  - **Form Info**: Form Name, Version, Created By, Created Date.
  - **Categories**: List of categories from `form_categories` with weights.
  - **Questions**: List of questions from `form_questions`, including:
    - Question Text
    - Type (Yes/No, Scale, Text, Info)
    - N/A Allowed (Yes/No)
    - Scale Range (if applicable)
    - Weight (if applicable)
- **Close Button**: Closes the modal.

## 🔄 Workflow
1. **View Forms**  
   - QA Analyst navigates to Form Library from the dashboard.
   - Browses form list, applies filters, or searches.

2. **Review Form Details**  
   - Clicks “View Details” to open modal.
   - Reviews form structure, categories, and question details.

3. **Return to List**  
   - Closes modal to return to the form list or applies new filters.

## 🗄️ Backend Integration
- **Tables**:
  - `forms`: Fetch active forms.
  - `form_categories`: Fetch category details.
  - `form_questions`: Fetch question details.
  - `users`: Fetch creator names.
- **Endpoints**:
  - `GET /api/qa/forms`: Fetch active forms with pagination and filters.
  - `GET /api/qa/forms/:form_id`: Fetch form details, including categories and questions.
- **Validation**:
  - Restrict to active forms (`is_active=true`).
  - Ensure access is limited to QA Analyst role.

## 💻 Frontend Implementation
- **React Components**:
  - `FormTable`: Paginated table with filters and action buttons.
  - `FormDetailsModal`: Modal for displaying form structure and questions.
- **State Management**: Use React Query for fetching form data.
- **Styling**: Tailwind CSS for table and modal styling.

## ✅ Testing Notes
- Verify only active forms are displayed.
- Test filters for form name and creator.
- Ensure modal shows correct category weights and question types.
- Confirm N/A and scale details are displayed accurately.
- Validate QA Analyst-only access to the screen.