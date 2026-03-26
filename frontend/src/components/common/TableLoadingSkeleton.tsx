interface TableLoadingSkeletonProps {
  rows?: number
}

/** Pulsing skeleton rows shown while a table's data is loading */
export function TableLoadingSkeleton({ rows = 8 }: TableLoadingSkeletonProps) {
  return (
    <div className="p-4 space-y-2">
      {[...Array(rows)].map((_, i) => (
        <div key={i} className="h-10 bg-slate-100 animate-pulse rounded" />
      ))}
    </div>
  )
}
