import type { AxiosError } from 'axios'

/**
 * Canonical user-facing error messages for QTIP.
 *
 * Source of truth: `docs/error-messages-catalog.md`
 *
 * - 15 canonical patterns (P1–P15) live here as small factory functions and
 *   are the default we reach for whenever a new toast is needed.
 * - Bespoke business-rule wording (e.g. "Closed or canceled sessions can't be
 *   reopened") stays at the call site rather than living in a giant registry —
 *   it's still on-spec because the call site copies wording from the catalog.
 * - `mapErrorToToast(error)` is the auto-mapper used by the global
 *   `MutationCache.onError` in `app/queryClient.ts` so any mutation that does
 *   NOT supply its own `onError` automatically surfaces a sensible message.
 *
 * Voice: modern SaaS (Linear / Stripe / GitHub / Atlassian style), sentence
 * case titles without trailing punctuation, descriptions ending in a period.
 * Never expose backend codes (`ER_DUP_ENTRY`, `TOKEN_BLACKLISTED`, …) directly.
 */

export interface ErrorToast {
  title: string
  description?: string
  variant: 'default' | 'destructive'
}

// ─── P1–P15 — canonical patterns ─────────────────────────────────────────────

/** P1. Load failure (GET). */
export const eLoad = (noun: string): ErrorToast => ({
  variant: 'destructive',
  title: `Couldn't load ${noun}`,
  description: 'Refresh to try again.',
})

/** P2. Save failure (POST/PUT/PATCH). */
export const eSave = (noun?: string): ErrorToast => ({
  variant: 'destructive',
  title: noun ? `Couldn't save ${noun}` : "Couldn't save changes",
  description: "Your changes weren't applied. Try again.",
})

/** P3. Delete failure. */
export const eDelete = (noun: string): ErrorToast => ({
  variant: 'destructive',
  title: `Couldn't delete ${noun}`,
  description: 'Try again. If this keeps happening, contact support.',
})

/** P4. Submit / terminal-action failure (finalize, sign, schedule, publish). */
export const eSubmit = (action: string): ErrorToast => ({
  variant: 'destructive',
  title: `Couldn't ${action}`,
  description: "Try again. Your work hasn't been lost.",
})

/** P6. Multi-field validation summary (toast on submit). */
export const eValidation = (n: number): ErrorToast => ({
  variant: 'destructive',
  title: `Please fix ${n} field${n === 1 ? '' : 's'} and try again`,
  description: `${n} item${n === 1 ? '' : 's'} need attention before you can save.`,
})

/** P7. Permission denied (403). */
export const eForbidden = (noun = 'this section'): ErrorToast => ({
  variant: 'destructive',
  title: "You don't have access",
  description: `Ask your administrator if you need access to ${noun}.`,
})

/** P8. Resource not found (404). */
export const eNotFound = (noun: string): ErrorToast => ({
  variant: 'destructive',
  title: `This ${noun} no longer exists`,
  description: 'It may have been deleted, moved, or your link is out of date.',
})

/** P9. State conflict (409 / 422 — already-done, wrong-state, duplicate). */
export const eConflict = (action: string, reason: string): ErrorToast => ({
  variant: 'destructive',
  title: `Can't ${action} right now`,
  description: reason,
})

/** P10. Session expired (401). */
export const eSessionExpired = (): ErrorToast => ({
  variant: 'destructive',
  title: 'Session expired',
  description: 'Sign in again to continue.',
})

/** P11. Rate-limited (429). */
export const eRateLimit = (): ErrorToast => ({
  variant: 'destructive',
  title: 'Too many requests',
  description: 'Wait a moment and try again.',
})

/** P12. Timeout / slow query (504, 408). */
export const eTimeout = (): ErrorToast => ({
  variant: 'destructive',
  title: 'This is taking too long',
  description: 'Narrow your filters or shorten your date range, then try again.',
})

/** P13. Network unreachable. */
export const eNetwork = (): ErrorToast => ({
  variant: 'destructive',
  title: "Can't reach the server",
  description: 'Check your connection and try again.',
})

/** P14. Server error (5xx, unknown). Pass `correlationId` when available. */
export const eServer = (correlationId?: string): ErrorToast => ({
  variant: 'destructive',
  title: 'Something went wrong on our end',
  description: correlationId
    ? `Try again. If this keeps happening, contact support and reference ${correlationId}.`
    : 'Try again. If this keeps happening, contact support.',
})

/** P15. Upload failure (server-side). */
export const eUpload = (): ErrorToast => ({
  variant: 'destructive',
  title: 'Upload failed',
  description: "We couldn't save your file. Try again.",
})

// ─── Auto-mapper: HTTP error → canonical toast ───────────────────────────────

interface ApiErrorEnvelope {
  error?: { type?: string; message?: string; correlationId?: string } | string
  message?: string
  success?: boolean
}

function isAxiosError(e: unknown): e is AxiosError<ApiErrorEnvelope> {
  return !!e && typeof e === 'object' && 'isAxiosError' in e &&
    (e as { isAxiosError?: boolean }).isAxiosError === true
}

/** Pull a correlation ID from either the rich envelope or `X-Correlation-ID`. */
function extractCorrelationId(error: AxiosError<ApiErrorEnvelope>): string | undefined {
  const env = error.response?.data
  if (env && typeof env === 'object' && env.error && typeof env.error === 'object') {
    return env.error.correlationId
  }
  const headers = error.response?.headers as Record<string, string> | undefined
  if (!headers) return undefined
  return headers['x-correlation-id'] ?? headers['X-Correlation-ID']
}

/** Pull the most specific human-readable message the backend supplied, if any. */
function readBackendMessage(data: unknown): string | undefined {
  if (!data || typeof data !== 'object') return undefined
  const d = data as ApiErrorEnvelope
  if (typeof d.error === 'string') return d.error
  if (d.error && typeof d.error === 'object' && d.error.message) return d.error.message
  if (typeof d.message === 'string') return d.message
  return undefined
}

/**
 * Map an axios / fetch / `Error` object to a canonical `ErrorToast`.
 *
 * Used by the global `MutationCache.onError` for mutations that don't supply
 * their own `onError`, and as a fallback any caller can reach for.
 */
export function mapErrorToToast(error: unknown): ErrorToast {
  if (!isAxiosError(error)) {
    if (error instanceof Error && /network|ECONNREFUSED|fetch/i.test(error.message)) {
      return eNetwork()
    }
    return eServer()
  }
  if (!error.response) return eNetwork()

  const status = error.response.status
  const cid = extractCorrelationId(error)
  const backendMsg = readBackendMessage(error.response.data)

  if (status === 401) return eSessionExpired()
  if (status === 403) return eForbidden()
  if (status === 404) {
    return backendMsg
      ? { variant: 'destructive', title: 'Not found', description: backendMsg }
      : eNotFound('item')
  }
  if (status === 408 || status === 504) return eTimeout()
  if (status === 409 || status === 422) {
    return {
      variant: 'destructive',
      title: "Can't complete that action",
      description: backendMsg ?? 'Try again.',
    }
  }
  if (status === 429) return eRateLimit()
  if (status === 413) {
    return {
      variant: 'destructive',
      title: 'File or request too large',
      description: 'Try a smaller file or fewer items at once.',
    }
  }
  if (status === 503) {
    return {
      variant: 'destructive',
      title: "We're having trouble loading",
      description: 'Try again in a moment. We\'re aware and looking into it.',
    }
  }
  if (status >= 500) return eServer(cid)
  if (status === 400) {
    return {
      variant: 'destructive',
      title: 'Please check your input',
      description: backendMsg ?? 'Some fields need attention before you can continue.',
    }
  }
  return eServer(cid)
}
