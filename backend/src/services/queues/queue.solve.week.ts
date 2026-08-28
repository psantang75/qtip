/**
 * The week view: the day view repeated seven times — people down, days across.
 *
 * It solves every day at full quarter-hour resolution and hands back the same
 * `people` rows and `slots` the day view uses, so the grid draws one compact
 * queue-coloured bar per person per day. A cheaper approximation would sooner or
 * later disagree with the day view a cell links to, and the first time a manager
 * saw one queue here and another there they would stop trusting both.
 *
 * Beneath the grid a per-queue coverage summary grades each day by its thinnest
 * moment, so the colour you scan and the headcount you read come from the same
 * instant.
 */
import { addDays } from '../scheduling/schedule.dates';
import { loadSolveContext, type LoadOptions } from './queue.solve.context';
import { solveSlots } from './queue.solve.service';
import type { QueueScope } from './queue.types';
import type {
  CoverageLevel, QueueWeekSolution, SlotSolution, WeekDay,
} from './queue.types';

const DAYS_IN_WEEK = 7;

/** Escalation order, so "the worst thing that happened" is comparable. */
const SEVERITY: Record<CoverageLevel, number> = {
  closed: 0, green: 1, yellow: 2, red: 3, none: 4,
};

/** The worst-graded state for one queue across a set of slots. */
function worstAcross(
  slots: SlotSolution[],
  queueId: number,
): { level: CoverageLevel; trough: number } {
  let level: CoverageLevel = 'closed';
  let trough = 0;
  let severity = -1;

  for (const slot of slots) {
    const state = slot.queues.find((s) => s.queueId === queueId);
    if (!state || state.level === 'closed') continue;
    if (SEVERITY[state.level] > severity) {
      severity = SEVERITY[state.level];
      level = state.level;
      trough = state.trough;
    }
  }
  return { level, trough };
}

export async function solveQueueWeek(
  scope: QueueScope,
  departmentId: number,
  startDate: string,
  opts: LoadOptions = {},
): Promise<QueueWeekSolution> {
  const dates = Array.from({ length: DAYS_IN_WEEK }, (_, i) => addDays(startDate, i));
  const ctx = await loadSolveContext(scope, departmentId, dates, opts);

  const base = {
    departmentId: ctx.departmentId,
    departmentName: ctx.departmentName,
    publishedOnly: ctx.publishedOnly,
    queues: ctx.meta,
  };

  if (ctx.notConfigured) {
    return { ...base, notConfigured: true, days: [] };
  }

  const days: WeekDay[] = dates.map((date) => {
    const people = ctx.peopleByDate.get(date) ?? [];
    const { slots, axis } = solveSlots(people, ctx.queues, ctx.policy, ctx.overridesByDate.get(date) ?? []);

    // No axis means nobody was scheduled — a weekend, a holiday, or simply an
    // empty day. All three read the same on the grid, and none is a warning.
    if (!axis || slots.length === 0) {
      return { date, hasSchedule: false, axis: null, people: [], slots: [], cells: [] };
    }

    const cells = ctx.queues.map((q) => ({
      queueId: q.queueId,
      ...worstAcross(slots, q.queueId),
    }));

    return { date, hasSchedule: true, axis, people: ctx.rowsByDate.get(date) ?? [], slots, cells };
  });

  return { ...base, notConfigured: false, days };
}
