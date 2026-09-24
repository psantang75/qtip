import { useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { BLOCK_MIN, WINDOW_END, WINDOW_START, fmtClock, fmtHM, type DayModel } from './productivityModel'
import {
  CALL_CLS, CHART_LEGEND_GROUPS, CLOCK_CLS, offQueueCls, ROUTING_CLS, ROUTING_LABEL,
  SALES_LEGEND_GROUPS, SCHEDULE_TRACK, TICKET_CLS, TRACK,
  type PresenceStatus, type RoutingStatus,
} from './productivityStatus'
import CallTranscriptModal from './CallTranscriptModal'
import SalesActivityRows from './SalesActivityRows'
import { Bar, ChartLegend, HoverCard, TimelineRow } from './TimelinePrimitives'
import {
  crmLinkRow, hMuted, hText, hTime, titleCase, type HoverDetail, type HoverRow, type ShowFn,
} from './timelineCells'

/**
 * The Activity Timeline for one agent's day across a shared hour axis, mirroring
 * the Scheduling day view. Each row answers a distinct question:
 *
 *   Clock    — was the agent punched in, against the shift they were scheduled?
 *   Status   — were they in queue and reachable? (off-queue runs name the reason)
 *   Calls    — was each ringing call answered or missed?
 *   Tickets  — what work got touched?
 *
 * Sales adds its own work rows (Emails, Leads, Floor Plans & Demos) between
 * Calls and Tickets — see `SalesActivityRows`.
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

const CALL_TONE: Record<'inbound' | 'outbound' | 'missed', string> = {
  inbound:  CALL_CLS.Inbound,
  outbound: CALL_CLS.Outbound,
  missed:   CALL_CLS.Missed,
}
const TICKET_TONE: Record<'completed' | 'updated', string> = {
  completed: TICKET_CLS.Completed,
  updated:   TICKET_CLS.Updated,
}

/** The fill for one status run — an off-queue run takes its presence reason's hue. */
const statusCls = (status: RoutingStatus, reason: PresenceStatus | null) =>
  status === 'OFF_QUEUE' ? offQueueCls(reason) : ROUTING_CLS[status]

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
          <TimelineRow label="Clock" ticks={axisTicks}>
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

          {/* Genesys routing status, as 5-minute bars. A bar that holds a single
              status is one solid colour; one that spans a switch — a meeting
              running into a break — is filled from its minute slices, so the
              boundary sits where it really fell instead of rounding to the
              nearest five. The hover lists the actual status runs (with their
              real time ranges) that fell in the block. */}
          <TimelineRow label="Status" ticks={axisTicks}>
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
                  // The dominant status is the base fill, so a block the runs
                  // only partly cover (the last one of a shift) still reads as a
                  // whole bar; the slices paint the real boundaries over it.
                  cls={statusCls(b.status, b.reason)}
                  leftPct={b.leftPct}
                  widthPct={b.widthPct}
                  onShow={show}
                  onHide={scheduleHide}
                  detail={{
                    title: 'Status',
                    gridCols: 'auto auto auto',
                    rows: rows.length ? rows : [{ cells: [hTime(b.startMin, blockEnd), hText(titleCase(ROUTING_LABEL[b.status]).split(' · ')[0]), hMuted('')] }],
                  }}
                >
                  {b.slices.length > 1 && b.slices.map((sl, j) => (
                    <span
                      key={j}
                      className={cn('absolute inset-y-0', statusCls(sl.status, sl.reason))}
                      style={{ left: `${sl.leftPct}%`, width: `${sl.widthPct}%` }}
                    />
                  ))}
                </Bar>
              )
            })}
          </TimelineRow>

          {/* Conversations, in 5-minute blocks: teal in, blue out, red missed —
              dominant tone fills the block, exact calls are in the hover. */}
          <TimelineRow label="Calls" ticks={axisTicks}>
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

          {model.sales && <SalesActivityRows sales={model.sales} ticks={axisTicks} onShow={show} onHide={scheduleHide} />}

          {/* Ticket / task touches, in 5-minute blocks: green closed, amber
              updated. The hover lists each real Ticket/Task # linked to the CRM. */}
          <TimelineRow label="Tickets" ticks={axisTicks}>
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
                  rows: b.ids.map(item => crmLinkRow(`${titleCase(item.itemType)} ${item.itemId}`, item.subject ?? item.action, item.url)),
                }}
              />
            ))}
          </TimelineRow>
        </div>

        {/* Phone status, then calls, then tickets — plus the Sales work rows'
            groups when they are drawn. */}
        <ChartLegend groups={model.sales ? [...CHART_LEGEND_GROUPS, ...SALES_LEGEND_GROUPS] : CHART_LEGEND_GROUPS} />
        <div className="text-[11px] text-slate-400">Hover any bar for the exact times and detail.</div>
      </div>

      {hover && <HoverCard left={hover.left} top={hover.top} detail={hover.detail} onEnter={cancelHide} onLeave={scheduleHide} />}

      <CallTranscriptModal conversationId={callModal} onClose={() => setCallModal(null)} />
    </div>
  )
}
