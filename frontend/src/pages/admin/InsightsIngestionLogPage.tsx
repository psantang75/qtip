import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import { api } from '@/services/authService'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'

interface IngestionLogEntry {
  id: number
  worker_name: string
  source_system: string
  run_started_at: string
  run_finished_at: string | null
  status: string
  rows_extracted: number | null
  rows_loaded: number | null
  rows_skipped: number | null
  rows_errored: number | null
  error_message: string | null
  batch_identifier: string | null
}

const STATUS_STYLES: Record<string, string> = {
  SUCCESS: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  FAILED:  'bg-red-50 text-red-700 border-red-200',
  RUNNING: 'bg-blue-50 text-blue-700 border-blue-200',
  PARTIAL: 'bg-amber-50 text-amber-700 border-amber-200',
}

export default function InsightsIngestionLogPage() {
  const [workerFilter, setWorkerFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')

  const { data: logs = [], isLoading, refetch, dataUpdatedAt } = useQuery({
    queryKey: ['ie-ingestion-log', workerFilter, statusFilter],
    queryFn: async () => {
      const params = new URLSearchParams()
      if (workerFilter !== 'all') params.set('worker', workerFilter)
      if (statusFilter !== 'all') params.set('status', statusFilter)
      const response = await api.get(`/insights/admin/ingestion-log?${params}`)
      return response.data as IngestionLogEntry[]
    },
    refetchInterval: 30_000,
  })

  const workers = [...new Set(logs.map(l => l.worker_name))].sort()

  function formatDate(d: string | null) {
    if (!d) return '—'
    return new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Ingestion Log</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Pipeline run history for Insights Engine workers</p>
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

      <div className="bg-white rounded-xl border border-slate-200 p-4 flex flex-wrap gap-3">
        <Select value={workerFilter} onValueChange={setWorkerFilter}>
          <SelectTrigger className="w-[200px]"><SelectValue placeholder="All Workers" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Workers</SelectItem>
            {workers.map(w => <SelectItem key={w} value={w}>{w}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[145px]"><SelectValue placeholder="All Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="SUCCESS">Success</SelectItem>
            <SelectItem value="FAILED">Failed</SelectItem>
            <SelectItem value="RUNNING">Running</SelectItem>
            <SelectItem value="PARTIAL">Partial</SelectItem>
          </SelectContent>
        </Select>
        <button
          onClick={() => { setWorkerFilter('all'); setStatusFilter('all') }}
          disabled={workerFilter === 'all' && statusFilter === 'all'}
          className="ml-auto text-[12px] font-medium text-primary hover:underline disabled:opacity-30 disabled:cursor-not-allowed"
        >Reset Filters</button>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-slate-50/60">
              <TableHead className="py-4">Worker</TableHead>
              <TableHead className="py-4">Source</TableHead>
              <TableHead className="py-4">Started</TableHead>
              <TableHead className="py-4">Finished</TableHead>
              <TableHead className="py-4">Status</TableHead>
              <TableHead className="py-4">Extracted</TableHead>
              <TableHead className="py-4">Loaded</TableHead>
              <TableHead className="py-4">Skipped</TableHead>
              <TableHead className="py-4">Errored</TableHead>
              <TableHead className="py-4">Batch</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={10} className="text-center py-12 text-muted-foreground">Loading...</TableCell></TableRow>
            ) : logs.length === 0 ? (
              <TableRow><TableCell colSpan={10} className="text-center py-12 text-muted-foreground">No ingestion logs found</TableCell></TableRow>
            ) : logs.map(l => (
              <TableRow key={l.id} className="hover:bg-slate-50/50">
                <TableCell className="text-[13px] font-medium">{l.worker_name}</TableCell>
                <TableCell className="text-[13px] text-slate-600">{l.source_system}</TableCell>
                <TableCell className="text-[13px] text-slate-600">{formatDate(l.run_started_at)}</TableCell>
                <TableCell className="text-[13px] text-slate-600">{formatDate(l.run_finished_at)}</TableCell>
                <TableCell>
                  <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold border ${STATUS_STYLES[l.status] ?? 'bg-slate-50 text-slate-600'}`}>
                    {l.status}
                  </span>
                </TableCell>
                <TableCell className="text-[13px] text-slate-600">{l.rows_extracted ?? '—'}</TableCell>
                <TableCell className="text-[13px] text-slate-600">{l.rows_loaded ?? '—'}</TableCell>
                <TableCell className="text-[13px] text-slate-600">{l.rows_skipped ?? '—'}</TableCell>
                <TableCell className="text-[13px] text-slate-600">{l.rows_errored ?? '—'}</TableCell>
                <TableCell className="text-[13px] text-slate-500 max-w-[200px] truncate">{l.batch_identifier ?? '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
