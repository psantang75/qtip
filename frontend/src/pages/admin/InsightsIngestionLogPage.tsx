import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import { api } from '@/services/authService'
import { Button } from '@/components/ui/button'
import { ListFilterBar } from '@/components/common/ListFilterBar'
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

export default function InsightsIngestionLogPage() {
  const [channelFilter, setChannelFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')

  const { data: logs = [], isLoading, refetch, dataUpdatedAt } = useQuery({
    queryKey: ['ie-ingestion-log', channelFilter, statusFilter],
    queryFn: async () => {
      const params = new URLSearchParams()
      if (channelFilter !== 'all') params.set('channel', channelFilter)
      if (statusFilter !== 'all') params.set('status', statusFilter)
      const response = await api.get(`/insights/admin/ingestion-log?${params}`)
      return response.data as UnifiedIngestionRow[]
    },
    refetchInterval: 30_000,
  })

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
            onChange: setChannelFilter,
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
            onChange: setStatusFilter,
            placeholder: 'All Status',
            options: [
              { value: 'all', label: 'All Status' },
              { value: 'SUCCESS', label: 'Success' },
              { value: 'FAILED', label: 'Failed' },
              { value: 'RUNNING', label: 'Running' },
              { value: 'PARTIAL', label: 'Partial' },
            ],
          },
        ]}
        hasFilters={channelFilter !== 'all' || statusFilter !== 'all'}
        onReset={() => { setChannelFilter('all'); setStatusFilter('all') }}
        resultCount={{ total: logs.length }}
      />

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
            ) : logs.length === 0 ? (
              <TableRow><TableCell colSpan={10} className="text-center py-12 text-muted-foreground">No ingestion logs found</TableCell></TableRow>
            ) : logs.map(l => (
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
    </div>
  )
}
