# Backend Architecture

Express 5 + TypeScript + Prisma + MySQL 8. Layered separation of concerns: a
thin HTTP layer over business logic over data access.

> **Authoritative contract:** the *enforceable* API rules (data access, error
> envelope, validation) live in
> [`.cursor/rules/backend-api-conventions.mdc`](../.cursor/rules/backend-api-conventions.mdc).
> This document explains the layering and the "why"; that rule is the checklist
> to obey when writing a route/controller/service. If the two ever disagree, the
> rule wins — fix this doc.

## Layers

```
routes/        # HTTP layer (thin): endpoints + middleware, delegate to controllers
   ↓
controllers/   # Parse/validate request, call a service, shape the response (asyncHandler)
   ↓
services/      # Business logic + domain rules. Owns Prisma access.
   ↓
Prisma Client  # Data access — backend/src/generated/prisma
   ↓
MySQL 8
```

Supporting folders:

- `validation/` — Zod schemas for request input.
- `models/`, `interfaces/`, `types/` — domain models, interfaces, shared DTO types.
- `middleware/` — auth (JWT access/refresh), uploads (Multer), rate limiting, and the global error handler.
- `utils/errorHandler.ts` — `asyncHandler` + `AppError` (the response envelope).
- `config/` — environment, Prisma client, logger (Winston), swagger, timezone.
- `workers/` — Insights data-warehouse cron jobs (deliberately raw SQL — see below).
- `repositories/` — LEGACY raw-SQL / `mysql2` data-access classes, being migrated onto Prisma. Do not add new ones.

## Layer responsibilities

### 1. Routes (`/routes`)

HTTP routing + middleware only. Delegate to a controller; do not put business
logic or DB calls inline in the route file.

```typescript
router.post('/', authenticate, createForm);
router.get('/:id', authenticate, getFormById);
```

### 2. Controllers (`/controllers`)

Parse params, validate input with Zod, call a service, shape the HTTP response.
Keep them thin — no business logic, no direct DB access. Wrap async handlers in
`asyncHandler` and throw `AppError` rather than hand-rolling error responses.

```typescript
export const createForm = asyncHandler(async (req: Request, res: Response) => {
  const data = createFormSchema.parse(req.body);
  const createdBy = req.user!.userId;
  const result = await formService.createForm(data, createdBy);
  res.status(201).json(result);
});
```

### 3. Services (`/services`)

Business rules, validation, and orchestration. This is where Prisma is used and
where domain errors are thrown (`AppError` or the `create*Error` factories); the
global handler renders them.

```typescript
export class FormService {
  async createForm(data: CreateFormDTO, createdBy: number) {
    await this.validateFormStructure(data);
    return prisma.form.create({ data: normalize(data, createdBy) });
  }
}
```

### 4. Data access — Prisma is the standard

All DB operations go through Prisma (`config/prisma.ts` → `generated/prisma`).
Do NOT add `mysql2` pool queries. Transactions use `prisma.$transaction`.

Two deliberate exceptions, both documented and NOT conversion targets:

- The **Insights data-warehouse** layer (`services/QC*Data.ts`, `QCKpiService`,
  `workers/`, `insights`/`insightsQC` read controllers) is hand-written SQL for
  analytical performance — see
  [`.cursor/rules/insights-data-warehouse.mdc`](../.cursor/rules/insights-data-warehouse.mdc).
- A shrinking set of legacy `repositories/` still open raw `mysql2` connections.
  When you touch one, prefer converting it to Prisma rather than extending it.

## Error / response envelope

Only three shapes are allowed. Full policy in
[`backend/src/utils/errorHandler.ts`](../backend/src/utils/errorHandler.ts):

- **(A) Rich envelope** — throw `AppError` (or `createValidationError` /
  `createNotFoundError` / etc.) from a controller/service wrapped in
  `asyncHandler`. Use this for ALL new code.
- **(B) Flat auth envelope** — `ApiErrors.*` from `utils/apiError.ts`, only in
  auth/authorization middleware that short-circuits before a controller.
- **(C) Legacy `{ success, message, data }`** — do NOT add to new handlers;
  existing sites migrate to (A) endpoint-by-endpoint.

```typescript
// Service throws a typed error:
throw createNotFoundError('Form', id);
// The controller does nothing special — asyncHandler forwards it to the global
// errorHandler, which renders the (A) envelope with the correct status code.
```

Never hand-roll `res.status(500).json({ error })` — throw instead.

## Validation & logging

- Validate all request input with Zod schemas in `validation/` (small controllers
  may use an inline `z.object`). Enforce the shared page-size cap (`MAX_PAGE_SIZE`
  in `validation/common.ts`) on list endpoints.
- Log with Winston (`config/logger.ts`). Never `console.log` in request paths.

## Adding a new feature

1. **Define types/DTOs** in `types/`, and a Zod schema in `validation/`.
2. **Write the service** in `services/` — business logic + Prisma calls.
3. **Write a thin controller** wrapped in `asyncHandler`; throw `AppError` on failure.
4. **Wire the route** with auth middleware; delegate to the controller.
5. **Add tests** (`__tests__/`) — at minimum the controller's response shape and its error branches.

Keep files under ~200–300 lines; extract a cohesive piece rather than growing a
file past that.

## Benefits of the layering

- **Separation of concerns** — HTTP, business rules, and persistence are isolated and independently testable.
- **Consistency** — every feature follows the same route → controller → service → Prisma flow and the same error envelope.
- **Maintainability** — predictable locations; the enforceable specifics live in the scoped rule so they can't silently drift from this prose.
