/**
 * MOCKUP DATA — Phase 1 design probe only.
 *
 * Hardcoded fixtures for the scheduling grid layout review. Nothing here talks
 * to an API and none of these shapes are the final types; they exist so the
 * grid can be judged against realistic density before the schema is committed.
 * Delete this file when the grid is wired to the real endpoints.
 *
 * Department names and headcount distribution mirror production so the layout
 * is reviewed at true scale (26 CSRs, largest department 9).
 */

export type ShiftStatus = 'DRAFT' | 'PUBLISHED'

export interface MockBreak {
  kind: 'BREAK' | 'LUNCH'
  /** Wall-clock 'HH:MM', local time. Never a Date — see date-handling rule. */
  start: string
  end: string
}

export interface MockShift {
  /** 'YYYY-MM-DD', local date components only. */
  date: string
  start: string
  end: string
  breaks: MockBreak[]
  status: ShiftStatus
}

export interface MockException {
  date: string
  typeLabel: string
  excused: boolean
  isFullDay: boolean
  /** Excused window, omitted when isFullDay. */
  start?: string
  end?: string
}

export interface MockPerson {
  id: number
  name: string
  /** null models a user with no department_id — invisible to every manager. */
  department: string | null
  shifts: MockShift[]
  exceptions: MockException[]
}

/**
 * Stand-in for the schedule_exception_type list, which is admin-managed in the
 * real thing. `excused` alone decides whether an exception counts against the
 * employee — there is no separate points flag, and no points logic here at all.
 * `mode` drives whether the entry form asks for a time window.
 */
export interface MockExceptionType {
  label: string
  excused: boolean
  mode: 'FULL_DAY' | 'WINDOW' | 'EITHER'
}

export const MOCK_EXCEPTION_TYPES: MockExceptionType[] = [
  { label: 'Excused Absence',        excused: true,  mode: 'FULL_DAY' },
  { label: 'Unexcused Absence',      excused: false, mode: 'FULL_DAY' },
  { label: 'No Call / No Show',      excused: false, mode: 'FULL_DAY' },
  { label: 'Excused Late Arrival',   excused: true,  mode: 'WINDOW' },
  { label: 'Unexcused Late Arrival', excused: false, mode: 'WINDOW' },
  { label: 'Excused Early Leave',    excused: true,  mode: 'WINDOW' },
  { label: 'Unexcused Early Leave',  excused: false, mode: 'WINDOW' },
  { label: 'Excused Partial Day',    excused: true,  mode: 'WINDOW' },
  { label: 'Extended Lunch / Break', excused: false, mode: 'WINDOW' },
  { label: 'Scheduled PTO',          excused: true,  mode: 'EITHER' },
  { label: 'Unscheduled PTO / Call-Out', excused: false, mode: 'EITHER' },
  { label: 'Bereavement',            excused: true,  mode: 'EITHER' },
  { label: 'Jury Duty',              excused: true,  mode: 'EITHER' },
  { label: 'FMLA / LOA',             excused: true,  mode: 'FULL_DAY' },
  { label: 'Holiday',                excused: true,  mode: 'FULL_DAY' },
  { label: 'Company Closure',        excused: true,  mode: 'EITHER' },
  { label: 'Sent Home - Company',    excused: true,  mode: 'WINDOW' },
  { label: 'Missed Punch',           excused: true,  mode: 'EITHER' },
]

// ── Templates ────────────────────────────────────────────────────────────────

/** One day of a template. Index 0 is Sunday — the business week is Sun-Sat. */
export interface TemplateDay {
  working: boolean
  start: string
  end: string
  breaks: MockBreak[]
}

export interface MockTemplate {
  id: number
  name: string
  description: string
  isActive: boolean
  days: TemplateDay[]
}

const OFF_DAY: TemplateDay = { working: false, start: '08:00', end: '17:00', breaks: [] }

function weekOf(start: string, end: string, breaks: MockBreak[], workingDays = [1, 2, 3, 4, 5]): TemplateDay[] {
  return Array.from({ length: 7 }, (_, i) =>
    workingDays.includes(i) ? { working: true, start, end, breaks } : { ...OFF_DAY })
}

export const MOCK_TEMPLATES: MockTemplate[] = [
  {
    id: 1, name: 'Standard 8-5', description: 'Default weekday shift for most agents.',
    isActive: true,
    days: weekOf('08:00', '17:00', [
      { kind: 'BREAK', start: '10:00', end: '10:15' },
      { kind: 'LUNCH', start: '12:00', end: '12:30' },
      { kind: 'BREAK', start: '14:30', end: '14:45' },
    ]),
  },
  {
    id: 2, name: 'Rotating Late', description: 'Late coverage. Rotates weekly between agents.',
    isActive: true,
    days: weekOf('10:30', '19:30', [
      { kind: 'BREAK', start: '12:30', end: '12:45' },
      { kind: 'LUNCH', start: '15:00', end: '15:30' },
      { kind: 'BREAK', start: '17:30', end: '17:45' },
    ]),
  },
  {
    id: 3, name: 'Early Open', description: 'Opens the queue an hour before the standard shift.',
    isActive: true,
    days: weekOf('07:00', '16:00', [
      { kind: 'BREAK', start: '09:00', end: '09:15' },
      { kind: 'LUNCH', start: '11:30', end: '12:00' },
      { kind: 'BREAK', start: '14:00', end: '14:15' },
    ]),
  },
  {
    id: 4, name: 'Part Time Mid-Day', description: 'Five hour mid-day shift, single break.',
    isActive: true,
    days: weekOf('09:00', '14:00', [{ kind: 'BREAK', start: '11:30', end: '11:45' }]),
  },
  {
    id: 5, name: 'Saturday Coverage', description: 'Weekend rotation for Tech Support.',
    isActive: false,
    days: weekOf('09:00', '17:00', [{ kind: 'LUNCH', start: '12:30', end: '13:00' }], [6]),
  },
]

// ── Local date helpers ───────────────────────────────────────────────────────
// Local components throughout. Never toISOString() — it shifts the day.

export function toLocalIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  return toLocalIso(new Date(y, m - 1, d + days))
}

/** Sunday of the week containing `iso` — the business week runs Sun-Sat. */
export function startOfWeek(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return addDays(iso, -new Date(y, m - 1, d).getDay())
}

export function parseLocal(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function isWeekend(iso: string): boolean {
  const dow = parseLocal(iso).getDay()
  return dow === 0 || dow === 6
}

// ── Shift patterns ───────────────────────────────────────────────────────────

type Pattern = { start: string; end: string; breaks: MockBreak[] }

const PATTERNS: Record<string, Pattern> = {
  standard: {
    start: '08:00', end: '17:00',
    breaks: [
      { kind: 'BREAK', start: '10:00', end: '10:15' },
      { kind: 'LUNCH', start: '12:00', end: '12:30' },
      { kind: 'BREAK', start: '14:30', end: '14:45' },
    ],
  },
  early: {
    start: '07:00', end: '16:00',
    breaks: [
      { kind: 'BREAK', start: '09:00', end: '09:15' },
      { kind: 'LUNCH', start: '11:30', end: '12:00' },
      { kind: 'BREAK', start: '14:00', end: '14:15' },
    ],
  },
  late: {
    start: '10:30', end: '19:30',
    breaks: [
      { kind: 'BREAK', start: '12:30', end: '12:45' },
      { kind: 'LUNCH', start: '15:00', end: '15:30' },
      { kind: 'BREAK', start: '17:30', end: '17:45' },
    ],
  },
  partTime: {
    start: '09:00', end: '14:00',
    breaks: [{ kind: 'BREAK', start: '11:30', end: '11:45' }],
  },
}

/** Holidays inside the mock range, mirroring business_calendar_days. */
export const MOCK_HOLIDAYS: Record<string, string> = {}

function buildWeek(weekStart: string, pattern: Pattern, status: ShiftStatus): MockShift[] {
  const out: MockShift[] = []
  for (let i = 0; i < 7; i++) {
    const date = addDays(weekStart, i)
    if (isWeekend(date) || MOCK_HOLIDAYS[date]) continue
    out.push({ date, start: pattern.start, end: pattern.end, breaks: pattern.breaks, status })
  }
  return out
}

// ── Fixture assembly ─────────────────────────────────────────────────────────

/** Week 1 has elapsed; week 2 is upcoming. */
export const MOCK_WEEK_1 = startOfWeek(toLocalIso(new Date()))
export const MOCK_WEEK_2 = addDays(MOCK_WEEK_1, 7)

interface PersonSeed {
  id: number
  name: string
  department: string | null
  pattern: keyof typeof PATTERNS
  /** Week-1 publish state. Week 1 is elapsed, so DRAFT here is the warning case. */
  week1: ShiftStatus | 'NONE'
  week2: ShiftStatus | 'NONE'
  exceptions?: MockException[]
}

const SEEDS: PersonSeed[] = [
  // Customer Service — the largest department, and where the edge cases live.
  { id: 1, name: 'Alicia Moreno',   department: 'Customer Service', pattern: 'standard', week1: 'PUBLISHED', week2: 'DRAFT',
    exceptions: [
      { date: addDays(MOCK_WEEK_1, 1), typeLabel: 'Excused Late Arrival', excused: true,  isFullDay: false, start: '08:00', end: '10:00' },
      { date: addDays(MOCK_WEEK_1, 3), typeLabel: 'Scheduled PTO',        excused: true,  isFullDay: true },
    ] },
  { id: 2, name: 'Brandon Fisk',    department: 'Customer Service', pattern: 'late',     week1: 'PUBLISHED', week2: 'DRAFT',
    exceptions: [
      { date: addDays(MOCK_WEEK_1, 2), typeLabel: 'Unexcused Absence', excused: false, isFullDay: true },
    ] },
  { id: 3, name: 'Cara Whitfield',  department: 'Customer Service', pattern: 'standard', week1: 'PUBLISHED', week2: 'DRAFT' },
  { id: 4, name: 'Devon Ramirez',   department: 'Customer Service', pattern: 'early',    week1: 'PUBLISHED', week2: 'DRAFT',
    exceptions: [
      { date: addDays(MOCK_WEEK_1, 4), typeLabel: 'Unexcused Early Leave', excused: false, isFullDay: false, start: '14:30', end: '16:00' },
    ] },
  // Elapsed week still in draft — invisible to the attendance metric.
  { id: 5, name: 'Erin Nakamura',   department: 'Customer Service', pattern: 'standard', week1: 'DRAFT',     week2: 'DRAFT' },
  // Nobody built this person a schedule at all — scores a clean record.
  { id: 6, name: 'Felix Duarte',    department: 'Customer Service', pattern: 'standard', week1: 'NONE',      week2: 'NONE' },

  // Sales Team - Inbound
  { id: 7,  name: 'Gina Patel',     department: 'Sales Team - Inbound', pattern: 'standard', week1: 'PUBLISHED', week2: 'PUBLISHED' },
  { id: 8,  name: 'Hector Alvarez', department: 'Sales Team - Inbound', pattern: 'late',     week1: 'PUBLISHED', week2: 'PUBLISHED',
    exceptions: [
      { date: addDays(MOCK_WEEK_1, 1), typeLabel: 'Bereavement', excused: true, isFullDay: true },
      { date: addDays(MOCK_WEEK_1, 2), typeLabel: 'Bereavement', excused: true, isFullDay: true },
    ] },
  { id: 9,  name: 'Imani Brooks',   department: 'Sales Team - Inbound', pattern: 'standard', week1: 'PUBLISHED', week2: 'DRAFT' },

  // Tech Support
  { id: 10, name: 'Jonas Reilly',   department: 'Tech Support', pattern: 'early',    week1: 'PUBLISHED', week2: 'DRAFT' },
  { id: 11, name: 'Kelsey Vaughn',  department: 'Tech Support', pattern: 'late',     week1: 'PUBLISHED', week2: 'DRAFT',
    exceptions: [
      { date: addDays(MOCK_WEEK_1, 2), typeLabel: 'Extended Lunch / Break', excused: false, isFullDay: false, start: '15:00', end: '15:50' },
    ] },
  { id: 12, name: 'Marcus Idowu',   department: 'Tech Support', pattern: 'partTime', week1: 'PUBLISHED', week2: 'DRAFT' },

  // Smaller departments
  { id: 13, name: 'Nina Castellano', department: 'VIP Support', pattern: 'standard', week1: 'PUBLISHED', week2: 'DRAFT' },
  { id: 14, name: 'Owen Trask',      department: 'Installs',    pattern: 'early',    week1: 'PUBLISHED', week2: 'DRAFT' },

  // No department_id — outside every manager's scope, admin-only.
  { id: 15, name: 'Luca Santangelo', department: null, pattern: 'standard', week1: 'NONE', week2: 'DRAFT' },
]

export const MOCK_PEOPLE: MockPerson[] = SEEDS.map(seed => {
  const pattern = PATTERNS[seed.pattern]
  const shifts: MockShift[] = [
    ...(seed.week1 === 'NONE' ? [] : buildWeek(MOCK_WEEK_1, pattern, seed.week1)),
    ...(seed.week2 === 'NONE' ? [] : buildWeek(MOCK_WEEK_2, pattern, seed.week2)),
  ]
  return {
    id: seed.id,
    name: seed.name,
    department: seed.department,
    shifts,
    exceptions: seed.exceptions ?? [],
  }
})

export const MOCK_DEPARTMENTS = [
  'Customer Service',
  'Sales Team - Inbound',
  'Tech Support',
  'VIP Support',
  'Installs',
  'Unassigned',
]

// ── Coverage thresholds ──────────────────────────────────────────────────────

/**
 * How many people have to be on the floor before coverage reads healthy.
 * Per department, because a two-person team judged against a nine-person bar
 * is red all day and tells you nothing.
 *
 * Stand-in for an admin list — Scheduling > Coverage Thresholds — with the same
 * shape a `schedule_coverage_threshold` row would have.
 */
export interface CoverageThreshold {
  /** At or above this many working, coverage is green. */
  green: number
  /** At or above this many working, coverage is yellow. Below it, red. */
  yellow: number
}

export const MOCK_COVERAGE_THRESHOLDS: Record<string, CoverageThreshold> = {
  'Customer Service': { green: 4, yellow: 2 },
  'Sales Team - Inbound': { green: 3, yellow: 2 },
  'Tech Support': { green: 3, yellow: 2 },
  'VIP Support': { green: 1, yellow: 1 },
  'Installs': { green: 1, yellow: 1 },
}

/** Falls back to a share of headcount so an unconfigured department still reads. */
export function thresholdFor(department: string, headcount: number): CoverageThreshold {
  return MOCK_COVERAGE_THRESHOLDS[department]
    ?? { green: Math.max(1, Math.ceil(headcount * 0.6)), yellow: Math.max(1, Math.ceil(headcount * 0.3)) }
}
