/**
 * Live templates, adapted to the MockTemplate shape the Apply dialog and
 * template components consume. The API returns a sparse day list (only the days
 * the template covers); the mock shape wants a dense seven-entry week indexed by
 * day_of_week (0 = Sunday), so the adapter fills the gaps with days off.
 */
import { useQuery } from '@tanstack/react-query'
import schedulingService, { type ApiTemplate } from '@/services/schedulingService'
import type { MockTemplate, TemplateDay, MockBreak } from '@/components/scheduling/mockScheduleData'

const OFF: TemplateDay = { working: false, start: '08:00', end: '17:00', breaks: [] }
// Prisma Time columns come back as an epoch-anchored Date, so JSON gives an ISO
// datetime ('1970-01-01T08:00:00.000Z'); take the UTC wall-clock. Plain
// 'HH:MM(:SS)' strings are handled too.
const hm = (t: string) => (t.includes('T') ? t.slice(11, 16) : t.slice(0, 5))

export function adaptTemplate(t: ApiTemplate): MockTemplate {
  const days: TemplateDay[] = Array.from({ length: 7 }, () => ({ ...OFF }))
  for (const d of t.days) {
    if (d.is_day_off || !d.start_time || !d.end_time) {
      days[d.day_of_week] = { ...OFF }
      continue
    }
    const breaks: MockBreak[] = d.segments.map((s) => ({
      kind: 'BREAK',
      start: hm(s.start_time),
      end: hm(s.end_time),
    }))
    days[d.day_of_week] = { working: true, start: hm(d.start_time), end: hm(d.end_time), breaks }
  }
  return { id: t.id, name: t.template_name, description: t.description ?? '', isActive: t.is_active, days }
}

export function useScheduleTemplates(enabled = true) {
  return useQuery({
    queryKey: ['schedule-templates'],
    queryFn: () => schedulingService.listTemplates(false),
    enabled,
    select: (rows: ApiTemplate[]) => rows.map(adaptTemplate),
  })
}
