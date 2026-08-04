/**
 * The admin-managed exception type list, for every place that offers a type to
 * pick. Eight of these are linked to a Paychex pay type and are normally written
 * by the punch import; the pickers exist for the manual entry that overrides it.
 *
 * Active types only — a retired type must not be offered for a new entry, even
 * though old rows still reference it.
 */
import { useQuery } from '@tanstack/react-query'
import schedulingService, { type ApiExceptionType } from '@/services/schedulingService'

export function useExceptionTypes(enabled = true) {
  return useQuery({
    queryKey: ['schedule-exception-types'],
    queryFn: () => schedulingService.listExceptionTypes(false),
    enabled,
  })
}

/** Whether the entry form should ask for a time window, given the picked type. */
export function windowMode(type: ApiExceptionType | undefined, fullDayToggle: boolean) {
  const forcesFullDay = type?.duration_mode === 'FULL_DAY'
  const forcesWindow = type?.duration_mode === 'WINDOW'
  return {
    forcesFullDay,
    forcesWindow,
    isFullDay: forcesFullDay || (!forcesWindow && fullDayToggle),
  }
}
