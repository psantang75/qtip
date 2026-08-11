/**
 * Pin the Node process timezone to America/New_York in every environment
 * (dev, test, prod).
 *
 * Why: `@db.DateTime` values (schedule start/end, breaks/lunches, exceptions,
 * punches) are stored as UTC instants — the Prisma mariadb adapter normalizes
 * DATETIME to UTC (e.g. 8:30 AM Eastern is stored as 12:30:00Z). The scheduling
 * helpers in schedule.dates.ts read them back with local getters, so the process
 * MUST run in the business timezone (Eastern) for the wall-clock to come out
 * right. Stage/prod containers were running UTC, which displayed every time 4–5h
 * ahead (12:30 instead of 8:30). Pinning Eastern here makes dev, stage, and prod
 * identical and correct. This matches the single-zone assumption in
 * schedule.dates.ts and the BUSINESS_TZ used by the insights layer.
 *
 * The data itself is correct and needs no migration — this only fixes the
 * runtime conversion.
 *
 * This file has no imports on purpose and must be imported FIRST in index.ts, so
 * the assignment runs before any other module loads and constructs a Date. Node
 * applies a runtime change to process.env.TZ to all subsequent Date operations.
 */
process.env.TZ = 'America/New_York';

export {};
