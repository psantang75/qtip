/**
 * Statement-timeout primitives for the analytics / insights stack.
 *
 * Two layers protect long-running reads:
 *
 *   1) Engine-side session timeout — `database.ts` applies a per-connection
 *      statement-execution cap to every new mysql2 pool connection. It
 *      tries MySQL syntax first (`SET SESSION max_execution_time = <ms>`)
 *      and falls back to MariaDB (`SET SESSION max_statement_time = <s>`).
 *      A runaway query is killed by the server even if Node never times
 *      it out.
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

/** Engine-side per-statement cap, in seconds. Must be slightly shorter than
 *  `ANALYTICS_QUERY_TIMEOUT_MS` so the DB kills the query before Node gives
 *  up, leaving the connection clean for the pool to reuse. Used as the
 *  MariaDB `max_statement_time` value (seconds, double). */
export const DB_SESSION_TIMEOUT_SECONDS = 25

/** Same cap as `DB_SESSION_TIMEOUT_SECONDS`, in milliseconds. Used as the
 *  MySQL `max_execution_time` value (ms, integer). */
export const DB_SESSION_TIMEOUT_MS = DB_SESSION_TIMEOUT_SECONDS * 1000

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
 *
 * Pair with `database.ts`'s engine-side cap (MySQL `max_execution_time`
 * or MariaDB `max_statement_time`) so the server actually cancels the
 * underlying query when the Node-side race fires.
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
