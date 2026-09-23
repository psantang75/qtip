/**
 * Admin → Insights → AI Spend. What every LLM feature cost, by job and by day.
 *
 * Exists because spend used to be invisible outside the AI Reviewer's budget
 * gauge: a background miner firing on every deploy went unnoticed for a week.
 * Figures are upper bounds — see the note rendered on the page.
 */
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Info, RefreshCw } from 'lucide-react'
import { api } from '@/services/authService'
import { Button } from '@/components/ui/button'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'

interface AiSpendRow {
  day: string
  purpose: string
  model: string
  calls: number
  failedCalls: number
  tokensIn: number
  tokensOut: number
  estimatedUsd: number
}

interface AiSpendTotal {
  purpose: string
  calls: number
  estimatedUsd: number
  /** Exact charge, for the jobs that record one. */
  recordedUsd: number | null
}

interface AiSpendRollup {
  windowDays: number
  totalEstimatedUsd: number
  totalRecordedUsd: number | null
  totalCalls: number
  byPurpose: AiSpendTotal[]
  rows: AiSpendRow[]
}

const WINDOWS = [
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
]

/** Job names are machine-readable in the log; make the common ones legible. */
const PURPOSE_LABELS: Record<string, string> = {
  'insights.missed_opportunities': 'Missed Opportunities review',
  'insights.sales_plays_miner': 'Sales plays miner',
  'insights.sales_plays_librarian': 'Sales plays librarian',
}

function purposeLabel(purpose: string): string {
  if (PURPOSE_LABELS[purpose]) return PURPOSE_LABELS[purpose]
  if (purpose.startsWith('ai_reviewer.')) {
    return `AI Reviewer — ${purpose.slice('ai_reviewer.'.length).replace(/\./g, ' ')}`
  }
  return purpose
}

const usd = (n: number) => `$${n.toFixed(n < 1 ? 4 : 2)}`
const num = (n: number) => n.toLocaleString()

export default function InsightsAiSpendPage() {
  const [days, setDays] = useState('30')

  const { data, isLoading, isFetching, refetch } = useQuery<AiSpendRollup>({
    queryKey: ['insights', 'admin', 'ai-spend', days],
    queryFn: async () => (await api.get(`/insights/admin/ai-spend?days=${days}`)).data,
  })

  const topJob = data?.byPurpose[0]

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">AI Spend</h1>
          <p className="text-[13px] text-slate-500">
            Every LLM call the platform made, costed by job. Includes background workers, so a
            scheduled run can never spend unnoticed.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={days} onValueChange={setDays}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WINDOWS.map((w) => (
                <SelectItem key={w.value} value={w.value}>{w.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`mr-1 h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      <div className="flex items-start gap-2 rounded-xl border border-slate-200 bg-surface px-4 py-3">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
        <p className="text-[12.5px] text-slate-600">
          Estimates are upper bounds. The call log records a call’s total input tokens but not how
          many were prompt-cache reads, which bill at a tenth of the input rate — so a heavily
          cached job reads several times higher than it really costs. Where a job banks its own
          exact charge, the <span className="font-medium">Recorded</span> figure is the one to
          trust.
        </p>
      </div>

      {isLoading || !data ? (
        <p className="py-8 text-center text-sm text-slate-400">Loading AI spend…</p>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                Estimated spend
              </p>
              <p className="mt-1 text-2xl font-bold text-slate-900">{usd(data.totalEstimatedUsd)}</p>
              <p className="text-[11px] text-slate-400">
                ceiling over the last {data.windowDays} days
                {data.totalRecordedUsd !== null && ` · ${usd(data.totalRecordedUsd)} recorded exactly`}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                Calls
              </p>
              <p className="mt-1 text-2xl font-bold text-slate-900">{num(data.totalCalls)}</p>
              <p className="text-[11px] text-slate-400">across every AI feature</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                Biggest spender
              </p>
              <p className="mt-1 text-[15px] font-semibold text-slate-900">
                {topJob ? purposeLabel(topJob.purpose) : '—'}
              </p>
              <p className="text-[11px] text-slate-400">
                {topJob
                  ? `${usd(topJob.recordedUsd ?? topJob.estimatedUsd)} over ${num(topJob.calls)} call(s)`
                  : 'No calls in this window'}
              </p>
            </div>
          </div>

          <section className="rounded-xl border border-slate-200 bg-white">
            <div className="border-b border-slate-100 px-4 py-3">
              <h2 className="text-[14px] font-semibold text-slate-900">By job</h2>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Job</TableHead>
                  <TableHead className="text-right">Calls</TableHead>
                  <TableHead className="text-right">Estimated ceiling</TableHead>
                  <TableHead className="text-right">Recorded</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.byPurpose.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-sm text-slate-400">
                      No AI calls in this window.
                    </TableCell>
                  </TableRow>
                ) : data.byPurpose.map((p) => (
                  <TableRow key={p.purpose}>
                    <TableCell className="font-medium text-slate-800">{purposeLabel(p.purpose)}</TableCell>
                    <TableCell className="text-right">{num(p.calls)}</TableCell>
                    <TableCell className="text-right text-slate-500">{usd(p.estimatedUsd)}</TableCell>
                    <TableCell className="text-right font-medium">
                      {p.recordedUsd === null
                        ? <span className="text-slate-400">—</span>
                        : usd(p.recordedUsd)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white">
            <div className="border-b border-slate-100 px-4 py-3">
              <h2 className="text-[14px] font-semibold text-slate-900">By day</h2>
              <p className="text-[12px] text-slate-500">Newest first, in Eastern business days.</p>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Job</TableHead>
                  <TableHead>Model</TableHead>
                  <TableHead className="text-right">Calls</TableHead>
                  <TableHead className="text-right">Failed</TableHead>
                  <TableHead className="text-right">Tokens in</TableHead>
                  <TableHead className="text-right">Tokens out</TableHead>
                  <TableHead className="text-right">Estimated cost</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-sm text-slate-400">
                      No AI calls in this window.
                    </TableCell>
                  </TableRow>
                ) : data.rows.map((r) => (
                  <TableRow key={`${r.day}|${r.purpose}|${r.model}`}>
                    <TableCell className="whitespace-nowrap">{r.day}</TableCell>
                    <TableCell className="text-slate-800">{purposeLabel(r.purpose)}</TableCell>
                    <TableCell className="text-[12px] text-slate-500">{r.model}</TableCell>
                    <TableCell className="text-right">{num(r.calls)}</TableCell>
                    <TableCell className={`text-right ${r.failedCalls > 0 ? 'text-destructive' : 'text-slate-400'}`}>
                      {r.failedCalls > 0 ? num(r.failedCalls) : '—'}
                    </TableCell>
                    <TableCell className="text-right text-slate-500">{num(r.tokensIn)}</TableCell>
                    <TableCell className="text-right text-slate-500">{num(r.tokensOut)}</TableCell>
                    <TableCell className="text-right font-medium">{usd(r.estimatedUsd)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </section>
        </>
      )}
    </div>
  )
}
