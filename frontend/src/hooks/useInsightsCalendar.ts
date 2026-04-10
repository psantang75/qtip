import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getCalendar,
  updateCalendarDay,
  saveCalendarMonthDefaults,
  type CalendarDayEntry,
  type CalendarUpdatePayload,
} from '@/services/insightsService'

export type { CalendarDayEntry }

/** Fetch all calendar days (stored + synthesized defaults) for a month. */
export function useCalendar(year: number, month: number) {
  return useQuery({
    queryKey: ['insights-calendar', year, month],
    queryFn:  () => getCalendar(year, month),
    staleTime: 30_000,
  })
}

/** Mutation to update (upsert) a single calendar day. */
export function useUpdateCalendarDay() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ date, payload }: { date: string; payload: CalendarUpdatePayload }) =>
      updateCalendarDay(date, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['insights-calendar'] })
    },
  })
}

/** Mutation to fill a month with Mon–Fri defaults for all un-stored dates. */
export function useSaveMonthDefaults() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ year, month }: { year: number; month: number }) =>
      saveCalendarMonthDefaults(year, month),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['insights-calendar'] })
    },
  })
}
