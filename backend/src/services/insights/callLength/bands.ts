/**
 * Length-bucket definition for the Call Length report — the single source for
 * both the SQL that assigns a call to a bucket and the definition sent to the
 * client, so the two cannot drift.
 *
 * Boundaries are deliberately NOT stored on ie_fact_support_call: they are
 * applied at read time over `handle_secs`, so retuning them is a code change
 * with no reload.
 */

/** Genesys wrap-up code written when the agent never dispositioned the call. */
export const WRAP_TIMEOUT_CODE = 'ININ-WRAP-UP-TIMEOUT';

/**
 * Buckets in ascending order, half-open [minSecs, maxSecs). Fitted to the
 * measured support distribution (median 159s, p90 489s, p99 1348s) so the
 * middle bands carry real volume instead of one band holding everything.
 */
export const CALL_LENGTH_BANDS = [
  { key: 'u1',     label: 'Under 1 min', minSecs: 0,    maxSecs: 60 },
  { key: 'm1_2',   label: '1-2 min',     minSecs: 60,   maxSecs: 120 },
  { key: 'm2_5',   label: '2-5 min',     minSecs: 120,  maxSecs: 300 },
  { key: 'm5_10',  label: '5-10 min',    minSecs: 300,  maxSecs: 600 },
  { key: 'm10_20', label: '10-20 min',   minSecs: 600,  maxSecs: 1200 },
  { key: 'o20',    label: '20 min+',     minSecs: 1200, maxSecs: null },
] as const;

export type CallLengthBand = (typeof CALL_LENGTH_BANDS)[number];

/** Buckets counted as "long" by the over-5 / over-10 KPIs. */
export const LONG_BANDS: string[] = ['m5_10', 'm10_20', 'o20'];
export const OVER_10_BANDS: string[] = ['m10_20', 'o20'];

/** An all-zero bucket map, so a rep with no calls in a band still renders a 0. */
export function zeroBands(): Record<string, number> {
  return Object.fromEntries(CALL_LENGTH_BANDS.map((b) => [b.key, 0]));
}

/**
 * The bucket assignment as one SQL CASE over `column`, generated from the
 * constant above. Boundaries are inlined as literals rather than bound params
 * because they originate here, never from a request.
 */
export function bandCaseSql(column = 'f.handle_secs'): string {
  const arms = CALL_LENGTH_BANDS
    .filter((b) => b.maxSecs !== null)
    .map((b) => `WHEN ${column} < ${b.maxSecs} THEN '${b.key}'`);
  const last = CALL_LENGTH_BANDS[CALL_LENGTH_BANDS.length - 1];
  return `CASE ${arms.join(' ')} ELSE '${last.key}' END`;
}

/**
 * The bucket a handle time falls in. The SQL CASE above is authoritative for
 * report queries; this is the same rule in TS for tests and any caller holding
 * raw seconds.
 */
export function bandForSecs(handleSecs: number): string {
  const hit = CALL_LENGTH_BANDS.find((b) => b.maxSecs !== null && handleSecs < b.maxSecs);
  return hit ? hit.key : CALL_LENGTH_BANDS[CALL_LENGTH_BANDS.length - 1].key;
}

/**
 * A `handle_secs` predicate covering one or more bucket keys, derived from the
 * same boundaries as `bandCaseSql` so a band means one thing everywhere.
 * Boundaries are inlined for the same reason: they originate here, never from
 * a request. Unknown keys are ignored; an empty result yields a false
 * predicate rather than silently matching every call.
 */
export function bandRangeSql(bandKeys: string[], column = 'f.handle_secs'): string {
  const arms = bandKeys
    .map((key) => CALL_LENGTH_BANDS.find((b) => b.key === key))
    .filter((b): b is CallLengthBand => !!b)
    .map((b) => (b.maxSecs === null
      ? `${column} >= ${b.minSecs}`
      : `(${column} >= ${b.minSecs} AND ${column} < ${b.maxSecs})`));
  if (arms.length === 0) return '1 = 0';
  return arms.length === 1 ? arms[0] : `(${arms.join(' OR ')})`;
}
