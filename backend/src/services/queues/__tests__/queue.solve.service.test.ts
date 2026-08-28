/**
 * The queue solver's rules, which are the whole point of the feature:
 *
 *   every queue gets a body before any queue gets its minimum;
 *   the highest-priority queue is filled first once the floor is met;
 *   people sit where they normally sit unless a shortfall moves them;
 *   PTO and lunches take them out, because those come from the work schedule;
 *   ONE person covers a whole absence rather than the cover changing every
 *     quarter hour, and hands it straight back when the regular is home;
 *   a manager's override beats all of it, for exactly the window it names.
 *
 * The last two are why this file is mostly written in terms of specific times.
 * A frame-based solver passed every rule above except those, and lunch cover is
 * the job, so the assertions have to be able to see 12:30 differ from 12:15.
 *
 * Availability is faked at the `getScheduledShifts` boundary rather than by
 * seeding shift rows — that adapter is the solver's only door to the schedule,
 * so mocking it is what proves the solver has no second source.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../config/prisma', () => ({
  default: {
    phoneQueueDepartment: { findMany: vi.fn() },
    phoneQueueMember: { findMany: vi.fn() },
    phoneQueueAssignmentOverride: { findMany: vi.fn() },
  },
}));
vi.mock('../../attendance/scheduleProvider', () => ({ getScheduledShifts: vi.fn() }));
vi.mock('../../scheduling/schedule.permissions', () => ({ listRoster: vi.fn(), resolveScope: vi.fn() }));
vi.mock('../queue.permissions', () => ({
  loadViewableDepartment: vi.fn(async () => ({ id: 1, department_name: 'Support' })),
}));
vi.mock('../queue.policy.service', () => ({ getPolicy: vi.fn() }));

import prisma from '../../../config/prisma';
import { getScheduledShifts } from '../../attendance/scheduleProvider';
import { listRoster } from '../../scheduling/schedule.permissions';
import { getPolicy } from '../queue.policy.service';
import { solveQueueDay } from '../queue.solve.service';
import type { ScheduledDay } from '../../attendance/scheduleProvider';
import type { FillStrategy, QueueDaySolution, QueueScope } from '../queue.types';

const db = prisma as unknown as {
  phoneQueueDepartment: { findMany: ReturnType<typeof vi.fn> };
  phoneQueueMember: { findMany: ReturnType<typeof vi.fn> };
  phoneQueueAssignmentOverride: { findMany: ReturnType<typeof vi.fn> };
};

const DATE = '2026-09-01';
const scope: QueueScope = { viewerId: 1, canViewAll: true, departmentIds: null, isAdmin: true };

// ── Fixture builders ─────────────────────────────────────────────────────────

interface QueueFixture {
  id: number;
  name: string;
  priority: number;
  min: number;
  target?: number;
  max?: number | null;
}

const queue = (q: QueueFixture) => ({
  queue: { id: q.id, queue_name: q.name, color: '#00aeef', sort_order: q.id },
  fill_priority: q.priority,
  min_agents: q.min,
  target_agents: q.target ?? q.min,
  max_agents: q.max ?? null,
  windows: [],
});

const member = (userId: number, queueId: number, over: Partial<{
  is_home: boolean; person_priority: number; is_pinned: boolean;
}> = {}) => ({
  user_id: userId,
  queue_id: queueId,
  is_home: over.is_home ?? false,
  person_priority: over.person_priority ?? 100,
  is_pinned: over.is_pinned ?? false,
});

const lunch = (start: string, end: string) => ({
  activity: 'Lunch', start, end, isPaid: false, countsAsCoverage: false,
});

const workingDay = (over: Partial<ScheduledDay> = {}): ScheduledDay => ({
  shiftId: 1, start: '08:00', end: '17:00', isDayOff: false,
  scheduledMinutes: 480, segments: [], exceptions: [], ...over,
});

const policy = (over: Partial<{
  is_enabled: boolean; max_queues_per_person: number;
  require_min_one_per_queue: boolean; respect_pins: boolean; fill_strategy: FillStrategy;
}> = {}) => ({
  department_id: 1,
  is_enabled: over.is_enabled ?? true,
  max_queues_per_person: over.max_queues_per_person ?? 1,
  require_min_one_per_queue: over.require_min_one_per_queue ?? true,
  respect_pins: over.respect_pins ?? true,
  fill_strategy: over.fill_strategy ?? ('PRIORITY' as FillStrategy),
  configured: true,
});

interface OverrideFixture {
  user_id: number;
  queue_id: number;
  action: string;
  /** 'HH:MM'; omit both for an all-day override. */
  start?: string;
  end?: string;
}

const at = (hm: string) => {
  const [h, m] = hm.split(':').map(Number);
  return new Date(2026, 8, 1, h, m, 0);
};

/** Everybody works 08:00–17:00 unless the caller says otherwise. */
function setup(opts: {
  queues: QueueFixture[];
  people: Array<{ id: number; name: string; day?: ScheduledDay | null }>;
  members: Array<ReturnType<typeof member>>;
  policy?: ReturnType<typeof policy>;
  overrides?: OverrideFixture[];
}) {
  vi.mocked(getPolicy).mockResolvedValue(opts.policy ?? policy());
  db.phoneQueueDepartment.findMany.mockResolvedValue(opts.queues.map(queue));
  db.phoneQueueMember.findMany.mockResolvedValue(opts.members);
  db.phoneQueueAssignmentOverride.findMany.mockResolvedValue(
    (opts.overrides ?? []).map((o) => ({
      ...o,
      assignment_date: new Date(Date.UTC(2026, 8, 1)),
      starts_at: o.start ? at(o.start) : null,
      ends_at: o.end ? at(o.end) : null,
    })),
  );

  vi.mocked(listRoster).mockResolvedValue(
    opts.people.map((p) => ({ id: p.id, username: p.name, department_id: 1 })) as never,
  );
  const schedule = new Map<string, ScheduledDay>();
  for (const p of opts.people) {
    const d = p.day === undefined ? workingDay() : p.day;
    if (d) schedule.set(`${p.id}:${DATE}`, d);
  }
  vi.mocked(getScheduledShifts).mockResolvedValue(schedule);
}

const solve = () => solveQueueDay(scope, 1, DATE);

/** Who is on each queue at one moment of the day, by name. */
function seatingAt(result: QueueDaySolution, time: string): Record<string, string[]> {
  const slot = result.slots.find((s) => s.start === time);
  if (!slot) throw new Error(`No slot at ${time}`);
  const nameOf = new Map(result.people.map((p) => [p.userId, p.username]));
  const out: Record<string, string[]> = {};
  for (const q of result.queues) {
    out[q.queueName] = slot.assignments
      .filter((a) => a.queueId === q.queueId)
      .map((a) => nameOf.get(a.userId)!);
  }
  return out;
}

/** The reason one person was placed at one moment, or null when unseated. */
function reasonAt(result: QueueDaySolution, time: string, userId: number): string | null {
  const slot = result.slots.find((s) => s.start === time)!;
  return slot.assignments.find((a) => a.userId === userId)?.reason ?? null;
}

// Two queues and three people is the smallest arrangement in which pulling
// somebody off their own queue to cover another is a real decision.
const TWO_QUEUES: QueueFixture[] = [
  { id: 10, name: 'Inbound', priority: 1, min: 1, target: 1 },
  { id: 20, name: 'Outbound', priority: 2, min: 1, target: 1 },
];
const THREE_PEOPLE = [
  { id: 1, name: 'jamie' },
  { id: 2, name: 'mitch' },
  { id: 3, name: 'steve' },
];
/** Everyone can take either queue; jamie lives on Inbound, the others Outbound. */
const CROSS_TRAINED = [
  member(1, 10, { is_home: true }), member(1, 20),
  member(2, 20, { is_home: true }), member(2, 10),
  member(3, 20, { is_home: true }), member(3, 10),
];

beforeEach(() => vi.clearAllMocks());

describe('the shape of the day', () => {
  it('says nothing when the department has queue planning turned off', async () => {
    setup({ queues: TWO_QUEUES, people: THREE_PEOPLE, members: CROSS_TRAINED, policy: policy({ is_enabled: false }) });
    const result = await solve();
    expect(result.notConfigured).toBe(true);
    expect(result.slots).toEqual([]);
  });

  it('has no day to draw when nobody is scheduled', async () => {
    setup({
      queues: TWO_QUEUES,
      people: THREE_PEOPLE.map((p) => ({ ...p, day: null })),
      members: CROSS_TRAINED,
    });
    const result = await solve();
    expect(result.notConfigured).toBe(false);
    expect(result.axis).toBeNull();
    expect(result.slots).toEqual([]);
  });

  it('cuts the working hours into quarter hours', async () => {
    setup({ queues: TWO_QUEUES, people: THREE_PEOPLE, members: CROSS_TRAINED });
    const result = await solve();
    expect(result.slotMinutes).toBe(15);
    expect(result.axis).toEqual({ startMin: 8 * 60, endMin: 17 * 60 });
    expect(result.slots).toHaveLength(36);
    expect(result.slots[0].start).toBe('08:00');
    expect(result.slots[35].end).toBe('17:00');
  });

  it('reports each person\'s lunch so the grid can explain the hole', async () => {
    setup({
      queues: TWO_QUEUES,
      people: [{ id: 1, name: 'jamie', day: workingDay({ segments: [lunch('12:30', '13:30')] }) }],
      members: [member(1, 10, { is_home: true })],
    });
    const result = await solve();
    expect(result.people[0].away).toEqual([
      { start: '12:30', end: '13:30', kind: 'BREAK', label: 'Lunch' },
    ]);
  });
});

describe('placement rules', () => {
  it('gives every queue a body before it fills any queue to its minimum', async () => {
    // Inbound wants three and could have had all of them. An empty Outbound does
    // not ring, so it takes one first.
    setup({
      queues: [
        { id: 10, name: 'Inbound', priority: 1, min: 3, target: 3 },
        { id: 20, name: 'Outbound', priority: 2, min: 1, target: 1 },
      ],
      people: THREE_PEOPLE,
      members: CROSS_TRAINED,
    });
    const seats = seatingAt(await solve(), '09:00');
    expect(seats.Outbound).toHaveLength(1);
    expect(seats.Inbound.length).toBeGreaterThan(0);
  });

  it('leaves people on their home queue when nothing is short', async () => {
    setup({ queues: TWO_QUEUES, people: THREE_PEOPLE, members: CROSS_TRAINED });
    const result = await solve();
    expect(seatingAt(result, '09:00')).toEqual({
      Inbound: ['jamie'],
      Outbound: ['mitch', 'steve'],
    });
    expect(reasonAt(result, '09:00', 1)).toBe('HOME');
  });

  it('pulls a spare person up to a higher-priority queue that is short', async () => {
    setup({
      queues: [
        { id: 10, name: 'Inbound', priority: 1, min: 2, target: 2 },
        { id: 20, name: 'Outbound', priority: 2, min: 1, target: 1 },
      ],
      people: THREE_PEOPLE,
      members: CROSS_TRAINED,
    });
    const result = await solve();
    expect(seatingAt(result, '09:00')).toEqual({
      Inbound: ['jamie', 'steve'],
      Outbound: ['mitch'],
    });
    // Steve was taken off his own queue, and the plan says so.
    expect(reasonAt(result, '09:00', 3)).toBe('COVER');
  });

  it('does not empty a lower-priority queue to feed a higher one', async () => {
    setup({
      queues: [
        { id: 10, name: 'Inbound', priority: 1, min: 3, target: 3 },
        { id: 20, name: 'Outbound', priority: 2, min: 1, target: 1 },
      ],
      people: THREE_PEOPLE,
      members: CROSS_TRAINED,
    });
    const seats = seatingAt(await solve(), '09:00');
    expect(seats.Outbound).toEqual(['mitch']);
    expect(seats.Inbound).toEqual(['jamie', 'steve']);
  });

  it('never moves a pinned person, however short another queue is', async () => {
    setup({
      queues: [
        { id: 10, name: 'Inbound', priority: 1, min: 3, target: 3 },
        { id: 20, name: 'Outbound', priority: 2, min: 1, target: 1 },
      ],
      people: THREE_PEOPLE,
      members: [
        member(1, 10, { is_home: true }),
        member(2, 20, { is_home: true, is_pinned: true }), member(2, 10),
        member(3, 20, { is_home: true }), member(3, 10),
      ],
    });
    const result = await solve();
    expect(seatingAt(result, '09:00').Outbound).toEqual(['mitch']);
    expect(reasonAt(result, '09:00', 2)).toBe('PINNED');
  });
});

describe('lunch cover', () => {
  // jamie owns Inbound and goes to lunch for an hour in the middle of it.
  const withJamieAtLunch = () => setup({
    queues: TWO_QUEUES,
    people: [
      { id: 1, name: 'jamie', day: workingDay({ segments: [lunch('12:30', '13:30')] }) },
      { id: 2, name: 'mitch' },
      { id: 3, name: 'steve' },
    ],
    members: CROSS_TRAINED,
  });

  it('backfills the queue the moment its regular leaves', async () => {
    withJamieAtLunch();
    const result = await solve();
    expect(seatingAt(result, '12:15').Inbound).toEqual(['jamie']);
    expect(seatingAt(result, '12:30').Inbound).toEqual(['mitch']);
    expect(reasonAt(result, '12:30', 2)).toBe('COVER');
  });

  it('keeps the SAME person on cover for the whole absence', async () => {
    // The bug this guards: solving each slot from scratch makes the cover
    // change every quarter hour, which is unworkable on a real phone system.
    withJamieAtLunch();
    const result = await solve();
    for (const time of ['12:30', '12:45', '13:00', '13:15']) {
      expect(seatingAt(result, time).Inbound).toEqual(['mitch']);
    }
  });

  it('hands the queue straight back when its regular returns', async () => {
    withJamieAtLunch();
    const result = await solve();
    expect(seatingAt(result, '13:30').Inbound).toEqual(['jamie']);
    // And the cover is released rather than left stranded off their own queue.
    expect(seatingAt(result, '13:30').Outbound).toContain('mitch');
  });

  it('counts nobody who is at lunch, so the queue reads as thin not covered', async () => {
    setup({
      queues: [{ id: 10, name: 'Inbound', priority: 1, min: 1, target: 2 }],
      people: [
        { id: 1, name: 'jamie', day: workingDay({ segments: [lunch('12:30', '13:30')] }) },
        { id: 2, name: 'mitch' },
      ],
      members: [member(1, 10, { is_home: true }), member(2, 10, { is_home: true })],
    });
    const result = await solve();
    const before = result.slots.find((s) => s.start === '12:15')!.queues[0];
    const during = result.slots.find((s) => s.start === '12:45')!.queues[0];
    expect(before).toMatchObject({ trough: 2, level: 'green' });
    // Still above the minimum, so thin rather than failing — and nobody was
    // conjured up to replace jamie, because there is nobody left to conjure.
    expect(during).toMatchObject({ trough: 1, level: 'yellow' });
  });

  it('grades a queue red once the dip takes it under its minimum', async () => {
    setup({
      queues: [{ id: 10, name: 'Inbound', priority: 1, min: 2, target: 2 }],
      people: [
        { id: 1, name: 'jamie', day: workingDay({ segments: [lunch('12:30', '13:30')] }) },
        { id: 2, name: 'mitch' },
      ],
      members: [member(1, 10, { is_home: true }), member(2, 10, { is_home: true })],
    });
    const result = await solve();
    expect(result.slots.find((s) => s.start === '12:45')!.queues[0].level).toBe('red');
  });
});

describe('fill strategy', () => {
  // jamie is away twice, so there are two separate cover jobs to hand out.
  const twoAbsences = (fill: FillStrategy) => setup({
    queues: TWO_QUEUES,
    people: [
      { id: 1, name: 'jamie', day: workingDay({ segments: [lunch('11:00', '12:00'), lunch('14:00', '15:00')] }) },
      { id: 2, name: 'mitch' },
      { id: 3, name: 'steve' },
    ],
    members: CROSS_TRAINED,
    policy: policy({ fill_strategy: fill }),
  });

  it('by priority, the same person covers every time', async () => {
    twoAbsences('PRIORITY');
    const result = await solve();
    expect(seatingAt(result, '11:00').Inbound).toEqual(['mitch']);
    expect(seatingAt(result, '14:00').Inbound).toEqual(['mitch']);
  });

  it('by round-robin, the second cover goes to whoever has done less of it', async () => {
    twoAbsences('ROUND_ROBIN');
    const result = await solve();
    expect(seatingAt(result, '11:00').Inbound).toEqual(['mitch']);
    expect(seatingAt(result, '14:00').Inbound).toEqual(['steve']);
  });
});

describe('overrides', () => {
  it('forces somebody in for exactly the window it names, and no longer', async () => {
    setup({
      queues: TWO_QUEUES,
      people: THREE_PEOPLE,
      members: CROSS_TRAINED,
      overrides: [{ user_id: 3, queue_id: 10, action: 'ASSIGN', start: '10:00', end: '11:00' }],
    });
    const result = await solve();
    expect(seatingAt(result, '09:45').Inbound).not.toContain('steve');
    expect(seatingAt(result, '10:00').Inbound).toContain('steve');
    expect(seatingAt(result, '10:45').Inbound).toContain('steve');
    expect(seatingAt(result, '11:00').Inbound).not.toContain('steve');
    expect(reasonAt(result, '10:00', 3)).toBe('OVERRIDE');
  });

  it('applies an override with no window to the whole day', async () => {
    setup({
      queues: TWO_QUEUES,
      people: THREE_PEOPLE,
      members: CROSS_TRAINED,
      overrides: [{ user_id: 3, queue_id: 10, action: 'ASSIGN' }],
    });
    const result = await solve();
    expect(seatingAt(result, '08:00').Inbound).toContain('steve');
    expect(seatingAt(result, '16:45').Inbound).toContain('steve');
  });

  it('backfills the queue somebody was excluded from', async () => {
    // An exclusion applied after the rules ran would punch a hole nobody fills,
    // which is the opposite of what "take them off this queue" means.
    setup({
      queues: TWO_QUEUES,
      people: THREE_PEOPLE,
      members: CROSS_TRAINED,
      overrides: [{ user_id: 1, queue_id: 10, action: 'EXCLUDE' }],
    });
    const result = await solve();
    const seats = seatingAt(result, '09:00');
    expect(seats.Inbound).toEqual(['mitch']);
    expect(seats.Inbound).not.toContain('jamie');
    expect(result.slots.find((s) => s.start === '09:00')!.spare).toContain(1);
  });
});

describe('warnings', () => {
  it('merges a run of short slots into one reported window', async () => {
    setup({
      queues: [{ id: 10, name: 'Inbound', priority: 1, min: 2, target: 2 }],
      people: [{ id: 1, name: 'jamie' }],
      members: [member(1, 10, { is_home: true })],
    });
    const result = await solve();
    expect(result.warnings).toEqual([{
      queueId: 10,
      queueName: 'Inbound',
      reason: 'BELOW_MIN',
      start: '08:00',
      end: '17:00',
      message: 'Thins to 1 against a minimum of 2.',
    }]);
  });

  it('reports only the hours that were actually short', async () => {
    setup({
      queues: [{ id: 10, name: 'Inbound', priority: 1, min: 2, target: 2 }],
      people: [
        { id: 1, name: 'jamie' },
        { id: 2, name: 'mitch', day: workingDay({ segments: [lunch('12:00', '13:00')] }) },
      ],
      members: [member(1, 10, { is_home: true }), member(2, 10, { is_home: true })],
    });
    const result = await solve();
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatchObject({ reason: 'BELOW_MIN', start: '12:00', end: '13:00' });
  });

  it('says nothing when every queue is at target all day', async () => {
    setup({ queues: TWO_QUEUES, people: THREE_PEOPLE, members: CROSS_TRAINED });
    expect((await solve()).warnings).toEqual([]);
  });
});
