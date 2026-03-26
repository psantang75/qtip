import { Response } from 'express';

/**
 * Standard API error response shape used across all controllers and middleware.
 *
 *   { error: string, message: string, code: string }
 *
 * `error`   — short machine-readable label  (e.g. "UNAUTHORIZED")
 * `message` — human-readable description    (e.g. "Authentication required")
 * `code`    — namespaced error code         (e.g. "AUTH_REQUIRED")
 */
export function sendError(
  res: Response,
  status: number,
  error: string,
  message: string,
  code: string,
): void {
  res.status(status).json({ error, message, code });
}

// ── Common pre-built helpers ──────────────────────────────────────────────────

export const ApiErrors = {
  unauthorized: (res: Response) =>
    sendError(res, 401, 'UNAUTHORIZED', 'Authentication required', 'AUTH_REQUIRED'),

  forbidden: (res: Response, message = 'Access denied: insufficient permissions') =>
    sendError(res, 403, 'FORBIDDEN', message, 'INSUFFICIENT_PERMISSIONS'),

  notFound: (res: Response, message = 'Resource not found') =>
    sendError(res, 404, 'NOT_FOUND', message, 'NOT_FOUND'),

  badRequest: (res: Response, message: string, code = 'BAD_REQUEST') =>
    sendError(res, 400, 'BAD_REQUEST', message, code),

  internal: (res: Response, message = 'An unexpected error occurred') =>
    sendError(res, 500, 'INTERNAL_SERVER_ERROR', message, 'INTERNAL_ERROR'),
};
