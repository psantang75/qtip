import { useState } from 'react'
import { ChevronLeft, ChevronRight, Calendar, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/Select'
import { Textarea } from '@/components/ui/textarea'
import { useCalendar, useUpdateCalendarDay, useSaveMonthDefaults } from '@/hooks/useInsightsCalendar'
import type { CalendarDayEntry, BusinessDayType } from '@/services/insightsService'
import { cn } from '@/lib/utils'

// ── Constants ─────────────────────────────────────────────────────────────────

const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
]

const DAY_HEADERS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']

const DAY_TYPE_CONFIG: Record<BusinessDayType, { label: string; badge: string; cell: string }> = {
  WORKDAY:    { label: 'Work Day',   badge: 'bg-emerald-100 text-emerald-700 border-emerald-300', cell: 'bg-emerald-50' },
  WEEKEND:    { label: 'Weekend',    badge: 'bg-slate-100 text-slate-500 border-slate-300',       cell: 'bg-slate-50'   },
  HOLIDAY:    { label: 'Holiday',    badge: 'bg-blue-100 text-blue-700 border-blue-300',          cell: 'bg-blue-50'    },
  CLOSURE:    { label: 'Closure',    badge: 'bg-orange-100 text-orange-700 border-orange-300',    cell: 'bg-orange-50'  },
  ADJUSTMENT: { label: 'Adjustment', badge: 'bg-purple-100 text-purple-700 border-purple-300',   cell: 'bg-purple-50'  },
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function InsightsCalendarPage() {
  const now = new Date()
  const [year,  setYear]  = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1) // 1-based

  const [editDay,  setEditDay]  = useState<CalendarDayEntry | null>(null)
  const [editType, setEditType] = useState<BusinessDayType>('WORKDAY')
  const [editNote, setEditNote] = useState<string>('')

  const { data, isLoading, isError } = useCalendar(year, month)
  const updateMutation = useUpdateCalendarDay()
  const saveMutation   = useSaveMonthDefaults()

  // ── Month navigation ──────────────────────────────────────────────────────

  function prevMonth() {
    if (month === 1) { setYear(y => y - 1); setMonth(12) }
    else              setMonth(m => m - 1)
  }
  function nextMonth() {
    if (month === 12) { setYear(y => y + 1); setMonth(1) }
    else               setMonth(m => m + 1)
  }

  // ── Day cell click → open editor ─────────────────────────────────────────

  function openEdit(day: CalendarDayEntry) {
    setEditDay(day)
    setEditType(day.day_type)
    setEditNote(day.note ?? '')
  }

  function closeEdit() {
    setEditDay(null)
    setEditNote('')
  }

  async function saveEdit() {
    if (!editDay) return
    await updateMutation.mutateAsync({
      date:    editDay.calendar_date,
      payload: { day_type: editType, note: editNote.trim() || null },
    })
    closeEdit()
  }

  // ── Derived data ──────────────────────────────────────────────────────────

  const days       = data?.days ?? []
  const summary    = data?.summary
  const savedCount = days.filter(d => d.is_stored).length

  // Day-of-week offset for the 1st of the month
  const firstDow = days.length > 0
    ? new Date(days[0].calendar_date + 'T00:00:00Z').getUTCDay()
    : 0
  const blanks   = Array.from({ length: firstDow })
  const isSaving = saveMutation.isPending

  return (
    <div className="space-y-3">

      {/* ── Title ─────────────────────────────────────────────────────────── */}
      <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
        <Calendar className="h-6 w-6 text-primary" />
        Business Calendar
      </h1>

      {/* ── Month navigation — centered, large ───────────────────────────── */}
      <div className="flex items-center justify-center gap-4">
        <Button variant="ghost" size="icon" onClick={prevMonth}>
          <ChevronLeft size={22} />
        </Button>
        <span className="text-3xl font-bold text-slate-800 w-64 text-center">
          {MONTH_NAMES[month - 1]} {year}
        </span>
        <Button variant="ghost" size="icon" onClick={nextMonth}>
          <ChevronRight size={22} />
        </Button>
      </div>

      {/* ── Stat tiles ───────────────────────────────────────────────────── */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Business Days',     value: String(summary.businessDays),    color: 'text-emerald-700' },
            { label: 'Non-Business Days', value: String(summary.nonBusinessDays), color: 'text-slate-500'   },
            { label: 'Total Days',        value: String(summary.totalDays),        color: 'text-slate-800'   },
            {
              label: 'Days Saved',
              value: `${savedCount} / ${summary.totalDays}`,
              color: savedCount === summary.totalDays ? 'text-emerald-700' : 'text-orange-600',
            },
          ].map(s => (
            <div key={s.label} className="bg-white border border-slate-200 rounded-xl p-4 text-center">
              <div className="text-[11px] text-slate-400 mb-1">{s.label}</div>
              <div className={cn('text-2xl font-bold', s.color)}>{s.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* ── Fill button — above the calendar ────────────────────────────── */}
      <div className="flex justify-end">
        <Button
          variant="outline"
          size="sm"
          onClick={() => saveMutation.mutate({ year, month })}
          disabled={isSaving}
          className="gap-1.5"
        >
          <RefreshCw size={13} className={isSaving ? 'animate-spin' : ''} />
          {isSaving ? 'Filling…' : 'Fill Unsaved Days with Defaults'}
        </Button>
      </div>

      {/* ── Calendar grid ─────────────────────────────────────────────────── */}
      {isLoading && (
        <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-sm text-slate-400">
          Loading calendar…
        </div>
      )}
      {isError && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center text-sm text-red-600">
          Failed to load calendar. Please refresh.
        </div>
      )}

      {!isLoading && !isError && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">

          {/* Day-of-week headers */}
          <div className="grid grid-cols-7 border-b border-slate-200">
            {DAY_HEADERS.map(d => (
              <div key={d} className={cn(
                'py-2 text-center text-[11px] font-semibold tracking-wide',
                d === 'Sun' || d === 'Sat' ? 'text-slate-400' : 'text-slate-600',
              )}>
                {d}
              </div>
            ))}
          </div>

          {/* Day cells */}
          <div className="grid grid-cols-7">
            {blanks.map((_, i) => (
              <div key={`blank-${i}`} className="h-24 border-b border-r border-slate-100 bg-slate-50/40" />
            ))}

            {days.map(day => {
              const cfg      = DAY_TYPE_CONFIG[day.day_type]
              const dateNum  = parseInt(day.calendar_date.slice(-2), 10)
              const isToday  = day.calendar_date === new Date().toISOString().slice(0, 10)

              return (
                <button
                  key={day.calendar_date}
                  onClick={() => openEdit(day)}
                  className={cn(
                    // Base layout
                    'h-24 p-1.5 text-left flex flex-col justify-between transition-all hover:brightness-95 focus:outline-none',
                    // Cell background by type
                    cfg.cell,
                    // Right + bottom grid lines
                    'border-b border-r border-slate-200',
                    // Left accent strip: green = business day, transparent = not
                    day.is_business_day
                      ? 'border-l-[3px] border-l-emerald-400'
                      : 'border-l-[3px] border-l-transparent',
                    // Top border: dashed = default (unsaved), solid = saved
                    day.is_stored
                      ? 'border-t border-t-slate-200'
                      : 'border-t border-t-dashed border-dashed',
                  )}
                >
                  {/* Top row: date number + saved/default pill */}
                  <div className="flex items-start justify-between gap-1">
                    <span className={cn(
                      'text-[13px] font-semibold w-6 h-6 flex items-center justify-center rounded-full shrink-0',
                      isToday ? 'bg-primary text-white' : 'text-slate-700',
                    )}>
                      {dateNum}
                    </span>
                    {day.is_stored
                      ? <span className="text-[9px] font-semibold text-emerald-600 bg-emerald-50 border border-emerald-200 px-1 py-0.5 rounded leading-none">Saved</span>
                      : <span className="text-[9px] text-slate-400 bg-slate-100 border border-slate-200 border-dashed px-1 py-0.5 rounded leading-none">Not Saved</span>
                    }
                  </div>

                  {/* Type badge — centered */}
                  <div className="flex justify-center">
                    <span className={cn(
                      'inline-block px-1.5 py-0.5 rounded text-[10px] font-medium border',
                      cfg.badge,
                    )}>
                      {cfg.label}
                    </span>
                  </div>

                  {/* Bottom row: note (left) + business day status (right) */}
                  <div className="flex items-end justify-between gap-1">
                    <span className="text-[10px] text-slate-500 truncate italic leading-tight">
                      {day.note ?? ''}
                    </span>
                    <span className={cn(
                      'text-[9px] font-medium leading-tight shrink-0',
                      day.is_business_day ? 'text-emerald-600' : 'text-slate-400',
                    )}>
                      {day.is_business_day ? '✓ Business Day' : '— Not counted'}
                    </span>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Edit dialog ───────────────────────────────────────────────────── */}
      <Dialog open={!!editDay} onOpenChange={open => !open && closeEdit()}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              Edit {editDay?.calendar_date}
              {editDay && (
                <span className="ml-2 text-sm font-normal text-slate-400">
                  {editDay.is_stored ? '· Saved' : '· Using default'}
                </span>
              )}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Day type select */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-700">Day Type</label>
              <Select value={editType} onValueChange={v => setEditType(v as BusinessDayType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.entries(DAY_TYPE_CONFIG) as [BusinessDayType, typeof DAY_TYPE_CONFIG[BusinessDayType]][]).map(([type, cfg]) => (
                    <SelectItem key={type} value={type}>{cfg.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Business day impact callout */}
            <div className={cn(
              'rounded-lg px-3 py-2.5 text-sm font-medium',
              editType === 'WORKDAY'
                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                : 'bg-slate-100 text-slate-500 border border-slate-200',
            )}>
              {editType === 'WORKDAY'
                ? '✓ This day WILL count toward business day totals and pace calculations.'
                : '— This day will NOT count toward business day totals or pace calculations.'
              }
            </div>

            {/* Note */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-700">
                Note <span className="font-normal text-slate-400">(optional)</span>
              </label>
              <Textarea
                value={editNote}
                onChange={e => setEditNote(e.target.value)}
                placeholder="e.g. Thanksgiving, Company All-Hands…"
                rows={2}
                className="resize-none text-sm"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeEdit}>Cancel</Button>
            <Button onClick={saveEdit} disabled={updateMutation.isPending}>
              {updateMutation.isPending ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  )
}
