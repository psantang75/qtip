/**
 * Fetches the live schedule grid for a date range and adapts it into the
 * MockPerson[] shape the approved grid components already consume, so the UI
 * built during the mockup phase renders real data with no component churn.
 *
 * The adapter is intentionally the only place that knows both shapes; when the
 * mock types are eventually deleted the components will move to ApiShift
 * directly and this file goes with them.
 */
import { useQuery } from '@tanstack/react-query'
import schedulingService, { type ApiGrid } from '@/services/schedulingService'
import type { MockPerson, MockShift, MockException, MockBreak } from '@/components/scheduling/mockScheduleData'

const UNASSIGNED = 'Unassigned'

export function toBreak(label: string, start: string, end: string): MockBreak {
  return { kind: label.toLowerCase().includes('lunch') ? 'LUNCH' : 'BREAK', start, end }
}

export function adaptGrid(grid: ApiGrid): { people: MockPerson[]; departments: string[] } {
  const shiftsByUser = new Map<number, MockShift[]>()
  for (const s of grid.shifts) {
    if (s.is_day_off || !s.start || !s.end) continue
    const arr = shiftsByUser.get(s.user_id) ?? shiftsByUser.set(s.user_id, []).get(s.user_id)!
    arr.push({
      date: s.shift_date,
      start: s.start,
      end: s.end,
      breaks: s.segments.map((seg) => toBreak(seg.label, seg.start, seg.end)),
      status: s.status,
    })
  }

  const exByUser = new Map<number, MockException[]>()
  for (const e of grid.exceptions) {
    const arr = exByUser.get(e.user_id) ?? exByUser.set(e.user_id, []).get(e.user_id)!
    arr.push({
      id: e.id,
      date: e.exception_date,
      exceptionTypeId: e.exception_type_id,
      typeLabel: e.label,
      excused: e.is_excused,
      isFullDay: e.is_full_day,
      isImported: e.is_imported,
      start: e.start ?? undefined,
      end: e.end ?? undefined,
    })
  }

  const people: MockPerson[] = grid.roster.map((u) => ({
    id: u.id,
    name: u.username,
    department: u.department_name,
    shifts: shiftsByUser.get(u.id) ?? [],
    exceptions: exByUser.get(u.id) ?? [],
  }))

  const departments = Array.from(
    new Set(grid.roster.map((u) => u.department_name ?? UNASSIGNED)),
  ).sort()

  return { people, departments }
}

export function useScheduleGrid(from: string, to: string, enabled = true) {
  return useQuery({
    queryKey: ['schedule-grid', from, to],
    queryFn: () => schedulingService.getGrid(from, to),
    enabled,
    placeholderData: (prev) => prev,
    select: adaptGrid,
  })
}
