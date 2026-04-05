# Qtip Insights Engine — Foundation Architecture Spec

**Version:** 2.0
**Date:** April 3, 2026
**Scope:** Platform foundation only. No phase-specific KPIs, fact tables, or report definitions.

---

## 1. What This Document Covers

The Insights Engine is a separate analytics layer that sits alongside the existing Qtip application. It uses its own database tables and does not modify or replace anything currently working in Qtip.

The engine has two parts:

- **The Foundation (this document):** The permanent infrastructure that every future analytics section plugs into. Built once, used forever. Includes shared dimensions, the KPI registry, the permission system, the ingestion framework, and the aggregation engine.
- **Section Blueprints (separate documents, one per phase):** Each phase defines its own fact tables, KPIs, ingestion workers, and report pages. Blueprints are designed at build time and plug into the foundation.

This document covers only the foundation. It defines patterns and rules — not specific KPIs or report pages.

---

## 2. Architecture Overview

### 2.1 Design Principles

- **Metadata-driven:** KPIs, report pages, and permissions are defined as data (database rows), not code. Adding a new KPI means inserting a row, not writing a new React component.
- **Additive by design:** New sections, KPIs, and data sources are added without changing what already exists. Fact tables grow columns; registries grow rows.
- **Separation of concerns:** The foundation engine doesn't know or care about specific business domains. It knows how to store, aggregate, permission-gate, and render analytics — the specifics come from each section blueprint.
- **Existing Qtip untouched:** The Insights Engine uses its own table namespace (`ie_` prefix). Existing Qtip tables (forms, submissions, users, departments, etc.) remain the source of truth for operational data. The engine reads from them; it never writes to them.

### 2.2 Table Naming Convention

All Insights Engine tables use the `ie_` prefix to clearly separate them from existing Qtip tables.

| Table Type | Prefix | Example |
|---|---|---|
| Shared dimension | `ie_dim_` | `ie_dim_date`, `ie_dim_department` |
| Fact table | `ie_fact_` | Defined per section blueprint |
| Staging table | `ie_stg_` | Defined per section blueprint |
| Aggregate table | `ie_agg_` | Defined per section blueprint |
| Registry / config | `ie_` | `ie_kpi`, `ie_page`, `ie_page_role_access` |
| Ingestion tracking | `ie_` | `ie_ingestion_log` |

### 2.3 Three-Layer Storage Pattern

Every section blueprint follows this data flow:

```
Raw / Staging (ie_stg_*)          Facts & Dimensions (ie_fact_*, ie_dim_*)          Aggregates (ie_agg_*)
┌──────────────────────┐          ┌──────────────────────────────────┐              ┌─────────────────────┐
│ Temporary landing    │          │ Cleaned, normalized, linked to   │              │ Pre-computed rollups │
│ zone for incoming    │  ─────►  │ dimensions. Source of truth for  │  ─────────►  │ for fast dashboard   │
│ data. Raw format.    │          │ all analytics queries.           │              │ rendering.           │
│                      │          │                                  │              │                     │
│ Retention: 90 days   │          │ Retention: 3 years               │              │ Retention: Indefinite│
└──────────────────────┘          └──────────────────────────────────┘              └─────────────────────┘
```

**Staging tables** hold raw imported data in its original format before transformation. They exist for debugging and reprocessing. Each section blueprint defines its own staging tables based on the data sources it ingests.

**Fact tables** hold cleaned, normalized event data linked to shared dimensions via foreign keys. Every fact table must include a set of standard columns (defined in Section 5). Each section blueprint defines its own fact tables.

**Aggregate tables** hold pre-computed rollups (daily, weekly, monthly) for dashboard performance. They are rebuilt from fact tables and can always be regenerated. Each section blueprint defines its own aggregate tables.

---

## 3. Shared Dimension Tables

These dimension tables are universal — they serve every section and are built as part of the foundation. Section blueprints may define additional dimensions specific to their domain.

### 3.1 ie_dim_date

A pre-populated calendar table covering 5 years (2 years back, 3 years forward from deployment). One row per calendar day.

```sql
CREATE TABLE ie_dim_date (
  date_key          INT           PRIMARY KEY,    -- YYYYMMDD format (e.g., 20260403)
  full_date         DATE          NOT NULL UNIQUE,
  day_of_week       TINYINT       NOT NULL,       -- 1=Monday, 7=Sunday
  day_name          VARCHAR(10)   NOT NULL,       -- 'Monday', 'Tuesday', etc.
  day_of_month      TINYINT       NOT NULL,
  day_of_year       SMALLINT      NOT NULL,
  week_of_year      TINYINT       NOT NULL,       -- ISO week number
  month_number      TINYINT       NOT NULL,
  month_name        VARCHAR(10)   NOT NULL,
  quarter           TINYINT       NOT NULL,       -- 1-4
  year              SMALLINT      NOT NULL,
  is_weekend        BOOLEAN       NOT NULL DEFAULT FALSE,
  is_business_day   BOOLEAN       NOT NULL DEFAULT TRUE,
  fiscal_year       SMALLINT      NULL,           -- Set if fiscal year differs from calendar
  fiscal_quarter    TINYINT       NULL
);
```

**Why this exists:** Every analytics query filters or groups by date. A date dimension lets you group by week, month, quarter, or year without calculating it on the fly. It also supports business-day filtering and fiscal calendar alignment.

**Business day logic:** The `is_business_day` column defaults to TRUE for weekdays and FALSE for weekends. It integrates with the existing `BusinessCalendarDay` table in Qtip — holidays and closures from that table set `is_business_day = FALSE` in the date dimension. A nightly sync keeps them aligned.

### 3.2 ie_dim_department

A view of departments with hierarchy support. Synced from the existing Qtip `Department` table.

```sql
CREATE TABLE ie_dim_department (
  department_key    INT           PRIMARY KEY AUTO_INCREMENT,
  department_id     INT           NOT NULL,       -- FK to Qtip Department.id
  department_name   VARCHAR(100)  NOT NULL,
  parent_id         INT           NULL,           -- FK to ie_dim_department.department_key
  hierarchy_level   TINYINT       NOT NULL DEFAULT 0,  -- 0=top, 1=division, 2=team
  hierarchy_path    VARCHAR(500)  NULL,           -- '/Operations/Tech Support' for breadcrumb display
  is_active         BOOLEAN       NOT NULL DEFAULT TRUE,
  effective_from    DATE          NOT NULL,
  effective_to      DATE          NULL,           -- NULL = current. Populated when department changes (SCD Type 2)
  is_current        BOOLEAN       NOT NULL DEFAULT TRUE
);

CREATE INDEX idx_dim_dept_current ON ie_dim_department (is_current, is_active);
CREATE INDEX idx_dim_dept_qtip_id ON ie_dim_department (department_id);
```

**Why this exists:** Departments can be reorganized — merged, renamed, moved under a new parent. The dimension tracks these changes over time (SCD Type 2) so historical reports stay accurate. When Tech Support was under Operations last year but moved to Enterprise this year, both are preserved.

**Hierarchy support:** The `parent_id` column enables rollup queries. "Show me all of Operations" automatically includes Billing, Tech Support, and any other child departments. The `hierarchy_path` column gives a human-readable breadcrumb.

**Sync from Qtip:** A nightly process reads the Qtip `Department` table and updates this dimension. If a department's name or parent changes, the current row gets an `effective_to` date and a new row is inserted with the updated values. This requires adding a `parent_id` column to the existing Qtip `Department` table (see Section 9).

### 3.3 ie_dim_employee

A view of employees with their department and role assignments over time.

```sql
CREATE TABLE ie_dim_employee (
  employee_key      INT           PRIMARY KEY AUTO_INCREMENT,
  user_id           INT           NOT NULL,       -- FK to Qtip User.id
  username          VARCHAR(100)  NOT NULL,
  email             VARCHAR(255)  NULL,
  role_name         VARCHAR(50)   NOT NULL,       -- Denormalized from Role table
  department_key    INT           NULL,           -- FK to ie_dim_department.department_key
  manager_user_id   INT           NULL,           -- FK to Qtip User.id
  title             VARCHAR(100)  NULL,
  is_active         BOOLEAN       NOT NULL DEFAULT TRUE,
  effective_from    DATE          NOT NULL,
  effective_to      DATE          NULL,
  is_current        BOOLEAN       NOT NULL DEFAULT TRUE
);

CREATE INDEX idx_dim_emp_current ON ie_dim_employee (is_current, is_active);
CREATE INDEX idx_dim_emp_user_id ON ie_dim_employee (user_id);
CREATE INDEX idx_dim_emp_dept ON ie_dim_employee (department_key);
```

**Why this exists:** When an agent transfers from Billing to Tech Support, historical reports should show their old scores under Billing and new scores under Tech Support. SCD Type 2 handles this automatically.

**Sync from Qtip:** Same pattern as departments — nightly sync, detect changes in role/department/manager/active status, close old row, insert new row.

### 3.4 ie_dim_time_of_day (optional, built when first requested)

For sections that need intraday analysis (e.g., call volume by hour, shift performance by time slot), a time-of-day dimension with one row per 15-minute interval (96 rows total).

```sql
CREATE TABLE ie_dim_time_of_day (
  time_key          SMALLINT      PRIMARY KEY,       -- 0-95 (15-min intervals)
  interval_start    TIME          NOT NULL,           -- '00:00:00', '00:15:00', etc.
  interval_end      TIME          NOT NULL,
  hour_of_day       TINYINT       NOT NULL,           -- 0-23
  am_pm             VARCHAR(2)    NOT NULL,           -- 'AM' or 'PM'
  display_label     VARCHAR(20)   NOT NULL,           -- '8:00 AM - 8:15 AM'
  is_business_hours BOOLEAN       NOT NULL DEFAULT FALSE  -- TRUE for 8:00-17:00 (configurable)
);
```

**Not built during foundation.** Created and populated when the first section blueprint declares it needs intraday analysis. Section blueprints must explicitly answer "Does this section need time-of-day analysis?" (see Section 14 template).

### 3.5 Business Calendar Sync

The `ie_dim_date.is_business_day` column must stay in sync with the existing Qtip `BusinessCalendarDay` table. This is handled by the **dimension sync worker** (Section 7, built as part of the foundation). On each nightly run, it reads all `HOLIDAY` and `CLOSURE` entries from `BusinessCalendarDay` and sets `is_business_day = FALSE` on the matching dates in `ie_dim_date`. New entries added to the Qtip calendar are picked up on the next sync.

---

## 4. KPI Registry

The KPI registry is the core mechanism that makes the Insights Engine metadata-driven. Every KPI displayed anywhere in the engine is defined as a row in this table — not in code.

### 4.1 ie_kpi

```sql
CREATE TABLE ie_kpi (
  id                INT           PRIMARY KEY AUTO_INCREMENT,
  kpi_code          VARCHAR(50)   NOT NULL UNIQUE,  -- Machine-readable key (e.g., 'qa_avg_score')
  kpi_name          VARCHAR(100)  NOT NULL,          -- Display name (e.g., 'Average QA Score')
  description       TEXT          NULL,              -- Tooltip / help text
  category          VARCHAR(50)   NOT NULL,          -- Groups KPIs in the UI (e.g., 'Quality', 'Training')

  -- Calculation
  formula_type      ENUM('SQL','DERIVED','COMPOSITE') NOT NULL DEFAULT 'SQL',
  formula           TEXT          NOT NULL,           -- See formula types below
  source_table      VARCHAR(100)  NULL,              -- Primary fact/agg table this KPI reads from

  -- Display
  format_type       ENUM('PERCENT','NUMBER','CURRENCY','DURATION','RATIO') NOT NULL,
  decimal_places    TINYINT       NOT NULL DEFAULT 1,
  direction         ENUM('UP_IS_GOOD','DOWN_IS_GOOD','NEUTRAL') NOT NULL,
  unit_label        VARCHAR(20)   NULL,              -- e.g., '%', 'mins', '$'

  -- Behavior
  is_active         BOOLEAN       NOT NULL DEFAULT TRUE,
  sort_order        INT           NOT NULL DEFAULT 0,
  created_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by        INT           NULL               -- FK to User.id
);

CREATE INDEX idx_kpi_category ON ie_kpi (category, is_active, sort_order);
```

### 4.2 Formula Types Explained

**SQL:** A SQL expression that can be evaluated against a fact or aggregate table. The engine substitutes dimension filters (date range, department, employee) at query time.

```
-- Example: Average QA Score
AVG(total_score)
```

**DERIVED:** A calculation based on other KPIs. References other KPI codes.

```
-- Example: Net Quality Trend = Current Period Avg - Prior Period Avg
{qa_avg_score}.current - {qa_avg_score}.prior
```

**COMPOSITE:** A KPI that combines data from multiple fact tables or source systems. Defined as a named SQL query or stored procedure reference.

```
-- Example: references a view or procedure that joins multiple tables
CALL ie_compute_composite('true_productivity', :date_from, :date_to, :department_key)
```

### 4.3 ie_kpi_threshold

Stores goal and warning thresholds per KPI, scoped to department (or global).

```sql
CREATE TABLE ie_kpi_threshold (
  id                INT           PRIMARY KEY AUTO_INCREMENT,
  kpi_id            INT           NOT NULL,          -- FK to ie_kpi.id
  department_key    INT           NULL,              -- FK to ie_dim_department. NULL = global default

  goal_value        DECIMAL(12,4) NULL,              -- Green line / target
  warning_value     DECIMAL(12,4) NULL,              -- Yellow threshold
  critical_value    DECIMAL(12,4) NULL,              -- Red threshold

  effective_from    DATE          NOT NULL,
  effective_to      DATE          NULL,              -- NULL = current

  created_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY uq_kpi_dept_effective (kpi_id, department_key, effective_from)
);
```

**Why thresholds are dated:** Goals change. Q1 target might be 85%, Q2 might be 90%. Historical reports should show the threshold that was active at the time, not today's threshold. The `effective_from` / `effective_to` range handles this.

**Resolution order:** When rendering a KPI for a department, the engine looks for: (1) department-specific threshold active on the report date, (2) parent department threshold, (3) global threshold (department_key = NULL). First match wins.

---

## 5. Fact Table Standards

Each section blueprint defines its own fact tables. This section defines the rules all fact tables must follow.

### 5.1 Required Standard Columns

Every `ie_fact_*` table must include these columns:

```sql
-- These columns are REQUIRED in every fact table
id                BIGINT        PRIMARY KEY AUTO_INCREMENT,
event_date        DATE          NOT NULL,          -- Links to ie_dim_date.full_date
date_key          INT           NOT NULL,          -- Links to ie_dim_date.date_key
employee_key      INT           NOT NULL,          -- Links to ie_dim_employee.employee_key
department_key    INT           NOT NULL,          -- Links to ie_dim_department.department_key
source_system     VARCHAR(30)   NOT NULL,          -- 'qtip', 'crm', 'genesys', 'desktime', 'paychex'
ingested_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
ingestion_log_id  INT           NULL               -- FK to ie_ingestion_log.id
```

**Section-specific columns** are added after the standard columns. These are defined in each section blueprint.

### 5.2 Indexing Standards

Every fact table must include at minimum:

```sql
CREATE INDEX idx_{table}_date_dept ON {table} (date_key, department_key);
CREATE INDEX idx_{table}_date_emp ON {table} (date_key, employee_key);
CREATE INDEX idx_{table}_ingestion ON {table} (ingestion_log_id);
```

### 5.3 Monthly Partitioning

All fact and staging tables are partitioned by month on the `event_date` column. This provides fast date-range queries and instant archival (drop a partition vs. delete millions of rows).

```sql
-- Example partition setup (applied to every fact table)
PARTITION BY RANGE (YEAR(event_date) * 100 + MONTH(event_date)) (
  PARTITION p202601 VALUES LESS THAN (202602),
  PARTITION p202602 VALUES LESS THAN (202603),
  -- ... new partitions added automatically by the partition manager worker
  PARTITION p_future VALUES LESS THAN MAXVALUE
);
```

A **partition manager** (see Section 7) runs monthly to create new partitions ahead of time and drop partitions past retention.

---

## 6. Page & Permission System

### 6.1 ie_page (Report Page Registry)

Every report page in the Insights Engine is registered here. Like KPIs, pages are data, not code — though each page does have a corresponding React route/component.

```sql
CREATE TABLE ie_page (
  id                INT           PRIMARY KEY AUTO_INCREMENT,
  page_key          VARCHAR(50)   NOT NULL UNIQUE,  -- URL-safe key (e.g., 'qa-scores')
  page_name         VARCHAR(100)  NOT NULL,          -- Display name in navigation
  description       TEXT          NULL,
  category          VARCHAR(50)   NOT NULL,          -- Groups pages in nav (e.g., 'Quality & Training')
  route_path        VARCHAR(200)  NOT NULL,          -- React route (e.g., '/insights/qa-scores')
  icon              VARCHAR(50)   NULL,              -- Icon identifier for nav
  sort_order        INT           NOT NULL DEFAULT 0,
  is_active         BOOLEAN       NOT NULL DEFAULT TRUE,
  requires_section  VARCHAR(50)   NULL,              -- Which section blueprint this belongs to
  created_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

### 6.2 ie_page_role_access (Role-Level Defaults)

Defines the default access level for each role on each page.

```sql
CREATE TABLE ie_page_role_access (
  id                INT           PRIMARY KEY AUTO_INCREMENT,
  page_id           INT           NOT NULL,          -- FK to ie_page.id
  role_id           INT           NOT NULL,          -- FK to Qtip Role.id

  can_access        BOOLEAN       NOT NULL DEFAULT FALSE,
  data_scope        ENUM('ALL','DIVISION','DEPARTMENT','SELF') NOT NULL DEFAULT 'SELF',

  UNIQUE KEY uq_page_role (page_id, role_id)
);
```

### 6.3 ie_page_user_override (Per-User Exceptions)

Overrides the role default for a specific user on a specific page. Used sparingly — for example, giving a team lead access to a page their role normally can't see.

```sql
CREATE TABLE ie_page_user_override (
  id                INT           PRIMARY KEY AUTO_INCREMENT,
  page_id           INT           NOT NULL,          -- FK to ie_page.id
  user_id           INT           NOT NULL,          -- FK to Qtip User.id

  can_access        BOOLEAN       NOT NULL,
  data_scope        ENUM('ALL','DIVISION','DEPARTMENT','SELF') NULL,  -- NULL = use role default scope

  granted_by        INT           NOT NULL,          -- FK to User.id (admin who set this)
  granted_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at        DATETIME      NULL,              -- NULL = permanent
  reason            VARCHAR(255)  NULL,

  UNIQUE KEY uq_page_user (page_id, user_id)
);
```

### 6.4 Permission Resolution Logic

When a user navigates to an Insights page, the engine resolves their access in this order:

1. **Check user override** — if a row exists in `ie_page_user_override` for this user + page (and hasn't expired), use it.
2. **Check role default** — look up the user's role in `ie_page_role_access` for this page.
3. **No match = no access** — if neither exists, the user cannot see the page.

**Data scope** determines what data the user sees once they have access:

| Scope | What They See |
|---|---|
| ALL | All departments, all employees |
| DIVISION | Their department and all child departments in the hierarchy |
| DEPARTMENT | Only their own department |
| SELF | Only their own data |

### 6.5 Backend Middleware

```
authorizeInsights(pageKey)
```

An Express middleware function that:

1. Reads the authenticated user's ID and role from the request (existing auth system).
2. Resolves access and data scope using the logic above.
3. Attaches the resolved scope to `req.insightsScope` — an object containing `{ canAccess: boolean, dataScope: string, departmentKeys: number[], employeeKey: number | null }`.
4. Returns 403 if `canAccess` is false.
5. Downstream query builders use `req.insightsScope` to filter data automatically.

### 6.6 Frontend Hook

```typescript
useInsightsAccess(pageKey: string): {
  canAccess: boolean;
  dataScope: 'ALL' | 'DIVISION' | 'DEPARTMENT' | 'SELF';
  isLoading: boolean;
}
```

Called by each Insights page component on mount. Controls whether the page renders and what filter options are available (e.g., a DEPARTMENT-scoped user cannot switch to a different department).

---

## 7. Ingestion Pipeline Framework

The ingestion pipeline is how data flows from source systems into the Insights Engine. The framework defines the patterns; each section blueprint defines its specific workers.

### 7.1 Worker Pattern

Each data source gets its own independent ingestion worker — a Node.js process managed by PM2. Workers are isolated: if the Genesys worker fails, QA score ingestion continues unaffected.

**Worker responsibilities:**
1. Extract data from the source (Qtip DB query, API call, file parse, etc.)
2. Write raw data to the appropriate staging table (`ie_stg_*`)
3. Transform and load into fact tables (`ie_fact_*`), linking to shared dimensions
4. Log the run in `ie_ingestion_log`

**Worker lifecycle:**
- Triggered on a cron schedule (configured per worker in PM2 ecosystem file)
- Acquires a lock (database row lock) to prevent overlapping runs
- Processes data in batches (configurable batch size per worker)
- Writes a summary to the ingestion log on completion or failure

### 7.2 ie_ingestion_log

Tracks every ingestion run for observability and debugging.

```sql
CREATE TABLE ie_ingestion_log (
  id                INT           PRIMARY KEY AUTO_INCREMENT,
  worker_name       VARCHAR(50)   NOT NULL,          -- e.g., 'qtip-qa-sync', 'crm-sync'
  source_system     VARCHAR(30)   NOT NULL,          -- e.g., 'qtip', 'crm', 'genesys'
  run_started_at    DATETIME      NOT NULL,
  run_finished_at   DATETIME      NULL,
  status            ENUM('RUNNING','SUCCESS','PARTIAL','FAILED') NOT NULL DEFAULT 'RUNNING',
  rows_extracted    INT           NULL,
  rows_loaded       INT           NULL,
  rows_skipped      INT           NULL,
  rows_errored      INT           NULL,
  error_message     TEXT          NULL,
  batch_identifier  VARCHAR(100)  NULL,              -- e.g., date range processed, file name
  created_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_ingestion_worker ON ie_ingestion_log (worker_name, run_started_at DESC);
CREATE INDEX idx_ingestion_status ON ie_ingestion_log (status);
```

### 7.3 Data Freshness

Each page in the UI displays a "Data as of" indicator showing when the underlying data was last successfully ingested. This is derived from the most recent `SUCCESS` entry in `ie_ingestion_log` for the relevant `source_system`.

### 7.4 Ingestion Lock Table

Prevents overlapping worker runs.

```sql
CREATE TABLE ie_ingestion_lock (
  worker_name       VARCHAR(50)   PRIMARY KEY,
  locked_at         DATETIME      NOT NULL,
  locked_by         VARCHAR(100)  NOT NULL,          -- Hostname or process ID
  expires_at        DATETIME      NOT NULL            -- Auto-unlock after timeout (prevents dead locks)
);
```

### 7.5 Source System Adapters (Defined Per Section Blueprint)

Each section blueprint specifies which source systems it reads from and how:

| Source Type | Adapter Pattern |
|---|---|
| Qtip internal DB | Direct Prisma/SQL query against existing Qtip tables |
| Custom CRM | Direct SQL query (separate DB connection) |
| Genesys phone system | Direct query access |
| DeskTime | REST API calls |
| Paychex Flex | Parse CSV from email attachments |

The foundation provides the framework (worker pattern, logging, locking). The section blueprint provides the specific adapter code.

---

## 8. Aggregation Engine

### 8.1 Purpose

Dashboards need to render fast. Querying millions of fact table rows on every page load is not viable. The aggregation engine pre-computes rollups at standard time grains so dashboards read from small aggregate tables instead.

### 8.2 Standard Time Grains

Every aggregate table supports these grains:

| Grain | Use Case |
|---|---|
| Daily | Trend charts, day-over-day comparison |
| Weekly | Weekly team reviews, short-term trends |
| Monthly | Monthly reports, manager dashboards |
| Quarterly | Executive summaries, long-term trends |

### 8.3 Aggregate Table Standards

Each section blueprint defines its own aggregate tables. All must follow this structure:

```sql
-- Required columns in every ie_agg_* table
id                BIGINT        PRIMARY KEY AUTO_INCREMENT,
date_key          INT           NOT NULL,          -- Links to ie_dim_date.date_key
grain             ENUM('DAILY','WEEKLY','MONTHLY','QUARTERLY') NOT NULL,
department_key    INT           NOT NULL,          -- Links to ie_dim_department.department_key
employee_key      INT           NULL,              -- NULL for department-level aggregates

-- Section-specific measure columns go here (defined per blueprint)

record_count      INT           NOT NULL,          -- Number of source records in this aggregate
computed_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,

UNIQUE KEY uq_grain_date_dept_emp (grain, date_key, department_key, employee_key)
```

### 8.4 Rollup Worker

A single PM2-managed rollup worker runs on a schedule (nightly + on-demand). It:

1. Reads from fact tables for each active section
2. Computes aggregates at each time grain
3. Upserts into the section's aggregate tables
4. Handles department hierarchy rollups — a parent department's aggregate is the sum/average of its children's aggregates

The rollup worker is generic — it reads the KPI registry to know what to compute and where to store it. Section blueprints don't need their own rollup workers; they configure the central one.

---

## 9. Required Changes to Existing Qtip Schema

The foundation requires minimal changes to the existing Qtip database. These are additive — no existing columns are modified or removed.

### 9.1 Department Hierarchy

Add `parent_id` to the existing `Department` table:

```sql
ALTER TABLE Department ADD COLUMN parent_id INT NULL;
ALTER TABLE Department ADD CONSTRAINT fk_dept_parent FOREIGN KEY (parent_id) REFERENCES Department(id);
```

This enables the department hierarchy used by `ie_dim_department`. The existing flat department list continues to work — `parent_id` is nullable, so departments with no parent are top-level.

**Admin UI change:** Add a "Parent Department" dropdown to the existing department management page (`AdminDepartmentsPage.tsx`). Optional field — leave blank for top-level departments.

### 9.2 No Other Changes

No other modifications to existing Qtip tables are required. The Insights Engine reads from Qtip tables through its ingestion workers and writes only to `ie_*` tables.

---

## 10. Partition Manager

A lightweight PM2 worker that runs monthly (1st of each month at midnight).

**Responsibilities:**
1. Create partitions for the next 3 months on all `ie_fact_*` and `ie_stg_*` tables (ensures partitions always exist ahead of time).
2. Drop staging table partitions older than 90 days.
3. Drop fact table partitions older than 3 years (configurable per table).
4. Log actions to `ie_ingestion_log` with `worker_name = 'partition-manager'`.

---

## 11. Configuration Table

A simple key-value table for engine-wide settings.

```sql
CREATE TABLE ie_config (
  config_key        VARCHAR(50)   PRIMARY KEY,
  config_value      TEXT          NOT NULL,
  description       VARCHAR(255)  NULL,
  updated_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  updated_by        INT           NULL
);

-- Example rows:
-- ('retention_staging_days', '90', 'Days to keep staging data')
-- ('retention_fact_years', '3', 'Years to keep fact data')
-- ('aggregation_schedule', '0 2 * * *', 'Cron for nightly rollup')
-- ('partition_lookahead_months', '3', 'Months of partitions to create ahead')
```

---

## 12. Technology & Infrastructure

### 12.1 Database

MariaDB (already in use). All `ie_*` tables live in the same database as existing Qtip tables. No additional database server required.

### 12.2 Backend

Express.js 5.1.0 with Prisma 7.5.0 (already in use). New routes under `/api/insights/*`. New middleware `authorizeInsights()` layered on top of existing `authenticate()`.

For complex analytical queries that exceed Prisma's ergonomic limits, raw SQL via `prisma.$queryRawUnsafe()` is acceptable and expected. Fact table queries with dynamic dimension filters, group-by clauses, and formula evaluation will use raw SQL with parameterized inputs.

### 12.3 Frontend

React 19.1.0 with TypeScript (already in use). New routes under `/insights/*`. Charting with Recharts 2.15.3 and Tremor 3.18.7 (already in use). New `useInsightsAccess` hook for permission gating.

### 12.4 Ingestion Workers

Node.js scripts managed by PM2 (already in use for the Qtip app process). Each worker gets its own entry in the PM2 ecosystem file with its own cron schedule and restart policy.

### 12.5 Monitoring

- `ie_ingestion_log` for pipeline observability
- PM2 built-in process monitoring and restart
- Winston logger (already in use) for structured logging from workers
- Data freshness indicators on every Insights page

---

## 13. Foundation Build Checklist

This is the order of implementation for the foundation, before any section blueprint is built.

**Database:**
1. Add `parent_id` to existing Department table + admin UI dropdown
2. Create `ie_dim_date` and populate with 5 years of dates
3. Create `ie_dim_department` and run initial sync from Department table
4. Create `ie_dim_employee` and run initial sync from User table
5. Create `ie_kpi` and `ie_kpi_threshold`
6. Create `ie_page`, `ie_page_role_access`, `ie_page_user_override`
7. Create `ie_ingestion_log`, `ie_ingestion_lock`, `ie_config`

**Backend:**
8. `authorizeInsights(pageKey)` middleware
9. API endpoints: `GET /api/insights/pages` (navigation), `GET /api/insights/access/:pageKey` (permission check)
10. Dimension sync workers: department sync, employee sync (nightly cron)
11. Partition manager worker
12. Rollup worker skeleton (activated when first section is built)

**Frontend:**
13. `useInsightsAccess` hook
14. Insights navigation shell (sidebar/header with pages loaded from registry)
15. Empty Insights settings section for threshold management

---

## 14. Section Blueprint Template

When we're ready to build a section (Phase 1, Phase 2, etc.), the blueprint document answers these questions:

1. **Section name and category** — What is it called? Where does it sit in the nav?
2. **Business questions** — What questions should this section answer? (Plain language, not technical.)
3. **Data sources** — Which systems provide the raw data?
4. **Staging tables** — What does the raw data look like before transformation?
5. **Fact tables** — What events/measures are we tracking? What columns beyond the standard set?
6. **Additional dimensions** — Any new dimension tables needed beyond the shared ones?
7. **KPI definitions** — Each KPI: code, name, formula, format, direction, default thresholds.
8. **Aggregate tables** — What pre-computed rollups does the dashboard need?
9. **Report pages** — What pages exist? What does each page show?
10. **Permission defaults** — Which roles see which pages at what scope?
11. **Ingestion workers** — How many workers? What schedule? What source adapters?
12. **UI wireframes** — Layout sketches for each report page.

Additionally, each blueprint must declare:

13. **Time-of-day analysis** — Does this section need intraday granularity? If yes, the `ie_dim_time_of_day` table will be created (if not already built by a prior section).
14. **Rollup rules** — For each measure in the aggregate tables, how does it roll up? SUM, AVG, MAX, MIN, or COUNT? This is critical — you can SUM revenue but you must AVG percentages.
15. **Section-specific dimensions** — If the blueprint introduces a new dimension (e.g., `ie_dim_product` for sales), does it need SCD Type 2 historical tracking or is a simple lookup sufficient?

This template ensures every section is fully specified before code is written, without requiring the foundation spec to predict the specifics.

---

## Appendix A: Glossary

| Term | Meaning |
|---|---|
| Dimension | A lookup table providing context (who, what, when, where). Used for filtering and grouping. |
| Fact table | A table of events or measurements, linked to dimensions via foreign keys. The raw material for analytics. |
| SCD Type 2 | Slowly Changing Dimension. When a dimension value changes (e.g., employee changes department), the old row is closed with an end date and a new row is inserted. Historical reports use the row that was active at the time. |
| KPI | Key Performance Indicator. A named metric computed from fact/aggregate data, defined in the registry. |
| Grain | The time resolution of an aggregate (daily, weekly, monthly, quarterly). |
| Data scope | The permission level determining what subset of data a user sees: all, division, department, or self. |
| Staging | Temporary landing zone for raw imported data before it's cleaned and loaded into fact tables. |
| Partition | A physical subdivision of a table by month. Enables fast date-range queries and instant data archival. |
| Ingestion | The process of extracting data from a source system and loading it into the Insights Engine. |
| Section blueprint | A specification document for one analytics section (e.g., Quality & Training) that defines its specific tables, KPIs, and pages. |

---

## Appendix B: Revision History

| Version | Date | Changes |
|---|---|---|
| 1.0 | March 2026 | Initial architecture with specific table definitions |
| 1.1 | March 2026 | Added access control & page-level permissions |
| 2.0 | April 3, 2026 | Complete restructure: separated foundation (patterns) from section blueprints (specifics). Removed all phase-specific tables, KPIs, and report definitions from main spec. |
