import { useSearchParams } from 'react-router-dom'
import { useCallback } from 'react'

/**
 * Provides URL-backed filter state so filters survive navigation
 * and can be shared via link.
 *
 * Usage:
 *   const { get, set, reset } = useUrlFilters({ status: 'all', page: '1' })
 *   const status = get('status')
 *   const setStatus = (v: string) => set('status', v)
 *   reset() // restores defaults
 */
export function useUrlFilters(defaults: Record<string, string>) {
  const [params, setParams] = useSearchParams()

  const get = useCallback(
    (key: string): string => params.get(key) ?? defaults[key] ?? '',
    [params, defaults],
  )

  const set = useCallback(
    (key: string, value: string) => {
      setParams(
        p => {
          const n = new URLSearchParams(p)
          value !== (defaults[key] ?? '') ? n.set(key, value) : n.delete(key)
          return n
        },
        { replace: true },
      )
    },
    [setParams, defaults],
  )

  const setMany = useCallback(
    (updates: Record<string, string>) => {
      setParams(
        p => {
          const n = new URLSearchParams(p)
          Object.entries(updates).forEach(([k, v]) => {
            v !== (defaults[k] ?? '') ? n.set(k, v) : n.delete(k)
          })
          return n
        },
        { replace: true },
      )
    },
    [setParams, defaults],
  )

  const reset = useCallback(() => {
    setParams({}, { replace: true })
  }, [setParams])

  const hasAnyFilter = Object.keys(defaults).some(
    k => (params.get(k) ?? defaults[k]) !== defaults[k],
  )

  return { get, set, setMany, reset, hasAnyFilter }
}
