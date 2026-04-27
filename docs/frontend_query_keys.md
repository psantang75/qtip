# TanStack Query — Key Conventions

Pre-production review item #77. These rules make query keys
invalidate-by-name instead of invalidate-by-prefix-coincidence.

## 1. Shape

Use a tuple where the **first segment is a domain noun** and each subsequent
segment is a scope modifier (resource, id, filter hash, role, …):

```ts
// domain           resource    id       scope modifiers
['submissions',   'detail',   id,      roleId]
['submissions',   'list',     filtersHash]
['coaching',      'session',  sessionId]
['coaching',      'list',     filtersHash]
['on-demand-reports', 'data', reportId, page, pageSize, appliedFiltersHash]
['insights-access', pageKey,  userId]
```

Rules:

1. **Domain first, always.** `submissions`, `coaching`, `writeups`,
   `insights`, `forms`, `disputes`, `csr`, `on-demand-reports`, …
2. **Sub-resource second** (`list` / `detail` / `options` / `summary`).
   This lets a single call invalidate every list under a domain
   (`queryClient.invalidateQueries({ queryKey: ['submissions', 'list'] })`)
   without touching detail pages that are still valid.
3. **Ids and role scope** come after the sub-resource so keys sort naturally.
4. **Filter objects** go through `JSON.stringify` (or a stable hash helper)
   at the **last** position so partial prefix matches still work for
   "invalidate all lists in this domain."

## 2. Don't drop role scope in invalidation

Detail pages like `SubmissionDetailPage.tsx` key on
`['submissions', 'detail', id, roleId]` because the response shape
depends on the viewer's role. When invalidating after a mutation, include
the role or use the coarser list prefix — **never** silently drop the
trailing `roleId` and hope TanStack Query's prefix matcher does the right
thing.

```ts
// ✅ Correct — refetch the exact key
qc.invalidateQueries({ queryKey: ['submissions', 'detail', id, roleId] })

// ✅ Also fine — refetch every detail view for this submission
qc.invalidateQueries({ queryKey: ['submissions', 'detail', id] })

// ❌ Wrong — drops the id, nukes every detail query globally
qc.invalidateQueries({ queryKey: ['submissions', 'detail'] })
```

## 3. Use `exact: true` for cache reads

`getQueryData` / `setQueryData` take exact keys. When writing optimistic
updates, pass the full key including role scope so you don't overwrite a
stale sibling entry.

## 4. Where to put new keys

- **Page-local keys** can stay inline in the page file.
- **Keys shared by multiple components** belong in a `queryKeys.ts` next
  to the service (e.g. `services/csrService.ts` →
  `services/csrQueryKeys.ts`). That file should export a `const` object
  so callers get autocomplete and refactors are safe:

```ts
export const csrQueryKeys = {
  all:    ['csr'] as const,
  audits: (filters: CsrAuditFilters) =>
    [...csrQueryKeys.all, 'audits', filters] as const,
  audit:  (id: number) =>
    [...csrQueryKeys.all, 'audit', id] as const,
}
```

## 5. Global cache reset

`CacheResetGuard` in `app/guards.tsx` calls `queryClient.clear()` whenever
the logged-in user changes, so role-scoped data from a prior session
never leaks. Keys should follow the convention above so a session-scoped
clear is the only "reset everything" code path in the app.
