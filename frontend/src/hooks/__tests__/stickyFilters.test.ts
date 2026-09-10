/**
 * Sticky filters — the session-storage layer behind `useStickyState` and the
 * `storageKey` option on `useUrlFilters`. The hooks themselves need a renderer
 * (the frontend Vitest run is `environment: 'node'`), so this covers the pure
 * read/merge/write and the two decisions that drive restoration.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearStickyFilters,
  readStickyFilters,
  resolveStickyValue,
  writeStickyFilters,
} from '../useStickyFilters'
import { restorableFilters } from '../useUrlFilters'

function installSessionStorage(): Map<string, string> {
  const store = new Map<string, string>()
  vi.stubGlobal('sessionStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v) },
    removeItem: (k: string) => { store.delete(k) },
    clear: () => { store.clear() },
  })
  return store
}

describe('sticky filter storage', () => {
  let store: Map<string, string>

  beforeEach(() => { store = installSessionStorage() })

  it('round-trips values under a namespaced, page-scoped key', () => {
    writeStickyFilters('quality.disputes', { statuses: ['OPEN'], page: 2 })

    expect(readStickyFilters('quality.disputes')).toEqual({ statuses: ['OPEN'], page: 2 })
    expect(store.has('qtip.filters.quality.disputes')).toBe(true)
  })

  it('merges into the saved record instead of replacing it', () => {
    writeStickyFilters('quality.disputes', { statuses: ['OPEN'], page: 2 })
    writeStickyFilters('quality.disputes', { page: 3 })

    expect(readStickyFilters('quality.disputes')).toEqual({ statuses: ['OPEN'], page: 3 })
  })

  it('keeps each page scope independent', () => {
    writeStickyFilters('quality.disputes', { page: 2 })
    writeStickyFilters('training.reports', { page: 7 })

    expect(readStickyFilters('quality.disputes')).toEqual({ page: 2 })
    expect(readStickyFilters('training.reports')).toEqual({ page: 7 })
  })

  it('clears a scope back to nothing saved', () => {
    writeStickyFilters('scheduling.grid', { search: 'ana' })
    clearStickyFilters('scheduling.grid')

    expect(readStickyFilters('scheduling.grid')).toEqual({})
  })

  it('treats unreadable or non-object storage as nothing saved', () => {
    store.set('qtip.filters.broken', '{ not json')
    store.set('qtip.filters.array', '["a"]')

    expect(readStickyFilters('broken')).toEqual({})
    expect(readStickyFilters('array')).toEqual({})
  })

  it('does not throw when sessionStorage is unavailable', () => {
    vi.stubGlobal('sessionStorage', {
      getItem: () => { throw new Error('denied') },
      setItem: () => { throw new Error('denied') },
      removeItem: () => { throw new Error('denied') },
    })

    expect(() => writeStickyFilters('any', { a: 1 })).not.toThrow()
    expect(() => clearStickyFilters('any')).not.toThrow()
    expect(readStickyFilters('any')).toEqual({})
  })
})

describe('resolveStickyValue', () => {
  it('prefers the saved value when it matches the default shape', () => {
    expect(resolveStickyValue('inactive', 'active')).toBe('inactive')
    expect(resolveStickyValue(3, 1)).toBe(3)
    expect(resolveStickyValue(true, false)).toBe(true)
    expect(resolveStickyValue(['QA'], [] as string[])).toEqual(['QA'])
    expect(resolveStickyValue({ start: '2026-01-01', end: '' }, { start: '', end: '' }))
      .toEqual({ start: '2026-01-01', end: '' })
  })

  it('falls back to the default when nothing is saved', () => {
    expect(resolveStickyValue(undefined, 'active')).toBe('active')
  })

  it('discards a saved value whose shape no longer matches', () => {
    expect(resolveStickyValue('2', 1)).toBe(1)
    expect(resolveStickyValue(['a'], '' as string)).toBe('')
    expect(resolveStickyValue({ start: '' }, [] as string[])).toEqual([])
  })

  it('accepts any saved value for a nullable field, which has no shape to match', () => {
    expect(resolveStickyValue(12, null as number | null)).toBe(12)
  })
})

describe('restorableFilters', () => {
  const defaults = { statuses: '', from: '2026-01-01', page: '1' }

  it('restores only the keys saved with a non-default value', () => {
    expect(restorableFilters(defaults, { statuses: 'OPEN', from: '2026-01-01', page: '3' }))
      .toEqual({ statuses: 'OPEN', page: '3' })
  })

  it('ignores keys the page no longer owns', () => {
    expect(restorableFilters(defaults, { retired: 'x', statuses: 'OPEN' }))
      .toEqual({ statuses: 'OPEN' })
  })

  it('ignores saved values that are not strings', () => {
    expect(restorableFilters(defaults, { page: 3, statuses: null })).toEqual({})
  })

  it('restores nothing when the session holds only defaults', () => {
    expect(restorableFilters(defaults, { statuses: '', page: '1' })).toEqual({})
  })
})
