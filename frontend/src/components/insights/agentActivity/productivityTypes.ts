/**
 * Shared types for the Insights → Productivity report.
 *
 * These mirror the shapes the backend live services return (see
 * backend/src/services/insightsProductivityDay.service.ts and
 * insightsProductivityRoster.service.ts), so `buildDayModel` and the roster
 * table consume the API response directly. The status vocabularies live in
 * `productivityStatus.ts`.
 */
import type { CallDirection, ClockStatus, PresenceStatus, RoutingStatus } from './productivityStatus'

/** A contiguous run of one status. Times are local "HH:MM" (24h). */
export interface StatusSpan<T extends string> { start: string; end: string; status: T }
export type RoutingSpan = StatusSpan<RoutingStatus>
export type PresenceSpan = StatusSpan<PresenceStatus>
export type ClockSpan = StatusSpan<ClockStatus>

/** One conversation leg the agent participated in. */
export interface CallSpan {
  conversationId: string
  start: string
  end: string
  direction: CallDirection
  /** False when the call alerted but was never answered (Genesys NOT_RESPONDING). */
  answered: boolean
  /** True when the call was offered through a queue; false for direct/outbound. */
  acd: boolean
  holdMins: number
  /** After-call work (Genesys Wrapup segment). */
  wrapMins: number
  /** Passed to another agent or queue instead of being resolved on this call. */
  transferred: boolean
}

/** Dialling effort for the day (Genesys outbound aggregates). */
export interface OutboundEffort {
  dials: number
  connected: number
  voicemail: number
  noAnswer: number
}

/** One touched CRM item, carrying its real ID and deep link for the drill-down. */
export interface TicketTouch {
  itemType: 'task' | 'ticket'
  /** The real CRM TaskID / TicketID — the number in the URL, not an internal key. */
  itemId: number
  /** CRM deep link for the item, null when it couldn't be resolved. */
  url: string | null
  subject: string | null
  action: 'Updated' | 'Completed'
}

/** A one-minute bucket in which the agent touched one or more tickets/tasks. */
export interface TicketEvent {
  time: string
  updated: number
  completed: number
  ids: TicketTouch[]
}

/** A carve-out of the scheduled shift (unpaid lunch or paid break). */
export interface ScheduleBreak { start: string; end: string; kind: 'Lunch' | 'Break' }
/** The planned shift, pulled from Scheduling. Null until wired to the roster. */
export interface ScheduleShift { start: string; end: string; breaks: ScheduleBreak[] }

/** All activity for one agent on one day. */
export interface AgentDay {
  schedule: ScheduleShift | null
  clock: ClockSpan[]
  routing: RoutingSpan[]
  presence: PresenceSpan[]
  calls: CallSpan[]
  outbound: OutboundEffort
  tickets: TicketEvent[]
}

/**
 * One row per agent for a single day — the roster table AND the source the
 * department comparison medians are computed from. Comes straight from the
 * roster endpoint.
 */
export interface ProductivityRosterRow {
  employeeKey: number
  agent: string
  department: string
  /** Paid time (Work + Break), in minutes. */
  clockedMin: number
  /** Phone-handle share of paid time — the report's headline metric. */
  utilizationPct: number
  /** Engaged share of on-queue time. */
  occupancyPct: number
  /** Answered calls per paid hour. */
  callsPerHour: number
  /** Average handle time per answered call, in minutes. */
  ahtMins: number
  /** Calls that alerted and were never answered. */
  missedCalls: number
  /** Total handle time (talk + hold + after-call work), in minutes. */
  handleMin: number
  /** Time signed in and available to the queue, in minutes. */
  onQueueMin: number
  /** Distinct tickets/tasks touched (the Workload "touched" basis). */
  ticketsTouched: number
}

export interface ProductivityRosterResponse {
  date: string
  area: 'sales' | 'csr'
  rows: ProductivityRosterRow[]
  departments: string[]
}
