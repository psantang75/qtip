import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Search, ChevronLeft, ChevronRight, FileText, RefreshCw, Eye } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import qaService, { scoreColor, type Submission } from '@/services/qaService'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'

// ── Main page ─────────────────────────────────────────────────────────────────
export default function SubmissionsPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')

  const roleId = user?.role_id ?? 0
  const isAdminOrQA = roleId === 1 || roleId === 2
  const isManager = roleId === 5
  const isCSR = roleId === 3
  const PAGE_SIZE = 20

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['submissions', roleId, page, search, statusFilter],
    queryFn: () => {
      const params = { page, limit: PAGE_SIZE, search: search || undefined, status: statusFilter !== 'all' ? statusFilter : undefined }
      if (isCSR)     return qaService.getCSRAudits(params)
      if (isManager) return qaService.getTeamAudits(params)
      return qaService.getSubmissions(params)
    },
    enabled: !!user,
    placeholderData: (prev: any) => prev,
  })

  const handleSearchChange = (v: string) => { setSearch(v); setPage(1) }
  const handleStatusChange = (v: string) => { setStatusFilter(v); setPage(1) }
  const totalPages = data?.total != null ? Math.ceil(data.total / PAGE_SIZE) : 1
  const hasFilters = search !== '' || statusFilter !== 'all'
  const fmtDate = (d: string) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            {isCSR ? 'My Reviews' : isManager ? 'Team Reviews' : 'Submissions'}
          </h1>
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
          <Input value={search} onChange={e => handleSearchChange(e.target.value)}
            placeholder={isCSR ? 'Search by form...' : 'Search by CSR name, form...'}
            className="pl-10" />
        </div>
        <Select value={statusFilter} onValueChange={handleStatusChange}>
          <SelectTrigger className="w-[145px]"><SelectValue placeholder="All statuses" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="COMPLETED">Completed</SelectItem>
            <SelectItem value="DRAFT">Draft</SelectItem>
            <SelectItem value="DISPUTED">Disputed</SelectItem>
            <SelectItem value="RESOLVED">Resolved</SelectItem>
          </SelectContent>
        </Select>
        <button
          onClick={() => { setSearch(''); setStatusFilter('all') }}
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
            <p className="text-[13px] text-red-700 font-medium">Failed to load submissions.</p>
            <Button variant="outline" size="sm" onClick={() => refetch()}><RefreshCw className="h-4 w-4 mr-1" /> Retry</Button>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50 border-b border-slate-200">
                <TableHead>Status</TableHead>
                <TableHead>Form ID</TableHead>
                <TableHead>Form Name</TableHead>
                {isAdminOrQA && <TableHead>Reviewer</TableHead>}
                {!isCSR && <TableHead>CSR</TableHead>}
                <TableHead>Date</TableHead>
                <TableHead className="text-right">Score</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.items?.length ? (
                data.items.map((row: Submission) => (
                  <TableRow key={row.id} className="cursor-pointer hover:bg-slate-50/50"
                    onClick={() => navigate(`/app/quality/submissions/${row.id}`)}>
                    <TableCell>
                      <span className="flex items-center gap-1.5 text-[13px]">
                        <span className={cn('w-1.5 h-1.5 rounded-full shrink-0',
                          row.status === 'COMPLETED' ? 'bg-emerald-500' :
                          row.status === 'DISPUTED'  ? 'bg-amber-500'  :
                          row.status === 'RESOLVED'  ? 'bg-blue-500'   : 'bg-slate-400'
                        )} />
                        <span className="text-slate-600">{row.status.charAt(0) + row.status.slice(1).toLowerCase()}</span>
                      </span>
                    </TableCell>
                    <TableCell className="text-[13px] text-slate-500">{row.form_id ?? '—'}</TableCell>
                    <TableCell className="text-[13px] font-medium text-slate-900">{row.form_name}</TableCell>
                    {isAdminOrQA && <TableCell className="text-[13px] text-slate-600">{row.reviewer_name ?? '—'}</TableCell>}
                    {!isCSR && <TableCell className="text-[13px] text-slate-600">{row.csr_name}</TableCell>}
                    <TableCell className="text-[13px] text-slate-600">{fmtDate(row.created_at)}</TableCell>
                    <TableCell className="text-right text-[13px] font-medium">
                      {row.score != null && row.score > 0
                        ? <span className={scoreColor(row.score)}>{row.score.toFixed(1)}%</span>
                        : <span className="text-slate-400">—</span>
                      }
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="sm" className="h-7 px-2 text-[12px]"
                        onClick={e => { e.stopPropagation(); navigate(`/app/quality/submissions/${row.id}`) }}>
                        <Eye size={12} className="mr-1" /> View
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={isAdminOrQA ? 8 : isCSR ? 6 : 7} className="text-center py-12 text-slate-400">
                    <FileText className="h-8 w-8 mx-auto mb-2 text-slate-300" />
                    No submissions found.
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
