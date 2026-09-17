/**
 * Reading a warehouse instant back as the Eastern wall clock the business saw.
 *
 * WHY THIS EXISTS. The collections facts hold two different kinds of time and they
 * cannot be compared directly:
 *
 *   DATETIME columns (task.created_on, touch.created_on, recovery.applied_on) are UTC
 *   INSTANTS. CRM stores Eastern wall-clock times and the crm pool reads them in the
 *   process timezone — pinned to America/New_York by config/timezone.ts — while the
 *   primary pool writes with `timezone: 'Z'`. So an AR task CRM shows at 05:18:06 is
 *   stored here as 09:18:06. That is the platform convention (see config/environment.ts),
 *   not a defect, and every consumer that reads these through the primary pool gets the
 *   right instant back.
 *
 *   DATE columns (invoice.order_date, dim_date.full_date) are CALENDAR DAYS in Eastern,
 *   per .cursor/rules/date-handling.mdc. They carry no offset and never moved.
 *
 * Compare the two as they sit and the answer is wrong for anything logged in the last
 * four hours of an Eastern day: 21:00 on 07-31 is stored 01:00 on 08-01, so
 * `created_on >= order_date` calls it same-day when it preceded the invoice. 19 touches
 * in the current 15-month window sit in that band. Small, but it silently moves an
 * event across the boundary that decides which invoice a task belongs to.
 *
 * WHY NOT CONVERT_TZ. `CONVERT_TZ(dt, '+00:00', 'America/New_York')` returns NULL on
 * this server — mysql.time_zone_name holds 0 rows, and loading the zone tables is a
 * change to the mysql system schema rather than to this application. A NULL comparison
 * is silently false, which would be worse than the shift it fixes.
 *
 * WHY NOT "MINUS FOUR HOURS". It is right for roughly eight months of the year. The
 * window this report covers already spans both sides of a transition, so a fixed offset
 * would trade a four-hour error in summer for a one-hour error in winter and hide it
 * better. The US rule has been stable since 2007 and is short to express exactly:
 * EDT (UTC-4) from 07:00 UTC on the second Sunday of March until 06:00 UTC on the first
 * Sunday of November, EST (UTC-5) otherwise. Both switch instants are expressed in UTC
 * precisely because the input is UTC — there is no ambiguous local hour to resolve.
 */

/**
 * First Sunday of `month` in the year of `utc`, as a DATE.
 *
 * DAYOFWEEK is 1 on Sunday, so `(8 - DAYOFWEEK(first)) MOD 7` is the number of days
 * from the 1st to the first Sunday — 0 when the 1st is itself a Sunday.
 */
const firstSunday = (utc: string, month: '03' | '11') => {
  const first = `DATE(CONCAT(YEAR(${utc}), '-${month}-01'))`;
  return `DATE_ADD(${first}, INTERVAL ((8 - DAYOFWEEK(${first})) MOD 7) DAY)`;
};

/**
 * SQL that turns a UTC instant column into the Eastern wall clock.
 *
 * Pass the qualified column (e.g. `t.created_on`); it is evaluated several times, so
 * give it a column reference rather than an expensive expression. NULL in, NULL out.
 */
export const easternInstant = (utc: string): string => {
  const dstStart = `TIMESTAMPADD(HOUR, 7, DATE_ADD(${firstSunday(utc, '03')}, INTERVAL 7 DAY))`;
  const dstEnd = `TIMESTAMPADD(HOUR, 6, ${firstSunday(utc, '11')})`;
  return `DATE_SUB(${utc}, INTERVAL IF(${utc} >= ${dstStart} AND ${utc} < ${dstEnd}, 4, 5) HOUR)`;
};

/** The Eastern calendar day a UTC instant fell on. */
export const easternDate = (utc: string): string => `DATE(${easternInstant(utc)})`;
