# QTIP Project Overview — System Map

Single-page map of the **Quality and Training Insight Platform (QTIP)**: a
role-based platform for call centers spanning QA, training/LMS, and reporting.
This is the "where does everything live" index. It links out to the
authoritative source for each area rather than restating it (so it can't drift).

> **Entry points for orientation:** this file (the map) → [`README.md`](../README.md)
> (setup/run) → [`../AGENTS.md`](../AGENTS.md) (repo map + hard constraints) →
> [`docs/README.md`](./README.md) (full doc index, 70+ docs) →
> [`.cursor/rules/`](../.cursor/rules) (subsystem deep-dives, auto-attached on edit).

---

## 1. Stack & architecture

| Layer | Stack | Reference |
|-------|-------|-----------|
| Frontend | React 19 + Vite + TypeScript, TanStack Query (server state), TanStack Table (grids), shadcn/ui + Tailwind, React Router v7, Recharts, React Hook Form, TipTap, dnd-kit, lucide-react, Axios | [`frontend/src/AGENTS.md`](../frontend/src/AGENTS.md), [`.cursor/rules/ui-design.mdc`](../.cursor/rules/ui-design.mdc), [`design.md`](./design.md) |
| Backend | Node.js + Express 5 + TypeScript, Prisma ORM, Zod validation, Winston logging, JWT auth, Multer uploads, xlsx | [`backend/src/AGENTS.md`](../backend/src/AGENTS.md), [`ARCHITECTURE.md`](./ARCHITECTURE.md), [`.cursor/rules/backend-api-conventions.mdc`](../.cursor/rules/backend-api-conventions.mdc) |
| Database | MySQL 8 (schema `qtip`), Prisma as the single data-access standard | [`database_schema.md`](./database_schema.md), [`database_schema_updates.md`](./database_schema_updates.md) |
| Auth | JWT access + refresh tokens (httpOnly cookie), role-based access | [`role_permission_matrix.md`](./role_permission_matrix.md) |

**Backend layering (strict):** `routes/ → controllers/ (thin, asyncHandler) →
services/ (business logic, owns Prisma) → Prisma → MySQL`. Error envelope via
`AppError` in `utils/errorHandler.ts`. Deliberate SQL exceptions: the Insights
data warehouse (`workers/`, `QC*`) and a shrinking set of legacy `repositories/`.

**Frontend layout:** `app/` (router, query client, guards) · `pages/` (route
screens by section) · `components/{common,ui,quality,training,insights,admin,scheduling,shell}/`
· `hooks/` · `services/` (Axios) · `types/`, `utils/`, `lib/`, `contexts/`.

---

## 2. Roles (most → least access)

`admin` → `director` → `manager` → `qa` → `trainer` → `csr`.
Full route/permission map: [`role_permission_matrix.md`](./role_permission_matrix.md).
Navigation per role: [`navigation_overview.md`](./navigation_overview.md).

---

## 3. Subsystems — where each one lives

Each row: what it does · backend routes (`backend/src/routes/`) · frontend pages
(`frontend/src/pages/`) · deep-dive doc/rule.

| Subsystem | Backend routes | Frontend pages | Deep dive |
|-----------|----------------|----------------|-----------|
| **QA forms & scoring** | `form.routes` | `quality/form-builder/`, `quality/AuditFormPage` | [`forms-scoring.mdc`](../.cursor/rules/forms-scoring.mdc), [`qa_form_reference.md`](./qa_form_reference.md), [`scoring_preview.md`](./scoring_preview.md) |
| **Submissions & disputes** | `submission.routes`, `qa.routes`, `dispute.routes`, `unlock.routes`, `calls.routes` | `quality/submission-detail/`, `quality/ReviewFormsPage` | [`submissions-disputes.mdc`](../.cursor/rules/submissions-disputes.mdc), [`unlock_reopen_flow.md`](./unlock_reopen_flow.md) |
| **AI Reviewer** | `ai-reviewer.routes`, `kb.routes` | `quality/ai-reviewer/`, `quality/AIReviewInbox` | [`ai-reviewer.mdc`](../.cursor/rules/ai-reviewer.mdc), [`ai_reviewer_calibration_walkthrough.md`](./ai_reviewer_calibration_walkthrough.md), [`bookstack_kb_integration.md`](./bookstack_kb_integration.md) |
| **Training / LMS / coaching** | `trainer.routes`, `quiz.routes`, `csr.routes` | `training/` (courses, quizzes, coaching) | [`training-coaching.mdc`](../.cursor/rules/training-coaching.mdc), [`lms_trainer_workflow.md`](./lms_trainer_workflow.md) |
| **Write-ups (disciplinary)** | `writeup.routes` | `writeups/` | [`writeups.mdc`](../.cursor/rules/writeups.mdc) |
| **Scheduling / campaigns / phone queues** | `scheduling.routes`, `campaign.routes`, `phoneQueue.routes` | `scheduling/` | [`scheduling-attendance.mdc`](../.cursor/rules/scheduling-attendance.mdc), [`scheduling.md`](./scheduling.md), [`phone_queues.md`](./phone_queues.md) |
| **Insights / dashboards / data warehouse** | `insights.routes`, `insightsIR.routes`, `insightsCsr.routes`, `insightsQC.routes`, `insightsAdmin.routes`, `rawData.routes`, `metric.routes`, `analytics.routes`, `report.routes`, `onDemandReports.routes` | `insights/` | [`insights-data-warehouse.mdc`](../.cursor/rules/insights-data-warehouse.mdc), [`insights-report-page.mdc`](../.cursor/rules/insights-report-page.mdc), [`analytics_builder.md`](./analytics_builder.md) |
| **Import center / mailbox import** | `import.routes` | `insights/ImportHistoryPage`, `admin` manual upload | [`mailbox_import.md`](./mailbox_import.md) |
| **Performance goals** | `enhancedPerformanceGoal.routes` | admin goals screens | [`performance_goals.md`](./performance_goals.md) |
| **Users / departments / admin / system settings** | `user.routes`, `role.routes`, `department.routes`, `admin.routes`, `admin-system-settings.routes`, `appAccess.routes`, `list.routes`, `directorDepartment.routes`, `manager.routes` | `admin/` | [`user_management.md`](./user_management.md), [`department_management.md`](./department_management.md), [`ADMIN_COMPONENTS_README.md`](./ADMIN_COMPONENTS_README.md) |
| **Auth** | `auth.routes` | `auth/` (login, forgot/reset password) | [`role_permission_matrix.md`](./role_permission_matrix.md) |
| **External integrations** | `phoneSystem.routes`, `crm.routes` | (consumed across quality/insights) | see §5 |
| **Observability / audit trail** | `monitoring.routes`, `auditLog.routes` | admin monitoring | [`observability.md`](./observability.md), [`audit_logging.md`](./audit_logging.md) |

---

## 4. Three product sections (user-facing)

1. **Quality** — QA form builder + scoring, manual/assigned audits, submissions,
   disputes, AI Reviewer, unlock/reopen.
2. **Training** — LMS courses, training paths, quizzes, certificates, enrollments,
   coaching sessions.
3. **Insights** — role dashboards, report builder, data explorer, on-demand
   reports, import center, and the registry-driven data warehouse.

---

## 5. External systems & APIs

All configured via env vars — authoritative list + on/off behavior in
[`environment_variables.md`](./environment_variables.md).

| System | Direction | Purpose | Notes |
|--------|-----------|---------|-------|
| **MySQL 8** (`qtip`) | R/W | Primary store | via Prisma (`config/prisma.ts`) |
| **Phone System DB** | Read-only | Call transcripts + recordings | `PHONE_DB_*`; audio streamed from UNC share (`PHONE_RECORDING_BASE_PATH`); [`phone_system_integration.md`](./phone_system_integration.md) |
| **CRM DB** | Read-only | Ticket data (Phase 2) | `CRM_DB_*`; all-or-nothing config |
| **OpenAI** | API | AI Reviewer LLM | `OPENAI_API_KEY`; unset → `not_configured` |
| **Anthropic** | API | AI Reviewer LLM (alt) | `ANTHROPIC_API_KEY` |
| **BookStack KB** | Read-only API | Knowledge base grounding for AI Reviewer | `BOOKSTACK_*`; unset → `/api/kb/* 503`; [`bookstack_kb_integration.md`](./bookstack_kb_integration.md) |
| **SMTP relay** | Outbound | Email/notifications | `SMTP_*` (`yukon.dm.local:25`); blank host disables mail |
| **Exchange EWS** | Inbound poll | Mailbox import of emailed Excel reports (Paychex punch feed) | `EXCHANGE_*`, `MAILBOX_IMPORT_*`; [`mailbox_import.md`](./mailbox_import.md) |

---

## 6. Environments & deploy

Code must run across **dev**, **test**, **prod** — no stub/fake-data paths in dev
or prod. Env reference: [`environment_variables.md`](./environment_variables.md).
Containerized Docker Compose on stage/prod; promote flow and box identities in
[`.cursor/rules/deploy-to-stage.mdc`](../.cursor/rules/deploy-to-stage.mdc) →
[`deployment_runbook.md`](./deployment_runbook.md). DB backup/restore:
[`backup_restore_runbook.md`](./backup_restore_runbook.md).

---

## 7. Run / build / test (from repo root)

- Dev (both): `npm run dev`
- Build: `npm run build` (`build:backend` = `tsc`, `build:frontend` = `tsc -b && vite build`)
- Test: `npm test` (backend + frontend Vitest); `npm run test:e2e` (Playwright)
- Lint/type gate before merge: `npm run lint` then the builds. Red = hard stop.

---

## 8. Hard constraints (recap — full text in [`../AGENTS.md`](../AGENTS.md))

- Ask before adding/altering a DB table; migrations are additive + idempotent.
- PowerShell: chain with `;`, never `&&`.
- Prisma is the only data-access standard (SQL exceptions above are not conversion targets).
- shadcn/ui + TanStack + lucide-react + brand palette only (no Tremor, no new colors).
- Refactor files at 200–300 lines; reuse existing patterns before adding new ones.
