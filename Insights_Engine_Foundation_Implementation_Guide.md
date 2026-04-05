# Qtip Insights Engine — Foundation Implementation Guide

**Purpose:** Step-by-step instructions for building the Insights Engine foundation. Each phase is self-contained. Complete and test each phase before starting the next. No phase-specific KPIs, fact tables, or report pages are included — this builds only the engine infrastructure.

**Reference:** See `Qtip_Insights_Engine_Foundation.md` for the full architectural spec and rationale.

---

## PROJECT CONTEXT

**Tech Stack:** React 19.1.0, TypeScript 5.8.3, Vite 6.3.5, Express.js 5.1.0, Prisma 7.5.0, MariaDB, PM2, TanStack React Query, Tailwind CSS 3.3.2, shadcn/ui, Recharts 2.15.3, Tremor 3.18.7, Winston logger

**Key Paths:**
- Backend root: `qtip/backend/`
- Frontend root: `qtip/frontend/`
- Prisma schema: `qtip/backend/prisma/schema.prisma`
- Migrations: `qtip/backend/prisma/migrations/`
- PM2 config: `qtip/ecosystem.config.cjs`
- Routes config: `qtip/frontend/src/config/routes.ts`
- Auth middleware: `qtip/backend/src/middleware/auth.ts`
- Hooks: `qtip/frontend/src/hooks/`
- Services (backend): `qtip/backend/src/services/`
- Services (frontend): `qtip/frontend/src/services/`
- Controllers: `qtip/backend/src/controllers/`
- Routes (backend): `qtip/backend/src/routes/`
- Pages: `qtip/frontend/src/pages/`

**Existing Patterns (MUST follow):**
- Backend services: Class-based with repository injection (see `AnalyticsService.ts`)
- Backend controllers: Module-level service instantiation, async/await, try/catch (see `auth.controller.ts`)
- Backend routes: Express router with middleware chain `authenticate → authorize → handler` with `as unknown as RequestHandler` casting (see `admin.routes.ts`)
- Backend repositories: Prisma queries with dbLogger, error handling (see `UserRepository.ts`)
- Frontend hooks: Function exports using `useAuth()` context (see `useQualityRole.ts`)
- Frontend pages: `useQuery` for data fetching, `useUrlFilters` for state, `useQualityRole` for permissions (see `SubmissionsPage.tsx`)
- Frontend services: API client functions with typed responses (see `qaService.ts`)
- Naming: Controllers `entity.controller.ts`, Routes `entity.routes.ts`, Services `EntityService.ts`, Repos `EntityRepository.ts`, Pages `EntityPage.tsx`, Hooks `useEntityName.ts`

**Table Namespace:** ALL Insights Engine tables use the `ie_` prefix. Never modify existing Qtip tables except where explicitly stated.

**Role IDs (from `useQualityRole.ts`):**
- ADMIN = 1, QA = 2, CSR = 3, TRAINER = 4, MANAGER = 5, DIRECTOR = 6

---

## PHASE 1: Database Schema — Shared Dimensions

**Goal:** Create the shared dimension tables that every future analytics section will reference. Add department hierarchy support.

### Step 1.1: Add parent_id to Department Table

Create a new Prisma migration:

```
Migration name: add_parent_id_to_department
```

**Migration SQL:**

```sql
-- Add parent_id column to existing Department table for hierarchy support
ALTER TABLE `Department` ADD COLUMN `parent_id` INT NULL AFTER `is_active`;
ALTER TABLE `Department` ADD CONSTRAINT `fk_department_parent` FOREIGN KEY (`parent_id`) REFERENCES `Department`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX `idx_department_parent` ON `Department` (`parent_id`);
```

**Update Prisma schema** — add to the existing `Department` model:

```prisma
model Department {
  // ... existing fields ...
  parent_id        Int?
  parent           Department?  @relation("DepartmentHierarchy", fields: [parent_id], references: [id], onDelete: SetNull)
  children         Department[] @relation("DepartmentHierarchy")
}
```

Run `npx prisma generate` after updating the schema.

### Step 1.2: Create ie_dim_date Table

Create a new Prisma migration:

```
Migration name: create_ie_dim_date
```

**Migration SQL:**

```sql
CREATE TABLE `ie_dim_date` (
  `date_key`        INT           NOT NULL,
  `full_date`       DATE          NOT NULL,
  `day_of_week`     TINYINT       NOT NULL,
  `day_name`        VARCHAR(10)   NOT NULL,
  `day_of_month`    TINYINT       NOT NULL,
  `day_of_year`     SMALLINT      NOT NULL,
  `week_of_year`    TINYINT       NOT NULL,
  `month_number`    TINYINT       NOT NULL,
  `month_name`      VARCHAR(10)   NOT NULL,
  `quarter`         TINYINT       NOT NULL,
  `year`            SMALLINT      NOT NULL,
  `is_weekend`      BOOLEAN       NOT NULL DEFAULT FALSE,
  `is_business_day` BOOLEAN       NOT NULL DEFAULT TRUE,
  `fiscal_year`     SMALLINT      NULL,
  `fiscal_quarter`  TINYINT       NULL,
  PRIMARY KEY (`date_key`),
  UNIQUE KEY `uq_dim_date_full` (`full_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### Step 1.3: Create ie_dim_department Table

Same migration or a new one:

```sql
CREATE TABLE `ie_dim_department` (
  `department_key`  INT           NOT NULL AUTO_INCREMENT,
  `department_id`   INT           NOT NULL,
  `department_name` VARCHAR(100)  NOT NULL,
  `parent_id`       INT           NULL,
  `hierarchy_level` TINYINT       NOT NULL DEFAULT 0,
  `hierarchy_path`  VARCHAR(500)  NULL,
  `is_active`       BOOLEAN       NOT NULL DEFAULT TRUE,
  `effective_from`  DATE          NOT NULL,
  `effective_to`    DATE          NULL,
  `is_current`      BOOLEAN       NOT NULL DEFAULT TRUE,
  PRIMARY KEY (`department_key`),
  INDEX `idx_dim_dept_current` (`is_current`, `is_active`),
  INDEX `idx_dim_dept_qtip_id` (`department_id`),
  CONSTRAINT `fk_dim_dept_parent` FOREIGN KEY (`parent_id`) REFERENCES `ie_dim_department`(`department_key`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### Step 1.4: Create ie_dim_employee Table

```sql
CREATE TABLE `ie_dim_employee` (
  `employee_key`    INT           NOT NULL AUTO_INCREMENT,
  `user_id`         INT           NOT NULL,
  `username`        VARCHAR(100)  NOT NULL,
  `email`           VARCHAR(255)  NULL,
  `role_name`       VARCHAR(50)   NOT NULL,
  `department_key`  INT           NULL,
  `manager_user_id` INT           NULL,
  `title`           VARCHAR(100)  NULL,
  `is_active`       BOOLEAN       NOT NULL DEFAULT TRUE,
  `effective_from`  DATE          NOT NULL,
  `effective_to`    DATE          NULL,
  `is_current`      BOOLEAN       NOT NULL DEFAULT TRUE,
  PRIMARY KEY (`employee_key`),
  INDEX `idx_dim_emp_current` (`is_current`, `is_active`),
  INDEX `idx_dim_emp_user_id` (`user_id`),
  INDEX `idx_dim_emp_dept` (`department_key`),
  CONSTRAINT `fk_dim_emp_dept` FOREIGN KEY (`department_key`) REFERENCES `ie_dim_department`(`department_key`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### Step 1.5: Populate ie_dim_date

Create a seed script at `qtip/backend/src/scripts/seed-date-dimension.ts`:

This script populates `ie_dim_date` with every day from 2024-01-01 through 2028-12-31 (5 years). For each date, compute:

- `date_key` = YYYYMMDD as integer (e.g., 20260403)
- `day_of_week` = 1 (Monday) through 7 (Sunday) using ISO convention
- `day_name` = full English name
- `week_of_year` = ISO week number
- `month_name` = full English name
- `quarter` = Math.ceil(month / 3)
- `is_weekend` = true if Saturday or Sunday
- `is_business_day` = true if NOT weekend. Also cross-reference the existing `BusinessCalendarDay` table — any date with `day_type` of HOLIDAY or CLOSURE should set `is_business_day = false`.
- `fiscal_year` and `fiscal_quarter` = NULL for now (set later if fiscal calendar differs from calendar year)

Use `prisma.$executeRawUnsafe()` with batch INSERT statements (500 rows per batch) for performance.

### Step 1.6: Initial Sync of ie_dim_department

Create a seed script at `qtip/backend/src/scripts/seed-department-dimension.ts`:

Read all rows from the existing `Department` table. For each department:

- `department_id` = Department.id
- `department_name` = Department.department_name
- `parent_id` = NULL initially (hierarchy configured later via admin UI)
- `hierarchy_level` = 0 (updated when hierarchy is configured)
- `hierarchy_path` = '/' + department_name
- `is_active` = Department.is_active
- `effective_from` = today's date
- `effective_to` = NULL
- `is_current` = true

### Step 1.7: Initial Sync of ie_dim_employee

Create a seed script at `qtip/backend/src/scripts/seed-employee-dimension.ts`:

Read all rows from the existing `User` table with their `Role` and `Department` relationships. For each user:

- `user_id` = User.id
- `username` = User.username
- `email` = User.email
- `role_name` = User.role.role_name
- `department_key` = look up the matching `ie_dim_department` row by `department_id` where `is_current = true`. NULL if user has no department.
- `manager_user_id` = User.manager_id
- `title` = User.title
- `is_active` = User.is_active
- `effective_from` = today's date
- `effective_to` = NULL
- `is_current` = true

### Step 1.8: Add Dimension Models to Prisma Schema

Add these models to `schema.prisma` so Prisma is aware of them. Since these tables are created via raw SQL migrations (not Prisma's standard migration flow), use `@@map` to map to the exact table names:

```prisma
model IeDimDate {
  date_key        Int       @id
  full_date       DateTime  @unique @db.Date
  day_of_week     Int       @db.TinyInt
  day_name        String    @db.VarChar(10)
  day_of_month    Int       @db.TinyInt
  day_of_year     Int       @db.SmallInt
  week_of_year    Int       @db.TinyInt
  month_number    Int       @db.TinyInt
  month_name      String    @db.VarChar(10)
  quarter         Int       @db.TinyInt
  year            Int       @db.SmallInt
  is_weekend      Boolean   @default(false)
  is_business_day Boolean   @default(true)
  fiscal_year     Int?      @db.SmallInt
  fiscal_quarter  Int?      @db.TinyInt

  @@map("ie_dim_date")
}

model IeDimDepartment {
  department_key  Int       @id @default(autoincrement())
  department_id   Int
  department_name String    @db.VarChar(100)
  parent_id       Int?
  hierarchy_level Int       @default(0) @db.TinyInt
  hierarchy_path  String?   @db.VarChar(500)
  is_active       Boolean   @default(true)
  effective_from  DateTime  @db.Date
  effective_to    DateTime? @db.Date
  is_current      Boolean   @default(true)

  parent          IeDimDepartment?  @relation("DimDeptHierarchy", fields: [parent_id], references: [department_key], onDelete: SetNull)
  children        IeDimDepartment[] @relation("DimDeptHierarchy")
  employees       IeDimEmployee[]

  @@index([is_current, is_active], name: "idx_dim_dept_current")
  @@index([department_id], name: "idx_dim_dept_qtip_id")
  @@map("ie_dim_department")
}

model IeDimEmployee {
  employee_key    Int       @id @default(autoincrement())
  user_id         Int
  username        String    @db.VarChar(100)
  email           String?   @db.VarChar(255)
  role_name       String    @db.VarChar(50)
  department_key  Int?
  manager_user_id Int?
  title           String?   @db.VarChar(100)
  is_active       Boolean   @default(true)
  effective_from  DateTime  @db.Date
  effective_to    DateTime? @db.Date
  is_current      Boolean   @default(true)

  department      IeDimDepartment? @relation(fields: [department_key], references: [department_key], onDelete: SetNull)

  @@index([is_current, is_active], name: "idx_dim_emp_current")
  @@index([user_id], name: "idx_dim_emp_user_id")
  @@index([department_key], name: "idx_dim_emp_dept")
  @@map("ie_dim_employee")
}
```

### Step 1.9: Validation

After completing Phase 1:

1. Run `npx prisma migrate deploy` — all migrations should apply cleanly
2. Run `npx prisma generate` — Prisma client should regenerate without errors
3. Run the date seed script — verify `ie_dim_date` has 1,827 rows (5 years × ~365.25 days)
4. Run the department seed script — verify `ie_dim_department` row count matches `Department` table
5. Run the employee seed script — verify `ie_dim_employee` row count matches `User` table
6. Verify `Department` table now has `parent_id` column (should be NULL for all rows)
7. Run existing Qtip tests to confirm nothing is broken

---

## PHASE 2: Database Schema — KPI Registry & Permissions

**Goal:** Create the KPI registry, threshold system, page registry, and permission tables.

### Step 2.1: Create ie_kpi Table

New Prisma migration:

```
Migration name: create_ie_kpi_and_threshold
```

```sql
CREATE TABLE `ie_kpi` (
  `id`              INT           NOT NULL AUTO_INCREMENT,
  `kpi_code`        VARCHAR(50)   NOT NULL,
  `kpi_name`        VARCHAR(100)  NOT NULL,
  `description`     TEXT          NULL,
  `category`        VARCHAR(50)   NOT NULL,
  `formula_type`    ENUM('SQL','DERIVED','COMPOSITE') NOT NULL DEFAULT 'SQL',
  `formula`         TEXT          NOT NULL,
  `source_table`    VARCHAR(100)  NULL,
  `format_type`     ENUM('PERCENT','NUMBER','CURRENCY','DURATION','RATIO') NOT NULL,
  `decimal_places`  TINYINT       NOT NULL DEFAULT 1,
  `direction`       ENUM('UP_IS_GOOD','DOWN_IS_GOOD','NEUTRAL') NOT NULL,
  `unit_label`      VARCHAR(20)   NULL,
  `is_active`       BOOLEAN       NOT NULL DEFAULT TRUE,
  `sort_order`      INT           NOT NULL DEFAULT 0,
  `created_at`      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `created_by`      INT           NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_kpi_code` (`kpi_code`),
  INDEX `idx_kpi_category` (`category`, `is_active`, `sort_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### Step 2.2: Create ie_kpi_threshold Table

```sql
CREATE TABLE `ie_kpi_threshold` (
  `id`              INT           NOT NULL AUTO_INCREMENT,
  `kpi_id`          INT           NOT NULL,
  `department_key`  INT           NULL,
  `goal_value`      DECIMAL(12,4) NULL,
  `warning_value`   DECIMAL(12,4) NULL,
  `critical_value`  DECIMAL(12,4) NULL,
  `effective_from`  DATE          NOT NULL,
  `effective_to`    DATE          NULL,
  `created_at`      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_kpi_dept_effective` (`kpi_id`, `department_key`, `effective_from`),
  CONSTRAINT `fk_threshold_kpi` FOREIGN KEY (`kpi_id`) REFERENCES `ie_kpi`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_threshold_dept` FOREIGN KEY (`department_key`) REFERENCES `ie_dim_department`(`department_key`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### Step 2.3: Create ie_page Table

```sql
CREATE TABLE `ie_page` (
  `id`              INT           NOT NULL AUTO_INCREMENT,
  `page_key`        VARCHAR(50)   NOT NULL,
  `page_name`       VARCHAR(100)  NOT NULL,
  `description`     TEXT          NULL,
  `category`        VARCHAR(50)   NOT NULL,
  `route_path`      VARCHAR(200)  NOT NULL,
  `icon`            VARCHAR(50)   NULL,
  `sort_order`      INT           NOT NULL DEFAULT 0,
  `is_active`       BOOLEAN       NOT NULL DEFAULT TRUE,
  `requires_section` VARCHAR(50)  NULL,
  `created_at`      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_page_key` (`page_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### Step 2.4: Create ie_page_role_access Table

```sql
CREATE TABLE `ie_page_role_access` (
  `id`              INT           NOT NULL AUTO_INCREMENT,
  `page_id`         INT           NOT NULL,
  `role_id`         INT           NOT NULL,
  `can_access`      BOOLEAN       NOT NULL DEFAULT FALSE,
  `data_scope`      ENUM('ALL','DIVISION','DEPARTMENT','SELF') NOT NULL DEFAULT 'SELF',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_page_role` (`page_id`, `role_id`),
  CONSTRAINT `fk_page_role_page` FOREIGN KEY (`page_id`) REFERENCES `ie_page`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_page_role_role` FOREIGN KEY (`role_id`) REFERENCES `Role`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### Step 2.5: Create ie_page_user_override Table

```sql
CREATE TABLE `ie_page_user_override` (
  `id`              INT           NOT NULL AUTO_INCREMENT,
  `page_id`         INT           NOT NULL,
  `user_id`         INT           NOT NULL,
  `can_access`      BOOLEAN       NOT NULL,
  `data_scope`      ENUM('ALL','DIVISION','DEPARTMENT','SELF') NULL,
  `granted_by`      INT           NOT NULL,
  `granted_at`      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `expires_at`      DATETIME      NULL,
  `reason`          VARCHAR(255)  NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_page_user` (`page_id`, `user_id`),
  CONSTRAINT `fk_override_page` FOREIGN KEY (`page_id`) REFERENCES `ie_page`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_override_user` FOREIGN KEY (`user_id`) REFERENCES `User`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_override_granter` FOREIGN KEY (`granted_by`) REFERENCES `User`(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### Step 2.6: Add Prisma Models

Add to `schema.prisma`:

```prisma
model IeKpi {
  id             Int       @id @default(autoincrement())
  kpi_code       String    @unique @db.VarChar(50)
  kpi_name       String    @db.VarChar(100)
  description    String?   @db.Text
  category       String    @db.VarChar(50)
  formula_type   String    @default("SQL") @db.VarChar(10)
  formula        String    @db.Text
  source_table   String?   @db.VarChar(100)
  format_type    String    @db.VarChar(10)
  decimal_places Int       @default(1) @db.TinyInt
  direction      String    @db.VarChar(15)
  unit_label     String?   @db.VarChar(20)
  is_active      Boolean   @default(true)
  sort_order     Int       @default(0)
  created_at     DateTime  @default(now())
  updated_at     DateTime  @updatedAt
  created_by     Int?

  thresholds     IeKpiThreshold[]

  @@index([category, is_active, sort_order], name: "idx_kpi_category")
  @@map("ie_kpi")
}

model IeKpiThreshold {
  id             Int       @id @default(autoincrement())
  kpi_id         Int
  department_key Int?
  goal_value     Decimal?  @db.Decimal(12, 4)
  warning_value  Decimal?  @db.Decimal(12, 4)
  critical_value Decimal?  @db.Decimal(12, 4)
  effective_from DateTime  @db.Date
  effective_to   DateTime? @db.Date
  created_at     DateTime  @default(now())
  updated_at     DateTime  @updatedAt

  kpi            IeKpi     @relation(fields: [kpi_id], references: [id], onDelete: Cascade)
  department     IeDimDepartment? @relation(fields: [department_key], references: [department_key], onDelete: SetNull)

  @@unique([kpi_id, department_key, effective_from], name: "uq_kpi_dept_effective")
  @@map("ie_kpi_threshold")
}

model IePage {
  id              Int       @id @default(autoincrement())
  page_key        String    @unique @db.VarChar(50)
  page_name       String    @db.VarChar(100)
  description     String?   @db.Text
  category        String    @db.VarChar(50)
  route_path      String    @db.VarChar(200)
  icon            String?   @db.VarChar(50)
  sort_order      Int       @default(0)
  is_active       Boolean   @default(true)
  requires_section String?  @db.VarChar(50)
  created_at      DateTime  @default(now())

  role_access     IePageRoleAccess[]
  user_overrides  IePageUserOverride[]

  @@map("ie_page")
}

model IePageRoleAccess {
  id         Int     @id @default(autoincrement())
  page_id    Int
  role_id    Int
  can_access Boolean @default(false)
  data_scope String  @default("SELF") @db.VarChar(10)

  page       IePage  @relation(fields: [page_id], references: [id], onDelete: Cascade)
  role       Role    @relation(fields: [role_id], references: [id], onDelete: Cascade)

  @@unique([page_id, role_id], name: "uq_page_role")
  @@map("ie_page_role_access")
}

model IePageUserOverride {
  id         Int       @id @default(autoincrement())
  page_id    Int
  user_id    Int
  can_access Boolean
  data_scope String?   @db.VarChar(10)
  granted_by Int
  granted_at DateTime  @default(now())
  expires_at DateTime?
  reason     String?   @db.VarChar(255)

  page       IePage    @relation(fields: [page_id], references: [id], onDelete: Cascade)
  user       User      @relation("InsightsOverrideUser", fields: [user_id], references: [id], onDelete: Cascade)
  granter    User      @relation("InsightsOverrideGranter", fields: [granted_by], references: [id])

  @@unique([page_id, user_id], name: "uq_page_user")
  @@map("ie_page_user_override")
}
```

**IMPORTANT:** You will also need to add the reverse relations to the existing `Role` model and `User` model in schema.prisma:

In the `Role` model, add:
```prisma
  insightsPageAccess IePageRoleAccess[]
```

In the `User` model, add:
```prisma
  insightsOverrides       IePageUserOverride[] @relation("InsightsOverrideUser")
  insightsOverridesGranted IePageUserOverride[] @relation("InsightsOverrideGranter")
```

Also add to `IeDimDepartment` model:
```prisma
  thresholds  IeKpiThreshold[]
```

### Step 2.7: Validation

1. Run `npx prisma migrate deploy` — all migrations apply
2. Run `npx prisma generate` — no errors
3. Verify all 6 new tables exist: `ie_kpi`, `ie_kpi_threshold`, `ie_page`, `ie_page_role_access`, `ie_page_user_override`
4. Verify foreign keys by inserting a test row into `ie_page`, then a row into `ie_page_role_access` referencing it — should succeed. Insert with an invalid `page_id` — should fail with FK constraint error.
5. Clean up test rows
6. Run existing Qtip tests

---

## PHASE 3: Database Schema — Ingestion & Configuration

**Goal:** Create the ingestion logging, locking, and configuration tables.

### Step 3.1: Create ie_ingestion_log Table

New migration:

```
Migration name: create_ie_ingestion_and_config
```

```sql
CREATE TABLE `ie_ingestion_log` (
  `id`              INT           NOT NULL AUTO_INCREMENT,
  `worker_name`     VARCHAR(50)   NOT NULL,
  `source_system`   VARCHAR(30)   NOT NULL,
  `run_started_at`  DATETIME      NOT NULL,
  `run_finished_at` DATETIME      NULL,
  `status`          ENUM('RUNNING','SUCCESS','PARTIAL','FAILED') NOT NULL DEFAULT 'RUNNING',
  `rows_extracted`  INT           NULL,
  `rows_loaded`     INT           NULL,
  `rows_skipped`    INT           NULL,
  `rows_errored`    INT           NULL,
  `error_message`   TEXT          NULL,
  `batch_identifier` VARCHAR(100) NULL,
  `created_at`      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_ingestion_worker` (`worker_name`, `run_started_at` DESC),
  INDEX `idx_ingestion_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### Step 3.2: Create ie_ingestion_lock Table

```sql
CREATE TABLE `ie_ingestion_lock` (
  `worker_name`     VARCHAR(50)   NOT NULL,
  `locked_at`       DATETIME      NOT NULL,
  `locked_by`       VARCHAR(100)  NOT NULL,
  `expires_at`      DATETIME      NOT NULL,
  PRIMARY KEY (`worker_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### Step 3.3: Create ie_config Table

```sql
CREATE TABLE `ie_config` (
  `config_key`      VARCHAR(50)   NOT NULL,
  `config_value`    TEXT          NOT NULL,
  `description`     VARCHAR(255)  NULL,
  `updated_at`      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `updated_by`      INT           NULL,
  PRIMARY KEY (`config_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed default configuration values
INSERT INTO `ie_config` (`config_key`, `config_value`, `description`) VALUES
  ('retention_staging_days', '90', 'Number of days to keep staging table data before purging'),
  ('retention_fact_years', '3', 'Number of years to keep fact table data before archiving'),
  ('aggregation_schedule', '0 2 * * *', 'Cron expression for nightly aggregation rollup worker'),
  ('partition_lookahead_months', '3', 'Number of months of partitions to create ahead of current date'),
  ('dimension_sync_schedule', '0 1 * * *', 'Cron expression for nightly dimension sync from Qtip tables'),
  ('data_freshness_warning_hours', '24', 'Hours since last successful ingestion before showing a warning');
```

### Step 3.4: Add Prisma Models

```prisma
model IeIngestionLog {
  id               Int       @id @default(autoincrement())
  worker_name      String    @db.VarChar(50)
  source_system    String    @db.VarChar(30)
  run_started_at   DateTime
  run_finished_at  DateTime?
  status           String    @default("RUNNING") @db.VarChar(10)
  rows_extracted   Int?
  rows_loaded      Int?
  rows_skipped     Int?
  rows_errored     Int?
  error_message    String?   @db.Text
  batch_identifier String?   @db.VarChar(100)
  created_at       DateTime  @default(now())

  @@index([worker_name, run_started_at(sort: Desc)], name: "idx_ingestion_worker")
  @@index([status], name: "idx_ingestion_status")
  @@map("ie_ingestion_log")
}

model IeIngestionLock {
  worker_name String   @id @db.VarChar(50)
  locked_at   DateTime
  locked_by   String   @db.VarChar(100)
  expires_at  DateTime

  @@map("ie_ingestion_lock")
}

model IeConfig {
  config_key   String   @id @db.VarChar(50)
  config_value String   @db.Text
  description  String?  @db.VarChar(255)
  updated_at   DateTime @updatedAt
  updated_by   Int?

  @@map("ie_config")
}
```

### Step 3.5: Validation

1. Run migrations — all apply
2. Run `npx prisma generate`
3. Verify `ie_config` has 6 default rows
4. Verify `ie_ingestion_log` and `ie_ingestion_lock` tables exist and are empty
5. Run existing Qtip tests

---

## PHASE 4: Backend — Permission Middleware & API

**Goal:** Build the `authorizeInsights` middleware, the permission resolution service, and the core Insights API endpoints.

### Step 4.1: Create Insights Permission Service

Create file: `qtip/backend/src/services/InsightsPermissionService.ts`

This service resolves a user's access and data scope for a given Insights page.

**Class: `InsightsPermissionService`**

**Method: `resolveAccess(userId: number, roleId: number, pageKey: string): Promise<InsightsAccessResult>`**

Logic:
1. Look up the `ie_page` row by `page_key`. If not found or `is_active = false`, return `{ canAccess: false }`.
2. Check `ie_page_user_override` for a row matching `page_id` + `user_id` where `expires_at` is NULL or in the future. If found, use its `can_access` and `data_scope`.
3. If no override, check `ie_page_role_access` for a row matching `page_id` + `role_id`. Use its `can_access` and `data_scope`.
4. If no role access row exists, return `{ canAccess: false }`.
5. If `can_access` is true, resolve the `departmentKeys` array based on `data_scope`:
   - `ALL`: return empty array (no filter needed — query all departments)
   - `DIVISION`: look up the user's department_key from `ie_dim_employee` (where `user_id` matches and `is_current = true`), then get that employee's `department_key`, then use the recursive CTE query below to get all descendant department_keys including the user's own:
     ```sql
     WITH RECURSIVE dept_tree AS (
       SELECT department_key FROM ie_dim_department WHERE department_key = ? AND is_current = TRUE
       UNION ALL
       SELECT d.department_key FROM ie_dim_department d
       INNER JOIN dept_tree dt ON d.parent_id = dt.department_key
       WHERE d.is_current = TRUE
     )
     SELECT department_key FROM dept_tree;
     ```
     Use the shared utility from `qtip/backend/src/utils/departmentHierarchy.ts` (created in Phase 6, Step 6.7d).
   - `DEPARTMENT`: look up the user's department_key from `ie_dim_employee`, return array with just that key
   - `SELF`: return the user's `employee_key` from `ie_dim_employee` (where `user_id` matches and `is_current = true`)

**Return type:**
```typescript
interface InsightsAccessResult {
  canAccess: boolean;
  dataScope: 'ALL' | 'DIVISION' | 'DEPARTMENT' | 'SELF' | null;
  departmentKeys: number[];  // empty for ALL scope
  employeeKey: number | null; // populated for SELF scope
  pageId: number | null;
}
```

### Step 4.2: Create Insights Authorization Middleware

Create file: `qtip/backend/src/middleware/insightsAuth.ts`

**Follow the exact pattern from `auth.ts`.**

```typescript
import { Request, Response, NextFunction } from 'express';
import { InsightsPermissionService } from '../services/InsightsPermissionService';

const permissionService = new InsightsPermissionService();

// Extend Express Request type
declare global {
  namespace Express {
    interface Request {
      insightsScope?: {
        canAccess: boolean;
        dataScope: 'ALL' | 'DIVISION' | 'DEPARTMENT' | 'SELF';
        departmentKeys: number[];
        employeeKey: number | null;
        pageId: number;
      };
    }
  }
}

export const authorizeInsights = (pageKey: string) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      const roleId = await getRoleId(req.user.user_id); // Look up from User table
      const access = await permissionService.resolveAccess(
        req.user.user_id,
        roleId,
        pageKey
      );

      if (!access.canAccess) {
        res.status(403).json({ error: 'Access denied to this insights page' });
        return;
      }

      req.insightsScope = {
        canAccess: true,
        dataScope: access.dataScope!,
        departmentKeys: access.departmentKeys,
        employeeKey: access.employeeKey,
        pageId: access.pageId!,
      };

      next();
    } catch (error: any) {
      res.status(500).json({ error: 'Permission check failed' });
    }
  };
};
```

### Step 4.3: Create Insights Controller

Create file: `qtip/backend/src/controllers/insights.controller.ts`

**Endpoints:**

1. `getInsightsNavigation` — Returns all pages the current user can access, grouped by category. Used to build the Insights sidebar navigation.
   - Query `ie_page` joined with `ie_page_role_access` (and check overrides) for the current user
   - Return array of `{ page_key, page_name, category, route_path, icon, sort_order }`
   - Group by category, sort by sort_order within each category

2. `getInsightsAccess` — Returns the user's access and scope for a specific page.
   - Takes `pageKey` as URL parameter
   - Returns `{ canAccess, dataScope }`
   - Used by the frontend `useInsightsAccess` hook

3. `getDataFreshness` — Returns last successful ingestion time per source system.
   - Query `ie_ingestion_log` for the most recent `SUCCESS` row per `source_system`
   - Return array of `{ source_system, last_success_at, hours_since }`

### Step 4.4: Create Insights Routes

Create file: `qtip/backend/src/routes/insights.routes.ts`

```typescript
import express, { RequestHandler } from 'express';
import { authenticate } from '../middleware/auth';
import {
  getInsightsNavigation,
  getInsightsAccess,
  getDataFreshness
} from '../controllers/insights.controller';

const router = express.Router();

// All insights routes require authentication
router.get('/navigation',
  authenticate as unknown as RequestHandler,
  getInsightsNavigation as unknown as RequestHandler
);

router.get('/access/:pageKey',
  authenticate as unknown as RequestHandler,
  getInsightsAccess as unknown as RequestHandler
);

router.get('/data-freshness',
  authenticate as unknown as RequestHandler,
  getDataFreshness as unknown as RequestHandler
);

export default router;
```

**Register in the main Express app** (in `backend/src/index.ts` or wherever routes are mounted):

```typescript
import insightsRoutes from './routes/insights.routes';
app.use('/api/insights', insightsRoutes);
```

### Step 4.5: Create KPI Admin Endpoints

Create file: `qtip/backend/src/controllers/insightsAdmin.controller.ts`
Create file: `qtip/backend/src/routes/insightsAdmin.routes.ts`

These are admin-only endpoints for managing the Insights Engine configuration.

**Endpoints:**

1. `GET /api/insights/admin/kpis` — List all KPIs with their thresholds (admin only)
2. `POST /api/insights/admin/kpis` — Create a new KPI (admin only)
3. `PUT /api/insights/admin/kpis/:id` — Update a KPI (admin only)
4. `GET /api/insights/admin/kpis/:id/thresholds` — Get thresholds for a KPI
5. `POST /api/insights/admin/kpis/:id/thresholds` — Set a threshold for a KPI + department
6. `GET /api/insights/admin/pages` — List all pages with role access (admin only)
7. `PUT /api/insights/admin/pages/:id/access` — Update role access for a page (admin only)
8. `GET /api/insights/admin/pages/:id/overrides` — List user overrides for a page
9. `POST /api/insights/admin/pages/:id/overrides` — Create a user override
10. `DELETE /api/insights/admin/pages/:id/overrides/:overrideId` — Remove a user override

**Routes:**

```typescript
import express, { RequestHandler } from 'express';
import { authenticate, authorizeAdmin } from '../middleware/auth';
import { /* all controller functions */ } from '../controllers/insightsAdmin.controller';

const router = express.Router();

// All admin routes require authenticate + authorizeAdmin
router.get('/kpis', authenticate as unknown as RequestHandler, authorizeAdmin as unknown as RequestHandler, listKpis as unknown as RequestHandler);
router.post('/kpis', authenticate as unknown as RequestHandler, authorizeAdmin as unknown as RequestHandler, createKpi as unknown as RequestHandler);
router.put('/kpis/:id', authenticate as unknown as RequestHandler, authorizeAdmin as unknown as RequestHandler, updateKpi as unknown as RequestHandler);
router.get('/kpis/:id/thresholds', authenticate as unknown as RequestHandler, authorizeAdmin as unknown as RequestHandler, getThresholds as unknown as RequestHandler);
router.post('/kpis/:id/thresholds', authenticate as unknown as RequestHandler, authorizeAdmin as unknown as RequestHandler, setThreshold as unknown as RequestHandler);
router.get('/pages', authenticate as unknown as RequestHandler, authorizeAdmin as unknown as RequestHandler, listPages as unknown as RequestHandler);
router.put('/pages/:id/access', authenticate as unknown as RequestHandler, authorizeAdmin as unknown as RequestHandler, updatePageAccess as unknown as RequestHandler);
router.get('/pages/:id/overrides', authenticate as unknown as RequestHandler, authorizeAdmin as unknown as RequestHandler, listOverrides as unknown as RequestHandler);
router.post('/pages/:id/overrides', authenticate as unknown as RequestHandler, authorizeAdmin as unknown as RequestHandler, createOverride as unknown as RequestHandler);
router.delete('/pages/:id/overrides/:overrideId', authenticate as unknown as RequestHandler, authorizeAdmin as unknown as RequestHandler, deleteOverride as unknown as RequestHandler);

export default router;
```

Register: `app.use('/api/insights/admin', insightsAdminRoutes);`

### Step 4.6: Validation

1. Start the backend server
2. Test `GET /api/insights/navigation` with an authenticated user — should return empty array (no pages registered yet)
3. Test `GET /api/insights/access/nonexistent` — should return `{ canAccess: false }`
4. Test `GET /api/insights/data-freshness` — should return empty array
5. Test `POST /api/insights/admin/kpis` as admin — should create a KPI
6. Test `POST /api/insights/admin/kpis` as non-admin — should return 403
7. Run existing Qtip tests to confirm nothing is broken

---

## PHASE 5: Backend — Dimension Sync Workers

**Goal:** Create the nightly workers that keep `ie_dim_department` and `ie_dim_employee` in sync with the live Qtip tables, and sync business calendar holidays into `ie_dim_date`.

### Step 5.1: Create Base Worker Class

Create file: `qtip/backend/src/workers/BaseInsightsWorker.ts`

This is the reusable pattern for all ingestion/sync workers:

```typescript
import prisma from '../config/prisma';
import { createLogger } from 'winston';

export abstract class BaseInsightsWorker {
  protected workerName: string;
  protected sourceSystem: string;
  protected logger: ReturnType<typeof createLogger>;

  constructor(workerName: string, sourceSystem: string) {
    this.workerName = workerName;
    this.sourceSystem = sourceSystem;
    // Initialize winston logger for this worker
  }

  async run(): Promise<void> {
    // 1. Try to acquire lock (INSERT into ie_ingestion_lock, fail if exists and not expired)
    // 2. Create ie_ingestion_log entry with status = RUNNING
    // 3. Call this.execute() (implemented by subclass)
    // 4. Update ie_ingestion_log with status = SUCCESS and row counts
    // 5. Release lock (DELETE from ie_ingestion_lock)
    // On error: update log with status = FAILED and error_message, release lock
  }

  protected abstract execute(): Promise<WorkerResult>;

  private async acquireLock(): Promise<boolean> {
    // INSERT into ie_ingestion_lock with expires_at = now + 1 hour
    // If row already exists and expires_at > now, return false (another instance running)
    // If row exists but expired, DELETE it and INSERT new one
  }

  private async releaseLock(): Promise<void> {
    // DELETE FROM ie_ingestion_lock WHERE worker_name = this.workerName
  }
}

interface WorkerResult {
  rowsExtracted: number;
  rowsLoaded: number;
  rowsSkipped: number;
  rowsErrored: number;
  batchIdentifier?: string;
}
```

### Step 5.2: Create Department Sync Worker

Create file: `qtip/backend/src/workers/DepartmentSyncWorker.ts`

Extends `BaseInsightsWorker`. Worker name: `'dimension-dept-sync'`, source system: `'qtip'`.

**execute() logic:**

1. Read all departments from Qtip `Department` table (including the new `parent_id` column)
2. Read all current dimension rows from `ie_dim_department` where `is_current = true`
3. For each Qtip department:
   - If no matching `department_id` in dimension table → INSERT new row (effective_from = today, is_current = true)
   - If matching row exists but `department_name`, `parent_id`, or `is_active` has changed → close old row (set effective_to = yesterday, is_current = false) and INSERT new row with updated values
   - If matching row exists and nothing changed → skip
4. Recompute `hierarchy_level` and `hierarchy_path` for all current rows based on `parent_id` chain
5. Return counts

### Step 5.3: Create Employee Sync Worker

Create file: `qtip/backend/src/workers/EmployeeSyncWorker.ts`

Extends `BaseInsightsWorker`. Worker name: `'dimension-emp-sync'`, source system: `'qtip'`.

**execute() logic:**

1. Read all users from Qtip `User` table with their Role and Department relationships
2. Read all current dimension rows from `ie_dim_employee` where `is_current = true`
3. For each Qtip user:
   - If no matching `user_id` → INSERT new row
   - If matching row exists but `role_name`, `department_key`, `manager_user_id`, `title`, or `is_active` has changed → SCD Type 2 (close old, insert new)
   - If nothing changed → skip
4. For `department_key`: look up `ie_dim_department` by `department_id` where `is_current = true`
5. Return counts

### Step 5.4: Create Business Calendar Sync Worker

Create file: `qtip/backend/src/workers/BusinessCalendarSyncWorker.ts`

Extends `BaseInsightsWorker`. Worker name: `'dimension-calendar-sync'`, source system: `'qtip'`.

**execute() logic:**

1. Read all rows from Qtip `BusinessCalendarDay` table where `day_type` is HOLIDAY or CLOSURE
2. For each one, update `ie_dim_date` set `is_business_day = false` where `full_date` matches `calendar_date`
3. Also reset any `ie_dim_date` rows back to `is_business_day = true` if they were previously marked false (from a removed holiday) but are no longer in the BusinessCalendarDay table as HOLIDAY/CLOSURE and are not weekends
4. Return counts

### Step 5.5: Create Worker Runner Scripts

Create standalone entry-point scripts that PM2 will execute:

- `qtip/backend/src/workers/run-dept-sync.ts` — Instantiates DepartmentSyncWorker and calls run()
- `qtip/backend/src/workers/run-emp-sync.ts` — Instantiates EmployeeSyncWorker and calls run()
- `qtip/backend/src/workers/run-calendar-sync.ts` — Instantiates BusinessCalendarSyncWorker and calls run()

Each script should:
1. Import the worker class
2. Create an instance
3. Call `await worker.run()`
4. Exit with code 0 on success, 1 on failure

### Step 5.6: Add Workers to PM2 Ecosystem Config

Update `qtip/ecosystem.config.cjs` to add the sync workers:

```javascript
// Add these to the apps array alongside the existing qtip-backend entry
{
  name: 'ie-dept-sync',
  script: './backend/dist/workers/run-dept-sync.js',
  cron_restart: '0 1 * * *',  // 1:00 AM daily
  watch: false,
  autorestart: false,          // Don't auto-restart — cron handles scheduling
  env: { NODE_ENV: 'production' }
},
{
  name: 'ie-emp-sync',
  script: './backend/dist/workers/run-emp-sync.js',
  cron_restart: '10 1 * * *', // 1:10 AM daily (staggered)
  watch: false,
  autorestart: false,
  env: { NODE_ENV: 'production' }
},
{
  name: 'ie-calendar-sync',
  script: './backend/dist/workers/run-calendar-sync.js',
  cron_restart: '20 1 * * *', // 1:20 AM daily (staggered)
  watch: false,
  autorestart: false,
  env: { NODE_ENV: 'production' }
}
```

### Step 5.7: Validation

1. Build the TypeScript workers: `npx tsc`
2. Run each worker manually: `node dist/workers/run-dept-sync.js` — should log success and create an entry in `ie_ingestion_log`
3. Run `node dist/workers/run-emp-sync.js` — same
4. Run `node dist/workers/run-calendar-sync.js` — same
5. Verify `ie_ingestion_log` has 3 rows with status = SUCCESS
6. Verify `ie_ingestion_lock` is empty (locks released after each run)
7. Run the dept sync again — since nothing changed, `rows_loaded` should be 0
8. Manually change a department name in the Qtip `Department` table, run dept sync again — should create a new dimension row with updated name and close the old one (check `effective_to` and `is_current`)
9. Run existing Qtip tests

---

## PHASE 6: Frontend — Navigation Shell & Permissions Hook

**Goal:** Build the frontend Insights navigation, permission hook, and the empty shell that future section pages will plug into.

### Step 6.1: Create useInsightsAccess Hook

Create file: `qtip/frontend/src/hooks/useInsightsAccess.ts`

```typescript
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';

interface InsightsAccess {
  canAccess: boolean;
  dataScope: 'ALL' | 'DIVISION' | 'DEPARTMENT' | 'SELF';
  isLoading: boolean;
  error: Error | null;
}

export function useInsightsAccess(pageKey: string): InsightsAccess {
  const { user } = useAuth();

  const { data, isLoading, error } = useQuery({
    queryKey: ['insights-access', pageKey, user?.id],
    queryFn: async () => {
      const response = await fetch(`/api/insights/access/${pageKey}`, {
        headers: { Authorization: `Bearer ${/* token from auth context */}` },
      });
      if (!response.ok) throw new Error('Failed to check access');
      return response.json();
    },
    enabled: !!user && !!pageKey,
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  });

  return {
    canAccess: data?.canAccess ?? false,
    dataScope: data?.dataScope ?? 'SELF',
    isLoading,
    error: error as Error | null,
  };
}
```

### Step 6.2: Create useInsightsNavigation Hook

Create file: `qtip/frontend/src/hooks/useInsightsNavigation.ts`

```typescript
import { useQuery } from '@tanstack/react-query';

interface InsightsNavItem {
  page_key: string;
  page_name: string;
  category: string;
  route_path: string;
  icon: string | null;
  sort_order: number;
}

interface InsightsNavCategory {
  category: string;
  pages: InsightsNavItem[];
}

export function useInsightsNavigation() {
  const { data, isLoading } = useQuery({
    queryKey: ['insights-navigation'],
    queryFn: async () => {
      const response = await fetch('/api/insights/navigation', {
        headers: { Authorization: `Bearer ${/* token */}` },
      });
      if (!response.ok) throw new Error('Failed to load navigation');
      return response.json() as Promise<InsightsNavCategory[]>;
    },
    staleTime: 10 * 60 * 1000, // Cache for 10 minutes
  });

  return { categories: data ?? [], isLoading };
}
```

### Step 6.3: Create Insights Service (Frontend)

Create file: `qtip/frontend/src/services/insightsService.ts`

Follow the pattern of existing frontend services (e.g., `qaService.ts`). Export functions for:

- `getInsightsNavigation()` — calls `GET /api/insights/navigation`
- `getInsightsAccess(pageKey: string)` — calls `GET /api/insights/access/:pageKey`
- `getDataFreshness()` — calls `GET /api/insights/data-freshness`
- `listKpis()` — calls `GET /api/insights/admin/kpis`
- `createKpi(data)` — calls `POST /api/insights/admin/kpis`
- `updateKpi(id, data)` — calls `PUT /api/insights/admin/kpis/:id`
- `getThresholds(kpiId)` — calls `GET /api/insights/admin/kpis/:id/thresholds`
- `setThreshold(kpiId, data)` — calls `POST /api/insights/admin/kpis/:id/thresholds`
- `listPages()` — calls `GET /api/insights/admin/pages`
- `updatePageAccess(pageId, data)` — calls `PUT /api/insights/admin/pages/:id/access`
- `listOverrides(pageId)` — calls `GET /api/insights/admin/pages/:id/overrides`
- `createOverride(pageId, data)` — calls `POST /api/insights/admin/pages/:id/overrides`
- `deleteOverride(pageId, overrideId)` — calls `DELETE /api/insights/admin/pages/:id/overrides/:overrideId`

### Step 6.4: Create Insights Layout Shell

Create file: `qtip/frontend/src/pages/insights/InsightsLayout.tsx`

This is the wrapper component that all Insights pages render inside. It includes:

1. A sidebar (or section in the existing navigation) showing Insights page categories and links, populated from `useInsightsNavigation()`
2. A content area where the active page renders (via `<Outlet />` from react-router)
3. A "Data as of" freshness indicator in the header area, populated from the data-freshness endpoint

Follow the layout pattern of the existing app shell. The Insights section should feel like a natural part of the Qtip application, not a separate app.

### Step 6.5: Create Insights Dashboard Placeholder Page

Create file: `qtip/frontend/src/pages/insights/InsightsDashboardPage.tsx`

A minimal placeholder page that displays:
- "Insights Engine" heading
- A message: "No analytics sections have been configured yet. Sections will appear here as they are built."
- The data freshness indicator

This page will be replaced with actual content when Phase 1 (section blueprint) is built.

### Step 6.6: Add Routes to App

Update `qtip/frontend/src/config/routes.ts` to add Insights routes:

```typescript
{
  id: 'insights-dashboard',
  path: '/app/insights/dashboard',
  label: 'Insights Dashboard',
  permissions: { roles: [UserRole.ADMIN, UserRole.DIRECTOR, UserRole.MANAGER, UserRole.QA], requiresAuth: true },
  icon: /* appropriate icon */,
  category: 'insights',
}
```

Update `qtip/frontend/src/App.tsx` to add the Insights routes:

```typescript
// Inside the protected routes section
<Route path="insights" element={<InsightsLayout />}>
  <Route path="dashboard" element={<InsightsDashboardPage />} />
  {/* Future section pages will be added here */}
</Route>
```

### Step 6.7: Update Department Hierarchy — Full Stack Changes

This step requires changes across the entire stack to support the `parent_id` field added in Phase 1.

**6.7a: Backend — Update Department Controller**

Update file: `qtip/backend/src/controllers/department.controller.ts`

- In the `createDepartment` handler: accept `parent_id` from `req.body`. Validate that if provided, the referenced department exists and is not the same as the department being created. Pass `parent_id` to the service.
- In the `updateDepartment` handler: accept `parent_id` from `req.body`. Validate that:
  - The parent is not the department itself (no self-referencing)
  - The parent is not a child of this department (no circular references — use the recursive CTE query from Step 6.7d below to get all descendants, and reject if parent_id is in that list)
  - Pass `parent_id` to the service.
- In the `getDepartments` handler: include `parent_id` and `parent` relation in the response. Also include a `children` count or list if useful for the admin UI.

**6.7b: Backend — Update Department Service and Repository**

Update the department service and repository (whichever handles Prisma queries for departments) to:

- Include `parent_id` in create and update operations
- Include `parent` relation (with `select: { id: true, department_name: true }`) in find queries so the frontend can display the parent name
- Add a `getDepartmentHierarchy()` method that returns departments as a tree structure (for the dropdown to show indented/nested departments)

Prisma query for hierarchy:
```typescript
// Get all departments with parent info
const departments = await prisma.department.findMany({
  where: { is_active: true },
  include: {
    parent: { select: { id: true, department_name: true } },
    children: { select: { id: true, department_name: true }, where: { is_active: true } },
  },
  orderBy: { department_name: 'asc' },
});
```

**6.7c: Backend — Add Hierarchy Validation Endpoint**

Add endpoint `GET /api/departments/:id/descendants` that returns all descendant department IDs for circular reference prevention. Uses the recursive CTE from Step 6.7d.

**6.7d: Recursive CTE Query for Department Hierarchy**

MariaDB 10.2+ supports recursive CTEs. This query is used in two places: the permission service (DIVISION scope resolution) and the department circular reference check.

```sql
-- Get all descendant department_keys for a given department in ie_dim_department
WITH RECURSIVE dept_tree AS (
  -- Anchor: the starting department
  SELECT department_key, department_id, department_name, parent_id, hierarchy_level
  FROM ie_dim_department
  WHERE department_key = ? AND is_current = TRUE

  UNION ALL

  -- Recursive: all children of departments already in the tree
  SELECT d.department_key, d.department_id, d.department_name, d.parent_id, d.hierarchy_level
  FROM ie_dim_department d
  INNER JOIN dept_tree dt ON d.parent_id = dt.department_key
  WHERE d.is_current = TRUE
)
SELECT department_key FROM dept_tree;
```

For the existing Department table (used in the admin UI circular reference check):
```sql
WITH RECURSIVE dept_tree AS (
  SELECT id FROM Department WHERE id = ?
  UNION ALL
  SELECT d.id FROM Department d INNER JOIN dept_tree dt ON d.parent_id = dt.id
)
SELECT id FROM dept_tree;
```

Create a shared utility function at `qtip/backend/src/utils/departmentHierarchy.ts` that wraps this query and returns an array of IDs. Both the permission service and the department controller should import this utility.

**6.7e: Frontend — Update Department Service Types**

Update file: `qtip/frontend/src/services/departmentService.ts`

Add to the `Department` interface:
```typescript
parent_id: number | null;
parent_name: string | null;  // From the parent relation
children_count: number;       // Number of active child departments
```

Update `createDepartment()` and `updateDepartment()` to include `parent_id` in the request body.

**6.7f: Frontend — Update Department Admin Page**

Update file: `qtip/frontend/src/pages/admin/AdminDepartmentsPage.tsx`

In the department create/edit slide-out sheet:

- Add a `<Select>` dropdown field labeled "Parent Department" below the department name field
- Populate options from the departments list, excluding:
  - The department being edited (no self-reference)
  - Any descendants of the department being edited (no circular reference) — fetch descendants from the new API endpoint
- Include a blank/empty option labeled "None (Top-Level Department)" as the default
- When a parent is selected, display a visual indicator of the hierarchy (e.g., "Operations > Tech Support")
- On save, include `parent_id` in the API request body

In the department list table:
- Add a "Parent" column showing the parent department name (or "—" for top-level)
- Optionally add visual indentation to show hierarchy

### Step 6.8: Validation

1. Build the frontend: `npm run build` — no TypeScript errors
2. Navigate to `/app/insights/dashboard` as Admin — should see the placeholder page
3. Navigate as CSR — should see 403 or redirect (depending on your route protection pattern)
4. Verify the navigation hook returns empty categories (no pages registered yet)
5. Go to Admin > Departments — verify the "Parent Department" dropdown appears
6. Create a top-level department called "Operations" (no parent) — verify it saves with `parent_id = NULL`
7. Edit "Tech Support" and set its parent to "Operations" — verify it saves with correct `parent_id`
8. Edit "Billing" and set its parent to "Operations" — verify it saves
9. Try to set "Operations" parent to "Tech Support" — should be blocked (circular reference)
10. Verify the department list shows the parent column correctly
11. Run the department sync worker — verify `ie_dim_department` picks up the hierarchy (hierarchy_path should show '/Operations/Tech Support', hierarchy_level should be 1 for children)
12. Test the DIVISION scope: manually insert a test row in `ie_page` and `ie_page_role_access` with `data_scope = 'DIVISION'` for role MANAGER. As a manager assigned to "Operations", call `GET /api/insights/access/test-page` — the response should include department_keys for Operations, Tech Support, and Billing.
13. Clean up test data
14. Run existing Qtip tests
15. Run a frontend build to confirm no regressions

---

## PHASE 7: Backend — Partition Manager & Rollup Worker Skeleton

**Goal:** Create the partition manager worker and the rollup worker skeleton (activated when the first section is built).

### Step 7.1: Create Partition Manager Worker

Create file: `qtip/backend/src/workers/PartitionManagerWorker.ts`

Extends `BaseInsightsWorker`. Worker name: `'partition-manager'`, source system: `'system'`.

**execute() logic:**

1. Read `partition_lookahead_months` from `ie_config`
2. Read `retention_staging_days` and `retention_fact_years` from `ie_config`
3. Query `INFORMATION_SCHEMA.TABLES` to find all tables matching `ie_fact_%` and `ie_stg_%`
4. For each table:
   - Check existing partitions via `SHOW CREATE TABLE`
   - Create any missing future partitions (lookahead months from today)
   - Drop staging partitions older than retention_staging_days
   - Drop fact partitions older than retention_fact_years
5. Log all partition operations
6. Return counts (partitions created, partitions dropped)

**NOTE:** This worker does nothing until fact/staging tables exist (they're created per section blueprint). It's safe to run even when no fact tables exist — it simply finds no tables and exits with 0 operations.

### Step 7.2: Create Rollup Worker Skeleton

Create file: `qtip/backend/src/workers/RollupWorker.ts`

Extends `BaseInsightsWorker`. Worker name: `'aggregation-rollup'`, source system: `'system'`.

**execute() logic (skeleton):**

1. Query `ie_kpi` for all active KPIs grouped by `source_table`
2. For each unique `source_table`, check if the table exists in the database
3. If no active KPIs or no source tables exist yet, log "No active KPIs to aggregate" and return with 0 counts
4. (Future: when section blueprints are built, this will compute aggregates for each KPI into the section's aggregate tables)

This is intentionally a no-op skeleton. It will be extended when the first section blueprint provides actual fact tables and KPI definitions.

### Step 7.3: Create Worker Runner Scripts

- `qtip/backend/src/workers/run-partition-manager.ts`
- `qtip/backend/src/workers/run-rollup.ts`

Same pattern as Phase 5 runner scripts.

### Step 7.4: Add to PM2 Ecosystem Config

```javascript
{
  name: 'ie-partition-manager',
  script: './backend/dist/workers/run-partition-manager.js',
  cron_restart: '0 0 1 * *',  // 1st of each month at midnight
  watch: false,
  autorestart: false,
  env: { NODE_ENV: 'production' }
},
{
  name: 'ie-rollup',
  script: './backend/dist/workers/run-rollup.js',
  cron_restart: '0 2 * * *',  // 2:00 AM daily
  watch: false,
  autorestart: false,
  env: { NODE_ENV: 'production' }
}
```

### Step 7.5: Validation

1. Build workers
2. Run partition manager manually — should succeed with 0 operations (no fact tables yet)
3. Run rollup worker manually — should succeed with "No active KPIs to aggregate" message
4. Verify `ie_ingestion_log` entries for both workers show status = SUCCESS
5. Run existing Qtip tests

---

## PHASE 8: Admin UI — Insights Settings

**Goal:** Create the admin UI for managing KPIs, thresholds, pages, and permissions within the Insights Engine.

### Step 8.1: Create Insights Admin Pages

Create the following pages under `qtip/frontend/src/pages/admin/`:

**8.1a: InsightsKpiManagementPage.tsx**

A page listing all KPIs in the registry with the ability to create, edit, and deactivate them. This page will be mostly empty until section blueprints register KPIs, but it provides the admin interface.

Layout:
- Table with columns: KPI Code, Name, Category, Formula Type, Format, Direction, Active, Actions
- "Add KPI" button opens a slide-out sheet (follow the pattern in AdminDepartmentsPage.tsx) with fields:
  - kpi_code (text, required, unique)
  - kpi_name (text, required)
  - description (textarea)
  - category (text or dropdown)
  - formula_type (dropdown: SQL, DERIVED, COMPOSITE)
  - formula (textarea, required)
  - source_table (text)
  - format_type (dropdown: PERCENT, NUMBER, CURRENCY, DURATION, RATIO)
  - decimal_places (number, default 1)
  - direction (dropdown: UP_IS_GOOD, DOWN_IS_GOOD, NEUTRAL)
  - unit_label (text)
  - is_active (toggle)
  - sort_order (number)
- Clicking a KPI row opens the edit sheet
- Each KPI row has an expandable "Thresholds" section showing:
  - Table: Department, Goal, Warning, Critical, Effective From, Effective To
  - "Add Threshold" button for adding department-specific or global thresholds

**8.1b: InsightsPageManagementPage.tsx**

A page for managing Insights pages and their access control.

Layout:
- Table with columns: Page Key, Name, Category, Route, Active, Actions
- Each page row expands to show:
  - Role Access table: one row per role, with toggle for can_access and dropdown for data_scope
  - User Overrides table: list of overrides with user, access, scope, granted_by, expires_at
  - "Add Override" button

**8.1c: InsightsIngestionLogPage.tsx**

A page showing ingestion pipeline status.

Layout:
- Table with columns: Worker, Source, Started, Finished, Status, Rows (Extracted/Loaded/Skipped/Errored), Batch
- Filter by worker_name, status, date range
- Color-code status: SUCCESS = green, FAILED = red, RUNNING = blue, PARTIAL = yellow
- Auto-refresh every 30 seconds

### Step 8.2: Add Admin Routes

Update routes config and App.tsx to add these admin pages:

```typescript
// In routes config
{
  id: 'admin-insights-kpis',
  path: '/app/admin/insights/kpis',
  label: 'Insights KPIs',
  permissions: { roles: [UserRole.ADMIN], requiresAuth: true },
  category: 'admin',
},
{
  id: 'admin-insights-pages',
  path: '/app/admin/insights/pages',
  label: 'Insights Pages',
  permissions: { roles: [UserRole.ADMIN], requiresAuth: true },
  category: 'admin',
},
{
  id: 'admin-insights-ingestion',
  path: '/app/admin/insights/ingestion',
  label: 'Ingestion Log',
  permissions: { roles: [UserRole.ADMIN], requiresAuth: true },
  category: 'admin',
}
```

### Step 8.3: Add Navigation Links

Add "Insights Engine" as a section in the admin navigation with links to the three admin pages. Follow the existing admin navigation pattern.

### Step 8.4: Validation

1. Build frontend
2. Navigate to each admin page as Admin — all should render
3. Navigate as non-Admin — should be blocked
4. Create a test KPI via the KPI management page — verify it appears in the table and in the `ie_kpi` database table
5. Set a threshold for the test KPI — verify it saves to `ie_kpi_threshold`
6. View the ingestion log page — should show the sync worker entries from Phase 5
7. Clean up test data
8. Run all existing tests

---

## FINAL VALIDATION CHECKLIST

After all 8 phases are complete, verify the entire foundation:

**Database (11 tables):**
- [ ] `Department` table has `parent_id` column
- [ ] `ie_dim_date` exists with 1,827 rows
- [ ] `ie_dim_department` exists with synced data
- [ ] `ie_dim_employee` exists with synced data
- [ ] `ie_kpi` exists and is empty (no section KPIs yet)
- [ ] `ie_kpi_threshold` exists and is empty
- [ ] `ie_page` exists and is empty (no section pages yet)
- [ ] `ie_page_role_access` exists and is empty
- [ ] `ie_page_user_override` exists and is empty
- [ ] `ie_ingestion_log` exists with successful sync entries
- [ ] `ie_ingestion_lock` exists and is empty
- [ ] `ie_config` exists with 6 default configuration rows

**Backend (API endpoints):**
- [ ] `GET /api/insights/navigation` returns data
- [ ] `GET /api/insights/access/:pageKey` returns access info
- [ ] `GET /api/insights/data-freshness` returns freshness data
- [ ] `GET /api/insights/admin/kpis` returns KPI list (admin only)
- [ ] `POST /api/insights/admin/kpis` creates KPI (admin only)
- [ ] All other admin endpoints work

**Backend (Workers):**
- [ ] Department sync worker runs successfully
- [ ] Employee sync worker runs successfully
- [ ] Business calendar sync worker runs successfully
- [ ] Partition manager runs (no-op with no fact tables)
- [ ] Rollup worker runs (no-op with no KPIs)
- [ ] All workers log to `ie_ingestion_log`
- [ ] PM2 ecosystem config includes all 5 workers

**Frontend:**
- [ ] Insights navigation shell renders
- [ ] Dashboard placeholder page displays
- [ ] `useInsightsAccess` hook works
- [ ] `useInsightsNavigation` hook works
- [ ] Admin KPI management page works
- [ ] Admin page management page works
- [ ] Admin ingestion log page works
- [ ] Department admin page has "Parent Department" dropdown
- [ ] All existing Qtip functionality is unaffected

**When this checklist is complete, the foundation is ready. The next step is to design the Phase 1 Section Blueprint (Quality, Training & Coaching) together, which will define the specific fact tables, KPIs, pages, and ingestion workers that plug into this foundation.**
