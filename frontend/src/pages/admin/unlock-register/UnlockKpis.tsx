import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import type { UnlockStats } from '@/services/unlockService'

/**
 * Register KPI strip. Raw reopen volume on its own says nothing — the tiles
 * that matter are the rate against finalized reviews, the average score
 * movement (a reopen that never changes a score is not a correction), and
 * the three abuse signals: still open, auto-re-locked, out-of-window.
 */

interface Tile {
  label: string
  value: string
  description: string
  basis: string
  warn?: boolean
}

function fmtDelta(n: number | null): string {
  if (n == null) return '—'
  return `${n > 0 ? '+' : ''}${n.toFixed(1)} pts`
}

function buildTiles(stats: UnlockStats): Tile[] {
  return [
    {
      label: 'Total reopens',
      value: String(stats.total),
      description: 'Reviews and dispute decisions an admin reopened in the selected range.',
      basis: `${stats.closed} corrected, ${stats.open} still open, ${stats.auto_relocked} auto re-locked`,
    },
    {
      label: 'Per 100 finalized',
      value: stats.per_hundred_finalized == null ? '—' : stats.per_hundred_finalized.toFixed(1),
      description:
        'Reopens as a share of finalized reviews. This is the number to trend — raw volume rises with headcount, this does not.',
      basis: `${stats.total} reopens over ${stats.finalized_in_range} finalized reviews`,
    },
    {
      label: 'Avg score change',
      value: fmtDelta(stats.avg_score_delta),
      description:
        'Average movement between the withdrawn score and the corrected one. Near zero across many reopens means the reopens are not fixing scoring errors.',
      basis: `Across ${stats.closed} reopens that were corrected and re-scored`,
    },
    {
      label: 'Still open',
      value: String(stats.open),
      description: 'Reopened records nobody has corrected yet. Their scores are currently withdrawn.',
      basis: 'Auto-restored once each record passes its re-lock deadline',
      warn: stats.open > 0,
    },
    {
      label: 'Auto re-locked',
      value: String(stats.auto_relocked),
      description:
        'Reopened and then abandoned — the system restored the original score. A reopen nobody acted on is itself a signal.',
      basis: `${stats.auto_relocked} of ${stats.total} reopens in range`,
      warn: stats.auto_relocked > 0,
    },
    {
      label: 'Out of window',
      value: String(stats.beyond_window),
      description:
        'Break-glass reopens of records older than the configured window. These restate numbers that were already reported.',
      basis: `${stats.beyond_window} of ${stats.total} reopens in range`,
      warn: stats.beyond_window > 0,
    },
    {
      label: 'Self-service',
      value: String(stats.self_service),
      description:
        'The admin who reopened the record is also the person expected to fix it. Allowed on a small team, but worth watching.',
      basis: `${stats.self_service} of ${stats.total} reopens in range`,
      warn: stats.self_service > 0,
    },
  ]
}

export function UnlockKpis({ stats }: { stats: UnlockStats }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
      {buildTiles(stats).map((tile) => (
        <TooltipProvider key={tile.label} delayDuration={200}>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="bg-white border border-slate-200 rounded-xl p-4 cursor-default">
                <div className="text-xs font-medium text-slate-600 leading-tight truncate">{tile.label}</div>
                <div
                  className={`text-2xl font-bold leading-none mt-1.5 ${
                    tile.warn ? 'text-amber-700' : 'text-slate-900'
                  }`}
                >
                  {tile.value}
                </div>
              </div>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="rounded-xl border border-slate-200 bg-white p-3 shadow-lg max-w-[280px]">
              <p className="text-[13px] font-semibold text-slate-900">{tile.label}</p>
              <p className="text-[12.5px] text-slate-600 mt-1">{tile.description}</p>
              <div className="mt-2">
                <div className="text-[10px] uppercase tracking-wide text-slate-400">Basis</div>
                <div className="text-[12px] text-slate-700">{tile.basis}</div>
              </div>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ))}
    </div>
  )
}
