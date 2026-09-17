/**
 * One sentence about the Cycle Performance load, only when it is in flight
 * or something actually went wrong. There is no per-input Run now here —
 * the dispatcher owns the schedule.
 */
import { AlertTriangle, RefreshCw } from 'lucide-react'
import type { CycleDependencyFreshness } from '@/types/collections'
import { summariseFreshness } from './cycleFreshness'

export function DependencyFreshnessNote({
  items,
  loading = false,
}: {
  items: CycleDependencyFreshness[]
  loading?: boolean
}) {
  const { show, loading: inFlight, lines } = summariseFreshness(items, Date.now(), loading)
  if (!show) return null

  return (
    <div className="mt-3 flex items-start gap-2 rounded-xl border border-slate-200 bg-white p-3">
      {inFlight
        ? <RefreshCw className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-primary" aria-hidden />
        : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />}
      <div className="min-w-0 flex-1 text-[12px] text-slate-600">
        <p className="text-[12.5px] font-semibold text-neutral-900">
          {inFlight
            ? 'Cycle Performance Is Loading'
            : 'The Last Automatic Load Did Not Finish Cleanly'}
        </p>
        <p className="mt-0.5">
          {inFlight
            ? 'This is one job — tasks, invoices, gateway results, touches, then payments. It runs on its own at :20 and :50 past the hour. Leave it; the page will catch up.'
            : 'The five inputs load together on that same schedule. A missing stamp is not missing data; a failed or switched-off step is.'}
        </p>
        <ul className="mt-1.5 space-y-0.5">
          {lines.map(l => (
            <li key={l.code} className={l.isProblem ? 'text-warning' : undefined}>
              <span className="text-[10px] uppercase tracking-wide text-slate-500">
                {l.label}
              </span>
              {' — '}
              {l.state}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
