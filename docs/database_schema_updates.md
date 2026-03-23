# Database Schema Updates

## Audit Assignments Table Updates

The `audit_assignments` table has been updated to include additional fields required for the Audit Assignment functionality. These changes provide better support for the assignment workflow, including assigning specific QA analysts, setting time periods for assignments, and managing active/inactive status.

### Fields Added

| Field | Type | Description | Constraints |
|-------|------|-------------|-------------|
| `qa_id` | INT | ID of the QA Analyst assigned to this audit | FOREIGN KEY to `users(id)`, NULL allowed, ON DELETE SET NULL |
| `start_date` | DATETIME | Date when the audit assignment begins | NOT NULL |
| `end_date` | DATETIME | Optional date when the assignment should end | NULL allowed |
| `is_active` | BOOLEAN | Whether this assignment is active | DEFAULT TRUE |

### Schema Change SQL

```sql
ALTER TABLE audit_assignments
ADD COLUMN qa_id INT NULL,
ADD COLUMN start_date DATETIME NOT NULL,
ADD COLUMN end_date DATETIME NULL,
ADD COLUMN is_active BOOLEAN DEFAULT TRUE,
ADD CONSTRAINT fk_audit_assignments_qa FOREIGN KEY (qa_id) REFERENCES users(id) ON DELETE SET NULL;
```

### Complete Table Definition

```sql
CREATE TABLE audit_assignments (
    id INT NOT NULL AUTO_INCREMENT,
    form_id INT NOT NULL,
    target_id INT, -- CSR or department
    target_type ENUM('USER', 'DEPARTMENT') NOT NULL,
    schedule VARCHAR(100), -- e.g., "5 audits/week"
    qa_id INT NULL, -- QA Analyst assigned to this audit
    start_date DATETIME NOT NULL, -- When the audit assignment starts
    end_date DATETIME NULL, -- Optional end date for the audit assignment
    is_active BOOLEAN DEFAULT TRUE, -- Whether this assignment is active
    created_by INT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    FOREIGN KEY (form_id) REFERENCES forms(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (qa_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
```

## Impact on Existing Code

The API implementation has been developed to support these new fields with appropriate validation and error handling. The extended schema provides the following benefits:

1. **Quality Analyst Assignment**: Specific QA analysts can now be assigned to audit tasks, providing better accountability and workload management.

2. **Date Range Support**: Assignments can now have specific start and end dates, allowing for time-bound audit periods.

3. **Soft Deletion**: Assignments can be marked as inactive rather than being permanently deleted, preserving historical data.

4. **Better Filtering**: The API supports filtering by all new fields, allowing for more advanced querying capabilities.

No migration of existing data is necessary as all new fields either allow NULL values or have default values. 