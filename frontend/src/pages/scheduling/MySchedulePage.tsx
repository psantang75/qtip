/**
 * My Schedule — the self view (OWN access). Read-only, published shifts only.
 * It renders on the same calendar surface as the admin editor (ScheduleGrid in
 * readOnly mode) so agents read their week the same way it was built, in 12-hour
 * time. Agents never see drafts; the backend enforces that — this page just
 * renders what it is given.
 */
import { useState } from 'react'
import { CalendarClock, ChevronLeft, ChevronRight } from 'lucide-react'

import { ListPageShell } from '@/components/common/ListPageShell'
import { ListPageHeader } from '@/components/common/ListPageHeader'
import { ListCard } from '@/components/common/ListCard'
import { ListLoadingSkeleton } from '@/components/common/ListLoadingSkeleton'
import { Button } from '@/components/ui/button'
import { TooltipProvider } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

import { ScheduleGrid } from '@/components/scheduling/ScheduleGrid'
import { addDays, parseLocal, startOfWeek, toLocalIso } from '@/components/scheduling/mockScheduleData'
import { useMySchedule } from '@/hooks/useMySchedule'

type ViewMode = 'week' | 'period'

const VIEWS: { id: ViewMode; label: string }[] = [
  { id: 'week', label: 'Week' },
  { id: 'period', label: '2 Weeks' },
]

/** Canonical QTIP segmented-control styling — see formRendererComponents. */
const optionCls = (selected: boolean) =>
  selected
    ? 'bg-[#00aeef] text-white border-[#00aeef]'
    : 'bg-white text-slate-600 border-slate-200 hover:border-[#00aeef] hover:text-[#00aeef]'

export default function MySchedulePage() {
  const [view, setView] = useState<ViewMode>('week')
  const [anchor, setAnchor] = useState(startOfWeek(toLocalIso(new Date())))

  const span = view === 'week' ? 7 : 14
  const from = anchor
  const to = addDays(anchor, span - 1)

  const my = useMySchedule(from, to)
  const person = my.data?.person
  const published = my.data?.published ?? false

  const shiftBy = (dir: 1 | -1) => setAnchor(a => addDays(a, dir * span))
  const rangeLabel = `${parseLocal(from).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} \u2013 ${parseLocal(to).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`

  return (
    <TooltipProvider delayDuration={150}>
      <ListPageShell>
        <ListPageHeader
          title="My Schedule"
          subtitle="Your published shifts, breaks and lunches."
          actions={
            <div className="flex items-center gap-3">
              <div className="flex gap-1">
                {VIEWS.map(v => (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => setView(v.id)}
                    className={cn('h-9 rounded border px-3 text-[12px] font-medium transition-all', optionCls(view === v.id))}
                  >
                    {v.label}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-1">
                <Button variant="outline" size="sm" className="h-9 w-9 p-0" onClick={() => shiftBy(-1)} aria-label="Previous">
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="min-w-[170px] text-center text-[13px] font-medium text-slate-700">{rangeLabel}</span>
                <Button variant="outline" size="sm" className="h-9 w-9 p-0" onClick={() => shiftBy(1)} aria-label="Next">
                  <ChevronRight className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 px-3 text-[12px]"
                  onClick={() => setAnchor(startOfWeek(toLocalIso(new Date())))}
                >
                  Today
                </Button>
              </div>
            </div>
          }
        />

        <ListCard>
          {my.isLoading ? (
            <ListLoadingSkeleton rows={7} />
          ) : !published ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
              <CalendarClock className="h-8 w-8 text-slate-300" />
              <p className="text-[13px] text-slate-500">No published schedule in this range.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <ScheduleGrid
                readOnly
                people={person ? [person] : []}
                variant={view === 'week' ? 'week' : 'period'}
                weekStarts={view === 'week' ? [anchor] : [anchor, addDays(anchor, 7)]}
              />
            </div>
          )}
        </ListCard>
      </ListPageShell>
    </TooltipProvider>
  )
}
