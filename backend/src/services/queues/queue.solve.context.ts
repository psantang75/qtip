/**
 * Everything the solver needs to read, read once.
 *
 * The day and the week answer the same question over a different number of
 * dates, so they share one loader rather than each growing their own. A week is
 * seven days of schedule in ONE `getScheduledShifts` call instead of seven,
 * which is the difference between a page that opens and a page that crawls.
 *
 * Availability arrives entirely through `getScheduledShifts` — the one adapter
 * that joins shifts, activity segments, holidays and exceptions. Nothing here
 * queries shifts or exceptions itself, which is what makes "improve PTO in
 * scheduling and queues get better for free" true rather than aspirational.
 */
import prisma from '../../config/prisma';
import { getScheduledShifts } from '../attendance/scheduleProvider';
import { listRoster } from '../scheduling/schedule.permissions';
import {
  dateOnlyValue, dateStrFromDate, hmFromDateTime, hmFromTime, parseLocal,
} from '../scheduling/schedule.dates';
import { loadViewableDepartment } from './queue.permissions';
import { getPolicy } from './queue.policy.service';
import { awayBands, coverageIntervals, minutesOf } from './queue.availability';
import type { Membership, Person, PolicyRules, QueueRow } from './queue.solve.slot';
import type { PersonDayRow, QueueMeta, QueueScope } from './queue.types';

/** An override with its window resolved to minutes; null bounds mean all day. */
export interface DayOverride {
  date: string;
  userId: number;
  queueId: number;
  action: 'ASSIGN' | 'EXCLUDE';
  startMin: number | null;
  endMin: number | null;
}

export interface SolveContext {
  departmentId: number;
  departmentName: string;
  publishedOnly: boolean;
  /** True when the department has queue planning off, or no queues assigned. */
  notConfigured: boolean;
  policy: PolicyRules;
  queues: QueueRow[];
  meta: QueueMeta[];
  /** Solver-facing people, per date. */
  peopleByDate: Map<string, Person[]>;
  /** Grid-facing rows, per date. */
  rowsByDate: Map<string, PersonDayRow[]>;
  overridesByDate: Map<string, DayOverride[]>;
}

export interface LoadOptions {
  /** Include DRAFT shifts so a manager can preview a week still being built. */
  includeDraft?: boolean;
}

async function loadQueues(departmentId: number): Promise<QueueRow[]> {
  const rows = await prisma.phoneQueueDepartment.findMany({
    where: { department_id: departmentId, is_active: true, queue: { is_active: true } },
    include: {
      queue: { select: { id: true, queue_name: true, color: true, sort_order: true } },
      windows: true,
    },
  });
  return rows
    .map((r) => ({
      queueId: r.queue.id,
      queueName: r.queue.queue_name,
      color: r.queue.color,
      fillPriority: r.fill_priority,
      sortOrder: r.queue.sort_order,
      base: { min: r.min_agents, target: r.target_agents, max: r.max_agents },
      windows: r.windows.map((w) => ({
        startMin: minutesOf(hmFromTime(w.start_time)),
        endMin: minutesOf(hmFromTime(w.end_time)),
        min: w.min_agents,
        target: w.target_agents,
        max: w.max_agents,
      })),
    }))
    // Ties on fill_priority break on the library order, so the sequence is total.
    .sort((a, b) => a.fillPriority - b.fillPriority || a.sortOrder - b.sortOrder
      || a.queueName.localeCompare(b.queueName));
}

/** The full-day reason a person is off, or null when they are working. */
function fullDayLabel(day: { isDayOff: boolean; start: string | null; exceptions: Array<{ isFullDay: boolean; label: string }> } | undefined): string | null {
  if (!day) return 'Not scheduled';
  const whole = day.exceptions.find((e) => e.isFullDay);
  if (whole) return whole.label;
  if (day.isDayOff || !day.start) return 'Not scheduled';
  return null;
}

export async function loadSolveContext(
  scope: QueueScope,
  departmentId: number,
  dates: string[],
  opts: LoadOptions = {},
): Promise<SolveContext> {
  const dept = await loadViewableDepartment(scope, departmentId);
  const publishedOnly = !opts.includeDraft;

  const [policyRow, queues, roster] = await Promise.all([
    getPolicy(scope, departmentId),
    loadQueues(departmentId),
    listRoster(scope),
  ]);

  const policy: PolicyRules = {
    max_queues_per_person: policyRow.max_queues_per_person,
    require_min_one_per_queue: policyRow.require_min_one_per_queue,
    respect_pins: policyRow.respect_pins,
    fill_strategy: policyRow.fill_strategy,
  };

  const base = {
    departmentId: dept.id,
    departmentName: dept.department_name,
    publishedOnly,
    policy,
    queues,
    meta: queues.map((q) => ({
      queueId: q.queueId,
      queueName: q.queueName,
      color: q.color,
      fillPriority: q.fillPriority,
      targets: q.base,
    })),
  };

  if (!policyRow.is_enabled || queues.length === 0) {
    return {
      ...base,
      notConfigured: true,
      peopleByDate: new Map(),
      rowsByDate: new Map(),
      overridesByDate: new Map(),
    };
  }

  const members = roster.filter((r) => r.department_id === departmentId);
  const userIds = members.map((r) => r.id);
  const from = dates[0];
  const to = dates[dates.length - 1];

  const [schedule, memberships, overrideRows] = await Promise.all([
    userIds.length
      ? getScheduledShifts(userIds, parseLocal(from), parseLocal(to), { publishedOnly })
      : Promise.resolve(new Map()),
    userIds.length
      ? prisma.phoneQueueMember.findMany({
        where: { user_id: { in: userIds }, is_active: true, queue: { is_active: true } },
      })
      : Promise.resolve([]),
    prisma.phoneQueueAssignmentOverride.findMany({
      where: {
        department_id: departmentId,
        assignment_date: { in: dates.map((d) => dateOnlyValue(d)) },
      },
    }),
  ]);

  const membershipsByUser = new Map<number, Membership[]>();
  for (const m of memberships) {
    const list = membershipsByUser.get(m.user_id) ?? [];
    list.push({
      queueId: m.queue_id,
      isHome: m.is_home,
      personPriority: m.person_priority,
      isPinned: m.is_pinned,
    });
    membershipsByUser.set(m.user_id, list);
  }

  // Rotation rank is a stable position in the roster, so round-robin can break
  // an exact tie on cover-minutes without always landing on the same name.
  const ordered = [...members].sort((a, b) => a.username.localeCompare(b.username));
  const rankByUser = new Map(ordered.map((r, i) => [r.id, i]));

  const peopleByDate = new Map<string, Person[]>();
  const rowsByDate = new Map<string, PersonDayRow[]>();

  for (const date of dates) {
    const people: Person[] = [];
    const rows: PersonDayRow[] = [];

    for (const r of members) {
      const mine = membershipsByUser.get(r.id) ?? [];
      const day = schedule.get(`${r.id}:${date}`);

      people.push({
        userId: r.id,
        username: r.username,
        intervals: coverageIntervals(day),
        memberships: new Map(mine.map((m) => [m.queueId, m])),
        pinnedTo: mine.find((m) => m.isPinned)?.queueId ?? null,
        rotationRank: rankByUser.get(r.id) ?? 0,
      });

      rows.push({
        userId: r.id,
        username: r.username,
        shift: day?.start && day.end && !day.isDayOff ? { start: day.start, end: day.end } : null,
        offLabel: fullDayLabel(day),
        away: awayBands(day),
        homeQueueId: mine.find((m) => m.isHome)?.queueId ?? null,
        memberOf: mine.map((m) => m.queueId),
      });
    }

    peopleByDate.set(date, people);
    rowsByDate.set(date, rows);
  }

  const overridesByDate = new Map<string, DayOverride[]>(dates.map((d) => [d, []]));
  for (const o of overrideRows) {
    const date = dateStrFromDate(o.assignment_date);
    const list = overridesByDate.get(date);
    if (!list) continue;
    list.push({
      date,
      userId: o.user_id,
      queueId: o.queue_id,
      action: o.action as 'ASSIGN' | 'EXCLUDE',
      startMin: o.starts_at ? minutesOf(hmFromDateTime(o.starts_at)) : null,
      endMin: o.ends_at ? minutesOf(hmFromDateTime(o.ends_at)) : null,
    });
  }

  return { ...base, notConfigured: false, peopleByDate, rowsByDate, overridesByDate };
}
