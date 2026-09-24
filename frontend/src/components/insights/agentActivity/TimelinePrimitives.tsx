import { Fragment, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import type { AxisTick, TickTier } from './productivityModel'
import { TRACK, type LegendItem } from './productivityStatus'
import type { HoverDetail, ShowFn } from './timelineCells'

/** Building blocks shared by every Activity Timeline row (see `ActivityGantt`). */

const ROW = 'h-6'
const LABEL = 'w-[70px] shrink-0 text-[11px] font-medium leading-none text-slate-500'

/** Line weight per interval tier: strongest at the hour, faintest at 5 minutes. */
const TICK_LINE: Record<TickTier, string> = {
  hour:    'border-l border-slate-300',
  half:    'border-l border-dashed border-slate-300',
  quarter: 'border-l border-dashed border-slate-200',
  five:    'border-l border-slate-100',
}

/** The shared four-tier grid, drawn behind each row so every stream lines up. */
function Gridlines({ ticks }: { ticks: AxisTick[] }) {
  return (
    <div className="pointer-events-none absolute inset-0">
      {ticks.map(t => (
        <div key={t.min} className={cn('absolute inset-y-0', TICK_LINE[t.tier])} style={{ left: `${t.leftPct}%` }} />
      ))}
    </div>
  )
}

/** One labelled row of the timeline, with the shared gridlines behind it. */
export function TimelineRow({ label, ticks, children }: { label: string; ticks: AxisTick[]; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <div className={LABEL}>{label}</div>
      <div className={cn('relative flex-1', ROW, TRACK)}>
        <Gridlines ticks={ticks} />
        {children}
      </div>
    </div>
  )
}

/**
 * One absolutely-positioned bar. Positions come from the shared axis (never
 * flex), so every row lines up with the hour ticks even when a stream starts
 * later than the axis does. The bar reports its detail to the shared hover card
 * on enter rather than rendering its own tooltip.
 */
export function Bar({ cls, leftPct, widthPct, gap, minPx = 2, detail, onShow, onHide, children }: {
  cls: string; leftPct: number; widthPct: number
  detail: HoverDetail; onShow: ShowFn; onHide: () => void; children?: ReactNode
  /** Leave a hairline gap on the right so a run of these reads as discrete
   *  five-minute bars (the productivity-bar look) rather than one block. */
  gap?: boolean
  /** Floor width in pixels, so an instantaneous mark stays findable. */
  minPx?: number
}) {
  return (
    <div
      className={cn('absolute inset-y-0 cursor-pointer overflow-hidden', cls)}
      style={{ left: `${leftPct}%`, width: gap ? `calc(${widthPct}% - 1.5px)` : `${widthPct}%`, minWidth: minPx }}
      onMouseEnter={e => onShow(e.currentTarget, detail)}
      onMouseLeave={onHide}
    >
      {children}
    </div>
  )
}

/** The single shared hover card, fixed to the viewport so the scrolling track
 *  never clips it. It stays open while the pointer is inside it, so its CRM
 *  links can be clicked. */
export function HoverCard({ left, top, detail, onEnter, onLeave }: {
  left: number; top: number; detail: HoverDetail; onEnter: () => void; onLeave: () => void
}) {
  return (
    <div
      className="fixed z-50 w-max max-w-[min(92vw,560px)] rounded-md border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg"
      style={{ left, top }}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      <div className="font-semibold text-slate-900">{detail.title}</div>
      {detail.subtitle && <div className="mt-0.5 text-[11px] leading-tight text-slate-500">{detail.subtitle}</div>}
      {detail.rows.length > 0 && (
        <div
          className="mt-1 grid items-baseline gap-x-4 gap-y-1 whitespace-nowrap"
          style={{ gridTemplateColumns: detail.gridCols }}
        >
          {detail.rows.map((row, i) =>
            row.href ? (
              <a key={i} href={row.href} target="_blank" rel="noopener noreferrer" title={row.title} className="group contents">
                {row.cells.map((c, j) => <Fragment key={j}>{c}</Fragment>)}
              </a>
            ) : (
              <Fragment key={i}>{row.cells.map((c, j) => <Fragment key={j}>{c}</Fragment>)}</Fragment>
            ),
          )}
        </div>
      )}
    </div>
  )
}

/** One legend for the whole chart, grouped the way it is read. The groups are
 *  centred and split by dividers so it is unmistakable they are separate
 *  streams, not one long list of colours. */
export function ChartLegend({ groups }: { groups: { group: string; items: LegendItem[] }[] }) {
  return (
    <div className="mt-1 flex flex-wrap items-center justify-center gap-x-8 gap-y-3">
      {groups.map((group, gi) => (
        <Fragment key={group.group}>
          {gi > 0 && <span aria-hidden className="hidden h-5 w-px bg-slate-200 sm:block" />}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{group.group}</span>
            {group.items.map(item => (
              <span key={item.label} className="flex items-center gap-1.5 text-[11px] text-slate-500">
                <span className={cn('h-2.5 w-2.5', item.cls)} />
                {item.label}
              </span>
            ))}
          </div>
        </Fragment>
      ))}
    </div>
  )
}
