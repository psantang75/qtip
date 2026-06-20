import type { ErrorToast } from './errorMessages'

/**
 * Bespoke (non-pattern) user-facing error messages — the canonical wording
 * for business-rule errors that don't fit the P1–P15 patterns in
 * `errorMessages.ts`.
 *
 * Source of truth: `docs/error-messages-catalog.md`.
 *
 * Scope policy
 * ------------
 * Add a string here when **any** of these are true:
 *   - It's reused at 2+ call sites (so a wording change shouldn't require
 *     hunting through pages).
 *   - It takes parameters and the formatting matters (consistency between
 *     "{n}%" and "{n} %" matters for admin/PM review).
 *   - It maps from a backend `error.code` we want to translate consistently.
 *
 * Strings used at exactly one call site that already match catalog wording
 * stay inline — moving them here doubles the maintenance surface (catalog
 * markdown + this registry) without buying anything. The ESLint rule in
 * `eslint.config.js` blocks regression to old voice either way.
 *
 * How to extend
 * -------------
 *   export const errMsg = {
 *     ...
 *     myFeature: {
 *       myError: (): ErrorToast => ({ ... }),
 *     },
 *   } as const
 *
 * Then call sites do:
 *   import { t } from '@/lib/t'
 *   toast(t.msg.myFeature.myError())
 *
 * Localization hook
 * -----------------
 * When QTIP eventually localizes, swap each entry from `() => ({ title, ... })`
 * to `() => ({ title: i18n.t('myFeature.myError.title'), ... })`. Call sites
 * stay unchanged.
 */
export const errMsg = {
  // ── Auth ────────────────────────────────────────────────────────────────
  auth: {
    /** Wrong email/password (login). */
    wrongCredentials: 'The email or password you entered is incorrect.',

    /** Generic forgot-password failure (we never confirm vs. deny existence). */
    forgotPasswordFailed: (): ErrorToast => ({
      variant: 'destructive',
      title: "Couldn't send reset email",
      description: 'Try again in a moment. If this keeps happening, contact support.',
    }),

    /** Reset link state (used inline in `ResetPasswordPage`). */
    resetLinkExpired: 'This reset link has expired. Request a new one.',
    resetLinkUsed:    'This reset link has already been used. Request a new one if needed.',
    resetLinkInvalid: "We couldn't verify this link. Try requesting a new one.",
  },

  // ── User / department admin (mapped from backend error.code) ─────────────
  users: {
    emailExists:    'This email address is already in use.',
    usernameExists: 'This username is already taken.',
    userNotFound:   'User not found. Please refresh and try again.',
    /** Used when the backend returns an unparseable response shape. */
    serverFormat:   "Couldn't read the server response. Refresh and try again.",
  },

  // ── Form builder ────────────────────────────────────────────────────────
  forms: {
    /** Category weights must total 100. `n` is the current total %. */
    weightsNot100: (n: number): ErrorToast => ({
      variant: 'destructive',
      title: "Weights don't add up",
      description: `Categories must total 100%. They currently total ${n}%.`,
    }),

    /** Form must have at least one category / question. */
    needsCategory: (): ErrorToast => ({
      variant: 'destructive',
      title: 'Add at least one category',
      description: 'Forms need a category before you can save.',
    }),
  },

  // ── Quality — submissions & disputes ────────────────────────────────────
  submissions: {
    /** Reviewer-only — submission already accepted/finalized. */
    alreadyClosed: (action: string): ErrorToast => ({
      variant: 'destructive',
      title: `Can't ${action} right now`,
      description: 'This submission has already been closed.',
    }),
  },

  // ── Quality — AI Reviewer ───────────────────────────────────────────────
  aiReviewer: {
    /** Map known backend codes from the AI run endpoint to user-friendly text. */
    runCodeToDescription: (code: string | null, fallback: string): string => {
      if (code === 'INTERACTION_NOT_CLOSED') {
        return 'This submission isn\'t closed yet — close it before running AI review.'
      }
      if (code === 'TRANSCRIPT_TOO_LONG') {
        return 'The transcript is too long for the model. Trim it and try again.'
      }
      if (code === 'PROVIDER_UNAVAILABLE') {
        return 'The AI provider is unavailable right now. Try again in a few minutes.'
      }
      return fallback
    },
  },

  // ── Training / coaching ─────────────────────────────────────────────────
  coaching: {
    /** Status transition rejected (e.g. reopen on closed/canceled session). */
    invalidTransition: (reason: string): ErrorToast => ({
      variant: 'destructive',
      title: "Can't change status",
      description: reason,
    }),
  },

  // ── Write-ups (performance warnings) ────────────────────────────────────
  writeups: {
    /** Multi-field validation summary on submit. */
    fixFields: (count: number, lines: string[]): ErrorToast => ({
      variant: 'destructive',
      title: `Please fix ${count} field${count === 1 ? '' : 's'} and try again`,
      description: lines.join('\n'),
    }),

    /** PDF rendering failure. */
    pdfFailed: (): ErrorToast => ({
      variant: 'destructive',
      title: "Couldn't generate PDF",
      description: 'Try again. If this keeps happening, contact support.',
    }),
  },

  // ── Insights ────────────────────────────────────────────────────────────
  insights: {
    /** On-demand report missing required filter. `field` is what's missing. */
    filterRequired: (field: string): ErrorToast => ({
      variant: 'destructive',
      title: 'Filter required',
      description: `${field} is required to run this report.`,
    }),

    /** User tried to download before running. */
    runBeforeDownload: (): ErrorToast => ({
      variant: 'destructive',
      title: 'Run the report first',
      description: 'Apply your filters with Run before downloading.',
    }),

    /** Long-running report timed out. */
    timeout: (): ErrorToast => ({
      variant: 'destructive',
      title: 'This is taking too long',
      description: 'Narrow your filters or shorten your date range, then try again.',
    }),
  },
} as const

export type ErrMsg = typeof errMsg
