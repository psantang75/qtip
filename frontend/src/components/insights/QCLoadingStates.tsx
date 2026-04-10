import { AlertTriangle, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

// ── Primitives ────────────────────────────────────────────────────────────────

function Bone({ className }: { className?: string }) {
  return <div className={cn('bg-slate-200 animate-pulse rounded', className)} />
}

// ── Exported building blocks ──────────────────────────────────────────────────

/** Row of N skeleton tile cards matching KpiTile height */
export function SkeletonTiles({ count = 5, className }: { count?: number; className?: string }) {
  return (
    <div
      className={cn('gap-3', className)}
      style={{ display: 'grid', gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }}
    >
      {Array.from({ length: count }).map((_, i) => <Bone key={i} className="h-24 rounded-xl" />)}
    </div>
  )
}

/** N placeholder table rows */
export function SkeletonTable({ rows = 5, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('space-y-2', className)}>
      <Bone className="h-8 w-full rounded" />
      {Array.from({ length: rows }).map((_, i) => <Bone key={i} className="h-10 w-full rounded" />)}
    </div>
  )
}

/** Chart placeholder rectangle */
export function SkeletonChart({ height = 110, className }: { height?: number; className?: string }) {
  return <Bone className={cn('w-full rounded-lg', className)} style={{ height } as React.CSSProperties} />
}

/** Full-page skeleton used when primary KPI query is loading */
export function QCPageSkeleton({ tiles = 5 }: { tiles?: number }) {
  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <Bone className="h-7 w-64 rounded" />
        <Bone className="h-4 w-48 rounded" />
      </div>
      <SkeletonTiles count={tiles} />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Bone className="h-48 rounded-xl" />
        <Bone className="h-48 rounded-xl" />
      </div>
      <SkeletonTable rows={6} />
    </div>
  )
}

/** Error card with optional retry */
export function ErrorCard({
  message = 'Unable to load data. Please try again.',
  onRetry,
  className,
}: {
  message?: string
  onRetry?: () => void
  className?: string
}) {
  return (
    <div className={cn('bg-red-50 border border-red-200 rounded-xl p-8 text-center', className)}>
      <AlertTriangle className="h-9 w-9 text-red-400 mx-auto mb-3" />
      <p className="text-sm font-medium text-red-700 mb-4">{message}</p>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry} className="gap-1.5">
          <RefreshCw size={13} /> Try Again
        </Button>
      )}
    </div>
  )
}
