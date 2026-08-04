/**
 * Month navigation for the campaign calendar, plus this month's draft badge.
 * The publish control itself lives in the page header next to Build.
 *
 * Navigation is bounded by publish state for anyone who cannot see drafts: an
 * unpublished month does not exist for an agent, so they step between released
 * months only and stop at the ends rather than landing on a month the API would
 * refuse. Admin, Manager and Director move freely.
 */
import { ChevronLeft, ChevronRight, EyeOff } from 'lucide-react'
import { Button } from '@/components/ui/button'

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December']

export const monthKeyOf = (year: number, month: number): string =>
  `${year}-${String(month).padStart(2, '0')}`

const fromKey = (key: string): [number, number] =>
  [Number(key.slice(0, 4)), Number(key.slice(5, 7))]

/** The month an agent should land on: the first released month from now, else the last. */
export function nearestPublishedMonth(publishedMonths: string[], fromNow: string): [number, number] | null {
  if (publishedMonths.length === 0) return null
  return fromKey(publishedMonths.find(m => m >= fromNow) ?? publishedMonths[publishedMonths.length - 1])
}

export function CampaignMonthNav({
  year, month, onChange, canSeeDrafts, publishedMonths, isPublished,
}: {
  year: number
  month: number
  onChange: (year: number, month: number) => void
  /** Admin / Manager / Director — free navigation, drafts visible. */
  canSeeDrafts: boolean
  /** Released months as 'YYYY-MM', ascending. */
  publishedMonths: string[]
  isPublished: boolean
}) {
  const at = publishedMonths.indexOf(monthKeyOf(year, month))

  const canStep = (dir: -1 | 1) => canSeeDrafts || (at >= 0 && publishedMonths[at + dir] != null)
  const step = (dir: -1 | 1) => {
    if (!canSeeDrafts) {
      const target = at >= 0 ? publishedMonths[at + dir] : undefined
      if (target) onChange(...fromKey(target))
      return
    }
    const m = month + dir
    if (m === 0) onChange(year - 1, 12)
    else if (m === 13) onChange(year + 1, 1)
    else onChange(year, m)
  }

  const now = new Date()
  const [thisYear, thisMonth] = [now.getFullYear(), now.getMonth() + 1]
  const showToday = canSeeDrafts || publishedMonths.includes(monthKeyOf(thisYear, thisMonth))

  return (
    <div className="flex items-center gap-1">
      <Button variant="outline" size="sm" className="h-9 w-9 p-0" aria-label="Previous month"
        disabled={!canStep(-1)} onClick={() => step(-1)}>
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <span className="min-w-[160px] text-center text-[15px] font-semibold text-slate-800">
        {MONTH_NAMES[month - 1]} {year}
      </span>
      <Button variant="outline" size="sm" className="h-9 w-9 p-0" aria-label="Next month"
        disabled={!canStep(1)} onClick={() => step(1)}>
        <ChevronRight className="h-4 w-4" />
      </Button>

      {showToday && (
        <Button variant="ghost" size="sm" className="h-9 text-[12px] text-primary hover:bg-primary/5 hover:text-primary"
          onClick={() => onChange(thisYear, thisMonth)}>
          Today
        </Button>
      )}

      {canSeeDrafts && !isPublished && (
        <span className="ml-1 inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
          <EyeOff className="h-3 w-3" /> Draft month
        </span>
      )}
    </div>
  )
}
