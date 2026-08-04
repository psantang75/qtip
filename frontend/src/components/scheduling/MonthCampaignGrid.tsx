/**
 * MonthCampaignGrid — the call-campaign month calendar as category lanes.
 *
 * One block per week (Mon–Fri; the projection never places a chip on a weekend),
 * and inside each block one lane per campaign category in library sort order.
 * A lane holds the sequential steps of one dunning chain, so reading it across
 * the month reads as a single campaign track; a day with no step stays blank.
 * Lane rows are grid rows, so a day that stacks two steps grows the whole lane
 * and every column stays aligned instead of truncating to "+N more".
 *
 * Clicking a cell opens DayCampaignPopover scoped to that one category; clicking
 * the day header opens it for the whole day. Non-workdays are greyed and inert.
 */
import { Fragment, useEffect, useMemo, useRef } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { ApiMembershipRow, ApiMonthProjection, ApiProjectedDay } from '@/services/campaignService'
import { DayCampaignPopover } from './DayCampaignPopover'

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']
/** Mirrors ScheduleGrid's NAME_COL so both scheduling grids gutter identically. */
const GRID_COLS = '186px repeat(5, minmax(148px, 1fr))'

const CELL_BG: Record<string, string> = {
  WORKDAY: 'bg-white',
  ADJUSTMENT: 'bg-purple-50',
  HOLIDAY: 'bg-blue-50',
  CLOSURE: 'bg-orange-50',
}
const NON_WORKDAY_LABEL: Record<string, string> = { HOLIDAY: 'Holiday', CLOSURE: 'Closed' }

interface Lane { category_id: number; name: string; color: string }

function utcNoon(ds: string): Date {
  const [y, m, d] = ds.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d, 12))
}
function dowOf(ds: string): number { return utcNoon(ds).getUTCDay() }
function dateNum(ds: string): number { return parseInt(ds.slice(-2), 10) }
function shortLabel(ds: string): string {
  return utcNoon(ds).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}
function longLabel(ds: string): string {
  return utcNoon(ds).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}
function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
/** Monday of the week containing `ds`, as YYYY-MM-DD. */
function mondayOf(ds: string): string {
  const dt = utcNoon(ds)
  const dow = dt.getUTCDay()
  dt.setUTCDate(dt.getUTCDate() + (dow === 0 ? -6 : 1 - dow))
  return dt.toISOString().slice(0, 10)
}

/** Weekday-only days bucketed into weeks, each a fixed Mon–Fri slot array. */
function buildWeeks(days: ApiProjectedDay[]): Array<Array<ApiProjectedDay | null>> {
  const byWeek = new Map<string, Array<ApiProjectedDay | null>>()
  for (const day of days) {
    const dow = dowOf(day.date)
    if (dow === 0 || dow === 6) continue
    const key = mondayOf(day.date)
    if (!byWeek.has(key)) byWeek.set(key, Array(5).fill(null))
    byWeek.get(key)![dow - 1] = day
  }
  return [...byWeek.keys()].sort().map(k => byWeek.get(k)!)
}

/**
 * Lanes in library order, limited to categories that actually appear this month.
 * Membership carries category_sort; anything placed by an override but missing
 * from membership is appended so a manual add is never invisible.
 */
function buildLanes(days: ApiProjectedDay[], membership: ApiMembershipRow[]): Lane[] {
  const present = new Set(days.flatMap(d => d.chips.map(c => c.category_id)))
  const seen = new Set<number>()
  const lanes: Lane[] = []
  for (const m of [...membership].sort((a, b) => a.category_sort - b.category_sort || a.item_sort - b.item_sort)) {
    if (!present.has(m.category_id) || seen.has(m.category_id)) continue
    seen.add(m.category_id)
    lanes.push({ category_id: m.category_id, name: m.category_name, color: m.color })
  }
  for (const day of days) {
    for (const c of day.chips) {
      if (seen.has(c.category_id)) continue
      seen.add(c.category_id)
      lanes.push({ category_id: c.category_id, name: c.category_name, color: c.color })
    }
  }
  return lanes
}

/** The Monday a week block belongs to, so it can be matched against today's. */
function weekStartOf(week: Array<ApiProjectedDay | null>): string | null {
  const first = week.find((d): d is ApiProjectedDay => d != null)
  return first ? mondayOf(first.date) : null
}

function weekRange(week: Array<ApiProjectedDay | null>): string {
  const present = week.filter((d): d is ApiProjectedDay => d != null)
  if (present.length === 0) return ''
  const first = present[0].date
  const last = present[present.length - 1].date
  return first === last ? shortLabel(first) : `${shortLabel(first)} \u2013 ${shortLabel(last)}`
}

const gutterCell = 'sticky left-0 z-10 border-r border-slate-200'

export function MonthCampaignGrid({ projection, membership, canEdit, onToggle }: {
  projection: ApiMonthProjection
  membership: ApiMembershipRow[]
  canEdit: boolean
  onToggle: (date: string, campaignItemId: number, isOn: boolean) => void
}) {
  const days = projection.days
  const weeks = useMemo(() => buildWeeks(days), [days])
  const lanes = useMemo(() => buildLanes(days, membership), [days, membership])
  const today = todayIso()
  const currentWeekStart = mondayOf(today)

  // Land on the current week when viewing the current month: a month deep in
  // lanes can push today well below the fold. Only scroll when it is actually
  // off-screen, so a first-week "today" doesn't pull the header out of view.
  const currentWeekRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const el = currentWeekRef.current
    if (!el) return
    const { top, bottom } = el.getBoundingClientRect()
    if (top < 0 || bottom > window.innerHeight) {
      el.scrollIntoView({ block: 'center', inline: 'nearest' })
    }
  }, [projection.schedule_id, projection.year, projection.month, lanes.length])

  if (lanes.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-[13px] text-slate-400">
        No campaigns land in this month. Use Build to enable campaigns for this schedule.
      </div>
    )
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      {weeks.map((week, wi) => (
        <div key={wi} ref={weekStartOf(week) === currentWeekStart ? currentWeekRef : undefined}
          className={cn('grid', wi > 0 && 'border-t-[6px] border-slate-100')}
          style={{ gridTemplateColumns: GRID_COLS }}>
          {/* Week header: range in the gutter, weekday + date across */}
          <div className={cn(gutterCell, 'border-b border-slate-200 bg-slate-50 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400')}>
            {weekRange(week)}
          </div>
          {week.map((day, di) => (
            <DayHeader key={di} day={day} weekday={WEEKDAYS[di]} today={today} isLast={di === 4}
              membership={membership} canEdit={canEdit} onToggle={onToggle} />
          ))}

          {/* One lane per category, blank where the campaign has no step */}
          {lanes.map(lane => (
            <Fragment key={lane.category_id}>
              <LaneLabel lane={lane} />
              {week.map((day, di) => (
                <LaneCell key={di} day={day} lane={lane} isLast={di === 4}
                  membership={membership} canEdit={canEdit} onToggle={onToggle} />
              ))}
            </Fragment>
          ))}
        </div>
      ))}
    </div>
  )
}

/** The category name in the gutter — truncates, so the hover gives it in full. */
function LaneLabel({ lane }: { lane: Lane }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className={cn(gutterCell, 'flex cursor-default items-center gap-2 border-b border-slate-100 bg-white px-3 py-1.5')}>
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: lane.color }} />
          <span className="truncate text-[12px] font-medium text-slate-600">{lane.name}</span>
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom" align="start" className="max-w-xs">{lane.name}</TooltipContent>
    </Tooltip>
  )
}

/** Weekday + date. On a workday it's the trigger for the whole-day checklist. */
function DayHeader({ day, weekday, today, isLast, membership, canEdit, onToggle }: {
  day: ApiProjectedDay | null
  weekday: string
  today: string
  isLast: boolean
  membership: ApiMembershipRow[]
  canEdit: boolean
  onToggle: (date: string, campaignItemId: number, isOn: boolean) => void
}) {
  const base = cn('flex w-full items-center gap-1.5 border-b border-slate-200 bg-slate-50 px-2 py-2 text-left',
    !isLast && 'border-r')
  const label = <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{weekday}</span>

  if (day == null) return <div className={cn(base, 'opacity-40')}>{label}</div>

  const inner = (
    <>
      {label}
      <span className={cn('flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[12px] font-semibold',
        day.date === today ? 'bg-primary text-white' : 'text-slate-700')}>{dateNum(day.date)}</span>
      {!day.is_workday && (
        <span className="rounded bg-slate-200 px-1 py-0.5 text-[9px] font-medium text-slate-500">
          {NON_WORKDAY_LABEL[day.day_type] ?? ''}
        </span>
      )}
    </>
  )

  if (!day.is_workday) return <div className={base}>{inner}</div>

  return (
    <DayCampaignPopover date={day.date} dateLabel={longLabel(day.date)} dayChips={day.chips}
      membership={membership} canEdit={canEdit} onToggle={onToggle}>
      <button type="button" aria-label={`All campaigns on ${longLabel(day.date)}`}
        className={cn(base, 'transition-colors hover:bg-slate-100 focus:outline-none focus-visible:ring-1 focus-visible:ring-primary')}>
        {inner}
      </button>
    </DayCampaignPopover>
  )
}

function LaneCell({ day, lane, isLast, membership, canEdit, onToggle }: {
  day: ApiProjectedDay | null
  lane: Lane
  isLast: boolean
  membership: ApiMembershipRow[]
  canEdit: boolean
  onToggle: (date: string, campaignItemId: number, isOn: boolean) => void
}) {
  const base = cn('flex flex-col gap-1 border-b border-slate-100 p-1.5', !isLast && 'border-r')
  if (day == null) return <div className={cn(base, 'bg-slate-50/40')} />
  if (!day.is_workday) return <div className={cn(base, CELL_BG[day.day_type] ?? 'bg-slate-50')} />

  const chips = day.chips.filter(c => c.category_id === lane.category_id)
  const laneMembership = membership.filter(m => m.category_id === lane.category_id)

  return (
    <DayCampaignPopover
      date={day.date}
      dateLabel={`${longLabel(day.date)} \u00b7 ${lane.name}`}
      dayChips={chips}
      membership={laneMembership}
      canEdit={canEdit}
      onToggle={onToggle}
    >
      <button type="button"
        aria-label={`${lane.name} on ${longLabel(day.date)}`}
        className={cn(base, 'min-h-9 w-full text-left transition-colors hover:bg-slate-50 focus:outline-none focus-visible:ring-1 focus-visible:ring-primary',
          CELL_BG[day.day_type] ?? 'bg-white')}>
        {chips.map(c => (
          <Tooltip key={c.campaign_item_id}>
            <TooltipTrigger asChild>
              <span className="truncate rounded px-1.5 py-1 text-[11px] font-medium leading-tight text-white"
                style={{ backgroundColor: c.color }}>
                {c.label}
              </span>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-xs">{c.label}</TooltipContent>
          </Tooltip>
        ))}
      </button>
    </DayCampaignPopover>
  )
}
