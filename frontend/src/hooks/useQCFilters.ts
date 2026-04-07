import { useState, useMemo } from 'react'
import type { QCParams } from '@/services/insightsQCService'

export function useQCFilters() {
  const [departments, setDepartments] = useState<string[]>([])
  const [period, setPeriod]           = useState('Current Month')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd]     = useState('')
  const [forms, setForms]             = useState<string[]>([])

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
    params,
  }
}
