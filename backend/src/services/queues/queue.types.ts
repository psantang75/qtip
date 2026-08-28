/**
 * Shared types for phone queue coverage.
 *
 * The unit of the answer is a 15-MINUTE SLOT, not a coverage frame. That is the
 * whole reason this subsystem was reworked: an all-day frame counts somebody who
 * is at lunch from 12:30 to 13:30 as "available in the frame", so nothing was
 * ever pulled over to cover them, which is precisely the job. Lunches, PTO
 * windows and shift edges all land on quarter hours, so a quarter hour is the
 * coarsest grain that can still see them.
 *
 * Scope resolution is NOT redefined here — queues reuse `ScheduleScope` and
 * `resolveScope` from the scheduling slice, because a manager's queue authority
 * is exactly their schedule authority over the same departments.
 *
 * Errors are `AppError` (see .cursor/rules/backend-api-conventions.mdc), not the
 * `ScheduleServiceError` the older scheduling controllers throw: this is a new
 * surface, so it adopts the canonical envelope rather than the legacy one.
 */
export type { ScheduleScope as QueueScope, AuthReq } from '../scheduling/schedule.types';

/** A half-open wall-clock interval in minutes from midnight: [startMin, endMin). */
export interface Interval {
  startMin: number;
  endMin: number;
}

/** One solved slot of the day. */
export interface QueueSlot extends Interval {
  /** 'HH:MM' wall clock, for display and for matching phone_queue_window rows. */
  start: string;
  end: string;
}

/** A queue's resolved numbers for one slot. */
export interface QueueTargets {
  min: number;
  target: number;
  max: number | null;
}

/**
 * Who covers when several people could.
 *
 * PRIORITY follows the person_priority set against each queue's membership.
 * ROUND_ROBIN instead prefers whoever has served the fewest cover-minutes so far
 * that day, so lunch cover is shared out rather than always falling on the same
 * person. It needs no stored rotation state, which is what keeps the plan
 * deterministic under compute-on-read.
 */
export type FillStrategy = 'PRIORITY' | 'ROUND_ROBIN';

/**
 * Why somebody is on a queue.
 *
 * Four reasons, not one per placement pass. Which internal pass seated a person
 * is an implementation detail; what a supervisor needs to know is whether this
 * is where they normally sit, whether something is holding them there, or
 * whether they have been pulled off their own queue to cover another one.
 */
export type SeatReason =
  /** Sitting on their own home queue. */
  | 'HOME'
  /** Held in place by a pin. */
  | 'PINNED'
  /** Pulled onto a queue that is not their home, to keep it staffed. */
  | 'COVER'
  /** Put here by hand. Always wins, and is always labelled as such. */
  | 'OVERRIDE';

/** Why a queue is short, or why somebody could not be placed. */
export type GapReason =
  | 'UNSTAFFABLE'
  | 'BELOW_MIN'
  | 'BELOW_TARGET'
  | 'NO_ELIGIBLE_MEMBERS';

/**
 * Coverage grade. Matches the frontend `CoverageLevel` in scheduleTime.ts key for
 * key, so `COVERAGE_CLS` can colour a queue strip with no translation layer.
 */
export type CoverageLevel = 'closed' | 'none' | 'red' | 'yellow' | 'green';

/** What a person is doing when they are not available to take a call. */
export type AwayKind =
  /** A scheduled activity that does not count as coverage: lunch, training. */
  | 'BREAK'
  /** An exception window — PTO, an appointment, a late arrival. */
  | 'TIME_OFF';

/** One carve-out of a person's day, for the grid to draw. */
export interface AwayBand {
  start: string;
  end: string;
  kind: AwayKind;
  label: string;
}

/**
 * One row of the day grid. Carries the person's shape of day independently of
 * where they were placed, so the grid can draw "at lunch" and "on PTO" rather
 * than an unexplained hole.
 */
export interface PersonDayRow {
  userId: number;
  username: string;
  /** Shift bounds, null when they are not scheduled at all that day. */
  shift: { start: string; end: string } | null;
  /** Full-day absence label ('PTO', 'Holiday'), when the day is written off. */
  offLabel: string | null;
  away: AwayBand[];
  /** The queue they sit on by default, when they have one. */
  homeQueueId: number | null;
  /** Every queue they may be placed on, so the slot popover can offer them. */
  memberOf: number[];
}

/** One person's placement in one slot. */
export interface SlotAssignment {
  userId: number;
  queueId: number;
  reason: SeatReason;
  /** False when they only cover part of the slot — a lunch starting at :35. */
  fullSlot: boolean;
}

/** One queue's state in one slot. */
export interface SlotQueueState {
  queueId: number;
  targets: QueueTargets;
  /** Bodies assigned. */
  assigned: number;
  /**
   * The thinnest moment inside the slot: the fewest assigned people actually on
   * coverage at any point in it. A lunch that starts mid-slot makes this lower
   * than `assigned`, and it is the number that answers the phone.
   */
  trough: number;
  level: CoverageLevel;
}

export interface SlotSolution {
  start: string;
  end: string;
  startMin: number;
  assignments: SlotAssignment[];
  queues: SlotQueueState[];
  /** Available people the solver had nowhere to put. */
  spare: number[];
}

export interface QueueMeta {
  queueId: number;
  queueName: string;
  color: string;
  fillPriority: number;
  /** The queue's default numbers; a slot inside a phone_queue_window overrides them. */
  targets: QueueTargets;
}

/**
 * A run of contiguous slots where one queue was short, merged so the UI reports
 * "Inbound below minimum 12:30–13:30" once instead of four times.
 */
export interface DayWarning {
  queueId: number;
  queueName: string;
  reason: GapReason;
  start: string;
  end: string;
  message: string;
}

export interface QueueDaySolution {
  departmentId: number;
  departmentName: string;
  date: string;
  /** False when the caller asked to include DRAFT shifts; the UI labels it. */
  publishedOnly: boolean;
  /** Set when the department has no queue policy or no active queues. */
  notConfigured: boolean;
  slotMinutes: number;
  /** Null when nobody is scheduled: there is no day to draw. */
  axis: Interval | null;
  queues: QueueMeta[];
  people: PersonDayRow[];
  slots: SlotSolution[];
  warnings: DayWarning[];
}

// ── Week roll-up ─────────────────────────────────────────────────────────────

/**
 * One queue's whole day, for the per-queue coverage summary under the week grid.
 * Graded by the day's worst slot so the colour and the number agree.
 */
export interface WeekCell {
  queueId: number;
  /** Worst grade across the day — what the summary cell's colour reports. */
  level: CoverageLevel;
  /** Headcount at that worst moment, so the colour and the number agree. */
  trough: number;
}

/**
 * One day of the week grid. The week is now the day view repeated seven times —
 * people down, days across — so each day carries the same `people` rows and
 * `slots` the day view draws, letting the grid render one compact queue-coloured
 * bar per person per day. `cells` is the per-queue worst-of-day roll-up for the
 * coverage summary beneath the grid.
 */
export interface WeekDay {
  date: string;
  /** False for a weekend, a holiday, or simply a day nobody is scheduled. */
  hasSchedule: boolean;
  axis: Interval | null;
  people: PersonDayRow[];
  slots: SlotSolution[];
  cells: WeekCell[];
}

export interface QueueWeekSolution {
  departmentId: number;
  departmentName: string;
  publishedOnly: boolean;
  notConfigured: boolean;
  queues: QueueMeta[];
  days: WeekDay[];
}
