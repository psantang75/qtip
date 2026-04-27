/**
 * Lightweight controller-scoped `HttpError` (pre-production review item #99).
 *
 * Extracted from `controllers/auditAssignment.controller.ts` so the class
 * can be reused by other controllers that need the exact same envelope
 * shape — `{ message, ...responseData }` — without pulling in the richer
 * `AppError` / global-middleware pipeline (`utils/errorHandler.ts`).
 *
 * ── When to use which error type ─────────────────────────────────────────
 *
 *   • `AppError` (in `utils/errorHandler.ts`) — preferred for **new**
 *     handlers. Throws up to the global middleware, which renders the rich
 *     envelope with correlation IDs and structured `error.type` metadata.
 *
 *   • `HttpError` (this module) — legacy-compatible shape for endpoints
 *     that already expose the `{ message, ...extras }` envelope. Catch it
 *     explicitly in the controller's `catch` block and render with
 *     `res.status(err.statusCode).json({ message: err.message, ...err.responseData })`
 *     to preserve the existing client contract.
 *
 *   • `ApiErrors.*` (in `utils/apiError.ts`) — auth / authz middleware only;
 *     short-circuits with the `{ error, message, code }` envelope.
 *
 * See the `Response-envelope policy` comment in `utils/errorHandler.ts`
 * (item #89) for the full rationale on why three shapes coexist.
 */
export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public responseData?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}
