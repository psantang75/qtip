import type { ReactNode } from 'react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { BLOCK_MIN, WINDOW_END, WINDOW_START, fmtClock, fmtHM, type AxisTick, type DayModel, type TickTier } from './productivityModel'
import {
  CALL_CLS, CHART_LEGEND_GROUPS, CLOCK_CLS, DESK_CLS, offQueueCls, ROUTING_CLS, ROUTING_LABEL,
  SCHEDULE_TRACK, TICKET_CLS, TRACK,
} from './productivityStatus'

/**
 * The Activity Timeline for one agent's day across a shared hour axis, mirroring
 * the Scheduling day view. Five rows, each answering a distinct question:
 *
 *   Clock    — was the agent punched in, against the shift they were scheduled?
 *   DeskTime — was the computer being used?
 *   Status   — were they in queue and reachable? (off-queue runs name the reason)
 *   Calls    — was each ringing call answered or missed?
 *   Tickets  — what work got touched?
 *
 * Status and Calls stay separate on purpose: queue membership and call handling
 * are different questions, and neither stream can answer the other's.
 *
 * GEOMETRY RULE: every bar is a hard rectangle — square corners, same height,
 * same grey track — so a run of one status reads as one continuous bar rather
 * than a string of pills. The Clock, DeskTime and Status rows draw their exact
 * runs (a boundary at 8:07 sits at 8:07). Calls and tickets are too small and
 * too many to draw one-per-line, so they are quantised to 5-minute blocks: each
 * active slot is one hard block, and the exact calls/touches — with their real
 * times — live in the hover detail.
 *
 * Every bar is itself the hover trigger for its detail tooltip (no info icons),
 * per the QTIP UI conformance rule.
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

function TimelineRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <div className={LABEL}>{label}</div>
      <div className={cn('relative flex-1', ROW, TRACK)}>{children}</div>
    </div>
  )
}

/**
 * One absolutely-positioned bar plus its tooltip. Positions come from the shared
 * axis (never flex), so every row lines up with the hour ticks even when a
 * stream starts later than the axis does.
 */
function Seg({ cls, leftPct, widthPct, title, lines, children, gap }: {
  cls: string; leftPct: number; widthPct: number
  title: string; lines: ReactNode[]; children?: ReactNode
  /** Leave a hairline gap on the right so a run of these reads as discrete
   *  five-minute bars (the DeskTime productivity-bar look) rather than one block. */
  gap?: boolean
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className={cn('absolute inset-y-0 cursor-pointer overflow-hidden', cls)}
          style={{ left: `${leftPct}%`, width: gap ? `calc(${widthPct}% - 1.5px)` : `${widthPct}%`, minWidth: 2 }}
        >
          {children}
        </div>
      </TooltipTrigger>
      <TooltipContent className="text-xs">
        <div className="font-semibold">{title}</div>
        {lines.map((l, i) => <div key={i} className="text-slate-500">{l}</div>)}
      </TooltipContent>
    </Tooltip>
  )
}

/** Label column (70px) plus the gap to the track (8px) — this sits outside the
 *  scrolling time track. */
const AXIS_OFFSET = 78
/** Floor width per 5-minute bar. On a screen too narrow to give the whole day
 *  this much per bar, the track scrolls rather than collapsing the bars. */
const MIN_BAR_PX = 7

export default function ActivityGantt({ model }: { model: DayModel }) {
  const {
    scheduleBar, scheduleSegments, clockSegments, desktimeBlocks, statusBlocks,
    callBlocks, ticketBlocks, axisTicks,
  } = model

  const totalMin = model.endMin - model.startMin
  const baseMin = WINDOW_END - WINDOW_START
  // The fixed 8:00 AM – 6:30 PM window fills the track exactly (100% of the
  // viewport). A day that runs earlier or later makes the track wider than its
  // viewport, so only the overflow scrolls — the window itself always fills.
  const widthPct = (totalMin / baseMin) * 100
  const minWidth = AXIS_OFFSET + Math.round((totalMin / BLOCK_MIN) * MIN_BAR_PX)

  return (
    <TooltipProvider delayDuration={150}>
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
                  <Seg
                    cls={SCHEDULE_TRACK}
                    leftPct={scheduleBar.leftPct}
                    widthPct={scheduleBar.widthPct}
                    title={`Scheduled ${fmtClock(scheduleBar.startMin)} – ${fmtClock(scheduleBar.endMin)}`}
                    lines={scheduleSegments.map(s => `${s.kind} · ${fmtClock(s.startMin)}–${fmtClock(s.endMin)}`)}
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
                <Seg
                  key={i}
                  cls={CLOCK_CLS[seg.status]}
                  leftPct={seg.leftPct}
                  widthPct={seg.widthPct}
                  title={`${fmtClock(seg.startMin)} – ${fmtClock(seg.endMin)}`}
                  lines={[`${seg.status} · ${fmtHM(seg.mins)}`]}
                />
              ))}
            </TimelineRow>

            {/* DeskTime computer activity, as a continuous run of 5-minute bars. */}
            <TimelineRow label="DeskTime">
              <Gridlines ticks={axisTicks} />
              {desktimeBlocks.map((b, i) => (
                <Seg
                  key={i}
                  gap
                  cls={DESK_CLS[b.status]}
                  leftPct={b.leftPct}
                  widthPct={b.widthPct}
                  title={`${fmtClock(b.startMin)} – ${fmtClock(b.startMin + BLOCK_MIN)}`}
                  lines={[
                    `Computer ${b.status.toLowerCase()}`,
                    ...(b.changes > 0 ? [`${b.changes} change${b.changes > 1 ? 's' : ''} in this block`] : []),
                  ]}
                />
              ))}
            </TimelineRow>

            {/* Genesys routing status, as 5-minute bars. Each bar takes the colour
                of whatever status covered most of it — off-queue runs colour from
                their presence reason (a break is orange, else neutral grey) — and
                a switch shorter than five minutes is named in the hover count. */}
            <TimelineRow label="Status">
              <Gridlines ticks={axisTicks} />
              {statusBlocks.map((b, i) => (
                <Seg
                  key={i}
                  gap
                  cls={b.status === 'OFF_QUEUE' ? offQueueCls(b.reason) : ROUTING_CLS[b.status]}
                  leftPct={b.leftPct}
                  widthPct={b.widthPct}
                  title={`${fmtClock(b.startMin)} – ${fmtClock(b.startMin + BLOCK_MIN)}`}
                  lines={[
                    ROUTING_LABEL[b.status],
                    ...(b.reason ? [`Presence: ${b.reason}`] : []),
                    ...(b.changes > 0 ? [`${b.changes} status change${b.changes > 1 ? 's' : ''} in this block`] : []),
                  ]}
                />
              ))}
            </TimelineRow>

            {/* Conversations, in 5-minute blocks: teal in, blue out, red missed —
                dominant tone fills the block, exact calls are in the hover. */}
            <TimelineRow label="Calls">
              <Gridlines ticks={axisTicks} />
              {callBlocks.map((b, i) => {
                const inbound = b.calls.filter(c => c.label === 'Inbound').length
                const outbound = b.calls.filter(c => c.label === 'Outbound').length
                return (
                  <Seg
                    key={i}
                    gap
                    cls={CALL_TONE[b.tone]}
                    leftPct={b.leftPct}
                    widthPct={b.widthPct}
                    title={`${fmtClock(b.startMin)} – ${fmtClock(b.startMin + 5)}`}
                    lines={[
                      `Inbound ${inbound} · Outbound ${outbound}${b.missed > 0 ? ` · Missed ${b.missed}` : ''}`,
                      ...(b.inboundMins > 0 || b.outboundMins > 0
                        ? [`Talk · in ${fmtHM(b.inboundMins)} · out ${fmtHM(b.outboundMins)}`] : []),
                      ...(b.statusLabel ? [`Phone: ${b.statusLabel}`] : []),
                      ...(b.statusChanges > 0
                        ? [`${b.statusChanges} status change${b.statusChanges > 1 ? 's' : ''} in this block`] : []),
                      ...b.calls.map(c => (
                        <span className="font-mono text-[11px]">
                          {`${c.label} ${fmtClock(c.startMin)}–${fmtClock(c.endMin)} · ${c.conversationId}`}
                        </span>
                      )),
                    ]}
                  />
                )
              })}
            </TimelineRow>

            {/* Ticket / task touches, in 5-minute blocks: green closed, amber
                updated; the touched items are in the hover. */}
            <TimelineRow label="Tickets">
              <Gridlines ticks={axisTicks} />
              {ticketBlocks.map((b, i) => (
                <Seg
                  key={i}
                  gap
                  cls={TICKET_TONE[b.tone]}
                  leftPct={b.leftPct}
                  widthPct={b.widthPct}
                  title={`${fmtClock(b.startMin)} – ${fmtClock(b.startMin + 5)}`}
                  lines={[
                    `Touched ${b.ids.length} · Completed ${b.completed} · Updated ${b.updated}`,
                    ...(b.statusLabel ? [`Phone: ${b.statusLabel}`] : []),
                    ...(b.statusChanges > 0
                      ? [`${b.statusChanges} status change${b.statusChanges > 1 ? 's' : ''} in this block`] : []),
                    ...b.ids.map(id => (
                      <span className="flex items-center justify-between gap-3">
                        <span className="font-mono">{id.id}</span>
                        <span>{id.action}</span>
                      </span>
                    )),
                  ]}
                />
              ))}
            </TimelineRow>
          </div>

          {/* One legend for the whole chart, grouped the way it is read:
              phone-status tones first, then the two call/ticket streams. */}
          <div className="flex flex-wrap items-center gap-x-8 gap-y-2 pt-1">
            {CHART_LEGEND_GROUPS.map(group => (
              <div key={group.group} className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{group.group}</span>
                {group.items.map(item => (
                  <span key={item.label} className="flex items-center gap-1.5 text-[11px] text-slate-500">
                    <span className={cn('h-2.5 w-2.5', item.cls)} />
                    {item.label}
                  </span>
                ))}
              </div>
            ))}
          </div>
          <div className="text-[11px] text-slate-400">Hover any bar for the exact times and detail.</div>
        </div>
      </div>
    </TooltipProvider>
  )
}
