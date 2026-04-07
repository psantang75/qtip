import { cn } from '@/lib/utils'

interface Bucket { bucket: string; count: number }

interface ScoreHistogramProps {
  data: Bucket[]
  goalScore?: number   // score threshold — buckets at/above this score get brand color
}

function bucketMin(bucket: string): number {
  const n = parseInt(bucket.split('-')[0] ?? bucket, 10)
  return isNaN(n) ? 0 : n
}

export default function ScoreHistogram({ data, goalScore = 90 }: ScoreHistogramProps) {
  const maxCount = Math.max(...data.map(d => d.count), 1)
  const total    = data.reduce((s, d) => s + d.count, 0)

  return (
    <div className="space-y-1.5">
      {data.map(bucket => {
        const pct      = (bucket.count / maxCount) * 100
        const isAbove  = bucketMin(bucket.bucket) >= goalScore
        const sharePct = total > 0 ? Math.round((bucket.count / total) * 100) : 0

        return (
          <div key={bucket.bucket} className="flex items-center gap-2 text-xs">
            <span className="w-14 shrink-0 text-right text-slate-500 font-mono">{bucket.bucket}</span>
            <div className="flex-1 bg-slate-100 rounded-full h-4 overflow-hidden">
              <div
                className={cn('h-full rounded-full transition-all', isAbove ? 'bg-[#00aeef]/70' : 'bg-slate-300')}
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="w-10 text-right text-slate-600 shrink-0">{bucket.count}</span>
            <span className="w-8 text-right text-slate-400 shrink-0">{sharePct}%</span>
          </div>
        )
      })}
      <div className="flex items-center gap-3 pt-2 border-t border-slate-100 text-[11px] text-slate-400">
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-2 rounded bg-[#00aeef]/70" /> ≥ {goalScore} (goal)
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-2 rounded bg-slate-300" /> &lt; {goalScore}
        </span>
        <span className="ml-auto">n = {total}</span>
      </div>
    </div>
  )
}
