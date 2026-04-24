/**
 * Statement-timeout primitives for the analytics / insights stack.
 *
 * Two layers protect long-running reads:
 *
 *   1) MariaDB session timeout — `database.ts` runs
 *      `SET SESSION max_statement_time = ...` on every new mysql2 pool
 *      connection. Caps SELECTs at the engine level so a runaway query
 *      gets terminated by the server even if Node never times it out.
 *
 *   2) Application-level wrapper — `withQueryTimeout()` here wraps any
 *      `Promise<T>` (Prisma queries, Promise.all batches, raw fetches) in
 *      a `Promise.race` against a `setTimeout`. The wrapper rejects if
 *      the underlying query hasn't resolved by the deadline so the
 *      Express response can be returned (HTTP 504) without keeping the
 *      Node event-loop bound to a hung query.
 *
 * Use `withQueryTimeout()` at service entry points where one slow query
 * could block the whole HTTP response — analytics aggregates, on-demand
 * report generation, dashboard tiles. Don't sprinkle it on every call;
 * the engine-level cap already covers the common case.
 */

/** Default timeout (ms) for analytics / insights / on-demand report queries. */
export const ANALYTICS_QUERY_TIMEOUT_MS = 30_000

/** Default timeout (ms) the engine enforces — passed to `SET SESSION
 *  max_statement_time` (MariaDB takes seconds, double). Must be slightly
 *  shorter than `ANALYTICS_QUERY_TIMEOUT_MS` so the DB kills the query
 *  before Node decides to give up, leaving the connection clean for the
 *  pool to reuse. */
export const DB_SESSION_TIMEOUT_SECONDS = 25

export class QueryTimeoutError extends Error {
  readonly statusCode = 504
  readonly code = 'QUERY_TIMEOUT'
  constructor(public operation: string, public timeoutMs: number) {
    super(`Query timed out after ${timeoutMs}ms (${operation})`)
    this.name = 'QueryTimeoutError'
  }
}

/**
 * Race `promise` against a `setTimeout(timeoutMs)` and reject with
 * `QueryTimeoutError` if the timer fires first. The underlying query may
 * still be running on the DB side — pair this with `database.ts`'s
 * session-level `max_statement_time` so the engine actually cancels it.
 *
 * `operation` is included in the error message and is plain text — keep
 * it short and stable so it's safe to log / surface to the client.
 */
export async function withQueryTimeout<T>(
  promise: Promise<T>,
  operation: string,
  timeoutMs: number = ANALYTICS_QUERY_TIMEOUT_MS,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new QueryTimeoutError(operation, timeoutMs)), timeoutMs)
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
