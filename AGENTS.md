# QTIP + Insights Platform — Agent Guide

Unified QA + Training + Reporting platform. React 19 + TypeScript frontend,
Express 5 + Prisma + MySQL 8 backend. This file is the map: read it first,
then jump to the one subsystem doc/rule you need instead of scanning the tree.

## Repo layout

- `backend/` — Express 5 API (TypeScript, Prisma, MySQL). See [backend/src/AGENTS.md](backend/src/AGENTS.md).
- `frontend/` — React 19 + Vite SPA. See [frontend/src/AGENTS.md](frontend/src/AGENTS.md).
- `docs/` — product, feature, and operational docs. Index: [docs/README.md](docs/README.md).
- `scripts/` — deploy / backup / bootstrap shell + PowerShell scripts.
- `e2e/` — Playwright end-to-end tests.
- npm workspaces monorepo (`frontend`, `backend`); root `package.json` orchestrates both.

## Run / build / test (from repo root)

- Dev (both): `npm run dev` — backend on ts-node, frontend on Vite.
- Build: `npm run build` (`build:backend` = `tsc`, `build:frontend` = `tsc -b && vite build`).
- Test: `npm test` (backend + frontend Vitest); `npm run test:e2e` (Playwright).
- Lint / type gate before merging to `main`: `npm run lint` then the builds above. Treat red as a hard stop.
- Backend uses Vitest; frontend uses Vitest; tests live in `__tests__/` folders next to source.

## Environments

Code must work across **dev**, **test**, and **prod**. Never add stub/fake-data
paths that reach dev or prod. Env-var reference: [docs/environment_variables.md](docs/environment_variables.md).
Deploy + promote flow (stage/prod): [docs/deployment_runbook.md](docs/deployment_runbook.md)
and rule [.cursor/rules/deploy-to-stage.mdc](.cursor/rules/deploy-to-stage.mdc).

## Three product sections

1. Quality — QA forms, submissions, disputes, scoring, QA analytics.
2. Training — courses, paths, coaching, enrollments, certificates, quizzes.
3. Insights — dashboards, report builder, data explorer, import center, data warehouse.

## Roles (most → least access)

`admin` → `director` → `manager` → `qa` → `trainer` → `csr`.
Route/permission map: [docs/role_permission_matrix.md](docs/role_permission_matrix.md).

## Where to look by subsystem

Rules in `.cursor/rules/` auto-attach when you edit files their `globs` match;
the linked docs are the deeper reference.

**Cross-cutting rules**

- Backend API contract (Prisma DAL, `AppError`/`asyncHandler` envelope, Zod, thin controllers): [.cursor/rules/backend-api-conventions.mdc](.cursor/rules/backend-api-conventions.mdc). Layering write-up: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
- UI/UX conformance (shadcn/ui, TanStack, brand palette): [.cursor/rules/ui-design.mdc](.cursor/rules/ui-design.mdc) and [docs/design.md](docs/design.md).
- Date/time handling: [.cursor/rules/date-handling.mdc](.cursor/rules/date-handling.mdc).
- Frontend query keys: [.cursor/rules/query-keys.mdc](.cursor/rules/query-keys.mdc) → [docs/frontend_query_keys.md](docs/frontend_query_keys.md).
- Deploy / promote (stage + prod): [.cursor/rules/deploy-to-stage.mdc](.cursor/rules/deploy-to-stage.mdc) (quick-card) → [docs/deployment_runbook.md](docs/deployment_runbook.md) (full runbook).

**Subsystem maps** (`.cursor/rules/`)

- Forms & scoring engine: [.cursor/rules/forms-scoring.mdc](.cursor/rules/forms-scoring.mdc).
- Submissions & disputes (QA workflow): [.cursor/rules/submissions-disputes.mdc](.cursor/rules/submissions-disputes.mdc).
- Write-ups (disciplinary): [.cursor/rules/writeups.mdc](.cursor/rules/writeups.mdc).
- Scheduling / campaigns / attendance: [.cursor/rules/scheduling-attendance.mdc](.cursor/rules/scheduling-attendance.mdc).
- Training / coaching / LMS: [.cursor/rules/training-coaching.mdc](.cursor/rules/training-coaching.mdc).
- AI reviewer: [.cursor/rules/ai-reviewer.mdc](.cursor/rules/ai-reviewer.mdc).
- Insights data warehouse (registry-driven ingestion, partitioning, workers): [.cursor/rules/insights-data-warehouse.mdc](.cursor/rules/insights-data-warehouse.mdc).

**Reference docs**

- Database reference: [docs/database_schema.md](docs/database_schema.md); change process: [docs/database_schema_updates.md](docs/database_schema_updates.md); efficiency review: [docs/database_review.md](docs/database_review.md).
- Code-health cadence + cleanup backlog: [docs/maintenance_cadence.md](docs/maintenance_cadence.md).

## One source per convention (prevents drift)

Each cross-cutting convention has ONE authoritative home. Everywhere else must be
a one-line pointer, never a second copy that can drift out of sync:

| Convention | Authoritative source |
| --- | --- |
| Tech stack + brand palette | [.cursorrules](.cursorrules) |
| Backend API contract (Prisma, error envelope, Zod, thin controllers) | [.cursor/rules/backend-api-conventions.mdc](.cursor/rules/backend-api-conventions.mdc) |
| Error/response envelope policy | [backend/src/utils/errorHandler.ts](backend/src/utils/errorHandler.ts) |
| UI/UX + component patterns | [.cursor/rules/ui-design.mdc](.cursor/rules/ui-design.mdc) |
| Query-key conventions | [docs/frontend_query_keys.md](docs/frontend_query_keys.md) |
| 200–300 line refactor + no-duplication | this file (Hard constraints below) |
| Deploy / promote (stage + prod) | [docs/deployment_runbook.md](docs/deployment_runbook.md) |
| DB schema change process | [docs/database_schema_updates.md](docs/database_schema_updates.md) |

## Hard constraints (do not violate)

- Never add tables or alter the database without explicit approval. DB reviews are observations only.
- PowerShell shell: chain with `;`, never `&&`.
- Iterate on existing patterns before introducing new ones; if you add a new pattern, remove the old one (no duplicate logic).
- Refactor files at 200–300 lines. Avoid duplication; search for existing helpers/components first.
- Tech-stack and UI mandates are enforced in [.cursorrules](.cursorrules) and [.cursor/rules/ui-design.mdc](.cursor/rules/ui-design.mdc).
