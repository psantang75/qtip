import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { RefreshCw, Play, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  getMonitoringHealth, runMonitoringNow, type DatasetHealthRow, type DatasetHealthStatus,
} from '@/services/insightsService'

// Health badges use the QTIP brand tokens (not the ingestion-log page's raw
// emerald/amber) per .cursor/rules/ui-design.mdc.
const STATUS_STYLES: Record<DatasetHealthStatus, string> = {
  OK:      'bg-success/10 text-success border-success/30',
  WARN:    'bg-warning/10 text-warning border-warning/30',
  RED:     'bg-destructive/10 text-destructive border-destructive/30',
  UNKNOWN: 'bg-slate-50 text-slate-500 border-slate-200',
}

const STATUS_LABEL: Record<DatasetHealthStatus, string> = {
  OK: 'Healthy', WARN: 'Warning', RED: 'Failing', UNKNOWN: 'Pending',
}

// RED first, then WARN, so the datasets that need attention sort to the top.
const SEVERITY: Record<DatasetHealthStatus, number> = { RED: 0, WARN: 1, UNKNOWN: 2, OK: 3 }

function formatDate(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export default function InsightsMonitoringPage() {
  const [running, setRunning] = useState(false)

  const { data: rows = [], isLoading, refetch, dataUpdatedAt } = useQuery({
    queryKey: ['insights', 'monitoring', 'health'],
    queryFn: getMonitoringHealth,
    refetchInterval: 30_000,
  })

  const sorted = useMemo(
    () => [...rows].sort((a, b) => SEVERITY[a.status] - SEVERITY[b.status] || a.displayName.localeCompare(b.displayName)),
    [rows],
  )

  const counts = useMemo(() => {
    const c = { OK: 0, WARN: 0, RED: 0, UNKNOWN: 0 } as Record<DatasetHealthStatus, number>
    rows.forEach(r => { c[r.status] += 1 })
    return c
  }, [rows])

  async function handleRunNow() {
    setRunning(true)
    try {
      await runMonitoringNow()
      // The evaluation runs async on the server; give it a beat then refetch.
      await new Promise(r => setTimeout(r, 1500))
      await refetch()
    } finally {
      setRunning(false)
    }
  }

  function volume(r: DatasetHealthRow) {
    if (r.lastRowCount == null) return '—'
    if (r.baselineCount == null) return String(r.lastRowCount)
    return `${r.lastRowCount} / ~${r.baselineCount}`
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Monitoring</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Active health of every ingestion dataset — freshness and volume anomalies, evaluated each cycle</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-muted-foreground">
            Updated {dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString() : '—'}
          </span>
          <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => refetch()}>
            <RefreshCw size={13} /> Refresh
          </Button>
          <Button size="sm" className="h-8 gap-1.5 bg-primary hover:bg-primary/90 text-white" onClick={handleRunNow} disabled={running}>
            <Play size={13} /> {running ? 'Checking…' : 'Run check now'}
          </Button>
        </div>
      </div>

      {/* Summary tiles */}
      <div className="grid grid-cols-4 gap-3">
        {([
          ['RED', 'Failing'], ['WARN', 'Warning'], ['OK', 'Healthy'], ['UNKNOWN', 'Pending'],
        ] as [DatasetHealthStatus, string][]).map(([key, label]) => (
          <div key={key} className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
            <div className="mt-1 flex items-center gap-2">
              <span className={`inline-block h-2.5 w-2.5 rounded-full ${key === 'RED' ? 'bg-destructive' : key === 'WARN' ? 'bg-warning' : key === 'OK' ? 'bg-success' : 'bg-slate-300'}`} />
              <span className="text-2xl font-bold text-slate-900">{counts[key]}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-slate-50/60">
              <TableHead className="py-4">Dataset</TableHead>
              <TableHead className="py-4">Status</TableHead>
              <TableHead className="py-4">Reason</TableHead>
              <TableHead className="py-4">Last updated</TableHead>
              <TableHead className="py-4">Expected by</TableHead>
              <TableHead className="py-4">Last / baseline</TableHead>
              <TableHead className="py-4">Log</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={7} className="text-center py-12 text-muted-foreground">Loading…</TableCell></TableRow>
            ) : sorted.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="text-center py-12 text-muted-foreground">No monitored datasets</TableCell></TableRow>
            ) : sorted.map(r => (
              <TableRow key={r.datasetCode} className="hover:bg-slate-50/50">
                <TableCell className="text-[13px] font-medium">
                  {r.displayName}
                  <span className="block text-[11px] text-slate-400">{r.producerKind.replace('_', ' ')}</span>
                </TableCell>
                <TableCell>
                  <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold border ${STATUS_STYLES[r.status]}`}>
                    {STATUS_LABEL[r.status]}
                  </span>
                </TableCell>
                <TableCell className="text-[13px] text-slate-600 max-w-[320px] truncate" title={r.reason}>{r.reason}</TableCell>
                <TableCell className="text-[13px] text-slate-600">{formatDate(r.lastSuccessAt)}</TableCell>
                <TableCell className="text-[13px] text-slate-600">{formatDate(r.expectedBy)}</TableCell>
                <TableCell className="text-[13px] text-slate-600">{volume(r)}</TableCell>
                <TableCell>
                  <Link to="/app/admin/insights/ingestion" className="inline-flex items-center gap-1 text-[12px] text-primary hover:underline">
                    View <ExternalLink size={12} />
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
