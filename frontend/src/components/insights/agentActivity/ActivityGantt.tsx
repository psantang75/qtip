import { Fragment, useRef, useState, type ReactNode } from 'react'
import { ExternalLink } from 'lucide-react'
import { cn } from '@/lib/utils'
import { BLOCK_MIN, WINDOW_END, WINDOW_START, fmtClock, fmtHM, type AxisTick, type DayModel, type TickTier } from './productivityModel'
import {
  CALL_CLS, CHART_LEGEND_GROUPS, CLOCK_CLS, offQueueCls, ROUTING_CLS, ROUTING_LABEL,
  SCHEDULE_TRACK, TICKET_CLS, TRACK,
} from './productivityStatus'
import CallTranscriptModal from './CallTranscriptModal'

/**
 * The Activity Timeline for one agent's day across a shared hour axis, mirroring
 * the Scheduling day view. Four rows, each answering a distinct question:
 *
 *   Clock    — was the agent punched in, against the shift they were scheduled?
 *   Status   — were they in queue and reachable? (off-queue runs name the reason)
 *   Calls    — was each ringing call answered or missed?
 *   Tickets  — what work got touched?
 *
 * Status and Calls stay separate on purpose: queue membership and call handling
 * are different questions, and neither stream can answer the other's.
 *
 * GEOMETRY RULE: every bar is a hard rectangle — square corners, same height,
 * same grey track — so a run of one status reads as one continuous bar rather
 * than a string of pills. The Clock and Status rows draw their exact
 * runs (a boundary at 8:07 sits at 8:07). Calls and tickets are too small and
 * too many to draw one-per-line, so they are quantised to 5-minute blocks: each
 * active slot is one hard block, and the exact calls/touches — with their real
 * times — live in the hover detail.
 *
 * HOVER: one shared detail card, not a tooltip per bar. Each bar reports its
 * detail on enter and the single card re-anchors to it, so sliding across
 * adjacent blocks swaps content cleanly instead of the old per-block tooltips
 * flickering or sticking on the block you just left. A short close delay lets the
 * pointer travel from a bar into the card, so the Tickets links stay clickable.
 */

const ROW = 'h-6'
const LABEL = 'w-[70px] shrink-0 text-[11px] font-medium text-slate-500'

const CALL_TONE: Record<'inbound' | 'outbound' | 'missed', string> = {
  inbound:  CALL_CLS.Inbound,
  outbound: CALL_CLS.Outbound,
  missed:   CALL_CLS.Missed,
}
const TICKET_TONE: Record<'completed' | 'updated', string> = {
  completed: TICKET_CLS.Completed,
  updated:   TICKET_CLS.Updated,
}

/** Title Case for the status/label text shown in hovers (e.g. "queued call" →
 *  "Queued Call"), leaving the "·" separators and numeric spans untouched. */
const titleCase = (s: string) => s.replace(/[A-Za-z]+/g, w => w[0].toUpperCase() + w.slice(1).toLowerCase())

// ── Hover-table cells ─────────────────────────────────────────────────────────
// Every hover renders the same little table: a time-range column first, then the
// status/label, then a muted detail. Building the cells through these helpers is
// what keeps the four hovers looking identical.
const hTime = (a: number, b: number) => (
  <span className="font-mono text-[11px] tabular-nums text-slate-500">{fmtClock(a)} – {fmtClock(b)}</span>
)
const hText = (s: ReactNode) => <span className="text-slate-700">{s}</span>
const hMuted = (s: ReactNode) => <span className="text-slate-400">{s}</span>

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

/** One row of the hover table. A row with an `href` renders as a link spanning
 *  all its columns (display:contents) so the whole line is clickable. */
interface HoverRow { cells: ReactNode[]; href?: string; title?: string }
/** Detail the hovered bar hands to the shared card: a titled table whose columns
 *  line up (time first). Kept identical in shape across every row so the four
 *  hovers read the same way. */
interface HoverDetail { title: string; subtitle?: ReactNode; gridCols: string; rows: HoverRow[] }
type ShowFn = (el: HTMLElement, detail: HoverDetail) => void

function TimelineRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <div className={LABEL}>{label}</div>
      <div className={cn('relative flex-1', ROW, TRACK)}>{children}</div>
    </div>
  )
}

/**
 * One absolutely-positioned bar. Positions come from the shared axis (never
 * flex), so every row lines up with the hour ticks even when a stream starts
 * later than the axis does. The bar reports its detail to the shared hover card
 * on enter rather than rendering its own tooltip.
 */
function Bar({ cls, leftPct, widthPct, gap, detail, onShow, onHide, children }: {
  cls: string; leftPct: number; widthPct: number
  detail: HoverDetail; onShow: ShowFn; onHide: () => void; children?: ReactNode
  /** Leave a hairline gap on the right so a run of these reads as discrete
   *  five-minute bars (the productivity-bar look) rather than one block. */
  gap?: boolean
}) {
  return (
    <div
      className={cn('absolute inset-y-0 cursor-pointer overflow-hidden', cls)}
      style={{ left: `${leftPct}%`, width: gap ? `calc(${widthPct}% - 1.5px)` : `${widthPct}%`, minWidth: 2 }}
      onMouseEnter={e => onShow(e.currentTarget, detail)}
      onMouseLeave={onHide}
    >
      {children}
    </div>
  )
}

/** Label column (70px) plus the gap to the track (8px) — this sits outside the
 *  scrolling time track. */
const AXIS_OFFSET = 78
/** Floor width per 5-minute bar. On a screen too narrow to give the whole day
 *  this much per bar, the track scrolls rather than collapsing the bars. */
const MIN_BAR_PX = 7
/** Rough card width, used only to keep it inside the right edge of the viewport.
 *  The card is `w-max` (grows to its one-line content up to a cap); this is the
 *  estimate used to clamp its left edge near the right of the screen. */
const CARD_W = 380

export default function ActivityGantt({ model }: { model: DayModel }) {
  const {
    scheduleBar, scheduleSegments, clockSegments, statusBlocks, statusSegments,
    callBlocks, ticketBlocks, axisTicks,
  } = model

  // One shared, anchored hover card. `anchor` is the hovered bar's viewport rect
  // (fixed-positioned, so the surrounding overflow-x-auto can't clip it); a short
  // close timer bridges the gap from bar to card so its links stay clickable.
  const [hover, setHover] = useState<{ left: number; top: number; detail: HoverDetail } | null>(null)
  // The call whose transcript/audio modal is open. Opening it dismisses the hover
  // card so the two overlays never stack.
  const [callModal, setCallModal] = useState<string | null>(null)
  const openCall = (conversationId: string) => { setHover(null); setCallModal(conversationId) }
  const hideTimer = useRef<number | undefined>(undefined)
  const show: ShowFn = (el, detail) => {
    window.clearTimeout(hideTimer.current)
    const r = el.getBoundingClientRect()
    setHover({ left: Math.min(r.left, window.innerWidth - CARD_W - 8), top: r.bottom + 6, detail })
  }
  const scheduleHide = () => {
    window.clearTimeout(hideTimer.current)
    hideTimer.current = window.setTimeout(() => setHover(null), 140)
  }
  const cancelHide = () => window.clearTimeout(hideTimer.current)

  const totalMin = model.endMin - model.startMin
  const baseMin = WINDOW_END - WINDOW_START
  // The fixed 8:00 AM – 6:30 PM window fills the track exactly (100% of the
  // viewport). A day that runs earlier or later makes the track wider than its
  // viewport, so only the overflow scrolls — the window itself always fills.
  const widthPct = (totalMin / baseMin) * 100
  const minWidth = AXIS_OFFSET + Math.round((totalMin / BLOCK_MIN) * MIN_BAR_PX)

  return (
    <div className="overflow-x-auto">
      <div className="space-y-3" style={{ width: `${widthPct}%`, minWidth }}>
        {/* Hour labels only — with a five-minute gridline behind every row the
            intermediate :15/:30/:45 numbers only added clutter. The exact time
            of any bar lives in its hover instead. */}
        <div className="flex items-end">
          <div className="w-[70px] shrink-0" />
          <div className="relative ml-2 flex-1">
            <div className="relative h-4">
              {axisTicks.filter(t => t.tier === 'hour').map(t => (
                <span key={t.min} className="absolute -translate-x-1/2 text-[11px] font-semibold text-slate-500" style={{ left: `${t.leftPct}%` }}>
                  {t.label}
                </span>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-px">
          {/* Punch clock over the planned shift from Scheduling */}
          <TimelineRow label="Clock">
            <Gridlines ticks={axisTicks} />
            {scheduleBar && (
              <>
                <Bar
                  cls={SCHEDULE_TRACK}
                  leftPct={scheduleBar.leftPct}
                  widthPct={scheduleBar.widthPct}
                  onShow={show}
                  onHide={scheduleHide}
                  detail={{
                    title: 'Scheduled',
                    subtitle: `${fmtClock(scheduleBar.startMin)} – ${fmtClock(scheduleBar.endMin)}`,
                    gridCols: 'auto auto',
                    rows: scheduleSegments.map(s => ({ cells: [hTime(s.startMin, s.endMin), hText(titleCase(s.kind))] })),
                  }}
                />
                {/* Scheduled breaks carve back to the plain track: the agent
                    was not expected to be working, so nothing is owed there. */}
                {scheduleSegments.map((s, i) => (
                  <div
                    key={i}
                    className={cn('pointer-events-none absolute inset-y-0', TRACK)}
                    style={{ left: `${s.leftPct}%`, width: `${s.widthPct}%` }}
                  />
                ))}
              </>
            )}
            {clockSegments.map((seg, i) => (
              <Bar
                key={i}
                cls={CLOCK_CLS[seg.status]}
                leftPct={seg.leftPct}
                widthPct={seg.widthPct}
                onShow={show}
                onHide={scheduleHide}
                detail={{
                  title: 'Clock',
                  gridCols: 'auto auto auto',
                  rows: [{ cells: [hTime(seg.startMin, seg.endMin), hText(titleCase(seg.status)), hMuted(fmtHM(seg.mins))] }],
                }}
              />
            ))}
          </TimelineRow>

          {/* Genesys routing status, as 5-minute bars. Each bar takes the colour
              of whatever status covered most of it; the hover lists the actual
              status runs (with their real time ranges) that fell in the block. */}
          <TimelineRow label="Status">
            <Gridlines ticks={axisTicks} />
            {statusBlocks.map((b, i) => {
              const blockEnd = b.startMin + BLOCK_MIN
              const runs = statusSegments.filter(s => s.endMin > b.startMin && s.startMin < blockEnd)
              // Split each run into a [status, qualifier] pair so both align into
              // their own columns instead of a run-on "Name · qualifier" string.
              const rows: HoverRow[] = (runs.length ? runs : []).map(s => {
                const [name, qual] = s.status === 'OFF_QUEUE'
                  ? [s.reason ? titleCase(s.reason) : 'Off Queue', s.reason ? 'Off queue' : '']
                  : (titleCase(ROUTING_LABEL[s.status]).split(' · ') as [string, string?])
                return { cells: [hTime(s.startMin, s.endMin), hText(name), hMuted(qual ?? '')] }
              })
              return (
                <Bar
                  key={i}
                  gap
                  cls={b.status === 'OFF_QUEUE' ? offQueueCls(b.reason) : ROUTING_CLS[b.status]}
                  leftPct={b.leftPct}
                  widthPct={b.widthPct}
                  onShow={show}
                  onHide={scheduleHide}
                  detail={{
                    title: 'Status',
                    gridCols: 'auto auto auto',
                    rows: rows.length ? rows : [{ cells: [hTime(b.startMin, blockEnd), hText(titleCase(ROUTING_LABEL[b.status]).split(' · ')[0]), hMuted('')] }],
                  }}
                />
              )
            })}
          </TimelineRow>

          {/* Conversations, in 5-minute blocks: teal in, blue out, red missed —
              dominant tone fills the block, exact calls are in the hover. */}
          <TimelineRow label="Calls">
            <Gridlines ticks={axisTicks} />
            {callBlocks.map((b, i) => {
              const inbound = b.calls.filter(c => c.label === 'Inbound').length
              const outbound = b.calls.filter(c => c.label === 'Outbound').length
              const talkMins = b.inboundMins + b.outboundMins
              return (
                <Bar
                  key={i}
                  gap
                  cls={CALL_TONE[b.tone]}
                  leftPct={b.leftPct}
                  widthPct={b.widthPct}
                  onShow={show}
                  onHide={scheduleHide}
                  detail={{
                    title: 'Calls',
                    subtitle: `Inbound ${inbound} · Outbound ${outbound} · Total Talk ${fmtHM(talkMins)}${b.missed > 0 ? ` · Missed ${b.missed}` : ''}`,
                    gridCols: 'auto auto 1fr',
                    rows: b.calls.map(c => ({ cells: [
                      hTime(c.startMin, c.endMin),
                      hText(titleCase(c.label)),
                      <button
                        type="button"
                        onClick={() => openCall(c.conversationId)}
                        title="Open transcript & audio"
                        className="text-left font-mono text-[11px] text-primary hover:underline"
                      >
                        {c.conversationId}
                      </button>,
                    ] })),
                  }}
                />
              )
            })}
          </TimelineRow>

          {/* Ticket / task touches, in 5-minute blocks: green closed, amber
              updated. The hover lists each real Ticket/Task # linked to the CRM. */}
          <TimelineRow label="Tickets">
            <Gridlines ticks={axisTicks} />
            {ticketBlocks.map((b, i) => (
              <Bar
                key={i}
                gap
                cls={TICKET_TONE[b.tone]}
                leftPct={b.leftPct}
                widthPct={b.widthPct}
                onShow={show}
                onHide={scheduleHide}
                detail={{
                  title: 'Tickets',
                  subtitle: `Touched ${b.ids.length}`,
                  gridCols: 'auto minmax(0,1fr) auto',
                  rows: b.ids.map(item => ({
                    href: item.url ?? undefined,
                    title: item.url ? `Open ${item.itemType} ${item.itemId} in the CRM` : undefined,
                    cells: [
                      <span className={cn('font-medium', item.url ? 'text-primary group-hover:underline' : 'text-slate-700')}>
                        {`${titleCase(item.itemType)} ${item.itemId}`}
                      </span>,
                      <span className={cn('truncate text-slate-500', item.url && 'group-hover:underline')}>
                        {item.subject ?? item.action}
                      </span>,
                      item.url ? <ExternalLink className="h-3 w-3 shrink-0 opacity-70" /> : <span />,
                    ],
                  })),
                }}
              />
            ))}
          </TimelineRow>
        </div>

        {/* One legend for the whole chart, grouped the way it is read: phone
            status, then calls, then tickets. The three groups are centred and
            split by dividers so it is unmistakable they are three separate
            streams, not one long list of colours. */}
        <div className="mt-1 flex flex-wrap items-center justify-center gap-x-8 gap-y-3">
          {CHART_LEGEND_GROUPS.map((group, gi) => (
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
        <div className="text-[11px] text-slate-400">Hover any bar for the exact times and detail.</div>
      </div>

      {/* The single shared hover card, fixed to the viewport so the scrolling
          track never clips it. It stays open while the pointer is inside it, so
          the Tickets links can be clicked. */}
      {hover && (
        <div
          className="fixed z-50 w-max max-w-[min(92vw,560px)] rounded-md border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg"
          style={{ left: hover.left, top: hover.top }}
          onMouseEnter={cancelHide}
          onMouseLeave={scheduleHide}
        >
          <div className="font-semibold text-slate-900">{hover.detail.title}</div>
          {hover.detail.subtitle && <div className="mt-0.5 text-[11px] leading-tight text-slate-500">{hover.detail.subtitle}</div>}
          {hover.detail.rows.length > 0 && (
            <div
              className="mt-1 grid items-baseline gap-x-4 gap-y-1 whitespace-nowrap"
              style={{ gridTemplateColumns: hover.detail.gridCols }}
            >
              {hover.detail.rows.map((row, i) =>
                row.href ? (
                  <a
                    key={i}
                    href={row.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={row.title}
                    className="group contents"
                  >
                    {row.cells.map((c, j) => <Fragment key={j}>{c}</Fragment>)}
                  </a>
                ) : (
                  <Fragment key={i}>{row.cells.map((c, j) => <Fragment key={j}>{c}</Fragment>)}</Fragment>
                ),
              )}
            </div>
          )}
        </div>
      )}

      <CallTranscriptModal conversationId={callModal} onClose={() => setCallModal(null)} />
    </div>
  )
}
