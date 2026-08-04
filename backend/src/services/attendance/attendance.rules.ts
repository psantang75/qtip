/**
 * attendance.rules — pure band matching. No DB, no Prisma, no dates beyond
 * 'YYYY-MM-DD' string comparison, which is exactly why the boundary mistakes
 * (3:00 vs 3:01, 15:59 vs 16:00) get caught in unit tests instead of in
 * someone's discipline record.
 *
 * Rules are EFFECTIVE-DATED. Every entry point takes the work date and resolves
 * the bands in force on that date, so editing a band today cannot re-score
 * yesterday. Callers must never filter the rule list themselves.
 *
 * Bounds are INCLUSIVE on both ends: [min_seconds, max_seconds]. max_seconds
 * null means unbounded. Anything below the lowest band is grace — it earns no
 * points but is still recorded, because the person who is 2:59 late every single
 * day is invisible to a pure point system.
 */

export type AttendanceKind = 'LATE' | 'EARLY_LEAVE' | 'ABSENT' | 'EXCEPTION';

export interface PointRule {
  id: number;
  ruleKey: string;
  label: string;
  kind: AttendanceKind;
  minSeconds: number;
  maxSeconds: number | null;
  points: number;
  exceptionTypeId: number | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  isActive: boolean;
}

export interface WarningThreshold {
  levelKey: string;
  label: string;
  pointsThreshold: number;
  sortOrder: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  isActive: boolean;
}

interface EffectiveDated {
  effectiveFrom: string;
  effectiveTo: string | null;
  isActive: boolean;
}

/**
 * Active rows whose effective window covers `dateStr`. Half-open on the upper
 * end would silently drop the last day of a retired band, so effective_to is
 * inclusive: a band retired on the 31st still scores the 31st.
 */
function inForce<T extends EffectiveDated>(rows: T[], dateStr: string): T[] {
  return rows.filter(
    (r) => r.isActive && r.effectiveFrom <= dateStr && (r.effectiveTo === null || dateStr <= r.effectiveTo),
  );
}

/** Bands of one kind in force on a date, ordered by min_seconds ascending. */
export function bandsFor(rules: PointRule[], kind: AttendanceKind, dateStr: string): PointRule[] {
  return inForce(rules, dateStr)
    .filter((r) => r.kind === kind)
    .sort((a, b) => a.minSeconds - b.minSeconds);
}

/**
 * The band a deviation falls into, or null when it is inside grace (below every
 * band) — which is not an error, it is the normal case for most days.
 */
export function matchBand(
  rules: PointRule[],
  kind: 'LATE' | 'EARLY_LEAVE',
  seconds: number,
  dateStr: string,
): PointRule | null {
  if (seconds <= 0) return null;
  for (const band of bandsFor(rules, kind, dateStr)) {
    const withinLower = seconds >= band.minSeconds;
    const withinUpper = band.maxSeconds === null || seconds <= band.maxSeconds;
    if (withinLower && withinUpper) return band;
  }
  return null;
}

/**
 * True when someone is so late the LATE ladder no longer covers it — over
 * 7:59:00 with the seeded bands. The engine converts these to an absence rather
 * than dropping them, which is the whole point of the check: a 9-hour "late
 * arrival" on an 8-hour shift means they were not there.
 *
 * Only meaningful when the top band is bounded; a policy with an unbounded top
 * LATE band never overflows.
 */
export function exceedsLateBands(rules: PointRule[], seconds: number, dateStr: string): boolean {
  const bands = bandsFor(rules, 'LATE', dateStr);
  if (bands.length === 0) return false;
  const top = bands[bands.length - 1];
  return top.maxSeconds !== null && seconds > top.maxSeconds;
}

/** The full-day absence rule in force, or null when the policy has none. */
export function absenceRule(rules: PointRule[], dateStr: string): PointRule | null {
  return bandsFor(rules, 'ABSENT', dateStr)[0] ?? null;
}

/**
 * The point-bearing rule bound to a manager-logged exception type, or null when
 * that type carries no weight. This is how No Call / No Show is expressible at
 * all: punch data cannot detect it, because the distinguishing fact is that
 * nobody called.
 */
export function exceptionRule(
  rules: PointRule[],
  exceptionTypeId: number,
  dateStr: string,
): PointRule | null {
  return bandsFor(rules, 'EXCEPTION', dateStr).find((r) => r.exceptionTypeId === exceptionTypeId) ?? null;
}

/**
 * The highest discipline rung a point total reaches, or null when it reaches
 * none. Compared with >= so a total sitting exactly on a threshold triggers it,
 * matching how the policy table reads ("Coaching 3", not "more than 3").
 */
export function resolveWarningLevel(
  thresholds: WarningThreshold[],
  points: number,
  dateStr: string,
): WarningThreshold | null {
  const ladder = inForce(thresholds, dateStr).sort((a, b) => a.pointsThreshold - b.pointsThreshold);
  let reached: WarningThreshold | null = null;
  for (const rung of ladder) {
    if (points >= rung.pointsThreshold) reached = rung;
  }
  return reached;
}

/**
 * Validation for the admin editor: bands of one kind may not overlap, or the
 * same deviation would match two rows and the displayed points would depend on
 * sort order. Returns human-readable problems, empty when the set is sound.
 *
 * Gaps are NOT errors — the space below the lowest band is grace by design.
 */
export function validateBands(bands: Array<Pick<PointRule, 'label' | 'minSeconds' | 'maxSeconds'>>): string[] {
  const problems: string[] = [];
  const sorted = [...bands].sort((a, b) => a.minSeconds - b.minSeconds);

  for (const b of sorted) {
    if (b.minSeconds < 0) problems.push(`${b.label}: minimum cannot be negative`);
    if (b.maxSeconds !== null && b.maxSeconds < b.minSeconds) {
      problems.push(`${b.label}: maximum is before its minimum`);
    }
  }

  for (let i = 0; i < sorted.length - 1; i++) {
    const cur = sorted[i];
    const next = sorted[i + 1];
    if (cur.maxSeconds === null) {
      problems.push(`${cur.label} is unbounded, so ${next.label} can never match`);
      continue;
    }
    if (next.minSeconds <= cur.maxSeconds) {
      problems.push(`${cur.label} overlaps ${next.label}`);
    }
  }

  return problems;
}

/** 'H:MM:SS' for tooltips and occurrence labels. Negative clamps to zero. */
export function formatDeviation(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}
