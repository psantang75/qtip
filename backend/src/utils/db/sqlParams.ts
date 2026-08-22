/**
 * Positional SQL parameter types for mysql2 `execute()` / `query()`.
 *
 * Newer mysql2 typings tighten the `values` parameter (`ExecuteValues`) so a
 * bare `unknown[]` no longer satisfies it — this surfaced only in the
 * reproducible Docker build, not a local install. Helpers that build a dynamic
 * params array should type it as `SqlParams` (or cast at the driver boundary)
 * so the code compiles under every @types/mysql2 resolution.
 */
export type SqlParam = string | number | boolean | Date | Buffer | null
export type SqlParams = SqlParam[]
