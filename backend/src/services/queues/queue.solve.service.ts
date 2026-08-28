/**
 * Solve queue coverage for one department-day, a quarter hour at a time.
 *
 * Nothing is stored. The answer is recomputed from the work schedule every time
 * it is read, exactly as the campaign month is projected, so a new shift, a PTO
 * row or a rule change shows up immediately with no publish step to forget.
 *
 * The slot loop is the whole design. Each slot is placed by the pure rules in
 * queue.solve.slot, and two things are carried from one slot to the next:
 *
 *   previous     — who held each queue last slot, so one person covers a whole
 *                  lunch rather than the cover changing every quarter hour.
 *   coverMinutes — how long each person has been off their own queue, which is
 *                  what round-robin shares out.
 *
 * That carry is why this is a loop and not a map: slot N's answer depends on
 * slot N-1's, and solving them independently is what produced the churn the
 * frame-based version never had to think about.
 */
import { buildSlots, dayAxis, SLOT_MINUTES, troughAcross } from './queue.availability';
import {
  availableIn, gradeLevel, solveSlot, targetsFor,
  type ActiveOverride, type Person, type QueueRow,
} from './queue.solve.slot';
import { loadSolveContext, type DayOverride, type LoadOptions, type SolveContext } from './queue.solve.context';
import type {
  DayWarning, GapReason, Interval, QueueDaySolution, QueueSlot, SlotQueueState, SlotSolution,
} from './queue.types';

/** Overrides whose window touches this slot. Null bounds mean the whole day. */
function activeIn(overrides: DayOverride[], slot: QueueSlot): ActiveOverride[] {
  return overrides
    .filter((o) => {
      if (o.startMin === null || o.endMin === null) return true;
      return o.endMin > slot.startMin && o.startMin < slot.endMin;
    })
    .map((o) => ({ userId: o.userId, queueId: o.queueId, action: o.action }));
}

interface SolvedSlots {
  slots: SlotSolution[];
  axis: Interval | null;
}

/**
 * Walk the day slot by slot. Exported so the week roll-up gets the identical
 * answer the day view shows — a week that disagreed with the day it links to
 * would be worse than no week view.
 */
export function solveSlots(
  people: Person[],
  queues: QueueRow[],
  policy: SolveContext['policy'],
  overrides: DayOverride[],
): SolvedSlots {
  const axis = dayAxis(people.map((p) => p.intervals));
  const slots = buildSlots(axis);
  if (slots.length === 0) return { slots: [], axis };

  const byId = new Map(people.map((p) => [p.userId, p]));
  const ctx = { previous: new Map<number, Set<number>>(), coverMinutes: new Map<number, number>() };

  const solved = slots.map((slot) => {
    const available = availableIn(people, slot);
    const { assignments, suspended } = solveSlot(
      slot, queues, available, policy, activeIn(overrides, slot), ctx,
    );

    const seatedBy = new Map<number, Set<number>>();
    for (const a of assignments) {
      if (!seatedBy.has(a.queueId)) seatedBy.set(a.queueId, new Set());
      seatedBy.get(a.queueId)!.add(a.userId);
    }

    const queueStates: SlotQueueState[] = queues.map((q) => {
      const seated = [...(seatedBy.get(q.queueId) ?? [])];
      const targets = targetsFor(q, slot);
      const trough = troughAcross(seated.map((id) => byId.get(id)?.intervals ?? []), slot);
      return {
        queueId: q.queueId,
        targets,
        assigned: seated.length,
        trough,
        // Nobody on shift at all is the department being shut, not a failure.
        level: available.length === 0 ? 'closed' : gradeLevel(trough, targets),
      };
    });

    // Carry forward: continuity for the next slot, and the cover-minutes that
    // round-robin balances. Only a COVER earns minutes — sitting at home is not
    // a favour anybody is owed a turn away from.
    const next = new Map<number, Set<number>>();
    for (const a of assignments) {
      if (!next.has(a.userId)) next.set(a.userId, new Set());
      next.get(a.userId)!.add(a.queueId);
      if (a.reason === 'COVER') {
        ctx.coverMinutes.set(a.userId, (ctx.coverMinutes.get(a.userId) ?? 0) + (slot.endMin - slot.startMin));
      }
    }
    ctx.previous = next;

    const spare = available
      .filter((p) => !assignments.some((a) => a.userId === p.userId))
      .map((p) => p.userId);

    return {
      start: slot.start,
      end: slot.end,
      startMin: slot.startMin,
      assignments,
      queues: queueStates.map((s) => (suspended.has(s.queueId)
        ? { ...s, level: 'none' as const }
        : s)),
      spare,
    };
  });

  return { slots: solved, axis };
}

const WARNING_TEXT: Record<GapReason, (s: SlotQueueState) => string> = {
  UNSTAFFABLE: () => 'Nobody eligible is available, so this queue cannot be staffed.',
  NO_ELIGIBLE_MEMBERS: () => 'No eligible member is available.',
  BELOW_MIN: (s) => `Thins to ${s.trough} against a minimum of ${s.targets.min}.`,
  BELOW_TARGET: (s) => `Thins to ${s.trough} against a target of ${s.targets.target}.`,
};

function slotWarning(state: SlotQueueState): GapReason | null {
  if (state.level === 'closed') return null;
  if (state.assigned === 0) return 'NO_ELIGIBLE_MEMBERS';
  if (state.trough < state.targets.min) return 'BELOW_MIN';
  if (state.trough < state.targets.target) return 'BELOW_TARGET';
  return null;
}

/**
 * Contiguous runs of the same problem, merged. "Inbound below minimum
 * 12:30–13:30" is one thing that happened; reporting it four times because it
 * spans four slots buries it.
 */
export function collectWarnings(slots: SlotSolution[], queues: QueueRow[]): DayWarning[] {
  const out: DayWarning[] = [];

  for (const q of queues) {
    let open: { reason: GapReason; start: string; end: string; state: SlotQueueState } | null = null;

    const close = () => {
      if (!open) return;
      out.push({
        queueId: q.queueId,
        queueName: q.queueName,
        reason: open.reason,
        start: open.start,
        end: open.end,
        message: WARNING_TEXT[open.reason](open.state),
      });
      open = null;
    };

    for (const slot of slots) {
      const state = slot.queues.find((s) => s.queueId === q.queueId);
      const reason = state ? slotWarning(state) : null;
      if (!state || !reason) {
        close();
        continue;
      }
      if (open && open.reason === reason) {
        // Keep the worst slot's numbers, so the message reports the low point.
        open.end = slot.end;
        if (state.trough < open.state.trough) open.state = state;
        continue;
      }
      close();
      open = { reason, start: slot.start, end: slot.end, state };
    }
    close();
  }

  return out;
}

/** Build the day answer from an already-loaded context. */
export function solveDay(ctx: SolveContext, date: string): QueueDaySolution {
  const base = {
    departmentId: ctx.departmentId,
    departmentName: ctx.departmentName,
    date,
    publishedOnly: ctx.publishedOnly,
    slotMinutes: SLOT_MINUTES,
    queues: ctx.meta,
  };

  if (ctx.notConfigured) {
    return { ...base, notConfigured: true, axis: null, people: [], slots: [], warnings: [] };
  }

  const people = ctx.peopleByDate.get(date) ?? [];
  const { slots, axis } = solveSlots(people, ctx.queues, ctx.policy, ctx.overridesByDate.get(date) ?? []);

  return {
    ...base,
    notConfigured: false,
    axis,
    people: ctx.rowsByDate.get(date) ?? [],
    slots,
    warnings: collectWarnings(slots, ctx.queues),
  };
}

export async function solveQueueDay(
  scope: Parameters<typeof loadSolveContext>[0],
  departmentId: number,
  date: string,
  opts: LoadOptions = {},
): Promise<QueueDaySolution> {
  const ctx = await loadSolveContext(scope, departmentId, [date], opts);
  return solveDay(ctx, date);
}
