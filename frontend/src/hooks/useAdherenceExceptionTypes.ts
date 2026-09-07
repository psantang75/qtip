/**
 * The admin-managed adherence exception type list (the excused/unexcused catalog),
 * for every place that offers a type to pick when logging an adherence exception.
 *
 * Active types only — a retired type must not be offered for a new entry, even
 * though old rows still reference it. Mirrors useExceptionTypes.
 */
import { useQuery } from '@tanstack/react-query'
import schedulingService from '@/services/schedulingService'

export function useAdherenceExceptionTypes(enabled = true) {
  return useQuery({
    queryKey: ['adherence-exception-types', 'active'],
    queryFn: () => schedulingService.listAdherenceExceptionTypes(false),
    enabled,
  })
}
