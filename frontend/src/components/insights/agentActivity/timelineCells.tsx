import type { ReactNode } from 'react'
import { ExternalLink } from 'lucide-react'
import { cn } from '@/lib/utils'
import { fmtClock } from './productivityModel'

/**
 * Hover-table vocabulary shared by every Activity Timeline row. Every hover
 * renders the same little table: a time column first, then the status/label,
 * then a muted detail. Building the cells through these helpers is what keeps
 * the hovers on every row looking identical.
 */

/** One row of the hover table. A row with an `href` renders as a link spanning
 *  all its columns (display:contents) so the whole line is clickable. */
export interface HoverRow { cells: ReactNode[]; href?: string; title?: string }
/** Detail the hovered bar hands to the shared card: a titled table whose columns
 *  line up (time first). */
export interface HoverDetail { title: string; subtitle?: ReactNode; gridCols: string; rows: HoverRow[] }
export type ShowFn = (el: HTMLElement, detail: HoverDetail) => void

/** Title Case for the status/label text shown in hovers (e.g. "queued call" →
 *  "Queued Call"), leaving the "·" separators and numeric spans untouched. */
export const titleCase = (s: string) => s.replace(/[A-Za-z]+/g, w => w[0].toUpperCase() + w.slice(1).toLowerCase())

export const hTime = (a: number, b: number) => (
  <span className="font-mono text-[11px] tabular-nums text-slate-500">{fmtClock(a)} – {fmtClock(b)}</span>
)
export const hAt = (m: number) => (
  <span className="font-mono text-[11px] tabular-nums text-slate-500">{fmtClock(m)}</span>
)
export const hText = (s: ReactNode) => <span className="text-slate-700">{s}</span>
export const hMuted = (s: ReactNode) => <span className="text-slate-400">{s}</span>

/** A CRM item as a three-cell hover row (name, description, link icon) that
 *  opens the item when it has a deep link. Grid: 'auto minmax(0,1fr) auto'. */
export function crmLinkRow(name: string, text: ReactNode, url: string | null): HoverRow {
  return {
    href: url ?? undefined,
    title: url ? `Open ${name} in the CRM` : undefined,
    cells: [
      <span className={cn('font-medium', url ? 'text-primary group-hover:underline' : 'text-slate-700')}>{name}</span>,
      <span className={cn('truncate text-slate-500', url && 'group-hover:underline')}>{text}</span>,
      url ? <ExternalLink className="h-3 w-3 shrink-0 opacity-70" /> : <span />,
    ],
  }
}
