interface ListLoadingSkeletonProps {
  rows?: number
}

/** Pulsing skeleton rows shown while a list/table's data is loading */
export function ListLoadingSkeleton({ rows = 8 }: ListLoadingSkeletonProps) {
  return (
    <div className="p-4 space-y-2">
      {[...Array(rows)].map((_, i) => (
        <div key={i} className="h-10 bg-slate-100 animate-pulse rounded" />
      ))}
    </div>
  )
}
