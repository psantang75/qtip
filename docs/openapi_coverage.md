# OpenAPI coverage audit

Swagger UI is wired at [`/api-docs`](http://localhost:3000/api-docs) and
served by `swagger-ui-express` against a `swagger-jsdoc` spec built from
[`backend/src/config/swagger.ts`](../backend/src/config/swagger.ts). The spec
scans comments matching the JSDoc `@swagger` / `@openapi` tags in
`backend/src/routes/*.ts`.

---

## Current coverage — as of this review

`rg "@swagger|@openapi" backend/src/routes` returns **zero matches**. The
spec therefore advertises the default shell (title, servers, security
schemes, two component schemas — `User`, `ErrorResponse`) without any
documented paths. Swagger UI renders but has an empty path list.

**Impact:** no client is using the generated spec as a contract. The
`/api-docs` URL is effectively decorative until this is populated.

---

## Target coverage

### Tier 1 — must document (next sprint)

Routes that are external-consumer-facing or security-critical. A failure
to document these makes the API feel like a private endpoint, and blocks
any future SDK or partner integration.

| Route file                      | Why tier 1                                                |
| ------------------------------- | --------------------------------------------------------- |
| `auth.routes.ts`                | Login, refresh, logout — security critical, stable shape. |
| `onDemandReports.routes.ts`     | External-report integration target.                       |
| `csr.routes.ts`                 | Agent-facing; webhooks may key off it.                    |
| `writeup.routes.ts`             | HR-facing; stable contract.                               |
| `insightsQC.routes.ts`          | KPI consumer-facing.                                      |

### Tier 2 — document opportunistically

Any time a controller is edited, add `@swagger` blocks for the routes
touched. Covers `form.routes`, `submission.routes`, `dispute.routes`,
`coaching`, `manager.routes`, `analytics.routes`, `report.routes`.

### Tier 3 — not exposed publicly

`admin.routes`, `insightsAdmin.routes`, `imports`, `rawData`,
`monitoring.routes`. Document the shape internally but don't publish a
server entry that points at them. Consider gating `/api-docs` behind
`authorizeAdmin` in production when the spec is actually useful (see §
[Swagger UI exposure](#swagger-ui-exposure) below).

---

## Documentation format

Use a JSDoc block immediately above each route registration:

```ts
/**
 * @swagger
 * /api/on-demand-reports:
 *   get:
 *     summary: List available on-demand reports
 *     description: Registry-driven list. Admin + Manager only.
 *     tags: [Reports]
 *     security: [{ BearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Report descriptors
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/OnDemandReportDescriptor'
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.get('/', authorizeOnDemandReportRole, onDemandReports.list)
```

Shared schemas (`User`, `ErrorResponse`, plus new additions like
`OnDemandReportDescriptor`, `Submission`, `Dispute`) belong in
`config/swagger.ts` under `components.schemas`. Add shared responses
(`Unauthorized`, `Forbidden`, `ValidationFailed`) at the same time so
route blocks can reference them by `$ref`.

---

## Versioning policy

QTIP's API follows these rules:

| Change type                                                 | SemVer bump                                 | Swagger `info.version` |
| ----------------------------------------------------------- | ------------------------------------------- | ---------------------- |
| Breaking: removed path, removed field, changed field type   | **Major** (`2.x.y` → `3.0.0`)               | bump, cut release notes |
| Non-breaking addition: new route, new optional field        | **Minor** (`2.1.y` → `2.2.0`)               | bump                    |
| Internal fix that doesn't change contract                   | **Patch**                                   | bump                    |

- `info.version` is sourced from `config.APP_VERSION`, which mirrors
  `package.json` at the repo root. Bump the package version in the same
  PR as the breaking change.
- There is no URL-based API version (no `/v1/`, `/v2/`). We rely on
  SemVer on the spec and deprecation headers on deprecated endpoints
  (`Deprecation: true`, `Sunset: <http-date>`).
- Deprecated endpoints should keep working for at least one minor-version
  release after deprecation, and announce the removal in
  [`CHANGELOG.md`](./CHANGELOG.md).

---

## Swagger UI exposure

`/api-docs` is currently public. In production this leaks internal route
structure to anyone who can reach the API. Recommended hardening, in
priority order:

1. **Short term** — front-door IP allow-list at nginx/IIS so only the
   office subnet hits `/api-docs`.
2. **Long term** — wrap the `app.use('/api-docs', …)` registration in a
   role guard (`authorizeAdmin`) so only Admin sessions load the UI.

Both are behaviour changes; leave the current setup alone until the
first Tier-1 route is documented so operators don't notice a blank UI
suddenly locking them out.

---

## Keeping this file honest

1. When you add `@swagger` to a route, move its row from Tier 1/2 into a
   "Documented" section in this file.
2. Pair every route you change with a spec refresh — the JSDoc block
   lives next to the handler for exactly this reason.
3. Run `npm run typecheck` after editing — swagger-jsdoc comments are not
   type-checked, but malformed YAML will crash the spec build on the next
   server start.

---

## Related documents

- [`role_permission_matrix.md`](./role_permission_matrix.md) — authoritative role → route map
- [`environment_variables.md`](./environment_variables.md) — env contract
- [`PRODUCTION_GUIDE.md`](./PRODUCTION_GUIDE.md) — /api-docs section
