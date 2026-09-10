import { useSearchParams } from 'react-router-dom'
import { useCallback, useEffect, useRef } from 'react'
import { clearStickyFilters, readStickyFilters, writeStickyFilters } from './useStickyFilters'

/**
 * Provides URL-backed filter state so filters survive navigation
 * and can be shared via link.
 *
 * Usage:
 *   const { get, set, reset } = useUrlFilters({ status: 'all', page: '1' })
 *   const status = get('status')
 *   const setStatus = (v: string) => set('status', v)
 *   reset() // restores defaults
 *
 * Pass `storageKey` to also make the filters sticky: selections are saved for the
 * browser session (see `useStickyFilters`) and restored the next time the page
 * mounts without filters in the URL. An incoming link that carries filters always
 * wins, so deep links and shared URLs are unaffected.
 *
 *   const { get, set, reset } = useUrlFilters({ status: 'all' }, 'quality.submissions')
 */
/**
 * Saved values worth restoring: keys this page still owns whose stored value
 * differs from the default — `set` never writes a default into the URL.
 */
export function restorableFilters(
  defaults: Record<string, string>,
  saved: Record<string, unknown>,
): Record<string, string> {
  const out: Record<string, string> = {}
  Object.keys(defaults).forEach(k => {
    const v = saved[k]
    if (typeof v === 'string' && v !== (defaults[k] ?? '')) out[k] = v
  })
  return out
}

export function useUrlFilters(defaults: Record<string, string>, storageKey?: string) {
  const [params, setParams] = useSearchParams()

  const get = useCallback(
    (key: string): string => params.get(key) ?? defaults[key] ?? '',
    [params, defaults],
  )

  // Restore once per mount, before the user touches anything. `params` is
  // deliberately out of the dependency list — a later render must not re-apply
  // stale selections over a filter the user just cleared.
  const restored = useRef(false)
  useEffect(() => {
    if (restored.current || !storageKey) return
    restored.current = true
    if (Object.keys(defaults).some(k => params.has(k))) return
    const overrides = Object.entries(restorableFilters(defaults, readStickyFilters(storageKey)))
    if (!overrides.length) return
    setParams(
      p => {
        const n = new URLSearchParams(p)
        overrides.forEach(([k, v]) => { n.set(k, v) })
        return n
      },
      { replace: true },
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey])

  /** Save the post-change value of every owned key so the next mount can restore it. */
  const persist = useCallback(
    (updates: Record<string, string>) => {
      if (!storageKey) return
      const snapshot: Record<string, string> = {}
      Object.keys(defaults).forEach(k => {
        snapshot[k] = updates[k] ?? params.get(k) ?? defaults[k] ?? ''
      })
      writeStickyFilters(storageKey, snapshot)
    },
    [storageKey, params, defaults],
  )

  const set = useCallback(
    (key: string, value: string) => {
      persist({ [key]: value })
      setParams(
        p => {
          const n = new URLSearchParams(p)
          if (value !== (defaults[key] ?? '')) { n.set(key, value) } else { n.delete(key) }
          return n
        },
        { replace: true },
      )
    },
    [setParams, defaults, persist],
  )

  const setMany = useCallback(
    (updates: Record<string, string>) => {
      persist(updates)
      setParams(
        p => {
          const n = new URLSearchParams(p)
          Object.entries(updates).forEach(([k, v]) => {
            if (v !== (defaults[k] ?? '')) { n.set(k, v) } else { n.delete(k) }
          })
          return n
        },
        { replace: true },
      )
    },
    [setParams, defaults, persist],
  )

  const reset = useCallback(() => {
    if (storageKey) clearStickyFilters(storageKey)
    setParams({}, { replace: true })
  }, [setParams, storageKey])

  const hasAnyFilter = Object.keys(defaults).some(
    k => (params.get(k) ?? defaults[k]) !== defaults[k],
  )

  return { get, set, setMany, reset, hasAnyFilter }
}
