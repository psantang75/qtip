/**
 * The overdue work items behind one Past Due cell on a Tickets & Tasks report.
 * Read-only and act-on-it: every row carries its CRM deep link so the viewer can
 * open the ticket/task in a new tab and clear it.
 *
 * Shared by the Sales and CSR reports — the caller supplies the fetcher, which is
 * the only thing that differs between the two sections.
 */
import { useQuery } from '@tanstack/react-query'
import { ExternalLink } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { formatQualityDate } from '@/utils/dateFormat'
import type { PastDueItem, PastDueQuery } from '@/services/insightsService'

export interface PastDueTarget {
  agent: string
  classification: string
}

interface PastDueItemsModalProps {
  /** The cell that was opened. `null` keeps the dialog closed. */
  target: PastDueTarget | null
  onClose: () => void
  fetchPastDue: (q: PastDueQuery) => Promise<PastDueItem[]>
  /** Distinguishes the Sales and CSR caches, which scope to different agents. */
  queryKeyPrefix: string
}

const dash = (v: string | null) => (v ? v : '—')

export default function PastDueItemsModal({ target, onClose, fetchPastDue, queryKeyPrefix }: PastDueItemsModalProps) {
  const { data, isLoading, isError } = useQuery({
    queryKey: [queryKeyPrefix, target?.agent, target?.classification],
    queryFn:  () => fetchPastDue({ agent: target!.agent, classification: target!.classification }),
    enabled:  !!target,
    staleTime: 0,
  })

  const items = data ?? []

  // Tickets and tasks describe themselves with different fields, so the first
  // detail column is labelled for whichever type is on screen and the
  // ticket-only sub-classification column is dropped when there are no tickets.
  // A cell almost always holds one type (a classification name belongs to
  // tickets or to a task type, rarely both), so the combined label is a
  // fallback, not the norm.
  const hasTickets = items.some((it) => it.processType === 'Ticket')
  const hasTasks   = items.some((it) => it.processType === 'Task')
  const detailHead = hasTickets && hasTasks ? 'Classification / Task Type' : hasTasks ? 'Task Type' : 'Classification'

  return (
    <Dialog open={!!target} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="max-w-6xl max-h-[85vh] flex flex-col gap-0 p-0">
        <DialogHeader className="px-5 pt-5 pb-3 border-b border-slate-100 shrink-0">
          <DialogTitle>Past Due — {target?.classification}</DialogTitle>
          <DialogDescription className="text-[12.5px] text-slate-500">
            {target?.agent}
            {items.length > 0 && ` · ${items.length} overdue item${items.length === 1 ? '' : 's'}, oldest first`}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <p className="text-sm text-slate-400 text-center py-8">Loading…</p>
          ) : isError ? (
            <p className="text-sm text-danger text-center py-8">Couldn't load past due items. Close and try again.</p>
          ) : items.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-8">No past due items.</p>
          ) : (
            <table className="w-full text-sm table-fixed [&_th:first-child]:pl-5 [&_td:first-child]:pl-5 [&_th:last-child]:pr-5 [&_td:last-child]:pr-5">
              {/* Frozen while the list scrolls. `sticky` resolves against this table's
                  own scroll container, so the header must not be wrapped in another
                  overflow box (which is why this is a plain table, not ui/table), and
                  the rule rides on the th cells because a border on a sticky <tr>
                  drops out mid-scroll in Chrome. */}
              <thead className="sticky top-0 z-10 bg-white [&_th]:border-b [&_th]:border-slate-200">
                <tr className="text-xs text-slate-400">
                  <th className="text-left  py-2 font-medium pr-3 w-[9%]">ID</th>
                  <th className="text-left  py-2 font-medium pr-3 w-[7%]">Type</th>
                  <th className={`text-left py-2 font-medium pr-3 ${hasTickets ? 'w-[19%]' : 'w-[24%]'}`}>Customer</th>
                  <th className={`text-left py-2 font-medium pr-3 ${hasTickets ? 'w-[16%]' : 'w-[22%]'}`}>{detailHead}</th>
                  {hasTickets && <th className="text-left py-2 font-medium pr-3 w-[17%]">Sub-Classification</th>}
                  <th className={`text-left py-2 font-medium pr-3 ${hasTickets ? 'w-[15%]' : 'w-[21%]'}`}>Status</th>
                  <th className="text-left  py-2 font-medium pr-3 w-[12%]">Next Contact</th>
                  <th className="text-center py-2 font-medium w-[5%]">CRM</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={`${it.processType}-${it.referenceId}`} className="border-b border-slate-100 hover:bg-slate-50 align-top">
                    <td className="py-2.5 pr-3 font-medium text-slate-700">{it.referenceId}</td>
                    <td className="py-2.5 pr-3 text-slate-500">{it.processType}</td>
                    <td className="py-2.5 pr-3 text-slate-600">{dash(it.customerName)}</td>
                    <td className="py-2.5 pr-3 text-slate-600">{dash(it.classification ?? it.taskType)}</td>
                    {hasTickets && <td className="py-2.5 pr-3 text-slate-600">{dash(it.subClassification)}</td>}
                    <td className="py-2.5 pr-3 text-slate-600">{dash(it.status)}</td>
                    <td className="py-2.5 pr-3 text-slate-500 whitespace-nowrap">{formatQualityDate(it.nextContact)}</td>
                    <td className="py-2.5 text-center">
                      {it.crmUrl ? (
                        <a
                          href={it.crmUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex text-primary hover:text-primary/70 transition-colors"
                          title={`Open ${it.processType.toLowerCase()} ${it.referenceId} in the CRM`}
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
