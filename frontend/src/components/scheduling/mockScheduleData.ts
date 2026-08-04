/**
 * Shared shapes and local-date helpers for the scheduling grid components.
 *
 * Named for the mockup phase it started in. The fixtures are gone — everything
 * here is fed by the API now, adapted into these shapes by useScheduleGrid and
 * useScheduleTemplates so the approved grid components did not have to change.
 *
 * Dates are 'YYYY-MM-DD' and times are wall-clock 'HH:MM', never a Date, so a
 * timezone can never shift a shift boundary.
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
  /** Absent until saved, so a row without one is a pending add. */
  id?: number
  date: string
  exceptionTypeId: number
  typeLabel: string
  excused: boolean
  isFullDay: boolean
  /** Owned by the Paychex import — deleting it returns on the next punch import. */
  isImported?: boolean
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

/** Holidays inside the range, mirroring business_calendar_days. */
export const MOCK_HOLIDAYS: Record<string, string> = {}

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

