# Manager Team Audits Implementation

## Overview
The Manager Team Audits component allows Managers to review audit history for their team's Customer Service Representatives (CSRs), including scores, form answers, call details, and dispute management.

## Database Relationships

Based on the `qtip_database_schema_5.29.25.sql`, the component utilizes the following relationships:

### Core Tables
- **`departments`**: Links managers to their departments via `manager_id`
- **`users`**: Contains CSR information with `department_id` linking to departments
- **`submissions`**: Main audit records with scores and submission data
- **`submission_metadata`**: Contains CSR information linked via form metadata fields
- **`submission_answers`**: Individual question answers for each audit
- **`disputes`**: Dispute records linked to submissions

### Key Relationships
1. **Manager → Department**: `departments.manager_id = users.id` (where users.role_id = 5 for managers)
2. **Department → CSRs**: `users.department_id = departments.id` (where users.role_id = 3 for CSRs)
3. **CSR → Audits**: CSR ID stored in `submission_metadata` where `form_metadata_fields.field_name = 'CSR'`
4. **Submissions → Answers**: `submission_answers.submission_id = submissions.id`
5. **Submissions → Disputes**: `disputes.submission_id = submissions.id`

## Component Features

### 1. Audit List Table
- **Columns**: Audit ID, CSR Name, Form Name, Score, Submitted Date, Dispute Status, Actions
- **Pagination**: 20 audits per page
- **Search**: By CSR name or audit ID
- **Filters**: CSR, Form, Date Range, Dispute Status

### 2. Advanced Filtering
- **CSR Filter**: Dropdown populated with team CSRs
- **Form Filter**: Dropdown with available forms
- **Date Range**: Start and end date filters
- **Dispute Status**: None, Pending, Resolved
- **Clear Filters**: Reset all filters and search

### 3. Audit Details Modal
- **Audit Information**: ID, CSR Name, QA Analyst, Form Name, Score, Date
- **Metadata**: Additional fields like Customer ID, Call Date, etc.
- **Form Answers**: Question-by-question breakdown with categories
- **Call Information**: Call details, transcript, audio player
- **Dispute Information**: Dispute status, reason, resolution notes

### 4. Dispute Management
- **View Disputes**: See pending and resolved disputes
- **Resolve Disputes**: Navigate to dispute resolution workflow
- **Dispute Status**: Visual indicators for dispute states

## API Endpoints

The component expects the following backend endpoints:

### Team Audits List
```
GET /api/manager/team-audits
Query Parameters:
- page: number
- limit: number  
- search: string
- csr_id: string
- form_id: string
- startDate: string
- endDate: string
- dispute_status: string
```

### Audit Details
```
GET /api/manager/team-audits/:id
Returns: ManagerTeamAuditDetails object
```

### Team CSRs
```
GET /api/manager/team-csrs
Returns: Array of CSROption objects
```

### Forms
```
GET /api/forms
Returns: Array of FormOption objects
```

## Backend Implementation Requirements

### SQL Query Logic for Team Audits

The backend should implement the following logic to retrieve audits for a manager's team:

```sql
-- Get CSRs in manager's department(s)
SELECT DISTINCT u.id as csr_id, u.username as csr_name
FROM users u
JOIN departments d ON u.department_id = d.id
WHERE d.manager_id = ? -- Current manager's ID
  AND u.role_id = 3    -- CSR role
  AND u.is_active = 1

-- Get submissions for these CSRs
SELECT s.*, f.form_name, 
       csr_meta.value as csr_id,
       csr_user.username as csr_name,
       qa_user.username as qa_analyst_name,
       CASE 
         WHEN d.id IS NULL THEN 'None'
         WHEN d.status = 'OPEN' THEN 'Pending'
         ELSE 'Resolved'
       END as dispute_status,
       d.id as dispute_id
FROM submissions s
JOIN forms f ON s.form_id = f.id
JOIN submission_metadata csr_meta ON s.id = csr_meta.submission_id
JOIN form_metadata_fields fmf ON csr_meta.field_id = fmf.id
JOIN users csr_user ON csr_meta.value = csr_user.id
JOIN users qa_user ON s.submitted_by = qa_user.id
LEFT JOIN disputes d ON s.id = d.submission_id AND d.status = 'OPEN'
WHERE fmf.field_name = 'CSR'
  AND csr_meta.value IN (/* CSR IDs from first query */)
  AND s.status = 'SUBMITTED'
```

### Audit Details Query

```sql
-- Get detailed audit information
SELECT s.*, f.form_name, f.version, f.interaction_type,
       csr_user.username as csr_name,
       qa_user.username as qa_analyst_name
FROM submissions s
JOIN forms f ON s.form_id = f.id
JOIN submission_metadata csr_meta ON s.id = csr_meta.submission_id
JOIN form_metadata_fields fmf ON csr_meta.field_id = fmf.id
JOIN users csr_user ON csr_meta.value = csr_user.id
JOIN users qa_user ON s.submitted_by = qa_user.id
WHERE s.id = ?
  AND fmf.field_name = 'CSR'
  AND csr_meta.value IN (/* Manager's team CSR IDs */)

-- Get metadata
SELECT fmf.field_name, sm.value
FROM submission_metadata sm
JOIN form_metadata_fields fmf ON sm.field_id = fmf.id
WHERE sm.submission_id = ?

-- Get answers
SELECT sa.*, fq.question_text, fc.category_name
FROM submission_answers sa
JOIN form_questions fq ON sa.question_id = fq.id
JOIN form_categories fc ON fq.category_id = fc.id
WHERE sa.submission_id = ?
ORDER BY fc.sort_order, fq.sort_order

-- Get calls (if applicable)
SELECT c.*
FROM calls c
JOIN submission_calls sc ON c.id = sc.call_id
WHERE sc.submission_id = ?

-- Get dispute information
SELECT d.*
FROM disputes d
WHERE d.submission_id = ?
ORDER BY d.created_at DESC
LIMIT 1
```

## File Structure

```
frontend/src/
├── components/
│   └── ManagerTeamAudits.tsx          # Main component
├── types/
│   └── manager.types.ts               # TypeScript interfaces
├── services/
│   └── managerService.ts              # API service methods
└── docs/
    └── manager_team_audits_implementation.md  # This documentation
```

## TypeScript Interfaces

The component uses the following interfaces defined in `manager.types.ts`:

- `ManagerTeamAudit`: Basic audit list item
- `ManagerTeamAuditDetails`: Detailed audit information
- `TeamAuditFilters`: Filter state interface
- `CSROption`: CSR dropdown option
- `FormOption`: Form dropdown option
- `PaginatedTeamAudits`: Paginated response format

## Usage

```tsx
import ManagerTeamAudits from '../components/ManagerTeamAudits';

// In your router or parent component
<Route path="/manager/team-audits" element={<ManagerTeamAudits />} />
```

## Security Considerations

1. **Access Control**: Ensure managers can only see audits for CSRs in their departments
2. **Role Validation**: Verify the user has manager role (role_id = 5)
3. **Data Filtering**: All queries must filter by manager's department relationships
4. **Dispute Access**: Managers should only access disputes for their team members

## Performance Optimizations

1. **Indexing**: Ensure proper indexes on:
   - `users.department_id`
   - `departments.manager_id`
   - `submission_metadata.submission_id`
   - `submission_metadata.field_id`
   - `disputes.submission_id`

2. **Caching**: Consider caching manager-team relationships

3. **Pagination**: Always use LIMIT/OFFSET for large datasets

## Testing

The component should be tested for:
1. Proper filtering by manager's team
2. Search functionality
3. Pagination
4. Modal interactions
5. Dispute resolution navigation
6. Error handling
7. Loading states 