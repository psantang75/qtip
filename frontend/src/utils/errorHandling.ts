/**
 * Error Handling Utilities
 * Centralized error handling for consistent behavior across the application
 */

/**
 * Checks if an error is a 401 (Unauthorized) authentication error
 * @param error - The error object from a catch block
 * @returns true if this is a 401 error that should be handled by the auth interceptor
 */
export function isAuthenticationError(error: any): boolean {
  return error?.response?.status === 401;
}

/**
 * Checks if an HTTP response status indicates authentication failure
 * Used for fetch() API calls that don't use axios interceptors
 * @param status - HTTP response status code
 * @returns true if this is a 401 error
 */
export function isAuthenticationStatus(status: number): boolean {
  return status === 401;
}

/**
 * Handles authentication errors consistently
 * Clears local storage and redirects to login page
 * Use this for fetch() API calls that bypass axios interceptors
 */
export function handleAuthenticationFailure(): void {
  if (!import.meta.env.PROD) {
    // eslint-disable-next-line no-console
    console.info('[auth] Session expired - redirecting to login');
  }
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  localStorage.removeItem('refreshToken');
  window.location.href = '/login';
}

/**
 * Wrapper for error handlers that need to check for authentication errors
 * Returns true if the error was handled (authentication error), false otherwise
 * @param error - The error object from a catch block
 * @returns true if this was an authentication error (handled), false if caller should handle it
 */
export function handleErrorIfAuthentication(error: any): boolean {
  if (isAuthenticationError(error)) {
    if (!import.meta.env.PROD) {
      // eslint-disable-next-line no-console
      console.info('[auth] Session expired - axios interceptor will handle redirect to login');
    }
    // Don't set error messages, let the axios interceptor handle cleanup and redirect
    return true;
  }
  return false;
}

/**
 * Canonical status → user-facing message map.
 *
 * Wording is kept in sync with the P1–P15 patterns in `lib/errorMessages.ts`
 * and `docs/error-messages-catalog.md`. These are full sentences so the result
 * works equally well as a toast `description` or an inline banner.
 */
const STATUS_MESSAGE: Record<number, string> = {
  400: 'Please check your input and try again.',
  401: 'Your session expired. Sign in again to continue.',
  403: "You don't have access to do that.",
  404: "We couldn't find what you were looking for. It may have been moved or deleted.",
  408: 'This is taking too long. Try again.',
  409: 'That conflicts with the current state. Refresh and try again.',
  413: 'That file or request is too large. Try a smaller one.',
  422: 'Please check your input and try again.',
  429: 'Too many requests. Wait a moment and try again.',
  500: 'Something went wrong on our end. Try again in a moment.',
  502: 'Something went wrong on our end. Try again in a moment.',
  503: "We're having trouble right now. Try again in a moment.",
  504: 'This is taking too long. Try again.',
};

function messageForStatus(status: number): string {
  if (STATUS_MESSAGE[status]) return STATUS_MESSAGE[status];
  if (status >= 500) return 'Something went wrong on our end. Try again in a moment.';
  if (status >= 400) return 'Please check your input and try again.';
  return 'Something went wrong. Try again.';
}

/**
 * True for ALL_CAPS_WITH_UNDERSCORES tokens — these are machine labels the
 * backend puts in `error` (e.g. "UNAUTHORIZED", "INTERNAL_SERVER_ERROR"), not
 * text we should ever show a user.
 */
function isMachineLabel(s: string): boolean {
  return /^[A-Z][A-Z0-9_]*$/.test(s.trim());
}

/**
 * Raw axios/fetch noise we must NEVER surface to a user
 * ("Request failed with status code 401", "Network Error", "timeout of …").
 */
function isTransportNoise(s: string): boolean {
  const t = s.trim();
  return (
    /^request failed with status code \d+$/i.test(t) ||
    /^network error$/i.test(t) ||
    /^timeout of \d+ms exceeded$/i.test(t) ||
    /^the operation was aborted$/i.test(t)
  );
}

/**
 * Pull a curated, human-readable message the backend supplied — or `null`.
 *
 * Handles every envelope shape used across our controllers:
 *   { message }                         — apiError.ts `sendError`
 *   { error: 'human text' }             — auth / insights / AI-reviewer routes
 *   { error: { message } }              — global error middleware
 *   { error: 'MACHINE_LABEL', message } — prefers `message`, drops the label
 *
 * Machine labels are filtered out so users never see "UNAUTHORIZED".
 */
export function getBackendMessage(error: any): string | null {
  const data = error?.response?.data;
  if (!data || typeof data !== 'object') return null;

  if (typeof data.message === 'string' && data.message.trim() && !isMachineLabel(data.message)) {
    return data.message.trim();
  }
  if (data.error && typeof data.error === 'object' && typeof data.error.message === 'string' && data.error.message.trim()) {
    return data.error.message.trim();
  }
  if (typeof data.error === 'string' && data.error.trim() && !isMachineLabel(data.error)) {
    return data.error.trim();
  }
  return null;
}

/**
 * Gets a user-friendly error message from any error object.
 *
 * Guarantees (best-in-class messaging):
 *   - NEVER returns the raw axios string ("Request failed with status code N").
 *   - NEVER returns a backend machine label ("UNAUTHORIZED", "BAD_REQUEST").
 *   - NEVER leaks server internals: 5xx always maps to the canonical "our end"
 *     message regardless of what the backend put in the body.
 *   - DOES surface curated 4xx validation messages the backend supplies
 *     (e.g. "This email address is already in use.").
 *
 * Use this anywhere you need a single string (toast `description`, inline
 * banner). For full title+description toasts, prefer `t.fromError(error)`.
 *
 * @param error - The error object (axios error, thrown Error, or unknown).
 * @param defaultMessage - Fallback when nothing more specific is available.
 */
export function getErrorMessage(error: any, defaultMessage: string = "Something went wrong. Try again."): string {
  const status: number | undefined = error?.response?.status;

  // 401 / 403 → canonical wording (backend text here is terse/machine-ish).
  if (status === 401) return STATUS_MESSAGE[401];
  if (status === 403) return STATUS_MESSAGE[403];

  // 5xx → never echo the body (it may contain stack/SQL/internal detail).
  if (typeof status === 'number' && status >= 500) return messageForStatus(status);

  // 4xx → prefer a curated backend message, else map the status.
  const backend = getBackendMessage(error);
  if (backend) return backend;
  if (typeof status === 'number') return messageForStatus(status);

  // No HTTP response → transport-level failures.
  if (error?.code === 'ECONNABORTED') return 'This is taking too long. Try again.';
  if (error?.request) return "Can't reach the server. Check your connection and try again.";

  // A thrown app Error carrying real human text (but never axios noise).
  if (typeof error?.message === 'string' && error.message.trim() && !isTransportNoise(error.message) && !isMachineLabel(error.message)) {
    return error.message.trim();
  }

  return defaultMessage;
}

/**
 * Type guard to check if an error has a response object
 */
export function hasErrorResponse(error: any): error is { response: { status: number; data: any } } {
  return error && typeof error === 'object' && 'response' in error;
}

/**
 * Centralized client-side error logger.
 *
 * In development: writes to the browser console (preserves stack traces and
 * lets devs inspect error objects).
 *
 * In production: silently no-ops. Bare `console.error` calls in services were
 * leaking stack traces and request payloads to end users' browser consoles
 * (pre-production review item #67). Route everything through this helper so
 * we have a single point to wire up an external logger (Sentry, Datadog RUM)
 * later if desired.
 *
 * @param scope - Short identifier for the call site (e.g. "csrService").
 * @param args  - Anything you would have passed to console.error.
 */
export function logError(scope: string, ...args: unknown[]): void {
  if (import.meta.env.PROD) return;
  // eslint-disable-next-line no-console
  console.error(`[${scope}]`, ...args);
}

/**
 * Centralized client-side warning logger. Same prod-no-op behavior as logError.
 *
 * @param scope - Short identifier for the call site.
 * @param args  - Anything you would have passed to console.warn.
 */
export function logWarn(scope: string, ...args: unknown[]): void {
  if (import.meta.env.PROD) return;
  // eslint-disable-next-line no-console
  console.warn(`[${scope}]`, ...args);
}

