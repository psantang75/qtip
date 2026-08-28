/**
 * Query keys for phone queues. Shared by the List Management editor and the
 * coverage page, so they live next to the service per docs/frontend_query_keys.md
 * rather than inline.
 *
 * Domain first (`phone-queues`), then sub-resource, then scope. Saving a
 * department's configuration invalidates `department(id)`, which is a prefix of
 * queues/policy/roster/coverage for that department, so one call refreshes the
 * whole page without touching another department's cache.
 */
export const phoneQueueKeys = {
  all: ['phone-queues'] as const,

  library: (includeInactive: boolean) => [...phoneQueueKeys.all, 'library', includeInactive] as const,
  departments: () => [...phoneQueueKeys.all, 'departments'] as const,

  department: (departmentId: number) => [...phoneQueueKeys.all, 'department', departmentId] as const,
  departmentQueues: (departmentId: number) => [...phoneQueueKeys.department(departmentId), 'queues'] as const,
  policy: (departmentId: number) => [...phoneQueueKeys.department(departmentId), 'policy'] as const,
  roster: (departmentId: number) => [...phoneQueueKeys.department(departmentId), 'roster'] as const,

  coverage: (departmentId: number, date: string, includeDraft: boolean) =>
    [...phoneQueueKeys.department(departmentId), 'coverage', date, includeDraft] as const,
  weekCoverage: (departmentId: number, start: string, includeDraft: boolean) =>
    [...phoneQueueKeys.department(departmentId), 'coverage-week', start, includeDraft] as const,
  overrides: (departmentId: number, date: string) =>
    [...phoneQueueKeys.department(departmentId), 'overrides', date] as const,

  members: (queueId: number) => [...phoneQueueKeys.all, 'members', queueId] as const,
}
