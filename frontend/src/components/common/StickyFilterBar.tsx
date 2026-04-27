import * as React from 'react'

/**
 * Shared chrome for sticky filter bars across QC Insights and On-Demand
 * Reports. Originally each page open-coded the same
 * `sticky -top-6 z-40 bg-slate-50 border-b …` wrapper plus nested row
 * containers; OnDemandReportViewPage even called this out in a comment.
 *
 * Pre-production review item #79 — this component owns the outer chrome
 * and row/field layout primitives. Feature-specific controls
 * (department selectors, period pickers, etc.) remain in the consuming
 * pages so we don't push every domain-specific filter into one uber-bar.
 *
 * Typical usage:
 *
 *   <StickyFilterBar>
 *     <StickyFilterBar.Row>
 *       <StickyFilterField label="Department">…</StickyFilterField>
 *       <StickyFilterBar.RightCluster>…</StickyFilterBar.RightCluster>
 *     </StickyFilterBar.Row>
 *     <StickyFilterBar.Row>…</StickyFilterBar.Row>
 *   </StickyFilterBar>
 */

interface StickyFilterBarProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Render content below the primary row(s) — e.g. business-days info row. */
  infoRow?: React.ReactNode
}

function StickyFilterBarRoot({
  children,
  infoRow,
  className,
  ...rest
}: StickyFilterBarProps) {
  return (
    <div
      className={[
        // 'sticky -top-6' matches the shell's content offset; bumping either
        // requires updating the other.
        'sticky -top-6 z-40 bg-slate-50 border-b border-slate-200',
        'px-6 py-3 -mx-6 -mt-6 mb-5',
        className ?? '',
      ].join(' ').trim()}
      {...rest}
    >
      {children}
      {infoRow && (
        <div className="flex gap-10 items-center mt-4 pt-3 border-t border-slate-200 text-xs text-slate-500">
          {infoRow}
        </div>
      )}
    </div>
  )
}

function Row({
  children,
  className,
}: React.PropsWithChildren<{ className?: string }>) {
  return (
    <div className={['flex flex-wrap items-center gap-3', className ?? ''].join(' ').trim()}>
      {children}
    </div>
  )
}

/** Pushes children to the right edge within a `Row`. */
function RightCluster({
  children,
  className,
}: React.PropsWithChildren<{ className?: string }>) {
  return (
    <div className={['ml-auto flex items-center gap-3', className ?? ''].join(' ').trim()}>
      {children}
    </div>
  )
}

/**
 * Label + control pair used inside a `Row`. Keeps the small-label / inline
 * control cadence consistent across every filter bar.
 */
export function StickyFilterField({
  label,
  children,
}: React.PropsWithChildren<{ label: string }>) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-xs text-slate-500 shrink-0">{label}</span>
      {children}
    </div>
  )
}

export const StickyFilterBar = Object.assign(StickyFilterBarRoot, {
  Row,
  RightCluster,
})

export default StickyFilterBar
