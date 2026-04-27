# Role & permission matrix

Which role can access which API surface and which UI route. This is a
**derived view** — the code is the source of truth. Update this file in
the same PR that changes middleware or route guards.

---

## 1. Roles

Role ids are defined in the DB (`roles` table) and mirrored in
[`frontend/src/hooks/useQualityRole.ts`](../frontend/src/hooks/useQualityRole.ts).

| id  | Name     | Scope                                                                 |
| --- | -------- | --------------------------------------------------------------------- |
| 1   | Admin    | Global; full CRUD on configuration, users, departments, forms.        |
| 2   | QA       | Owns quality forms, submissions, disputes, coaching (as reviewer).    |
| 3   | Agent    | End-user / CSR; sees own audits, coaching, write-ups.                 |
| 4   | Trainer  | Coaching + training library + own team's reports.                     |
| 5   | Manager  | Team-scoped: own department's audits, coaching, write-ups, reports.   |
| 6   | Director | Director-assignment + cross-team dispute resolution surfaces.         |

---

## 2. Backend middleware map

All middleware lives in [`backend/src/middleware/auth.ts`](../backend/src/middleware/auth.ts).

| Middleware                  | Allowed roles                    | Used for                                                      |
| --------------------------- | -------------------------------- | ------------------------------------------------------------- |
| `authenticate`              | any logged-in user               | Every `/api/*` route except `/api/auth/*` and `/api/csrf-token` |
| `authorizeAdmin`            | Admin                            | Role / department / list-item CRUD, admin-only config         |
| `authorizeQA`               | Admin, QA                        | Form CRUD, QA dashboard, submission finalize                  |
| `authorizeQAOrTrainer`      | Admin, QA, Trainer               | Completed-submission read / export                            |
| `authorizeTrainer`          | Admin, Trainer                   | Trainer-scoped coaching / training library                    |
| `authorizeCoachingUser`     | Admin, QA, Trainer, Manager      | Shared coaching endpoints                                     |
| `authorizeManager`          | Admin, QA, Manager               | Write-ups, dispute resolve, manager reports                   |

`ApiErrors.unauthorized(res)` / `ApiErrors.forbidden(res)` render the flat
auth envelope (see `utils/errorHandler.ts` — shape **B**).

---

## 3. API route matrix

Grouped by mount path. `A` = Admin, `Q` = QA, `T` = Trainer, `M` = Manager,
`D` = Director, `Ag` = Agent. A blank cell means **not allowed**.

### Configuration / admin

| Mount                      | Methods          | A | Q | T | M | D | Ag | Notes |
| -------------------------- | ---------------- | - | - | - | - | - | -- | ----- |
| `/api/admin/*`             | all              | ✓ |   |   |   |   |    | `authorizeAdmin` |
| `/api/users/*`             | CRUD             | ✓ |   |   |   |   |    | self-read on `GET /me` for any |
| `/api/roles/*`             | read/write       | ✓ |   |   |   |   |    |       |
| `/api/departments/*`       | CRUD             | ✓ |   |   |   |   |    |       |
| `/api/director-departments/*` | CRUD          | ✓ |   |   |   | ✓ |    |       |
| `/api/list-items/*`        | CRUD             | ✓ |   |   |   |   |    |       |

### Quality / forms / submissions

| Mount                        | Methods        | A | Q | T | M | D | Ag | Notes |
| ---------------------------- | -------------- | - | - | - | - | - | -- | ----- |
| `/api/forms`                 | GET            | ✓ | ✓ | ✓ | ✓ | ✓ | ✓  | `authenticate` only |
| `/api/forms`                 | POST/PUT/DELETE| ✓ | ✓ |   |   |   |    | `authorizeQA` |
| `/api/submissions/*`         | CRUD           | ✓ | ✓ |   |   |   |    | `authorizeQA` |
| `/api/qa/completed*`         | GET            | ✓ | ✓ | ✓ |   |   |    | `authorizeQAOrTrainer` |
| `/api/qa/submissions/:id/finalize` | PUT      | ✓ | ✓ |   |   |   |    | `authorizeQA` |
| `/api/qa/health`             | GET            | — | — | — | — | — | —  | **public** (uptime monitor) |
| `/api/disputes/*`            | read           | ✓ | ✓ |   | ✓ | ✓ | ✓  | CSRs see their own disputes |
| `/api/disputes/*/resolve`    | write          | ✓ | ✓ |   | ✓ | ✓ |    | `authorizeManager` |
| `/api/audit-assignments/*`   | CRUD           | ✓ | ✓ |   | ✓ |   |    |       |

### Coaching / training

| Mount                        | Methods        | A | Q | T | M | D | Ag | Notes |
| ---------------------------- | -------------- | - | - | - | - | - | -- | ----- |
| `/api/trainer/*`             | most           | ✓ |   | ✓ |   |   |    | `authorizeTrainer` |
| `/api/quizzes/*`             | read           | ✓ |   | ✓ |   |   | ✓  | Agent can take own quizzes |
| `/api/quizzes/*`             | write          | ✓ |   | ✓ |   |   |    |       |
| `/api/csr/coaching`          | GET            | ✓ | ✓ | ✓ | ✓ |   |    | `authorizeCoachingUser` |

### Write-ups (performance warnings)

| Mount                        | Methods        | A | Q | T | M | D | Ag | Notes |
| ---------------------------- | -------------- | - | - | - | - | - | -- | ----- |
| `/api/writeups`              | POST/PUT/DELETE| ✓ | ✓ |   | ✓ |   |    | `authorizeManager` — Trainer intentionally excluded (see `writeup.lifecycle.service.ts` header) |
| `/api/writeups`              | GET (list)     | ✓ | ✓ |   | ✓ |   |    |       |
| `/api/writeups/my`           | GET            | — | — | — | — | — | ✓  | Self-only, authenticated |
| `/api/writeups/:id/sign`     | POST           | — | — | — | — | — | ✓  | Agent signs their own write-up |

### Manager / reports

| Mount                        | Methods        | A | Q | T | M | D | Ag | Notes |
| ---------------------------- | -------------- | - | - | - | - | - | -- | ----- |
| `/api/manager/*`             | all            | ✓ | ✓ |   | ✓ | ✓ |    | `authorizeManager` |
| `/api/reports/*`             | GET            | ✓ | ✓ |   | ✓ | ✓ |    |       |
| `/api/on-demand-reports/*`   | GET            | ✓ |   |   | ✓ |   |    | Admin + Manager only |
| `/api/enhanced-performance-goals/*` | CRUD    | ✓ | ✓ |   | ✓ |   |    |       |

### Insights / analytics / imports

| Mount                        | Methods        | A | Q | T | M | D | Ag | Notes |
| ---------------------------- | -------------- | - | - | - | - | - | -- | ----- |
| `/api/insights/*`            | GET            | ✓ | ✓ | ✓ | ✓ | ✓ |    | Fine-grained page permissions via `ie_page_role_access` |
| `/api/insights/admin/*`      | CRUD           | ✓ |   |   |   |   |    | Admin-only KPI / page management |
| `/api/metrics/*`             | GET            | ✓ | ✓ |   | ✓ | ✓ |    |       |
| `/api/analytics/*`           | GET            | ✓ | ✓ |   | ✓ | ✓ |    |       |
| `/api/raw-data/*`            | read/export    | ✓ |   |   |   |   |    | Admin only |
| `/api/imports/*`             | all            | ✓ |   |   |   |   |    | Admin only |

### Monitoring (public)

| Mount                        | Access        | Notes                                               |
| ---------------------------- | ------------- | --------------------------------------------------- |
| `/health`, `/ready`, `/live` | Public        | Uptime monitors                                     |
| `/metrics`                   | Public        | Prometheus scrape target (firewall at infra layer)  |
| `/api-docs`                  | Public        | Swagger UI (consider gating in prod)                |
| `/api/qa/health`             | Public        | QA-subsystem health (trimmed payload; see item #98) |

---

## 4. UI route matrix

Sources: [`frontend/src/app/AppRoutes.tsx`](../frontend/src/app/AppRoutes.tsx),
[`frontend/src/app/guards.tsx`](../frontend/src/app/guards.tsx),
[`frontend/src/components/shell/ProtectedRoute.tsx`](../frontend/src/components/shell/ProtectedRoute.tsx).

All routes below sit behind `<ProtectedRoute>` (login required) unless
listed as public.

| Route                                      | A | Q | T | M | D | Ag | Guard                                     |
| ------------------------------------------ | - | - | - | - | - | -- | ----------------------------------------- |
| `/login`                                   | — | — | — | — | — | —  | public                                    |
| `/app` (root)                              | ✓ | ✓ | ✓ | ✓ | ✓ | ✓  | `<RoleRedirect />` sends to default page  |
| `/app/admin/*`                             | ✓ |   |   |   |   |    | `<RequireRole allowed={[ADMIN]}>`         |
| `/app/quality/forms*`                      | ✓ | ✓ |   |   |   |    | page-level check inside each page         |
| `/app/quality/submissions*`                | ✓ | ✓ |   | ✓ | ✓ | ✓  | server scopes results by role             |
| `/app/quality/disputes`                    | ✓ | ✓ |   | ✓ | ✓ |    |                                           |
| `/app/quality/review-forms` `/audit`       | ✓ | ✓ |   |   |   |    |                                           |
| `/app/training/coaching*`                  | ✓ | ✓ | ✓ | ✓ |   |    | `<RequireRole allowed={COACHING_REVIEWER_ROLES}>` (CSRs redirected to `my-coaching`) |
| `/app/training/my-coaching*`               | — | — | — | — | — | ✓  | any authenticated user                    |
| `/app/training/library*`                   | ✓ |   | ✓ |   |   |    |                                           |
| `/app/training/reports`                    | ✓ |   | ✓ | ✓ |   |    |                                           |
| `/app/performancewarnings/list` `/new` `/:id` `/:id/edit` | ✓ | ✓ |   | ✓ |   |    | `<RequireRole allowed={PERFORMANCE_WARNING_EDITOR_ROLES}>` |
| `/app/performancewarnings/my*`             | — | — | — | — | — | ✓  | any authenticated user (self-scoped)      |
| `/app/insights/qc-*`                       | per-page | per-page | per-page | per-page | per-page | per-page | `<RequireInsightsAccess pageKey=...>` — DB-driven via `ie_page_role_access` |
| `/app/insights/dashboard` `/team`          | ✓ | ✓ | ✓ | ✓ | ✓ |    |                                           |
| `/app/insights/on-demand-reports*`         | ✓ |   |   | ✓ |   |    | `<RequireRole allowed={ON_DEMAND_REPORT_ROLES}>` |
| `/app/insights/builder` `/reports` `/explorer` `/export` | ✓ |   |   |   |   |    | Admin only (see `navConfig.ts`) |
| `/app/insights/import` `/history`          | ✓ |   |   |   |   |    |                                           |
| `/app/profile`                             | ✓ | ✓ | ✓ | ✓ | ✓ | ✓  |                                           |

---

## 5. How to change a permission

1. Update the middleware in `backend/src/middleware/auth.ts` (or add a new
   `authorize*` helper — follow the existing pattern, return `ApiErrors.*`
   on failure).
2. Wire the middleware onto the route in `backend/src/routes/*.ts`. Keep
   the JSDoc `@access` marker in sync so `form.routes.ts`-style drift (see
   review items #2 / #87) doesn't return.
3. If the change affects UI visibility, update the corresponding
   `<RequireRole>` / `<RequireInsightsAccess>` block in
   `frontend/src/app/AppRoutes.tsx`, plus the nav gate in
   `frontend/src/config/navConfig.ts` when the new role should see the
   item in the sidebar.
4. Update the relevant row in §3 or §4 of this file in the same PR.
5. Add or update the Playwright scenario in `e2e/` that exercises the new
   role boundary (one happy path + one forbidden path is enough).
