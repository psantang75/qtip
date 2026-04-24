# Trainer Assign Training Component

A comprehensive React component for trainers to assign courses or training paths to CSRs (Customer Service Representatives) or entire departments in the QTIP platform's Learning Management System (LMS).

## Features

### 📋 Assignment Form
- **Assignment Type Selection**: Choose between Course or Training Path
- **Target Type Selection**: Assign to individual Users or entire Departments
- **Multi-select Targets**: Select multiple CSRs or departments for bulk assignment
- **Optional Due Dates**: Set deadlines for completion
- **Form Validation**: Ensures required fields are filled before submission

### 📝 Pending Assignments Management
- **Temporary Assignment Storage**: Add multiple assignments before saving
- **Visual Preview**: See all pending assignments in a table format
- **Individual Removal**: Remove specific pending assignments
- **Batch Saving**: Save all pending assignments at once

### 📊 Active Assignments Management
- **Real-time Assignment List**: View all current training assignments
- **Search Functionality**: Filter assignments by course/path or target name
- **Status Tracking**: See In Progress vs Completed status
- **Assignment Cancellation**: Cancel individual assignments with confirmation
- **Pagination**: Handle large lists of assignments efficiently (10 per page)

### 🎨 User Interface
- **Responsive Design**: Works on desktop and mobile devices
- **Modern Styling**: Clean, professional appearance using Tailwind CSS
- **Loading States**: Visual feedback during data operations
- **Confirmation Modals**: Prevent accidental cancellations
- **Form State Management**: React Hook Form for robust form handling

## Required API Endpoints

The component expects the following backend API endpoints to be implemented:

### 1. Get Published Courses
```
GET /api/trainer/courses
Response: Course[]
```

### 2. Get Training Paths
```
GET /api/trainer/paths
Response: TrainingPath[]
```

### 3. Get Assignment Targets
```
GET /api/trainer/targets
Response: {
  users: User[];
  departments: Department[];
}
```

### 4. Create Assignments
```
POST /api/enrollments
Body: CreateEnrollmentRequest
Response: {
  success: boolean;
  message: string;
  created_count: number;
}
```

### 5. Get Enrollments (with pagination)
```
GET /api/enrollments?page=1&pageSize=10&search=''
Response: {
  enrollments: Enrollment[];
  total: number;
  page: number;
  pageSize: number;
}
```

### 6. Cancel Assignment
```
DELETE /api/enrollments/:enrollment_id
Response: {
  success: boolean;
  message: string;
}
```

## TypeScript Interfaces

The component uses strongly-typed interfaces defined in `../types/trainer-assignment.ts`:

```typescript
interface Course {
  id: number;
  course_name: string;
  description?: string;
  created_by: number;
  created_at: string;
  is_draft: boolean;
}

interface TrainingPath {
  id: number;
  path_name: string;
  created_by: number;
  created_at: string;
}

interface User {
  id: number;
  username: string;
  email: string;
  role_id: number;
  department_id?: number;
  is_active: boolean;
}

interface Department {
  id: number;
  department_name: string;
  manager_id?: number;
  is_active: boolean;
}

interface Enrollment {
  id: number;
  course_id: number;
  user_id: number;
  status: 'IN_PROGRESS' | 'COMPLETED';
  progress: number;
  created_at: string;
  due_date?: string;
  course_name?: string;
  user_name?: string;
  target_type?: 'USER' | 'DEPARTMENT';
  target_name?: string;
}
```

## Database Schema Alignment

The component is designed to work with the following database tables from `qtip_database_schema_5.29.25.sql`:

- **courses**: Published courses available for assignment
- **training_paths**: Training paths containing multiple courses
- **users**: CSR users who can be assigned training
- **departments**: Organizational departments
- **enrollments**: Training assignments and progress tracking
- **audit_logs**: For logging assignment actions

## Usage Example

```jsx
import TrainerAssignTraining from './components/TrainerAssignTraining';

function App() {
  return (
    <div>
      <TrainerAssignTraining />
    </div>
  );
}
```

## Required Dependencies

Make sure these packages are installed in your React project:

```json
{
  "react": "^19.1.0",
  "react-dom": "^19.1.0",
  "react-hook-form": "^7.56.4",
  "axios": "^1.9.0",
  "tailwindcss": "^3.3.2"
}
```

## Authentication & Authorization

The component assumes:
- User is authenticated (token-based authentication via apiClient)
- User has Trainer role permissions
- API endpoints validate trainer-level access

## Error Handling

The component includes comprehensive error handling:
- Network request failures
- Validation errors
- User-friendly error messages
- Loading state management
- Form validation feedback

## Accessibility Features

- Semantic HTML structure
- Proper ARIA labels and roles
- Keyboard navigation support
- Screen reader friendly
- Focus management in modals

## Responsive Design

The component is fully responsive and works well on:
- Desktop computers (1024px+)
- Tablets (768px - 1023px)
- Mobile phones (320px - 767px)

## Performance Considerations

- Efficient re-renders using React hooks
- Pagination for large datasets
- Debounced search functionality
- Minimal API calls through intelligent state management

## Security Considerations

- All API calls use authenticated requests
- Input validation on the frontend
- XSS protection through proper escaping
- CSRF protection via API client configuration

## Future Enhancements

Potential improvements for future versions:
- Bulk assignment import via CSV
- Advanced filtering and sorting
- Assignment templates
- Email notifications
- Progress tracking dashboards
- Advanced search with filters
- Assignment history and audit trail 