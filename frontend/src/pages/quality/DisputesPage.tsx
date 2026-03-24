import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  Search, ChevronLeft, ChevronRight, AlertTriangle, RefreshCw, Eye,
  ChevronUp, ChevronDown, ChevronsUpDown,
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import qaService, { scoreColor } from '@/services/qaService'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'

const PAGE_SIZE = 20

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

// ── Sort head ─────────────────────────────────────────────────────────────────
type SortDir = 'asc' | 'desc' | null
function SortHead({ field, sort, dir, onSort, children, right = false }: {
  field: string; sort: string | null; dir: SortDir
  onSort: (f: string) => void; children: React.ReactNode; right?: boolean
}) {
  const active = sort === field
  const Icon = active ? (dir === 'asc' ? ChevronUp : ChevronDown) : ChevronsUpDown
  return (
    <TableHead
      className={cn('py-4 cursor-pointer select-none hover:bg-slate-100 transition-colors whitespace-nowrap', right && 'text-right')}
      onClick={() => onSort(field)}
    >
      <span className={cn('flex items-center gap-1', right && 'justify-end')}>
        {children}
        <Icon size={12} className={active ? 'text-[#00aeef]' : 'text-slate-400'} />
      </span>
    </TableHead>
  )
}

function useTableSort<T>(rows: T[]) {
  const [sort, setSort] = useState<string | null>(null)
  const [dir, setDir]   = useState<SortDir>(null)
  const toggle = (field: string) => {
    if (sort !== field) { setSort(field); setDir('asc') }
    else if (dir === 'asc') setDir('desc')
    else { setSort(null); setDir(null) }
  }
  const sorted = useMemo(() => {
    if (!sort || !dir) return rows
    return [...rows].sort((a: any, b: any) => {
      const av = a[sort] ?? '', bv = b[sort] ?? ''
      const cmp = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv))
      return dir === 'asc' ? cmp : -cmp
    })
  }, [rows, sort, dir])
  return { sort, dir, toggle, sorted }
}

function StatusDot({ status }: { status: string }) {
  const map: Record<string, { dot: string; label: string }> = {
    OPEN:     { dot: 'bg-amber-500',   label: 'Open'     },
    RESOLVED: { dot: 'bg-emerald-500', label: 'Resolved' },
    UPHELD:   { dot: 'bg-emerald-500', label: 'Upheld'   },
    REJECTED: { dot: 'bg-red-500',     label: 'Rejected' },
    ADJUSTED: { dot: 'bg-blue-500',    label: 'Adjusted' },
  }
  const cfg = map[status?.toUpperCase()] ?? { dot: 'bg-slate-400', label: status ?? '—' }
  return (
    <span className="flex items-center gap-1.5 text-[13px]">
      <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', cfg.dot)} />
      <span className="text-slate-600">{cfg.label}</span>
    </span>
  )
}

// ── Manager Dispute Resolution ────────────────────────────────────────────────
function ManagerDisputeResolution() {
  const navigate = useNavigate()
  const [page, setPage]           = useState(1)
  const [search, setSearch]       = useState('')
  const [statusFilter, setStatus] = useState('all')

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['manager-disputes', page, statusFilter],
    queryFn: () => qaService.getManagerDisputes({
      page, limit: PAGE_SIZE,
      status: statusFilter !== 'all' ? statusFilter : undefined,
    }),
    placeholderData: (prev: any) => prev,
  })

  const hasFilters = search !== '' || statusFilter !== 'all'
  const totalPages = data?.totalPages ?? (data?.total != null ? Math.ceil(data.total / PAGE_SIZE) : 1)

  const filtered = (data?.items ?? []).filter((d: any) => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      String(d.id ?? '').includes(q)          ||
      String(d.submission_id ?? '').includes(q)||
      d.csr_name?.toLowerCase().includes(q)   ||
      d.form_name?.toLowerCase().includes(q)
    )
  })
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const mgrSort = useTableSort(filtered)

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Dispute Resolution</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {data?.total != null ? `${data.total.toLocaleString()} total` : ''}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4 mr-1" /> Refresh
        </Button>
      </div>

      {/* Filter toolbar */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <Input value={search} onChange={e => { setSearch(e.target.value); setPage(1) }}
            placeholder="Search by CSR, form, dispute ID…" className="pl-10" />
        </div>
        <Select value={statusFilter} onValueChange={v => { setStatus(v); setPage(1) }}>
          <SelectTrigger className="w-[160px]"><SelectValue placeholder="All statuses" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="OPEN">Open</SelectItem>
            <SelectItem value="RESOLVED">Resolved</SelectItem>
          </SelectContent>
        </Select>
        <button
          onClick={() => { setSearch(''); setStatus('all') }}
          disabled={!hasFilters}
          className="ml-auto text-[12px] font-medium text-[#00aeef] hover:underline disabled:opacity-30 disabled:cursor-not-allowed disabled:no-underline"
        >
          Reset Filters
        </button>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {isLoading ? (
          <div className="p-4 space-y-2">
            {[...Array(8)].map((_, i) => <div key={i} className="h-10 bg-slate-100 animate-pulse rounded" />)}
          </div>
        ) : isError ? (
          <div className="p-6 bg-red-50 border border-red-200 flex items-center justify-between">
            <p className="text-[13px] text-red-700 font-medium">Failed to load disputes.</p>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4 mr-1" /> Retry
            </Button>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50 border-b border-slate-200">
                <SortHead field="status"        sort={mgrSort.sort} dir={mgrSort.dir} onSort={mgrSort.toggle}>Status</SortHead>
                <SortHead field="id"            sort={mgrSort.sort} dir={mgrSort.dir} onSort={mgrSort.toggle}>Dispute ID</SortHead>
                <SortHead field="csr_name"      sort={mgrSort.sort} dir={mgrSort.dir} onSort={mgrSort.toggle}>CSR</SortHead>
                <SortHead field="submission_id" sort={mgrSort.sort} dir={mgrSort.dir} onSort={mgrSort.toggle}>Review ID</SortHead>
                <SortHead field="form_name"     sort={mgrSort.sort} dir={mgrSort.dir} onSort={mgrSort.toggle}>Form Name</SortHead>
                <SortHead field="original_score" sort={mgrSort.sort} dir={mgrSort.dir} onSort={mgrSort.toggle} right>Score</SortHead>
                <SortHead field="previous_score" sort={mgrSort.sort} dir={mgrSort.dir} onSort={mgrSort.toggle} right>Prev Score</SortHead>
                <SortHead field="created_at"    sort={mgrSort.sort} dir={mgrSort.dir} onSort={mgrSort.toggle}>Date</SortHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {mgrSort.sorted.length ? (
                mgrSort.sorted.map((d: any) => (
                  <TableRow key={d.id ?? d.dispute_id} className="cursor-pointer hover:bg-slate-50/50">
                    <TableCell><StatusDot status={d.status} /></TableCell>
                    <TableCell className="text-[13px] text-slate-500">
                      #{d.id ?? d.dispute_id ?? '—'}
                    </TableCell>
                    <TableCell className="text-[13px] font-medium text-slate-900">
                      {d.csr_name ?? '—'}
                    </TableCell>
                    <TableCell>
                      <button
                        className="text-[13px] font-medium text-[#00aeef] hover:underline"
                        onClick={() => navigate(`/app/quality/submissions/${d.submission_id}`)}
                      >
                        #{d.submission_id ?? '—'}
                      </button>
                    </TableCell>
                    <TableCell className="text-[13px] text-slate-600">{d.form_name ?? '—'}</TableCell>
                    <TableCell className="text-right text-[13px] font-medium">
                      {d.original_score != null && d.original_score > 0
                        ? <span className={scoreColor(d.original_score)}>{d.original_score.toFixed(1)}%</span>
                        : <span className="text-slate-400">—</span>
                      }
                    </TableCell>
                    <TableCell className="text-right text-[13px]">
                      {d.previous_score != null
                        ? <span className="text-slate-500">{d.previous_score.toFixed(1)}%</span>
                        : <span className="text-slate-400">—</span>
                      }
                    </TableCell>
                    <TableCell className="text-[13px] text-slate-600">
                      {d.created_at ? fmtDate(d.created_at) : '—'}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="sm" className="h-7 px-2 text-[12px]"
                          onClick={() => navigate(`/app/quality/submissions/${d.submission_id}`)}>
                          <Eye size={12} className="mr-1" />
                          {d.status === 'OPEN' ? 'Resolve' : 'View'}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-12 text-slate-400">
                    <AlertTriangle className="h-8 w-8 mx-auto mb-2 text-slate-300" />
                    {search || statusFilter !== 'all'
                      ? 'No disputes match your filters.'
                      : 'No disputes found for your team.'}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-slate-500">
          <span>Page {page} of {totalPages}</span>
          <div className="flex gap-1">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Admin / QA Disputes ───────────────────────────────────────────────────────
function AdminQADisputes() {
  const navigate  = useNavigate()
  const [page, setPage]           = useState(1)
  const [search, setSearch]       = useState('')
  const [statusFilter, setStatus] = useState('all')

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['manager-disputes', page, statusFilter],
    queryFn: () => qaService.getManagerDisputes({
      page, limit: PAGE_SIZE,
      status: statusFilter !== 'all' ? statusFilter : undefined,
    }),
    placeholderData: (prev: any) => prev,
  })

  const hasFilters = search !== '' || statusFilter !== 'all'
  const totalPages = data?.totalPages ?? (data?.total != null ? Math.ceil(data.total / PAGE_SIZE) : 1)

  const filteredAdm = (data?.items ?? []).filter((d: any) => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      String(d.id ?? '').includes(q)          ||
      String(d.submission_id ?? '').includes(q)||
      d.csr_name?.toLowerCase().includes(q)   ||
      d.form_name?.toLowerCase().includes(q)
    )
  })
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const admSort = useTableSort(filteredAdm)

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Disputes</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {data?.total != null ? `${data.total.toLocaleString()} total` : ''}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4 mr-1" /> Refresh
        </Button>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <Input value={search} onChange={e => { setSearch(e.target.value); setPage(1) }}
            placeholder="Search by CSR, form, ID…" className="pl-10" />
        </div>
        <Select value={statusFilter} onValueChange={v => { setStatus(v); setPage(1) }}>
          <SelectTrigger className="w-[160px]"><SelectValue placeholder="All statuses" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="OPEN">Open</SelectItem>
            <SelectItem value="RESOLVED">Resolved</SelectItem>
          </SelectContent>
        </Select>
        <button
          onClick={() => { setSearch(''); setStatus('all') }}
          disabled={!hasFilters}
          className="ml-auto text-[12px] font-medium text-[#00aeef] hover:underline disabled:opacity-30 disabled:cursor-not-allowed disabled:no-underline"
        >
          Reset Filters
        </button>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {isLoading ? (
          <div className="p-4 space-y-2">
            {[...Array(8)].map((_, i) => <div key={i} className="h-10 bg-slate-100 animate-pulse rounded" />)}
          </div>
        ) : isError ? (
          <div className="p-6 bg-red-50 border border-red-200 flex items-center justify-between">
            <p className="text-[13px] text-red-700 font-medium">Failed to load disputes.</p>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4 mr-1" /> Retry
            </Button>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50 border-b border-slate-200">
                <SortHead field="status"        sort={admSort.sort} dir={admSort.dir} onSort={admSort.toggle}>Status</SortHead>
                <SortHead field="id"            sort={admSort.sort} dir={admSort.dir} onSort={admSort.toggle}>Dispute ID</SortHead>
                <SortHead field="csr_name"      sort={admSort.sort} dir={admSort.dir} onSort={admSort.toggle}>CSR</SortHead>
                <SortHead field="submission_id" sort={admSort.sort} dir={admSort.dir} onSort={admSort.toggle}>Review ID</SortHead>
                <SortHead field="form_name"     sort={admSort.sort} dir={admSort.dir} onSort={admSort.toggle}>Form Name</SortHead>
                <SortHead field="original_score" sort={admSort.sort} dir={admSort.dir} onSort={admSort.toggle} right>Score</SortHead>
                <SortHead field="created_at"    sort={admSort.sort} dir={admSort.dir} onSort={admSort.toggle}>Date</SortHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {admSort.sorted.length ? (
                admSort.sorted.map((d: any) => (
                  <TableRow key={d.id ?? d.dispute_id} className="cursor-pointer hover:bg-slate-50/50">
                    <TableCell><StatusDot status={d.status} /></TableCell>
                    <TableCell className="text-[13px] text-slate-500">#{d.id ?? d.dispute_id ?? '—'}</TableCell>
                    <TableCell className="text-[13px] font-medium text-slate-900">{d.csr_name ?? '—'}</TableCell>
                    <TableCell>
                      <button className="text-[13px] font-medium text-[#00aeef] hover:underline"
                        onClick={() => navigate(`/app/quality/submissions/${d.submission_id}`)}>
                        #{d.submission_id ?? '—'}
                      </button>
                    </TableCell>
                    <TableCell className="text-[13px] text-slate-600">{d.form_name ?? '—'}</TableCell>
                    <TableCell className="text-right text-[13px] font-medium">
                      {d.original_score != null && d.original_score > 0
                        ? <span className={scoreColor(d.original_score)}>{d.original_score.toFixed(1)}%</span>
                        : <span className="text-slate-400">—</span>
                      }
                    </TableCell>
                    <TableCell className="text-[13px] text-slate-600">
                      {d.created_at ? fmtDate(d.created_at) : '—'}
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="sm" className="h-7 px-2 text-[12px]"
                        onClick={() => navigate(`/app/quality/submissions/${d.submission_id}`)}>
                        <Eye size={12} className="mr-1" /> View
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-12 text-slate-400">
                    <AlertTriangle className="h-8 w-8 mx-auto mb-2 text-slate-300" />
                    {search || statusFilter !== 'all'
                      ? 'No disputes match your filters.'
                      : 'No disputes found.'}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-slate-500">
          <span>Page {page} of {totalPages}</span>
          <div className="flex gap-1">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Page entry ────────────────────────────────────────────────────────────────
export default function DisputesPage() {
  const { user } = useAuth()
  const roleId = user?.role_id ?? 0
  if (roleId === 5) return <ManagerDisputeResolution />
  return <AdminQADisputes />
}
