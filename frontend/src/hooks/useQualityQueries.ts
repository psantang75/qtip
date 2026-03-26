/**
 * Shared TanStack Query hooks for common Quality data lookups.
 * Single cache key per resource — all callers share the same cached value.
 */
import { useQuery } from '@tanstack/react-query'
import qaService from '@/services/qaService'

/** Active QA forms — used by Review Forms list and form filter dropdowns */
export function useActiveForms() {
  return useQuery({
    queryKey: ['forms-list-active'],
    queryFn: () => qaService.getForms({ is_active: true }),
    staleTime: 30 * 1000,
  })
}

/** All forms (active + inactive) — used by Form Builder list */
export function useAllForms() {
  return useQuery({
    queryKey: ['forms-list'],
    queryFn: () => qaService.getForms(),
    staleTime: 30 * 1000,
  })
}

/** Forms for filter dropdowns (lightweight) */
export function useFormsForFilter() {
  return useQuery({
    queryKey: ['forms-filter'],
    queryFn: () => qaService.getFormsForFilter(),
    staleTime: 5 * 60 * 1000,
  })
}

/** Manager's team CSRs */
export function useTeamCsrs(enabled = true) {
  return useQuery({
    queryKey: ['team-csrs'],
    queryFn: () => qaService.getTeamCSRs(),
    staleTime: 5 * 60 * 1000,
    enabled,
  })
}

/** Analytics filter options (org-wide CSRs, forms, departments) */
export function useAnalyticsFilters(enabled = true) {
  return useQuery({
    queryKey: ['analytics-filters'],
    queryFn: () => qaService.getAnalyticsFilters(),
    staleTime: 5 * 60 * 1000,
    enabled,
  })
}
