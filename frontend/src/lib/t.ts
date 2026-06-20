import {
  eLoad,
  eSave,
  eDelete,
  eSubmit,
  eValidation,
  eForbidden,
  eNotFound,
  eConflict,
  eSessionExpired,
  eRateLimit,
  eTimeout,
  eNetwork,
  eServer,
  eUpload,
  mapErrorToToast,
} from './errorMessages'
import { errMsg } from './errorMessages.bespoke'

/**
 * Single import for every user-facing error string in QTIP.
 *
 * - `t.eLoad('forms')`, `t.eSave('form')`, … — the 15 canonical patterns
 *   (P1–P15) from `docs/error-messages-catalog.md` § 3.
 * - `t.msg.*` — bespoke business-rule messages from
 *   `errorMessages.bespoke.ts`, organized by section.
 * - `t.fromError(error)` — the auto-mapper used by the global mutation
 *   handler; available here too if you need to project an arbitrary
 *   axios/fetch/Error onto a canonical toast at a call site.
 *
 * Why a shim?
 * -----------
 * Today every export is a thin re-export — calling through `t` is exactly
 * the same as importing from `errorMessages` directly. The reason it
 * exists is **future-proofing for i18n**:
 *
 *   When/if QTIP ever ships in another language, the migration is to
 *   replace this file's body with i18n-aware variants (`react-intl`,
 *   `i18next`, etc.) keyed off the same names. Every call site already
 *   imports `t.eLoad(...)` / `t.msg.*` and stays unchanged. That's a
 *   one-day refactor instead of a week-long sweep.
 *
 * Usage
 * -----
 *   import { t } from '@/lib/t'
 *   import { toast } from '@/hooks/use-toast'
 *
 *   // Pattern (95% of cases):
 *   toast(t.eSave('coaching session'))
 *
 *   // Bespoke business-rule:
 *   toast(t.msg.users.userNotFound)        // string used in inline banners
 *   toast(t.msg.forms.weightsNot100(87))   // factory with params
 *
 *   // Manual fallback for non-mutation errors:
 *   try { ... } catch (e) { toast(t.fromError(e)) }
 */
export const t = {
  // P1–P15 patterns
  eLoad,
  eSave,
  eDelete,
  eSubmit,
  eValidation,
  eForbidden,
  eNotFound,
  eConflict,
  eSessionExpired,
  eRateLimit,
  eTimeout,
  eNetwork,
  eServer,
  eUpload,

  // Auto-mapper for arbitrary error objects.
  fromError: mapErrorToToast,

  // Bespoke business-rule messages, namespaced by section.
  msg: errMsg,
} as const

export type T = typeof t
