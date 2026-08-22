/**
 * Self schedule adapted into the MockPerson shape the read-only ScheduleGrid
 * consumes, so an agent's My Schedule renders on the same calendar surface as the
 * admin editor. Published shifts only (enforced server-side); the endpoint returns
 * no exceptions to agents, so that list is always empty here.
 */
import { useQuery } from '@tanstack/react-query'
import schedulingService, { type ApiShift } from '@/services/schedulingService'
import { useAuth } from '@/hooks/useAuth'
import type { MockPerson, MockShift } from '@/components/scheduling/mockScheduleData'
import { toBreak } from './useScheduleGrid'

export interface MyScheduleData {
  person: MockPerson
  /**
   * The range has at least one published entry — a working shift OR an explicit
   * day off. A fully-off but published week is a real schedule, so it must render
   * the calendar rather than the "nothing published" empty state.
   */
  published: boolean
}

function adaptMySchedule(shifts: ApiShift[], name: string): MyScheduleData {
  const mockShifts: MockShift[] = []
  for (const s of shifts) {
    // Day-off / open days have no bar to draw — they read as an empty cell.
    if (s.is_day_off || !s.start || !s.end) continue
    mockShifts.push({
      date: s.shift_date,
      start: s.start,
      end: s.end,
      breaks: s.segments.map((seg) => toBreak(seg.label, seg.start, seg.end)),
      status: 'PUBLISHED',
    })
  }
  return {
    person: { id: 0, name, department: null, shifts: mockShifts, exceptions: [] },
    published: shifts.length > 0,
  }
}

export function useMySchedule(from: string, to: string, enabled = true) {
  const name = useAuth().user?.username ?? 'You'
  return useQuery({
    queryKey: ['my-schedule', from, to],
    queryFn: () => schedulingService.getMySchedule(from, to),
    enabled,
    placeholderData: (prev) => prev,
    select: (rows: ApiShift[]) => adaptMySchedule(rows, name),
  })
}
