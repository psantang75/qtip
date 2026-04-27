# JSDoc coverage standard

Every exported function / class / component in `backend/src/` and
`frontend/src/` must carry a JSDoc block. Coverage today is uneven — the
well-commented modules below are the reference; the big controllers still
rely on section headers only. This document defines the contract so
reviewers can enforce it going forward.

---

## 1. Exemplars to follow

Match the density and structure of these files when writing new code:

| Module                                                                     | What to copy                                   |
| -------------------------------------------------------------------------- | ---------------------------------------------- |
| [`backend/src/services/coachingSessionsReport.ts`](../backend/src/services/coachingSessionsReport.ts) | Per-function JSDoc, module header explains domain boundary. |
| [`backend/src/middleware/qcCache.ts`](../backend/src/middleware/qcCache.ts) | Tight header + per-export JSDoc, cache-policy section. |
| [`backend/src/services/onDemandReportsRegistry.ts`](../backend/src/services/onDemandReportsRegistry.ts) | Registry-level JSDoc, per-report descriptor. |
| [`backend/src/services/writeups/writeup.lifecycle.service.ts`](../backend/src/services/writeups/writeup.lifecycle.service.ts) | Module header documents role policy, audit trail, naming. |
| [`backend/src/utils/errorHandler.ts`](../backend/src/utils/errorHandler.ts) | Response-envelope policy block — the model for cross-cutting contracts. |

---

## 2. What every exported symbol needs

### Module header (top of every file with ≥ 1 exported symbol)

One paragraph describing:

- **What** this module owns (the feature slice, not a restatement of
  imports).
- **Where it sits** in the control flow (controller / service /
  repository / middleware / util).
- **Cross-cutting rules** the reader must know before touching anything
  in the file (role policy, error-envelope shape, caching behaviour,
  transactional boundaries, etc.).

### Per-exported-symbol block

```ts
/**
 * One-sentence summary.
 *
 * Longer paragraph if the behaviour isn't obvious — business rules,
 * failure modes, idempotency, side effects (logs, cache writes, outbound
 * calls). Skip this paragraph for trivial getters.
 *
 * @param foo   Plain-English meaning, not the type (types live in the
 *              signature).
 * @param bar   Constraints callers must respect.
 * @returns     What the caller gets back and when it is `null`
 *              / `undefined` / throws.
 * @throws      Error types that escape (AppError subclasses, ZodError).
 */
export function doThing(foo: FooShape, bar: BarShape): Promise<Result> { … }
```

Rules of thumb:

- **Don't repeat the type.** `@param foo: Record<string, unknown>` is
  noise — TS has the type.
- **Do document the invariant.** `@param form must already be
  `IN_REVIEW`; other statuses throw.`
- **Always document throwing behaviour** for anything that escapes the
  rich error-envelope policy (see `utils/errorHandler.ts`).
- **Link to the spec** when the function implements a documented flow:
  `See [`qa_submissions_api.md`](../../docs/qa_submissions_api.md).`

### React components

```tsx
/**
 * OnDemandReportViewPage — renders a single on-demand report with its
 * filter bar and table.
 *
 * Route: `/app/insights/on-demand-reports/:reportId`
 * Roles: Admin, Manager (gated by `<RequireRole>` in `AppRoutes.tsx`)
 *
 * Data: fetches descriptors + filter options + results via TanStack
 * Query. Query keys follow `docs/frontend_query_keys.md`.
 */
export default function OnDemandReportViewPage() { … }
```

---

## 3. What does **not** need a block

Skip JSDoc for:

- Internal (non-exported) helpers < 10 lines that the module header
  already describes.
- One-liner type aliases and constant exports whose name is their
  documentation (`export const PAGE_SIZE = 25`).
- Barrel re-exports (`export { foo } from './foo'`) — the target file
  owns the doc.

---

## 4. Known-gap inventory

Large controllers still relying on section-header comments only. When you
touch any of these files, add per-exported-function JSDoc to the handlers
you change (don't try to backfill the whole file — do it opportunistically
so the diff stays reviewable).

| File                                                  | Approx exports |
| ----------------------------------------------------- | -------------- |
| `backend/src/controllers/qa.controller.ts`            | ~40            |
| `backend/src/controllers/dispute.controller.ts`       | ~30            |
| `backend/src/controllers/form.controller.ts`          | ~25            |
| `backend/src/controllers/csrAudit.controller.ts`      | ~20            |
| `backend/src/controllers/manager.controller.ts`       | ~25            |
| `backend/src/controllers/csrDashboard.controller.ts`  | ~15            |
| `backend/src/controllers/trainer.controller.ts`       | ~20            |
| `backend/src/repositories/MySQLFormRepository.ts`     | ~30            |
| `backend/src/repositories/MySQLAnalyticsRepository.ts`| ~20            |
| `backend/src/services/FormService.ts`                 | ~30            |
| `backend/src/services/SubmissionService.ts`           | ~30            |
| `frontend/src/pages/quality/SubmissionsPage.tsx`      | page component + helpers |
| `frontend/src/services/qaService.ts`                  | ~40            |
| `frontend/src/services/formService.ts`                | ~30            |

The line-count god-file refactor (review item #29 / #30) is deliberately
scoped out — these files stay as-is per the operator's decision. JSDoc
coverage is the lightweight substitute that keeps review burden
manageable without a structural refactor.

---

## 5. PR review checklist

When reviewing a PR that adds or changes an exported symbol:

1. Is there a module header? If the file is new, it needs one.
2. Does every new exported function / component have a JSDoc block?
3. Does the block answer "what does this do, and what can go wrong?"
   — not just restate the signature?
4. If the symbol relates to a cross-cutting contract (error envelope,
   role policy, audit trail, cache), does the block reference the
   governing doc?
5. If the symbol implements a public API, is there a matching `@swagger`
   block on the route (see
   [`openapi_coverage.md`](./openapi_coverage.md))?

Reject the PR if any of the above fails and the author hasn't justified
the gap. This is the single cheapest lever we have on long-term review
burden.

---

## Related documents

- [`openapi_coverage.md`](./openapi_coverage.md) — route-level contract
- [`role_permission_matrix.md`](./role_permission_matrix.md) — the role policy JSDoc should cite
- [`environment_variables.md`](./environment_variables.md) — config JSDoc should cite
