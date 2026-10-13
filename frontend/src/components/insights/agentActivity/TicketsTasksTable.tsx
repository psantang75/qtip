/**
 * Tickets & Tasks snapshot table, shared by the Sales and CSR Agent Activity
 * reports. The two sections differ only in which agents the API returns and what
 * the first column is called, so the markup lives here once and can't drift.
 */
import { Fragment, useState } from 'react'
import { fmtNum } from './format'
import PastDueItemsModal, { type DueItemsPageFilters, type PastDueTarget } from './PastDueItemsModal'
import type { PastDueItem, PastDueQuery, TicketGroup, TicketsTasksResponse } from '@/services/insightsService'

// Zero counts render as an em dash, matching the source report.
const dash = (v: number) => (v === 0 ? '—' : fmtNum(v))

function CountLink({
  count, title, onClick,
}: { count: number; title: string; onClick: () => void }) {
  if (count <= 0) return <>{dash(count)}</>
  return (
    <button
      type="button"
      onClick={onClick}
      className="font-medium text-primary hover:underline focus:outline-none focus-visible:underline"
      title={title}
    >
      {fmtNum(count)}
    </button>
  )
}

interface TicketsTasksTableProps {
  groups: TicketGroup[]
  grandTotal?: TicketsTasksResponse['grandTotal']
  /** First-column header: "Salesperson" for Sales, "Agent" for CSR. */
  agentLabel: string
  fetchPastDue: (q: PastDueQuery) => Promise<PastDueItem[]>
  fetchDueToday: (q: PastDueQuery) => Promise<PastDueItem[]>
  /** Distinguishes the Sales and CSR drill-in caches. */
  queryKeyPrefix: string
  /** The page's Agent / Department filters, so the Grand Total list matches its count. */
  pageFilters?: DueItemsPageFilters
}

const plural = (n: number) => (n === 1 ? '' : 's')

export default function TicketsTasksTable({
  groups, grandTotal, agentLabel, fetchPastDue, fetchDueToday, queryKeyPrefix, pageFilters,
}: TicketsTasksTableProps) {
  const [target, setTarget] = useState<PastDueTarget | null>(null)

  return (
    <>
      <PastDueItemsModal
        target={target}
        onClose={() => setTarget(null)}
        fetchPastDue={fetchPastDue}
        fetchDueToday={fetchDueToday}
        queryKeyPrefix={queryKeyPrefix}
        pageFilters={pageFilters}
      />
      <table className="w-full text-sm table-fixed [&_th:first-child]:pl-4 [&_td:first-child]:pl-4 [&_th:last-child]:pr-4 [&_td:last-child]:pr-4">
        <thead>
          <tr className="text-xs text-slate-400 border-b border-slate-200">
            <th className="text-left  pb-2 font-medium pr-4 w-[20%]">{agentLabel}</th>
            <th className="text-left  pb-2 font-medium pr-4 w-[18%]">Department</th>
            <th className="text-left  pb-2 font-medium pr-4 w-[26%]">Classification</th>
            <th className="text-right pb-2 font-medium pr-4 w-[12%]">Current</th>
            <th className="text-right pb-2 font-medium pr-4 w-[12%]">Due Today</th>
            <th className="text-right pb-2 font-medium w-[12%]">Past Due</th>
          </tr>
        </thead>
        <tbody>
          {groups.map(group => (
            <Fragment key={group.agent}>
              {group.rows.map((r, i) => (
                <tr key={`${r.agent}-${r.classification}-${i}`} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="py-2.5 pr-4 text-slate-600">{r.agent}</td>
                  <td className="py-2.5 pr-4 text-slate-500">{r.department}</td>
                  <td className="py-2.5 pr-4 text-slate-600">{r.classification}</td>
                  <td className="py-2.5 pr-4 text-right text-slate-600">{dash(r.current)}</td>
                  <td className="py-2.5 pr-4 text-right text-slate-600">
                    <CountLink
                      count={r.dueToday}
                      title={`View the ${fmtNum(r.dueToday)} ${r.classification} item${plural(r.dueToday)} due today`}
                      onClick={() => setTarget({ agent: r.agent, classification: r.classification, bucket: 'due-today' })}
                    />
                  </td>
                  <td className="py-2.5 text-right text-slate-600">
                    <CountLink
                      count={r.pastDue}
                      title={`View the ${fmtNum(r.pastDue)} past due ${r.classification} item${plural(r.pastDue)}`}
                      onClick={() => setTarget({ agent: r.agent, classification: r.classification, bucket: 'past-due' })}
                    />
                  </td>
                </tr>
              ))}
              <tr className="bg-slate-100 border-b-2 border-slate-200 font-semibold text-slate-900">
                <td className="py-2.5 pr-4" colSpan={3}>Total - {group.agent}</td>
                <td className="py-2.5 pr-4 text-right">{dash(group.total.current)}</td>
                <td className="py-2.5 pr-4 text-right">
                  <CountLink
                    count={group.total.dueToday}
                    title={`View all ${fmtNum(group.total.dueToday)} item${plural(group.total.dueToday)} due today for ${group.agent}`}
                    onClick={() => setTarget({ agent: group.agent, bucket: 'due-today' })}
                  />
                </td>
                <td className="py-2.5 text-right">
                  <CountLink
                    count={group.total.pastDue}
                    title={`View all ${fmtNum(group.total.pastDue)} past due item${plural(group.total.pastDue)} for ${group.agent}`}
                    onClick={() => setTarget({ agent: group.agent, bucket: 'past-due' })}
                  />
                </td>
              </tr>
            </Fragment>
          ))}
          {grandTotal && (
            <tr className="border-b-2 border-slate-300 font-bold text-slate-900">
              <td className="py-2.5 pr-4" colSpan={3}>Grand Total</td>
              <td className="py-2.5 pr-4 text-right">{dash(grandTotal.current)}</td>
              <td className="py-2.5 pr-4 text-right">
                <CountLink
                  count={grandTotal.dueToday}
                  title={`View all ${fmtNum(grandTotal.dueToday)} item${plural(grandTotal.dueToday)} due today`}
                  onClick={() => setTarget({ bucket: 'due-today' })}
                />
              </td>
              <td className="py-2.5 text-right">
                <CountLink
                  count={grandTotal.pastDue}
                  title={`View all ${fmtNum(grandTotal.pastDue)} past due item${plural(grandTotal.pastDue)}`}
                  onClick={() => setTarget({ bucket: 'past-due' })}
                />
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </>
  )
}
