import { useQuery } from '@tanstack/react-query'
import schedulingService from '@/services/schedulingService'
import type { DayTypeMap } from '@/components/scheduling/businessDays'

/**
 * Business-calendar day types for a date range, the single source both the
 * scheduling and phone-queue day/week views read to grey non-business days and
 * to skip them when the date arrows move. Company-wide and rarely edited, so it
 * is cached generously.
 */
export function useBusinessDayTypes(from: string, to: string, enabled = true) {
  return useQuery<DayTypeMap>({
    queryKey: ['business-day-types', from, to],
    queryFn: () => schedulingService.getCalendarDayTypes(from, to),
    staleTime: 5 * 60_000,
    enabled,
  })
}
