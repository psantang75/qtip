/**
 * adherence.rules — pure band matching for intraday adherence. No DB, no Prisma,
 * no dates beyond 'YYYY-MM-DD' string comparison, so the boundary mistakes
 * (2:59 vs 3:00) get caught in unit tests rather than in someone's discipline
 * record. Mirrors attendance.rules.ts; kept separate so the two domains cannot
 * drift into each other.
 *
 * Rules are EFFECTIVE-DATED. Every entry point takes the work date and resolves
 * the bands in force on that date, so editing a band today cannot re-score
 * yesterday.
 *
 * Bounds are INCLUSIVE on both ends: [min_seconds, max_seconds]. max_seconds
 * null means unbounded. Anything below the lowest band of a kind is grace — it
 * earns no points but the raw deviation is still recorded on adherence_daily.
 */

/** Segment × metric. BREAK_/LUNCH_ prefix names the segment. */
export type AdherenceKind =
  | 'BREAK_DURATION' | 'LUNCH_DURATION'
  | 'BREAK_START' | 'LUNCH_START'
  | 'BREAK_PHONE_START' | 'BREAK_PHONE_STOP'
  | 'LUNCH_PHONE_START' | 'LUNCH_PHONE_STOP'
  | 'BREAK_MISSED' | 'LUNCH_MISSED';

export const ADHERENCE_KINDS: AdherenceKind[] = [
  'BREAK_DURATION', 'LUNCH_DURATION', 'BREAK_START', 'LUNCH_START',
  'BREAK_PHONE_START', 'BREAK_PHONE_STOP', 'LUNCH_PHONE_START', 'LUNCH_PHONE_STOP',
  'BREAK_MISSED', 'LUNCH_MISSED',
];

/** Kinds whose deviation is matched against a band ladder (min/max seconds). */
export const BANDED_KINDS: AdherenceKind[] = [
  'BREAK_DURATION', 'LUNCH_DURATION', 'BREAK_START', 'LUNCH_START',
  'BREAK_PHONE_START', 'BREAK_PHONE_STOP', 'LUNCH_PHONE_START', 'LUNCH_PHONE_STOP',
];

/** Kinds that are a single flat rule — there is no duration to tier. */
export const MISSED_KINDS: AdherenceKind[] = ['BREAK_MISSED', 'LUNCH_MISSED'];

export interface PointRule {
  id: number;
  ruleKey: string;
  label: string;
  kind: AdherenceKind;
  minSeconds: number;
  maxSeconds: number | null;
  points: number;
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
 * Active rows whose effective window covers `dateStr`. effective_to is INCLUSIVE
 * so a band retired on the 31st still scores the 31st.
 */
function inForce<T extends EffectiveDated>(rows: T[], dateStr: string): T[] {
  return rows.filter(
    (r) => r.isActive && r.effectiveFrom <= dateStr && (r.effectiveTo === null || dateStr <= r.effectiveTo),
  );
}

/** Bands of one kind in force on a date, ordered by min_seconds ascending. */
export function bandsFor(rules: PointRule[], kind: AdherenceKind, dateStr: string): PointRule[] {
  return inForce(rules, dateStr)
    .filter((r) => r.kind === kind)
    .sort((a, b) => a.minSeconds - b.minSeconds);
}

/**
 * The band a deviation falls into, or null when it is inside grace (below every
 * band) — the normal case for a compliant break.
 */
export function matchBand(rules: PointRule[], kind: AdherenceKind, seconds: number, dateStr: string): PointRule | null {
  if (seconds <= 0) return null;
  for (const band of bandsFor(rules, kind, dateStr)) {
    const withinLower = seconds >= band.minSeconds;
    const withinUpper = band.maxSeconds === null || seconds <= band.maxSeconds;
    if (withinLower && withinUpper) return band;
  }
  return null;
}

/** The flat MISSED rule (BREAK_MISSED / LUNCH_MISSED) in force, or null. */
export function missedRule(rules: PointRule[], kind: 'BREAK_MISSED' | 'LUNCH_MISSED', dateStr: string): PointRule | null {
  return bandsFor(rules, kind, dateStr)[0] ?? null;
}

/**
 * The highest discipline rung a point total reaches, or null when it reaches
 * none. Compared with >= so a total sitting exactly on a threshold triggers it.
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
 * Validation for the admin editor: banded rows of one kind may not overlap, or
 * the same deviation would match two rows and the points would depend on sort
 * order. Gaps are NOT errors — the space below the lowest band is grace.
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
