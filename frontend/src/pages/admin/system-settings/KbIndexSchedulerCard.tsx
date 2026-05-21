import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { RefreshCcw, Database, Loader2, AlertCircle } from 'lucide-react'
import { api } from '@/services/authService'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'

/**
 * KB Index Scheduler admin card. Backed by
 * /api/admin/system-settings/kb-scheduler (admin-only). Reuses the
 * same shadcn primitives + section/card pattern as the other admin
 * pages so the System Settings hub fits the QTIP design language
 * without introducing new component variants.
 */

interface CrawlSummary {
  pages_total: number
  pages_new: number
  pages_updated: number
  pages_unchanged: number
  pages_skipped: number
  pages_errored: number
  approx_cost_usd: number
  elapsed_ms: number
}

interface KbIndexRunRecord extends CrawlSummary {
  ran_at: string
  triggered_by: 'scheduler' | 'manual' | 'boot'
}

interface KbIndexSettings {
  interval_min: number
  last_run: KbIndexRunRecord | null
  recent_runs: KbIndexRunRecord[]
}

const MIN_INTERVAL = 5
const MAX_INTERVAL = 1440

function formatDate(iso: string | null | undefined) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function formatRelative(iso: string | null | undefined) {
  if (!iso) return 'never'
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return `${Math.floor(diff / 86_400_000)}d ago`
}

function formatDuration(ms: number) {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`
}

export default function KbIndexSchedulerCard() {
  const queryClient = useQueryClient()
  const [intervalDraft, setIntervalDraft] = useState<string>('')

  const { data, isLoading, error, refetch, dataUpdatedAt } = useQuery({
    queryKey: ['kb-scheduler-settings'],
    queryFn: async () => {
      const res = await api.get('/admin/system-settings/kb-scheduler')
      return res.data as KbIndexSettings
    },
    refetchInterval: 30_000,
  })

  useEffect(() => {
    if (data?.interval_min != null && intervalDraft === '') {
      setIntervalDraft(String(data.interval_min))
    }
  }, [data, intervalDraft])

  const intervalMutation = useMutation({
    mutationFn: async (interval_min: number) => {
      const res = await api.patch('/admin/system-settings/kb-scheduler', { interval_min })
      return res.data as { interval_min: number }
    },
    onSuccess: (res) => {
      setIntervalDraft(String(res.interval_min))
      queryClient.invalidateQueries({ queryKey: ['kb-scheduler-settings'] })
    },
  })

  const runNowMutation = useMutation({
    mutationFn: async () => {
      const res = await api.post('/admin/system-settings/kb-scheduler/run-now')
      return res.data as { started_at: string }
    },
    onSuccess: () => {
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['kb-scheduler-settings'] })
      }, 5000)
    },
  })

  const intervalIsDirty =
    intervalDraft !== '' && data && Number(intervalDraft) !== data.interval_min
  const intervalIsValid =
    intervalDraft !== '' &&
    Number.isFinite(Number(intervalDraft)) &&
    Number(intervalDraft) >= MIN_INTERVAL &&
    Number(intervalDraft) <= MAX_INTERVAL

  const lastRun = data?.last_run ?? null
  const recentRuns = data?.recent_runs ?? []

  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <header className="flex items-center justify-between gap-3 px-5 py-4 border-b border-slate-200">
        <div className="flex items-center gap-2.5">
          <Database size={18} className="text-primary" />
          <div>
            <h2 className="text-base font-semibold text-slate-900">KB Index Scheduler</h2>
            <p className="text-[12px] text-muted-foreground mt-0.5">
              Background BookStack crawl that refreshes the AI Reviewer's KB embeddings and parsed Approach structure.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-muted-foreground">
            Updated {dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString() : '—'}
          </span>
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5"
            onClick={() => refetch()}
            disabled={isLoading}
          >
            <RefreshCcw size={13} />
            Refresh
          </Button>
        </div>
      </header>

      {error ? (
        <div className="px-5 py-6 flex items-center gap-2 text-destructive">
          <AlertCircle size={16} />
          <span className="text-sm">Failed to load settings: {(error as Error).message}</span>
        </div>
      ) : isLoading || !data ? (
        <div className="px-5 py-12 text-center text-muted-foreground text-sm">Loading...</div>
      ) : (
        <div className="divide-y divide-slate-200">
          <div className="px-5 py-4 grid grid-cols-1 md:grid-cols-[1fr_auto] gap-4 items-end">
            <div className="space-y-1.5">
              <Label htmlFor="kb-interval" className="text-[13px] font-medium text-slate-700">
                Tick interval (minutes)
              </Label>
              <div className="flex items-center gap-3">
                <Input
                  id="kb-interval"
                  type="number"
                  min={MIN_INTERVAL}
                  max={MAX_INTERVAL}
                  step={5}
                  className="w-[140px]"
                  value={intervalDraft}
                  onChange={(e) => setIntervalDraft(e.target.value)}
                />
                <span className="text-[12px] text-muted-foreground">
                  Range {MIN_INTERVAL}-{MAX_INTERVAL}. Changes take effect on the next tick.
                </span>
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-9"
                disabled={!intervalIsDirty || !intervalIsValid || intervalMutation.isPending}
                onClick={() => intervalMutation.mutate(Number(intervalDraft))}
              >
                {intervalMutation.isPending ? <Loader2 size={14} className="animate-spin mr-1.5" /> : null}
                Save interval
              </Button>
              <Button
                size="sm"
                className="h-9 gap-1.5"
                disabled={runNowMutation.isPending}
                onClick={() => runNowMutation.mutate()}
              >
                {runNowMutation.isPending ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <RefreshCcw size={14} />
                )}
                Run now
              </Button>
            </div>
          </div>

          {runNowMutation.isSuccess && (
            <div className="px-5 py-2.5 bg-blue-50 border-y border-blue-100 text-[12px] text-blue-800">
              Crawl started at {formatDate(runNowMutation.data.started_at)} — refresh in a minute to see the result.
            </div>
          )}
          {intervalMutation.isError && (
            <div className="px-5 py-2.5 bg-red-50 border-y border-red-100 text-[12px] text-red-800">
              Failed to save interval: {(intervalMutation.error as Error)?.message ?? 'unknown error'}
            </div>
          )}

          <div className="px-5 py-4">
            <h3 className="text-[12px] font-semibold tracking-wide uppercase text-slate-500 mb-3">
              Last run
            </h3>
            {lastRun ? (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Stat label="Ran" value={formatRelative(lastRun.ran_at)} sub={formatDate(lastRun.ran_at)} />
                <Stat label="Pages total" value={String(lastRun.pages_total)} />
                <Stat label="New / Updated" value={`${lastRun.pages_new} / ${lastRun.pages_updated}`} />
                <Stat label="Unchanged" value={String(lastRun.pages_unchanged)} />
                <Stat label="Skipped" value={String(lastRun.pages_skipped)} />
                <Stat
                  label="Errored"
                  value={String(lastRun.pages_errored)}
                  variant={lastRun.pages_errored > 0 ? 'warn' : 'default'}
                />
                <Stat label="Approx cost" value={`$${lastRun.approx_cost_usd.toFixed(4)}`} />
                <Stat label="Elapsed" value={formatDuration(lastRun.elapsed_ms)} sub={`trigger: ${lastRun.triggered_by}`} />
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">No runs recorded yet.</div>
            )}
          </div>

          <div className="px-5 py-4">
            <h3 className="text-[12px] font-semibold tracking-wide uppercase text-slate-500 mb-3">
              Recent runs ({recentRuns.length})
            </h3>
            {recentRuns.length === 0 ? (
              <div className="text-sm text-muted-foreground">No history yet.</div>
            ) : (
              <div className="rounded-md border border-slate-200 overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50/60">
                      <TableHead className="py-3">Ran at</TableHead>
                      <TableHead className="py-3">Trigger</TableHead>
                      <TableHead className="py-3 text-right">Total</TableHead>
                      <TableHead className="py-3 text-right">New</TableHead>
                      <TableHead className="py-3 text-right">Updated</TableHead>
                      <TableHead className="py-3 text-right">Unchanged</TableHead>
                      <TableHead className="py-3 text-right">Skipped</TableHead>
                      <TableHead className="py-3 text-right">Errored</TableHead>
                      <TableHead className="py-3 text-right">Cost</TableHead>
                      <TableHead className="py-3 text-right">Elapsed</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {recentRuns.slice(0, 10).map((r) => (
                      <TableRow key={r.ran_at} className="hover:bg-slate-50/50">
                        <TableCell className="text-[13px] text-slate-700">{formatDate(r.ran_at)}</TableCell>
                        <TableCell className="text-[13px] text-slate-600 capitalize">{r.triggered_by}</TableCell>
                        <TableCell className="text-[13px] text-slate-700 text-right">{r.pages_total}</TableCell>
                        <TableCell className="text-[13px] text-slate-700 text-right">{r.pages_new}</TableCell>
                        <TableCell className="text-[13px] text-slate-700 text-right">{r.pages_updated}</TableCell>
                        <TableCell className="text-[13px] text-slate-500 text-right">{r.pages_unchanged}</TableCell>
                        <TableCell className="text-[13px] text-slate-500 text-right">{r.pages_skipped}</TableCell>
                        <TableCell
                          className={`text-[13px] text-right ${r.pages_errored > 0 ? 'text-amber-700 font-semibold' : 'text-slate-500'}`}
                        >
                          {r.pages_errored}
                        </TableCell>
                        <TableCell className="text-[13px] text-slate-700 text-right">${r.approx_cost_usd.toFixed(4)}</TableCell>
                        <TableCell className="text-[13px] text-slate-700 text-right">{formatDuration(r.elapsed_ms)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  )
}

function Stat({
  label,
  value,
  sub,
  variant = 'default',
}: {
  label: string
  value: string
  sub?: string
  variant?: 'default' | 'warn'
}) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-slate-400">{label}</div>
      <div
        className={`text-[15px] font-semibold mt-0.5 ${
          variant === 'warn' ? 'text-amber-700' : 'text-slate-900'
        }`}
      >
        {value}
      </div>
      {sub ? <div className="text-[11px] text-muted-foreground mt-0.5">{sub}</div> : null}
    </div>
  )
}
