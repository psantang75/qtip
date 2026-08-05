import { useState, useMemo, useCallback, useRef } from 'react'

/**
 * Filter state for the Agent Activity report pages. Mirrors `useQCFilters`
 * (department + period, session-persisted) but drops the Form filter, which
 * does not apply to activity reports. Kept as its own hook + storage key so
 * Agent Activity filters don't bleed into the QC pages.
 *
 * A page can pass its own `storageKey` to keep its filters separate from the
 * shared Agent Activity bar — the Attendance report does this because it drives
 * the bar to a Custom rolling-90 range, which should not leak onto the sales
 * reports that share the default key.
 */
const DEFAULT_STORAGE_KEY = 'aa-filters'

interface FilterState {
  users: string[]
  departments: string[]
  period: string
  customStart: string
  customEnd: string
}

const DEFAULTS: FilterState = {
  users: [],
  departments: [],
  period: 'Current Month',
  customStart: '',
  customEnd: '',
}

function loadFromStorage(storageKey: string): FilterState {
  try {
    const raw = sessionStorage.getItem(storageKey)
    if (!raw) return { ...DEFAULTS }
    return { ...DEFAULTS, ...JSON.parse(raw) }
  } catch {
    return { ...DEFAULTS }
  }
}

function saveToStorage(storageKey: string, values: FilterState) {
  try {
    sessionStorage.setItem(storageKey, JSON.stringify(values))
  } catch { /* sessionStorage unavailable */ }
}

export interface ActivityParams {
  users?: string
  departments?: string
  period: string
  start?: string
  end?: string
}

export function useActivityFilters(storageKey: string = DEFAULT_STORAGE_KEY) {
  const initial = useMemo(() => loadFromStorage(storageKey), [storageKey])

  const [users, _setUsers]             = useState<string[]>(initial.users)
  const [departments, _setDepartments] = useState<string[]>(initial.departments)
  const [period, _setPeriod]           = useState<string>(initial.period)
  const [customStart, _setCustomStart] = useState<string>(initial.customStart)
  const [customEnd, _setCustomEnd]     = useState<string>(initial.customEnd)

  const stateRef = useRef({ users, departments, period, customStart, customEnd })
  stateRef.current = { users, departments, period, customStart, customEnd }

  const persist = useCallback((patch: Partial<FilterState>) => {
    saveToStorage(storageKey, { ...stateRef.current, ...patch })
  }, [storageKey])

  const setUsers       = useCallback((v: string[]) => { _setUsers(v);       persist({ users: v })       }, [persist])
  const setDepartments = useCallback((v: string[]) => { _setDepartments(v); persist({ departments: v }) }, [persist])
  const setPeriod      = useCallback((v: string)   => { _setPeriod(v);      persist({ period: v })      }, [persist])
  const setCustomStart = useCallback((v: string)   => { _setCustomStart(v); persist({ customStart: v }) }, [persist])
  const setCustomEnd   = useCallback((v: string)   => { _setCustomEnd(v);   persist({ customEnd: v })   }, [persist])

  const resetFilters = useCallback(() => {
    _setUsers(DEFAULTS.users)
    _setDepartments(DEFAULTS.departments)
    _setPeriod(DEFAULTS.period)
    _setCustomStart(DEFAULTS.customStart)
    _setCustomEnd(DEFAULTS.customEnd)
    saveToStorage(storageKey, { ...DEFAULTS })
  }, [storageKey])

  const params = useMemo<ActivityParams>(() => {
    const normalized = period.toLowerCase().replace(/\s+/g, '_')
    return {
      users: users.length ? users.join(',') : undefined,
      departments: departments.length ? departments.join(',') : undefined,
      period: normalized,
      ...(normalized === 'custom' && customStart ? { start: customStart } : {}),
      ...(normalized === 'custom' && customEnd   ? { end:   customEnd   } : {}),
    }
  }, [users, departments, period, customStart, customEnd])

  return {
    users, setUsers,
    departments, setDepartments,
    period, setPeriod,
    customStart, setCustomStart,
    customEnd, setCustomEnd,
    resetFilters,
    params,
  }
}
