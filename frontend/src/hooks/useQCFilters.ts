import { useState, useMemo, useCallback, useRef } from 'react'
import type { QCParams } from '@/services/insightsQCService'

const STORAGE_KEY = 'qc-filters'

interface FilterState {
  departments: string[]
  period: string
  customStart: string
  customEnd: string
  forms: string[]
}

const DEFAULTS: FilterState = {
  departments: [],
  period: 'Current Month',
  customStart: '',
  customEnd: '',
  forms: [],
}

function loadFromStorage(): FilterState {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULTS }
    return { ...DEFAULTS, ...JSON.parse(raw) }
  } catch {
    return { ...DEFAULTS }
  }
}

function saveToStorage(values: FilterState) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(values))
  } catch { /* sessionStorage unavailable */ }
}

export function useQCFilters() {
  const initial = useMemo(loadFromStorage, [])

  const [departments, _setDepartments] = useState<string[]>(initial.departments)
  const [period, _setPeriod]           = useState<string>(initial.period)
  const [customStart, _setCustomStart] = useState<string>(initial.customStart)
  const [customEnd, _setCustomEnd]     = useState<string>(initial.customEnd)
  const [forms, _setForms]             = useState<string[]>(initial.forms)

  const stateRef = useRef({ departments, period, customStart, customEnd, forms })
  stateRef.current = { departments, period, customStart, customEnd, forms }

  const persist = useCallback((patch: Partial<FilterState>) => {
    saveToStorage({ ...stateRef.current, ...patch })
  }, [])

  const setDepartments = useCallback((v: string[]) => { _setDepartments(v); persist({ departments: v }) }, [persist])
  const setPeriod      = useCallback((v: string)   => { _setPeriod(v);      persist({ period: v })      }, [persist])
  const setCustomStart = useCallback((v: string)   => { _setCustomStart(v); persist({ customStart: v }) }, [persist])
  const setCustomEnd   = useCallback((v: string)   => { _setCustomEnd(v);   persist({ customEnd: v })   }, [persist])
  const setForms       = useCallback((v: string[]) => { _setForms(v);       persist({ forms: v })       }, [persist])

  const resetFilters = useCallback(() => {
    _setDepartments(DEFAULTS.departments)
    _setPeriod(DEFAULTS.period)
    _setCustomStart(DEFAULTS.customStart)
    _setCustomEnd(DEFAULTS.customEnd)
    _setForms(DEFAULTS.forms)
    saveToStorage({ ...DEFAULTS })
  }, [])

  const params = useMemo<QCParams>(() => {
    const normalized = period.toLowerCase().replace(/\s+/g, '_')
    return {
      departments: departments.length ? departments.join(',') : undefined,
      period: normalized,
      ...(normalized === 'custom' && customStart ? { start: customStart } : {}),
      ...(normalized === 'custom' && customEnd   ? { end:   customEnd   } : {}),
      ...(forms.length                            ? { forms: forms.join(',') } : {}),
    }
  }, [departments, period, customStart, customEnd, forms])

  return {
    departments, setDepartments,
    period, setPeriod,
    customStart, setCustomStart,
    customEnd, setCustomEnd,
    forms, setForms,
    resetFilters,
    params,
  }
}
