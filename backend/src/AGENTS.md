# Backend — Agent Guide

Express 5 + TypeScript + Prisma + MySQL 8. Follows Clean Architecture; full
write-up in [../../docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md).

## Layer flow (thin HTTP → business → data)

```
routes/ → controllers/ → services/ → (Prisma) → MySQL
```

- `routes/` — endpoint definitions + auth middleware; delegate to controllers only.
- `controllers/` — parse/validate request, call a service, shape the HTTP response. Keep thin.
- `services/` — business logic. This is where rules live; keep controllers out of the DB.
- `repositories/` — data-access classes (legacy raw-SQL layer; being consolidated onto Prisma).
- `models/`, `interfaces/`, `types/` — domain models, interfaces, shared TS types.
- `validation/` — Zod schemas. All request input should be validated with Zod.
- `middleware/` — auth (JWT access/refresh), uploads (Multer), rate limiting, etc.
- `config/` — environment, Prisma client, logger (Winston), swagger, timezone.
- `workers/` — Insights data-warehouse cron workers. See [../../.cursor/rules/insights-data-warehouse.mdc](../../.cursor/rules/insights-data-warehouse.mdc).
- `utils/` — shared helpers, incl. `errorHandler.ts` (`asyncHandler` + `AppError`).
- `generated/prisma/` — auto-generated Prisma client. Do NOT edit; it is `.cursorignore`d and gitignored.
- `__tests__/` and `services/**/__tests__/` — Vitest tests. Run `npm test` in `backend/`.

## Conventions (enforced)

- Prisma is the single data-access standard for ALL DB operations (see `.cursorrules`). Do not add new `mysql2` pool queries; prefer Prisma. Legacy raw-pool code is being migrated off.
- Standard error/response contract: wrap async controllers in `asyncHandler` and throw `AppError` from [utils/errorHandler.ts](utils/errorHandler.ts) rather than hand-rolling `res.status().json()` envelopes.
- Validate with Zod (`validation/`); log with Winston (`config/logger.ts`); never `console.log` in request paths.
- Never add tables or alter the DB without explicit approval. Schema change process: [../../docs/database_schema_updates.md](../../docs/database_schema_updates.md).
- Refactor files at 200–300 lines. Business logic belongs in `services/`, not controllers.
- Code must run in dev/test/prod; no stub/fake-data paths in dev or prod.
