/**
 * Status vocabularies and color tokens for the Productivity report.
 *
 * The phone values are the real Genesys ones read from the PhoneSystem DB, not
 * invented labels, so the Phase 2 data swap is a drop-in:
 *   - routing status   → tblRoutingStatus.RoutingStatus (is the agent in queue?)
 *   - primary presence → tblPrimaryPresence.PresenceStatus, labelled through
 *     tblSystemPresence (why are they off queue?)
 *
 * COLOR RULE: only the five QTIP brand tones are used, each meaning exactly one
 * thing across every row of the chart — blue = on a call / working, green =
 * available, orange = break/idle, red = needs attention, grey = off queue. A
 * manager scans for those meanings, never for "Communicating", so statuses that
 * share a meaning share a color and the exact status lives in the tooltip where
 * precision belongs.
 *
 * The streams the reference mockup color-codes (call direction, ticket action)
 * are coded from these same brand tones rather than new hues: inbound is the
 * brand teal, outbound the brand blue, a completed ticket green, an updated one
 * orange. They are kept in their own legend group so the reuse across rows never
 * sprawls the legend back into the seventeen-swatch problem it was pulled from.
 */

/** Genesys routing status — whether the agent was reachable in queue. */
export type RoutingStatus = 'INTERACTING' | 'COMMUNICATING' | 'IDLE' | 'NOT_RESPONDING' | 'OFF_QUEUE'

/**
 * Genesys primary presence — all 13 labels from tblSystemPresence. The last
 * three are this org's own labels (all mapping to the Busy system presence).
 */
export type PresenceStatus =
  | 'On Queue' | 'Available' | 'Busy' | 'Break' | 'Meal' | 'Meeting' | 'Training' | 'Away'
  | 'Idle' | 'Offline' | 'Follow-Up Extended' | 'In Warehouse' | 'Do Not Disturb'

/** Time-clock / attendance state, sourced from the punch clock. */
export type ClockStatus = 'Working' | 'Break' | 'Meal' | 'Away' | 'Offline'

/** DeskTime computer-activity state, sourced from the DeskTime API (Phase 2). */
export type DeskStatus = 'Active' | 'Idle'

export type CallDirection = 'Inbound' | 'Outbound'
export type CallLabel = CallDirection | 'Missed'

// ── The five tones ───────────────────────────────────────────────────────────

export const TONE = {
  /** Working the job. */
  work: 'bg-primary',
  /** Available capacity: paid, in queue, not engaged. Nothing else may use this. */
  ready: 'bg-success',
  /** Not working — a break, a meal, or an idle computer. */
  off: 'bg-warning',
  /** Needs attention. Nothing else on the page may use this. */
  alert: 'bg-destructive',
  /** Off queue, legitimately — no judgement attached. */
  neutral: 'bg-slate-300',
} as const

/** Empty row background, shared by every row so they read as one grid. */
export const TRACK = 'bg-slate-100'
/** The planned shift, shown only where the agent was not punched in. */
export const SCHEDULE_TRACK = 'bg-slate-200'

/** Presence reasons that mean the agent stepped away, not merely left the queue. */
const BREAK_REASONS: PresenceStatus[] = ['Break', 'Meal', 'Idle', 'Away']

/**
 * Off-queue colour depends on why: a break or a meal is orange (stepped away),
 * everything else legitimate — a meeting, warehouse time, training — stays the
 * neutral grey of simply being off the queue.
 */
export const offQueueCls = (reason: PresenceStatus | null): string =>
  reason && BREAK_REASONS.includes(reason) ? TONE.off : TONE.neutral

/**
 * The chart legend, grouped the way a manager reads it: the phone-status tones
 * first (shared by the Clock, DeskTime and Status rows), then the two streams
 * that reuse those same brand tones with their own labels.
 */
export interface LegendItem { label: string; cls: string; outline?: boolean }
export const CHART_LEGEND_GROUPS: { group: string; items: LegendItem[] }[] = [
  {
    group: 'Phone status',
    items: [
      { label: 'On call', cls: TONE.work },
      { label: 'Available in queue', cls: TONE.ready },
      { label: 'Break or idle', cls: TONE.off },
      { label: 'Off queue', cls: TONE.neutral },
      { label: 'Needs attention', cls: TONE.alert },
    ],
  },
  {
    group: 'Calls',
    items: [
      { label: 'Inbound', cls: TONE.ready },
      { label: 'Outbound', cls: TONE.work },
      { label: 'Missed', cls: 'border border-destructive bg-white', outline: true },
    ],
  },
  {
    group: 'Tickets',
    items: [
      { label: 'Completed', cls: TONE.ready },
      { label: 'Updated', cls: TONE.off },
    ],
  },
]

// ── Routing status ────────────────────────────────────────────────────────────

/** Everything except OFF_QUEUE means the agent was in queue and reachable. */
export const isOnQueue = (s: RoutingStatus): boolean => s !== 'OFF_QUEUE'

/** Time actually spent working an interaction — the numerator for occupancy. */
export const isEngaged = (s: RoutingStatus): boolean => s === 'INTERACTING' || s === 'COMMUNICATING'

export const ROUTING_CLS: Record<RoutingStatus, string> = {
  'INTERACTING':    TONE.work,
  'COMMUNICATING':  TONE.work,
  'IDLE':           TONE.ready,
  'NOT_RESPONDING': TONE.alert,
  'OFF_QUEUE':      TONE.neutral,
}

export const ROUTING_LABEL: Record<RoutingStatus, string> = {
  'INTERACTING':    'Interacting · queued call',
  'COMMUNICATING':  'Communicating · direct call',
  'IDLE':           'Idle · in queue',
  'NOT_RESPONDING': 'Not Responding',
  'OFF_QUEUE':      'Off Queue',
}

// ── Presence (the off-queue reason) ───────────────────────────────────────────

/** Display order for the off-queue breakdown; on-queue reasons sort first. */
export const PRESENCE_ORDER: PresenceStatus[] = [
  'On Queue', 'Available', 'Follow-Up Extended', 'In Warehouse', 'Meeting', 'Training',
  'Break', 'Meal', 'Busy', 'Do Not Disturb', 'Away', 'Idle', 'Offline',
]

// ── Clock / DeskTime / Calls / Tickets ───────────────────────────────────────

export const CLOCK_CLS: Record<ClockStatus, string> = {
  'Working': TONE.work,
  'Break':   TONE.off,
  'Meal':    TONE.off,
  'Away':    TONE.neutral,
  'Offline': TONE.neutral,
}

export const DESK_CLS: Record<DeskStatus, string> = {
  'Active': TONE.work,
  'Idle':   TONE.off,
}

// Direction reuses the brand tones (teal in, blue out) rather than new hues;
// a missed call is drawn as a red outline by the timeline, not a fill.
export const CALL_CLS: Record<CallLabel, string> = {
  'Inbound':  TONE.ready,
  'Outbound': TONE.work,
  'Missed':   TONE.alert,
}

/** Ticket / task touches, coloured by what happened to the item. */
export const TICKET_CLS: Record<'Completed' | 'Updated', string> = {
  'Completed': TONE.ready,
  'Updated':   TONE.off,
}

// ── Threshold states for the headline metrics ────────────────────────────────

export type MetricState = 'good' | 'warn' | 'bad'

export const METRIC_TEXT: Record<MetricState, string> = {
  good: 'text-success',
  warn: 'text-warning',
  bad:  'text-destructive',
}

/**
 * UI-phase defaults only. Phase 2 reads these from `ie_kpi_threshold` through
 * `useKpiConfig`, the same path every other Insights KPI uses — no new table and
 * no new admin screen.
 *
 * Set against the spread the sample generator actually produces (utilization
 * 59–77, occupancy 51–76) so all three states appear on screen. The real targets
 * are an operational decision, not a UI one.
 */
export const UTILIZATION_TARGET = { good: 70, warn: 64 }
export const OCCUPANCY_TARGET = { good: 72, warn: 58 }

export const stateFor = (pct: number, t: { good: number; warn: number }): MetricState =>
  pct >= t.good ? 'good' : pct >= t.warn ? 'warn' : 'bad'
