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
| `schedule_exception_type` | one per exception kind | PTO - Approved / Holiday / Bereavement / … . Carries `is_excused`, `duration_mode` (`FULL_DAY`/`WINDOW`/`EITHER`), `affects_arrival`, `affects_departure`, and `paychex_pay_type` (see below). |
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

### Paychex time-off link

Migration `20260804110000_paychex_pay_type_exceptions` adds two nullable columns
so approved leave in the punch feed can become an exception automatically
([`scheduling.md`](scheduling.md#time-off-comes-from-paychex)):

| Column | Purpose |
|--------|---------|
| `punch_raw.pay_type` | The Paychex pay type on the block — `Work`, `Break`, `Meal`, or a leave reason such as `PTO - Approved`. This is what lets a Non-Work block become a *typed* exception rather than an unexplained gap. |
| `schedule_exception_type.paychex_pay_type` | The pay type this exception type maps to, `UNIQUE` so two types cannot claim one pay type. NULL means manual-only (No Call / No Show). Editable in Admin → List Management, so a new Paychex reason needs no code change. |

The same migration consolidates the exception types down to the handful matching
Paychex one-for-one, retiring the rest by `is_active = 0` (no rows deleted —
historical exceptions keep their type), and seeds an `attendance_point_rule` of
1.00 for `PTO - Not Approved`. A follow-up,
`20260804160000_unpaid_not_approved`, relabels the retired `unexcused_absence`
type into `Unpaid - Not Approved` and gives it the matching 1.00 rule.

`20260804180000_jury_duty_vto` completes the set at eight linked pay types plus
the manual No Call / No Show: it reactivates and links `jury_duty`, and inserts a
`vto` row (VTO has no counterpart in the original list). Both are excused, so
neither needs a point rule. Pay types are matched on Paychex's **Description**
column, not its code — `Jury Duty`, not `JD` — which is what the feed carries.

## Attendance Points Tables

Added by migration `20260803200000_add_attendance_points`. Four additive tables
plus `ie_page` / `ie_kpi` / `ie_kpi_threshold` seeds for the `csr_attendance`
report. See [`insights_csr_attendance.md`](insights_csr_attendance.md) for the
feature overview.

Two **config** tables, both effective-dated, and two **derived** tables rebuilt by
`attendance.engine.ts`. The split matters: config is edited by admins and must
never be rewritten by a recompute, derived data is disposable and is deleted and
reinserted wholesale for the range being recomputed.

| Table | Grain | Purpose |
|-------|-------|---------|
| `attendance_point_rule` | one per band per effective period | The point bands. `rule_key`, `label`, `kind` (`LATE`/`EARLY_LEAVE`/`ABSENT`/`EXCEPTION`), `min_seconds`/`max_seconds` (inclusive; NULL max = unbounded), `points`, `exception_type_id` (FK → `schedule_exception_type`, set only for `EXCEPTION`), `effective_from`/`effective_to`, `sort_order`, `is_active`. Unique on (`rule_key`,`effective_from`). |
| `attendance_warning_threshold` | one per discipline step per effective period | Coaching / Verbal / Written / Final / Separation. `level_key`, `label`, `points_threshold`, `effective_from`/`effective_to`, `sort_order`, `is_active`. Unique on (`level_key`,`effective_from`). |
| `attendance_daily` | one per user × **scheduled** day | The compliance denominator. `scheduled_minutes`, `adherent_minutes`, `late_seconds`, `early_leave_seconds`, `is_absent`, `first_punch_at`/`last_punch_at`, `is_excused`, `excused_exception_id`. Clean days are stored too — compliance needs every scheduled day. `late_seconds` is stored even when it earns no points, which is what makes grace usage measurable. **No** `department_id` snapshot: department is joined live from `users`. |
| `attendance_occurrence` | one per user × day × kind | Point-bearing detail. `rule_id`, `kind`, `deviation_seconds`, `points`, `reason_label`. Unique on (`user_id`,`work_date`,`kind`) — a day carries at most one Late and one Leave Early. Points are summed from here and never denormalised onto `attendance_daily`, so there is one source of truth. |

There are deliberately **no** `waived` columns. Forgiveness is a
`schedule_exception`, and two ways to forgive a day would mean two sources of
truth. `work_date` is a `DATE`; all calendar logic uses local-first `YYYY-MM-DD`
strings per `.cursor/rules/date-handling.mdc`.

## Call Campaign Publishing

Added by migration `20260804190000_campaign_publishing`, on top of the campaign
tables from `20260803180000_add_campaigns`. A campaign calendar reaches agents
only once an Admin or Manager releases it, one month at a time, so a manager can
build next month while this month is already out.

| Change | Purpose |
|--------|---------|
| `campaign_schedule.status` | `DRAFT` / `PUBLISHED`, plus `published_at` / `published_by`. A DRAFT schedule is invisible to agents in full, whatever its months say. There is no separate control for it: publishing a month lifts it, so the UI has exactly one publish button. |
| `campaign_schedule_month` | One row per (`schedule_id`, `year`, `month`) — unique on all three. Carries the same `status` / `published_at` / `published_by` triple. FK → `campaign_schedule` (ON DELETE CASCADE); `published_by` has no FK, matching `created_by` on its siblings. |

Occurrences are still computed on read, so this table stores **only**
releasability, never projected days. **No row means DRAFT**, which is what makes
an unpublished month genuinely absent rather than empty: agents never receive it,
and the month list returned with each schedule bounds their navigation so they
cannot step onto one.

Both columns default to `DRAFT`, including for schedules that already existed —
publishing is deliberate, so the migration releases nothing implicitly.

Reads split on `resolveScope().canViewAll`, which is exactly the non-agent set:
Admin, Manager and Director see drafts. Writes (including publish) ride on
`authorizePage('sched_campaigns','edit')`, which is Admin and Manager only — so a
Director reads a draft calendar across the org without being able to release it.

## Call Campaign Schedules Across Departments

Added by migration `20260804200000_campaign_schedule_departments`. One named
calendar usually serves several departments, and copying it per department would
mean several calendars to publish and keep in step.

| Change | Purpose |
|--------|---------|
| `campaign_schedule_department` | One row per (`schedule_id`, `department_id`) — unique on both. The departments a calendar is visible to, and the **only** thing visibility reads. FK → `campaign_schedule` and `departments`, both ON DELETE CASCADE. |

`campaign_schedule.department_id` stays as the **owning** department: it still
backs `uq_campaign_schedule_dept_name` and `assertCanWriteSchedule`. Editing the
department list re-points it at the lowest id in the new list, so the owner is
always a department that can actually see the calendar. Every schedule that
existed before the migration is seeded with its current department, so nothing
changes for anyone until someone adds a department.

A view check (`assertCanViewSchedule`) passes when the viewer's scope intersects
that list; an agent needs their own department on it. Writes are unchanged —
scoped to the owner — and adding a department requires write scope over *that*
department too, so a Manager cannot lend a calendar to a department they do not
manage.