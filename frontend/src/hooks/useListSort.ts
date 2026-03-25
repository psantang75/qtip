import { useState, useMemo } from 'react'

export type SortDir = 'asc' | 'desc' | null

export function useListSort<T>(data: T[]) {
  const [sort, setSort] = useState<string | null>(null)
  const [dir, setDir]   = useState<SortDir>(null)

  const toggle = (field: string) => {
    if (sort !== field) { setSort(field); setDir('asc') }
    else if (dir === 'asc') setDir('desc')
    else { setSort(null); setDir(null) }
  }

  const sorted = useMemo(() => {
    if (!sort || !dir) return data
    return [...data].sort((a: any, b: any) => {
      const av = a[sort] ?? ''
      const bv = b[sort] ?? ''
      const cmp = typeof av === 'number' && typeof bv === 'number'
        ? av - bv
        : String(av).localeCompare(String(bv), undefined, { numeric: true })
      return dir === 'asc' ? cmp : -cmp
    })
  }, [data, sort, dir])

  return { sort, dir, toggle, sorted }
}
