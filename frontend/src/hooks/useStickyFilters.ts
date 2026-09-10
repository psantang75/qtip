import { useCallback, useRef, useState } from 'react'

/**
 * Sticky filters — session-scoped persistence of a page's filter selections, so
 * leaving a page and coming back keeps the view the user set up.
 *
 * The Insights reports already behave this way via `useQCFilters` /
 * `useActivityFilters`, which hand-roll the same `sessionStorage` read/merge/write
 * against their own key. This module is that storage layer on its own so the list
 * pages outside Insights (Quality, Training, Performance Warnings, Scheduling) get
 * the behaviour without a third copy of the plumbing:
 *
 *   - `useStickyState` replaces `useState` for a single filter field.
 *   - `useUrlFilters(defaults, storageKey)` layers it under URL-backed filters.
 *
 * Session (not local) storage matches Insights: filters follow the tab, and a new
 * browser session starts from the page defaults.
 */

const PREFIX = 'qtip.filters.'

type Record_ = Record<string, unknown>

/** All saved fields for one page scope. Returns `{}` when nothing is stored. */
export function readStickyFilters(scope: string): Record_ {
  try {
    const raw = sessionStorage.getItem(PREFIX + scope)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record_)
      : {}
  } catch {
    return {}
  }
}

/** Merge `patch` into the saved fields for one page scope. */
export function writeStickyFilters(scope: string, patch: Record_): void {
  try {
    sessionStorage.setItem(PREFIX + scope, JSON.stringify({ ...readStickyFilters(scope), ...patch }))
  } catch { /* sessionStorage unavailable (private mode, quota) — filters just stop persisting */ }
}

/** Drop everything saved for one page scope, so the next mount uses defaults. */
export function clearStickyFilters(scope: string): void {
  try {
    sessionStorage.removeItem(PREFIX + scope)
  } catch { /* see writeStickyFilters */ }
}

/**
 * Pick between a stored value and the page default. A stored value whose shape no
 * longer matches the default is discarded, so shipping a change to a filter's type
 * can't wedge the page on stale session data.
 */
export function resolveStickyValue<T>(stored: unknown, fallback: T): T {
  if (stored === undefined) return fallback
  // A nullable field starts empty, so there is no shape to compare against.
  if (fallback == null) return stored as T
  if (Array.isArray(stored) !== Array.isArray(fallback)) return fallback
  if (typeof stored !== typeof fallback) return fallback
  return stored as T
}

/**
 * Drop-in replacement for `useState` that remembers the value for the rest of the
 * browser session, keyed by page `scope` + `field`.
 *
 *   const [status, setStatus] = useStickyState('training.library.quizzes', 'status', 'all')
 */
export function useStickyState<T>(
  scope: string,
  field: string,
  initial: T | (() => T),
): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() =>
    resolveStickyValue(readStickyFilters(scope)[field], initial instanceof Function ? initial() : initial),
  )

  const scopeRef = useRef(scope)
  scopeRef.current = scope

  const set = useCallback((next: T) => {
    setValue(next)
    writeStickyFilters(scopeRef.current, { [field]: next })
  }, [field])

  return [value, set]
}
