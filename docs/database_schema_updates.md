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

## Scheduling Module Tables

Added by migration `20260731170000_add_scheduling`. Nine additive tables plus
`app_page` / `app_page_role_access` seeds (section `scheduling`). See
[`scheduling.md`](scheduling.md) for the feature overview. All tables use
`utf8mb4_unicode_ci`; author columns (`created_by` / `updated_by` / `entered_by`)
are `INT NULL` with no FK, matching existing convention. Dates are `@db.Date`
(UTC midnight), times `@db.Time`, and shift wall-clocks `@db.DateTime`.

| Table | Grain | Purpose |
|-------|-------|---------|
| `schedule_activity_type` | one per segment kind | Break / Lunch / … . `is_paid`, `counts_as_coverage`, `is_system`, `sort_order`. Generalizes breaks so new kinds are data, not schema. |
| `schedule_exception_type` | one per exception kind | Excused Absence / Scheduled PTO / Late / Early Leave / … . Carries `is_excused`, `duration_mode` (`FULL_DAY`/`WINDOW`/`EITHER`), `affects_arrival`, `affects_departure`. |
| `schedule_coverage_threshold` | one per department | `green_min` / `yellow_min` staffing minimums for the day-view heatmap. FK → `departments`. |
| `schedule_template` | one per reusable week | `template_name`, `description`, `is_active`. **No** department or color column. |
| `schedule_template_day` | one per template × weekday (0=Sun) | `is_day_off`, `start_time`/`end_time`. FK → `schedule_template` (ON DELETE CASCADE). |
| `schedule_template_day_segment` | one per template-day break/lunch | `activity_type_id`, `start_time`/`end_time`, `sort_order`. |
| `schedule_shift` | one per user × day (unique `user_id`,`shift_date`) | The materialized plan. `is_day_off`, `start_at`/`end_at`, `notes`, `status` (`DRAFT`/`PUBLISHED`), `source`, `template_id`, `locked_at`. FK → `users`. |
| `schedule_shift_segment` | one per shift break/lunch | `activity_type_id`, `start_at`/`end_at`, `sort_order`. FK → `schedule_shift` (ON DELETE CASCADE). |
| `schedule_exception` | one per user × day × window | `exception_type_id`, `is_full_day`, `starts_at`/`ends_at`, `notes`, `paychex_reference`. Non-overlapping per day (enforced in service). FK → `users`. |

All FKs use explicit `fk_*` names and appropriate `ON DELETE` clauses; unique
keys are `uq_*` and secondary indexes `idx_*`. The migration is additive only —
no existing table is altered and no data is migrated.