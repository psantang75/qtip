/**
 * Shared filter state + client-side filtering logic for form list pages
 * (Form Builder list and Review Forms list).
 */
import { useState, useMemo } from 'react'
import type { DateRange } from '@/components/common/DateRangeFilter'

interface RawForm {
  form_name?: string
  interaction_type?: string
  created_at?: string
  is_active?: boolean
}

interface UseFormListFiltersOptions {
  /** Initial value for the status filter — 'active' | 'inactive' | 'all' */
  defaultStatus?: string
}

export function useFormListFilters(
  rawForms: RawForm[],
  { defaultStatus = 'all' }: UseFormListFiltersOptions = {},
) {
  const [search, setSearch]                       = useState('')
  const [selectedFormNames, setSelectedFormNames] = useState<string[]>([])
  const [selectedTypes, setSelectedTypes]         = useState<string[]>([])
  const [statusFilter, setStatusFilter]           = useState(defaultStatus)
  const [typeFilter, setTypeFilter]               = useState('all')
  const [dateRange, setDateRange]                 = useState<DateRange>({ start: '', end: '' })
  const [page, setPage]                           = useState(1)
  const [pageSize, setPageSize]                   = useState(20)

  /** Unique types from forms that pass all OTHER active filters (status, selectedFormNames, date)
   *  so the dropdown only lists types present in the current list view. */
  const interactionTypes = useMemo(() => {
    const types = new Set(
      rawForms
        .filter(f => {
          if (statusFilter === 'active'   && !f.is_active) return false
          if (statusFilter === 'inactive' &&  f.is_active) return false
          if (selectedFormNames.length > 0 && !selectedFormNames.includes(f.form_name ?? '')) return false
          if (dateRange.start) {
            const created = f.created_at ? f.created_at.split('T')[0] : ''
            if (created && created < dateRange.start) return false
          }
          if (dateRange.end) {
            const created = f.created_at ? f.created_at.split('T')[0] : ''
            if (created && created > dateRange.end) return false
          }
          return true
        })
        .map(f => f.interaction_type)
        .filter(Boolean) as string[]
    )
    return Array.from(types).sort()
  }, [rawForms, statusFilter, selectedFormNames, dateRange])

  /** Unique form names from forms that pass all OTHER active filters (status, type, date)
   *  so the dropdown only lists what is actually visible in the current list view. */
  const formNames = useMemo(() => {
    const names = new Set(
      rawForms
        .filter(f => {
          if (statusFilter === 'active'   && !f.is_active) return false
          if (statusFilter === 'inactive' &&  f.is_active) return false
          if (selectedTypes.length > 0 && !selectedTypes.includes(f.interaction_type ?? '')) return false
          else if (selectedTypes.length === 0 && typeFilter !== 'all' && f.interaction_type !== typeFilter) return false
          if (dateRange.start) {
            const created = f.created_at ? f.created_at.split('T')[0] : ''
            if (created && created < dateRange.start) return false
          }
          if (dateRange.end) {
            const created = f.created_at ? f.created_at.split('T')[0] : ''
            if (created && created > dateRange.end) return false
          }
          return true
        })
        .map(f => f.form_name)
        .filter(Boolean) as string[]
    )
    return Array.from(names).sort((a, b) => a.localeCompare(b))
  }, [rawForms, statusFilter, selectedTypes, typeFilter, dateRange])

  const filtered = useMemo(() => rawForms.filter(f => {
    if (statusFilter === 'active'   && !f.is_active) return false
    if (statusFilter === 'inactive' &&  f.is_active) return false
    // Text search (ReviewFormsPage) and multi-select (FormBuilderList) are independent
    if (search && !f.form_name?.toLowerCase().includes(search.toLowerCase())) return false
    if (selectedFormNames.length > 0 && !selectedFormNames.includes(f.form_name ?? '')) return false
    // selectedTypes (multi, FormBuilderList) takes precedence over typeFilter (single, ReviewFormsPage)
    if (selectedTypes.length > 0 && !selectedTypes.includes(f.interaction_type ?? '')) return false
    else if (selectedTypes.length === 0 && typeFilter !== 'all' && f.interaction_type !== typeFilter) return false
    if (dateRange.start) {
      const created = f.created_at ? f.created_at.split('T')[0] : ''
      if (created && created < dateRange.start) return false
    }
    if (dateRange.end) {
      const created = f.created_at ? f.created_at.split('T')[0] : ''
      if (created && created > dateRange.end) return false
    }
    return true
  }), [rawForms, statusFilter, search, selectedFormNames, typeFilter, dateRange])

  const hasFilters =
    search !== '' ||
    selectedFormNames.length > 0 ||
    selectedTypes.length > 0 ||
    statusFilter !== defaultStatus ||
    typeFilter !== 'all' ||
    !!dateRange.start ||
    !!dateRange.end

  const resetFilters = () => {
    setSearch('')
    setSelectedFormNames([])
    setSelectedTypes([])
    setStatusFilter(defaultStatus)
    setTypeFilter('all')
    setDateRange({ start: '', end: '' })
    setPage(1)
  }

  return {
    search, setSearch,
    selectedFormNames, setSelectedFormNames,
    formNames,
    selectedTypes, setSelectedTypes,
    statusFilter, setStatusFilter,
    typeFilter, setTypeFilter,
    dateRange, setDateRange,
    page, setPage,
    pageSize, setPageSize,
    interactionTypes,
    filtered,
    hasFilters,
    resetFilters,
  }
}
