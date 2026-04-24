# QTIP — Quality & Training Insight Platform

A role-based call-center quality, coaching, and LMS platform: QA scoring,
dispute resolution, performance goals, training delivery, and cross-role
analytics.

| Layer    | Stack                                                  |
| -------- | ------------------------------------------------------ |
| Frontend | React 18 + Vite + Tailwind + TypeScript                |
| Backend  | Node.js + Express + TypeScript + Prisma                |
| Database | MySQL 8.x / MariaDB (schema: `qtip`)                   |
| Auth     | JWT (access + refresh) + role-based middleware         |
| Process  | PM2 cluster (`ecosystem.config.cjs`)                   |
| Tests    | Vitest (backend + frontend), Playwright (e2e)          |

## Repo layout

```
backend/         Express + Prisma API. See backend/README.md (TODO) and docs/.
frontend/        Vite + React SPA. See frontend/README.md.
docs/            Product / feature documentation. Index in docs/README.md.
deploy/          Docker, nginx, IIS, prod env templates. See deploy/README.md.
scripts/         Operator-facing PowerShell + SQL. See scripts/README.md.
e2e/             Playwright end-to-end suites.
```

## Prerequisites

- Node.js ≥ 18, npm ≥ 9
- MySQL 8.x or MariaDB (local or remote)
- PowerShell 5.1+ on Windows for the deploy / setup scripts

## Quick start (local dev)

```powershell
git clone <repo-url> qtip
cd qtip
npm run install:all

# 1. Configure backend/.env (copy deploy/production_environment_template.env
#    as a reference — never commit a real .env).
copy deploy\production_environment_template.env backend\.env
# Edit backend/.env: DB_*, JWT_SECRET, REFRESH_TOKEN_SECRET, etc.

# 2. Apply migrations against your local MySQL.
cd backend; npx prisma migrate dev; cd ..

# 3. (optional) Seed a local admin user — see scripts/setup_users.ps1.

# 4. Run frontend + backend together.
npm run dev
```

Backend listens on `http://localhost:3000`, frontend on
`http://localhost:5173`.

If the dev ports are stuck:

```powershell
.\scripts\kill-dev-servers.ps1
```

## Common scripts

| Command                           | What it does                                     |
| --------------------------------- | ------------------------------------------------ |
| `npm run dev`                     | Start backend + frontend with HMR (concurrently) |
| `npm run build`                   | Build backend + frontend for production          |
| `npm run lint`                    | ESLint both workspaces                           |
| `npm test`                        | Vitest backend + frontend                        |
| `npm run test:e2e`                | Playwright suites                                |
| `npm run start`                   | PM2 cluster (production)                         |
| `npm run deploy:prod`             | Run `scripts/deploy_application.ps1` for prod    |
| `npm run db:deploy:prod`          | Run `scripts/deploy_database.ps1 -BackupFirst`   |

Backend DB-touching tests are gated behind `ENABLE_DB_TESTS=1` so CI
doesn't accidentally hit a real database. Set the variable when you
want them to run against a golden-slice schema.

## Documentation

- [`docs/README.md`](./docs/README.md) — product / feature documentation index
- [`docs/project_overview.md`](./docs/project_overview.md) — system objective + roles + architecture
- [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) — backend/frontend architecture
- [`docs/PRODUCTION_READINESS_GUIDE.md`](./docs/PRODUCTION_READINESS_GUIDE.md) — production checklist
- [`docs/Contributing.md`](./docs/Contributing.md) — contribution guidelines
- [`deploy/README.md`](./deploy/README.md) — Docker / nginx / IIS / env templates
- [`scripts/README.md`](./scripts/README.md) — deploy / DB / verification scripts

## License

Proprietary — see `package.json` for current license metadata.
