import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Search, ChevronLeft, ChevronRight, FileText, RefreshCw, Eye } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import qaService, { scoreColor, type DisputeHistoryItem } from '@/services/qaService'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'

const PAGE_SIZE = 20

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

function StatusDot({ status }: { status: string }) {
  const map: Record<string, { dot: string; label: string }> = {
    OPEN:     { dot: 'bg-amber-500',   label: 'Open'     },
    UPHELD:   { dot: 'bg-emerald-500', label: 'Upheld'   },
    REJECTED: { dot: 'bg-red-500',     label: 'Rejected' },
    ADJUSTED: { dot: 'bg-blue-500',    label: 'Adjusted' },
    RESOLVED: { dot: 'bg-emerald-500', label: 'Resolved' },
  }
  const cfg = map[status?.toUpperCase()] ?? { dot: 'bg-slate-400', label: status ?? '—' }
  return (
    <span className="flex items-center gap-1.5 text-[13px]">
      <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', cfg.dot)} />
      <span className="text-slate-600">{cfg.label}</span>
    </span>
  )
}

export default function DisputeHistoryPage() {
  const { user } = useAuth()
  const navigate  = useNavigate()
  const [page, setPage]           = useState(1)
  const [search, setSearch]       = useState('')
  const [statusFilter, setStatus] = useState('all')

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['csr-dispute-history', page, search, statusFilter],
    queryFn: () => qaService.getCSRDisputeHistory({
      page,
      limit:  PAGE_SIZE,
      status: statusFilter !== 'all' ? statusFilter : undefined,
    }),
    enabled: !!user,
    placeholderData: (prev: any) => prev,
  })

  const hasFilters  = search !== '' || statusFilter !== 'all'
  const totalPages  = data?.totalPages ?? 1

  // Client-side search filter (dispute history endpoint doesn't expose a search param)
  const items: DisputeHistoryItem[] = (data?.items ?? []).filter((d: DisputeHistoryItem) => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      String(d.dispute_id).includes(q) ||
      String(d.audit_id).includes(q)   ||
      d.form_name?.toLowerCase().includes(q)
    )
  })

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Dispute History</h1>
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
            placeholder="Search by dispute ID, review ID, or form…" className="pl-10" />
        </div>
        <Select value={statusFilter} onValueChange={v => { setStatus(v); setPage(1) }}>
          <SelectTrigger className="w-[160px]"><SelectValue placeholder="All statuses" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="OPEN">Open</SelectItem>
            <SelectItem value="UPHELD">Upheld</SelectItem>
            <SelectItem value="REJECTED">Rejected</SelectItem>
            <SelectItem value="ADJUSTED">Adjusted</SelectItem>
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
            <p className="text-[13px] text-red-700 font-medium">Failed to load dispute history.</p>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4 mr-1" /> Retry
            </Button>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50 border-b border-slate-200">
                <TableHead>Status</TableHead>
                <TableHead>Dispute ID</TableHead>
                <TableHead>Review ID</TableHead>
                <TableHead>Form Name</TableHead>
                <TableHead className="text-right">Score</TableHead>
                <TableHead className="text-right">Prev Score</TableHead>
                <TableHead>Date</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.length ? (
                items.map((d: DisputeHistoryItem) => (
                  <TableRow key={d.dispute_id} className="hover:bg-slate-50/50">
                    <TableCell><StatusDot status={d.status} /></TableCell>
                    <TableCell className="text-[13px] text-slate-500">#{d.dispute_id}</TableCell>
                    <TableCell>
                      <button
                        className="text-[13px] font-medium text-[#00aeef] hover:underline"
                        onClick={() => navigate(`/app/quality/submissions/${d.audit_id}`)}
                      >
                        #{d.audit_id}
                      </button>
                    </TableCell>
                    <TableCell className="text-[13px] font-medium text-slate-900">{d.form_name}</TableCell>
                    <TableCell className="text-right text-[13px] font-medium">
                      {d.score != null && d.score > 0
                        ? <span className={scoreColor(d.score)}>{d.score.toFixed(1)}%</span>
                        : <span className="text-slate-400">—</span>
                      }
                    </TableCell>
                    <TableCell className="text-right text-[13px]">
                      {d.previous_score != null
                        ? <span className="text-slate-500">{d.previous_score.toFixed(1)}%</span>
                        : <span className="text-slate-400">—</span>
                      }
                    </TableCell>
                    <TableCell className="text-[13px] text-slate-600">{fmtDate(d.created_at)}</TableCell>
                    <TableCell>
                      <Button variant="ghost" size="sm" className="h-7 px-2 text-[12px]"
                        onClick={() => navigate(`/app/quality/submissions/${d.audit_id}`)}>
                        <Eye size={12} className="mr-1" /> View
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-12 text-slate-400">
                    <FileText className="h-8 w-8 mx-auto mb-2 text-slate-300" />
                    {search || statusFilter !== 'all'
                      ? 'No disputes match your filters.'
                      : 'You have no dispute history yet.'}
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
