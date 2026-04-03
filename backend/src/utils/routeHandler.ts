import type { RequestHandler } from 'express'

/**
 * Typed wrapper that casts any Express-compatible handler function to
 * RequestHandler, eliminating the need for `as unknown as RequestHandler`
 * boilerplate throughout route files.
 */
export function rh(fn: unknown): RequestHandler {
  return fn as RequestHandler
}
