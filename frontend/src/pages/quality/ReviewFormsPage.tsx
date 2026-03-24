import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  Search, PlayCircle, ClipboardList, RefreshCw, ChevronUp, ChevronDown, ChevronsUpDown,
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { getAllForms } from '@/services/formService'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'

type SortField = 'form_name' | 'interaction_type' | 'version' | 'created_at'
type SortDir   = 'asc' | 'desc'

export default function ReviewFormsPage() {
  const { user } = useAuth()
  const navigate  = useNavigate()
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [sortField, setSortField] = useState<SortField | null>(null)
  const [sortDir, setSortDir]     = useState<SortDir>('asc')

  // Access guard
  if (user && user.role_id !== 1 && user.role_id !== 2) {
    return (
      <div className="p-6">
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 text-amber-700">
          This page is only accessible to QA analysts and Administrators.
        </div>
      </div>
    )
  }

  const { data: rawForms = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['review-forms-list'],
    queryFn: () => getAllForms(true), // active only
  })

  function toggleSort(field: SortField) {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortField(field); setSortDir('asc') }
  }

  function SortIcon({ field }: { field: SortField }) {
    if (sortField !== field) return <ChevronsUpDown size={12} className="ml-1 text-slate-400 shrink-0" />
    return sortDir === 'asc'
      ? <ChevronUp   size={12} className="ml-1 text-[#00aeef] shrink-0" />
      : <ChevronDown size={12} className="ml-1 text-[#00aeef] shrink-0" />
  }

  function SortHead({ field, children }: { field: SortField; children: React.ReactNode }) {
    return (
      <TableHead
        className="py-4 cursor-pointer select-none hover:bg-slate-100 transition-colors whitespace-nowrap"
        onClick={() => toggleSort(field)}
      >
        <div className="flex items-center">{children}<SortIcon field={field} /></div>
      </TableHead>
    )
  }

  const forms = useMemo(() => {
    let list = (rawForms as any[]).filter(f => {
      const matchSearch = !search || f.form_name?.toLowerCase().includes(search.toLowerCase())
      const matchType = typeFilter === 'all' || f.interaction_type === typeFilter
      return matchSearch && matchType
    })
    if (sortField) {
      list = [...list].sort((a, b) => {
        const av = a[sortField] ?? ''
        const bv = b[sortField] ?? ''
        const cmp = String(av).localeCompare(String(bv), undefined, { numeric: true })
        return sortDir === 'asc' ? cmp : -cmp
      })
    }
    return list
  }, [rawForms, search, typeFilter, sortField, sortDir])

  const hasFilters = search !== '' || typeFilter !== 'all'

  const interactionTypes = useMemo(() => {
    const types = new Set((rawForms as any[]).map((f: any) => f.interaction_type).filter(Boolean))
    return Array.from(types) as string[]
  }, [rawForms])

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Review Forms</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Select a form to begin a manual QA review</p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4 mr-1" /> Refresh
        </Button>
      </div>

      {/* Filter toolbar */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[280px] max-w-[400px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Search form name…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>

        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-[160px]"><SelectValue placeholder="All Types" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            {interactionTypes.map(t => (
              <SelectItem key={t} value={t}>{t}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <button
          onClick={() => { setSearch(''); setTypeFilter('all') }}
          disabled={!hasFilters}
          className="ml-auto text-[12px] font-medium text-[#00aeef] hover:underline disabled:opacity-30 disabled:cursor-not-allowed disabled:no-underline"
        >
          Reset Filters
        </button>
      </div>

      {/* Count */}
      <p className="text-[13px] text-muted-foreground">
        Showing {forms.length} of {(rawForms as any[]).length} forms
      </p>

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {isLoading ? (
          <div className="p-4 space-y-2">
            {[...Array(6)].map((_, i) => <div key={i} className="h-10 bg-slate-100 animate-pulse rounded" />)}
          </div>
        ) : isError ? (
          <div className="p-6 bg-red-50 border border-red-200 flex items-center justify-between">
            <p className="text-[13px] text-red-700 font-medium">Failed to load forms.</p>
            <Button variant="outline" size="sm" onClick={() => refetch()}>Retry</Button>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50 border-b border-slate-200">
                <SortHead field="form_name">Form Name</SortHead>
                <SortHead field="interaction_type">Type</SortHead>
                <SortHead field="version">Version</SortHead>
                <SortHead field="created_at">Created</SortHead>
                <TableHead className="py-4">Status</TableHead>
                <TableHead className="py-4 w-[120px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {forms.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-12 text-muted-foreground">
                    <ClipboardList className="h-8 w-8 mx-auto mb-2 text-slate-300" />
                    {search || typeFilter !== 'all' ? 'No matching forms.' : 'No active forms found. Create a form in the Form Builder first.'}
                  </TableCell>
                </TableRow>
              ) : forms.map((f: any) => (
                <TableRow key={f.id} className="hover:bg-slate-50/50">
                  <TableCell className="text-[13px] font-medium text-slate-900">{f.form_name}</TableCell>
                  <TableCell className="text-[13px] text-slate-600">{f.interaction_type ?? '—'}</TableCell>
                  <TableCell className="text-[13px] text-slate-600">v{f.version ?? 1}</TableCell>
                  <TableCell className="text-[13px] text-slate-500">
                    {f.created_at ? new Date(f.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
                  </TableCell>
                  <TableCell>
                    <button className="flex items-center gap-1.5 text-[12px]">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                      <span className="text-emerald-700">Active</span>
                    </button>
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost" size="sm"
                      className="h-7 px-2 text-[12px]"
                      onClick={() => navigate(`/app/quality/audit?formId=${f.id}`)}
                    >
                      <PlayCircle size={12} className="mr-1" /> Start Review
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  )
}
