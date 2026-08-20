import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import { api } from '@/services/authService'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ListFilterBar } from '@/components/common/ListFilterBar'
import { ListPagination } from '@/components/common/ListPagination'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'

type Channel = 'sql' | 'email' | 'manual'

interface UnifiedIngestionRow {
  id: string
  channel: Channel
  name: string
  source: string
  started: string
  finished: string | null
  status: string
  rows_loaded: number | null
  rows_skipped: number | null
  rows_errored: number | null
  error_message: string | null
}

const STATUS_STYLES: Record<string, string> = {
  SUCCESS: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  FAILED:  'bg-red-50 text-red-700 border-red-200',
  RUNNING: 'bg-blue-50 text-blue-700 border-blue-200',
  PARTIAL: 'bg-amber-50 text-amber-700 border-amber-200',
}

const CHANNEL_LABELS: Record<Channel, string> = {
  sql: 'SQL',
  email: 'Email',
  manual: 'Manual',
}

const CHANNEL_STYLES: Record<Channel, string> = {
  sql:    'bg-violet-50 text-violet-700 border-violet-200',
  email:  'bg-sky-50 text-sky-700 border-sky-200',
  manual: 'bg-slate-50 text-slate-600 border-slate-200',
}

function ymd(d: Date) {
  return d.toISOString().slice(0, 10)
}

export default function InsightsIngestionLogPage() {
  // Default window: the last 7 days (by FINISHED time) so the log stays short.
  const defaults = useMemo(() => ({
    from: ymd(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)),
    to:   ymd(new Date()),
  }), [])

  const [channelFilter, setChannelFilter] = useState('all')
  const [statusFilter, setStatusFilter]   = useState('all')
  const [sourceFilter, setSourceFilter]   = useState('all')
  const [dateFrom, setDateFrom]           = useState(defaults.from)
  const [dateTo, setDateTo]               = useState(defaults.to)
  const [page, setPage]                   = useState(1)
  const [pageSize, setPageSize]           = useState(20)

  // Channel/status/date are applied server-side (they bound the fetch); the
  // date window keeps the payload small. Source + pagination are client-side.
  const { data: logs = [], isLoading, refetch, dataUpdatedAt } = useQuery({
    queryKey: ['ie-ingestion-log', channelFilter, statusFilter, dateFrom, dateTo],
    queryFn: async () => {
      const params = new URLSearchParams()
      if (channelFilter !== 'all') params.set('channel', channelFilter)
      if (statusFilter !== 'all') params.set('status', statusFilter)
      if (dateFrom) params.set('date_from', dateFrom)
      if (dateTo) params.set('date_to', dateTo)
      params.set('limit', '500')
      const response = await api.get(`/insights/admin/ingestion-log?${params}`)
      return response.data as UnifiedIngestionRow[]
    },
    refetchInterval: 30_000,
  })

  // Source options are derived from the current result set; the selection falls
  // back to "all" if a refetch (e.g. a new date window) drops that source.
  const sourceOptions = useMemo(
    () => Array.from(new Set(logs.map(l => l.source).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [logs],
  )
  const effectiveSource = sourceFilter !== 'all' && sourceOptions.includes(sourceFilter) ? sourceFilter : 'all'

  const displayed = useMemo(
    () => (effectiveSource === 'all' ? logs : logs.filter(l => l.source === effectiveSource)),
    [logs, effectiveSource],
  )

  const totalPages = Math.max(1, Math.ceil(displayed.length / pageSize))
  const safePage   = Math.min(page, totalPages)
  const pageRows   = displayed.slice((safePage - 1) * pageSize, safePage * pageSize)

  const isDefaultRange = dateFrom === defaults.from && dateTo === defaults.to
  const hasFilters = channelFilter !== 'all' || statusFilter !== 'all' || effectiveSource !== 'all' || !isDefaultRange

  function resetFilters() {
    setChannelFilter('all'); setStatusFilter('all'); setSourceFilter('all')
    setDateFrom(defaults.from); setDateTo(defaults.to); setPage(1)
  }

  function formatDate(d: string | null) {
    if (!d) return '—'
    return new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Ingestion Log</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Run history across every ingestion channel — SQL pipeline, email pickup, and manual upload</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-muted-foreground">
            Updated {dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString() : '—'}
          </span>
          <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => refetch()}>
            <RefreshCw size={13} /> Refresh
          </Button>
        </div>
      </div>

      <ListFilterBar
        selects={[
          {
            id: 'channel',
            value: channelFilter,
            onChange: v => { setChannelFilter(v); setPage(1) },
            placeholder: 'All Channels',
            width: 'w-[170px]',
            options: [
              { value: 'all', label: 'All Channels' },
              { value: 'sql', label: 'SQL pipeline' },
              { value: 'email', label: 'Email pickup' },
              { value: 'manual', label: 'Manual upload' },
            ],
          },
          {
            id: 'status',
            value: statusFilter,
            onChange: v => { setStatusFilter(v); setPage(1) },
            placeholder: 'All Status',
            options: [
              { value: 'all', label: 'All Status' },
              { value: 'SUCCESS', label: 'Success' },
              { value: 'FAILED', label: 'Failed' },
              { value: 'RUNNING', label: 'Running' },
              { value: 'PARTIAL', label: 'Partial' },
            ],
          },
          {
            id: 'source',
            value: effectiveSource,
            onChange: v => { setSourceFilter(v); setPage(1) },
            placeholder: 'All Sources',
            width: 'w-[200px]',
            options: [
              { value: 'all', label: 'All Sources' },
              ...sourceOptions.map(s => ({ value: s, label: s })),
            ],
          },
        ]}
        hasFilters={hasFilters}
        onReset={resetFilters}
        resultCount={{ filtered: displayed.length, total: logs.length }}
      >
        <div className="flex items-center gap-2">
          <span className="text-[12px] text-slate-500 whitespace-nowrap">Finished</span>
          <Input
            type="date"
            value={dateFrom}
            max={dateTo || undefined}
            onChange={e => { setDateFrom(e.target.value); setPage(1) }}
            className="h-9 w-[150px] text-[13px]"
          />
          <span className="text-slate-400 text-[12px]">to</span>
          <Input
            type="date"
            value={dateTo}
            min={dateFrom || undefined}
            onChange={e => { setDateTo(e.target.value); setPage(1) }}
            className="h-9 w-[150px] text-[13px]"
          />
        </div>
      </ListFilterBar>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-slate-50/60">
              <TableHead className="py-4">Channel</TableHead>
              <TableHead className="py-4">Name</TableHead>
              <TableHead className="py-4">Source</TableHead>
              <TableHead className="py-4">Started</TableHead>
              <TableHead className="py-4">Finished</TableHead>
              <TableHead className="py-4">Status</TableHead>
              <TableHead className="py-4">Loaded</TableHead>
              <TableHead className="py-4">Skipped</TableHead>
              <TableHead className="py-4">Errored</TableHead>
              <TableHead className="py-4">Details</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={10} className="text-center py-12 text-muted-foreground">Loading...</TableCell></TableRow>
            ) : displayed.length === 0 ? (
              <TableRow><TableCell colSpan={10} className="text-center py-12 text-muted-foreground">No ingestion logs found</TableCell></TableRow>
            ) : pageRows.map(l => (
              <TableRow key={l.id} className="hover:bg-slate-50/50">
                <TableCell>
                  <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold border ${CHANNEL_STYLES[l.channel] ?? 'bg-slate-50 text-slate-600'}`}>
                    {CHANNEL_LABELS[l.channel] ?? l.channel}
                  </span>
                </TableCell>
                <TableCell className="text-[13px] font-medium">{l.name}</TableCell>
                <TableCell className="text-[13px] text-slate-600 max-w-[180px] truncate">{l.source}</TableCell>
                <TableCell className="text-[13px] text-slate-600">{formatDate(l.started)}</TableCell>
                <TableCell className="text-[13px] text-slate-600">{formatDate(l.finished)}</TableCell>
                <TableCell>
                  <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold border ${STATUS_STYLES[l.status] ?? 'bg-slate-50 text-slate-600'}`}>
                    {l.status}
                  </span>
                </TableCell>
                <TableCell className="text-[13px] text-slate-600">{l.rows_loaded ?? '—'}</TableCell>
                <TableCell className="text-[13px] text-slate-600">{l.rows_skipped ?? '—'}</TableCell>
                <TableCell className="text-[13px] text-slate-600">{l.rows_errored ?? '—'}</TableCell>
                <TableCell className="text-[13px] text-slate-500 max-w-[240px] truncate" title={l.error_message ?? undefined}>{l.error_message ?? '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <ListPagination
        page={safePage}
        totalPages={totalPages}
        totalItems={displayed.length}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={s => { setPageSize(s); setPage(1) }}
      />
    </div>
  )
}
