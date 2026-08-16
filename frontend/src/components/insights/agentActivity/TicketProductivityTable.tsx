import { Fragment, useMemo, useState } from 'react'
import {
  useReactTable, getCoreRowModel, getSortedRowModel, flexRender,
  createColumnHelper, type SortingState,
} from '@tanstack/react-table'
import { ChevronRight, ChevronDown, RotateCcw, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import SortHeaderIcon from './SortHeaderIcon'
import TouchDetailDialog from './TouchDetailDialog'
import { fmtNum } from './format'
import { formatMetadataDate } from '@/utils/dateFormat'
import type { TicketProductivityRow } from '@/services/insightsService'

/** One agent's roll-up over the selected range + the per-day rows behind it. */
interface AgentSummary {
  agent: string
  department: string
  /** Open work items at the start of the range (earliest day's beginning). */
  beginning: number
  newAssigned: number
  touched: number
  closed: number
  days: TicketProductivityRow[]
}

interface TicketProductivityTableProps {
  /** One row per (agent, day) from the productivity endpoint. */
  rows: TicketProductivityRow[]
  /** "Salesperson" (Sales) or "Agent" (CSR). */
  agentLabel: string
  /** Which section's page grant the per-day touch drill-down reads under. */
  area: 'sales' | 'csr'
}

const BY_AGENT: SortingState = [{ id: 'agent', desc: false }]

/** Group the flat per-day rows into per-agent summaries (beginning = earliest
 *  day in range; new/touched/closed summed across the range). */
function buildSummaries(rows: TicketProductivityRow[]): AgentSummary[] {
  const byAgent = new Map<string, AgentSummary>()
  for (const r of rows) {
    let s = byAgent.get(r.agent)
    if (!s) {
      s = { agent: r.agent, department: r.department, beginning: 0, newAssigned: 0, touched: 0, closed: 0, days: [] }
      byAgent.set(r.agent, s)
    }
    s.newAssigned += r.newAssigned
    s.touched += r.touched
    s.closed += r.closed
    s.days.push(r)
  }
  for (const s of byAgent.values()) {
    s.days.sort((a, b) => a.date.localeCompare(b.date))
    s.beginning = s.days[0]?.beginning ?? 0
  }
  return [...byAgent.values()]
}

/** Running total accumulator shared by the department subtotal and grand total. */
interface Totals { beginning: number; newAssigned: number; touched: number; closed: number }
const zeroTotals = (): Totals => ({ beginning: 0, newAssigned: 0, touched: 0, closed: 0 })
function addInto(acc: Totals, s: Pick<AgentSummary, 'beginning' | 'newAssigned' | 'touched' | 'closed'>): Totals {
  acc.beginning += s.beginning
  acc.newAssigned += s.newAssigned
  acc.touched += s.touched
  acc.closed += s.closed
  return acc
}

/** One department's agents (in the caller's sort order) plus its subtotal. */
interface DeptGroup { department: string; agents: AgentSummary[]; subtotal: Totals }

/** Bucket already-sorted agents by department; departments come out alphabetically
 *  and each department keeps the incoming (column-sorted) agent order. Because
 *  work volume differs by department, each group carries its own subtotal. */
function groupByDept(agents: AgentSummary[]): DeptGroup[] {
  const byDept = new Map<string, AgentSummary[]>()
  for (const a of agents) {
    const key = a.department || '—'
    const list = byDept.get(key)
    if (list) list.push(a)
    else byDept.set(key, [a])
  }
  return [...byDept.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([department, deptAgents]) => ({
      department,
      agents: deptAgents,
      subtotal: deptAgents.reduce((acc, s) => addInto(acc, s), zeroTotals()),
    }))
}

/**
 * Column-header tooltip for the productivity grid. The label itself is the hover
 * trigger (no info-icon), and the card mirrors the KpiInfoCard layout used
 * elsewhere (PaceHeader): bold title, a description paragraph, then a labelled
 * "Basis" row stating whether the column is an effort or inventory measure. The
 * label sits inside the clickable <th>, so a click still bubbles to sort.
 */
function ColHeader({ label, description, basis }: { label: string; description: string; basis: string }) {
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span>{label}</span>
        </TooltipTrigger>
        <TooltipContent
          side="bottom"
          sideOffset={6}
          className="w-72 rounded-xl border border-slate-200 bg-white p-3 shadow-lg"
        >
          <div className="space-y-3 text-left">
            <p className="text-[13px] font-semibold text-slate-900 leading-tight">{label}</p>
            <p className="text-[12.5px] text-slate-600 leading-relaxed">{description}</p>
            <div className="pt-2 border-t border-slate-100">
              <div className="flex items-baseline gap-3">
                <span className="text-[10px] uppercase tracking-wide text-slate-400 w-[52px] shrink-0">Basis</span>
                <span className="text-[11.5px] text-slate-600">{basis}</span>
              </div>
            </div>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

const ch = createColumnHelper<AgentSummary>()

/**
 * Per-agent Ticket & Task productivity roll-up. Mirrors SortableTable's markup
 * and the QTIP 3-state sort affordance, but each agent row expands to reveal a
 * per-day breakdown (Beginning / New Assigned / Touched / Closed by date).
 */
export default function TicketProductivityTable({ rows, agentLabel, area }: TicketProductivityTableProps) {
  const [sorting, setSorting] = useState<SortingState>(BY_AGENT)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  // The day whose Touched breakdown is open in the drill-down modal.
  const [drill, setDrill] = useState<{ employeeKey: number; date: string; agent: string } | null>(null)

  const data = useMemo(() => buildSummaries(rows), [rows])

  const columns = useMemo(() => [
    ch.accessor('agent', { header: agentLabel, cell: i => i.getValue(), meta: { width: 'w-[34%]' } }),
    ch.accessor('beginning', {
      header: () => <ColHeader label="Beginning" basis="Inventory — keyed by assignee"
        description="Open tickets & tasks on this agent's queue at the start of the range. A workload/inventory measure — it counts items regardless of whether anyone worked them, so don't read it as effort." />,
      cell: i => fmtNum(i.getValue()), meta: { width: 'w-[16%]' },
    }),
    ch.accessor('newAssigned', {
      header: () => <ColHeader label="New Assigned" basis="Inventory — keyed by assignee"
        description="Tickets & tasks newly assigned to this agent during the range. Inventory entering the queue — includes system-spawned task types (Contact Manager, Order Flow, Activation, AR), so it isn't a pure effort number." />,
      cell: i => fmtNum(i.getValue()), meta: { width: 'w-[16%]' },
    }),
    ch.accessor('touched', {
      header: () => <ColHeader label="Touched" basis="Effort — keyed by the actor"
        description="Distinct tickets & tasks this agent did real human work on that day (a genuine noted action or ticket note). System-generated events are excluded, so this is the trustworthy effort metric." />,
      cell: i => fmtNum(i.getValue()), meta: { width: 'w-[16%]' },
    }),
    ch.accessor('closed', {
      header: () => <ColHeader label="Closed" basis="Inventory — keyed by assignee"
        description="Tickets & tasks that left this agent's queue during the range. Inventory leaving the queue — includes system/auto closes (e.g. 'CLOSED BY IT', opened-and-closed-immediately), so it isn't a pure effort number." />,
      cell: i => fmtNum(i.getValue()), meta: { width: 'w-[16%]' },
    }),
  ], [agentLabel])

  const table = useReactTable({
    data, columns,
    state: { sorting }, onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel(),
  })

  const isDirty = !(
    sorting.length === BY_AGENT.length &&
    sorting.every((s, i) => s.id === BY_AGENT[i]?.id && s.desc === BY_AGENT[i]?.desc)
  )

  // Group the column-sorted agent rows by department (each department keeps the
  // active sort order) so each department can show its own subtotal.
  const groups = useMemo(
    () => groupByDept(table.getSortedRowModel().rows.map(r => r.original)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, sorting],
  )

  const total = useMemo(() => data.reduce((acc, s) => addInto(acc, s), zeroTotals()), [data])

  const metaWidth = (col: { columnDef: { meta?: unknown } }) => ((col.columnDef.meta as { width?: string } | undefined)?.width) ?? ''
  const colCount = columns.length + 1 // + expander column

  return (
    <div>
      <div className="flex justify-end h-7 mb-1">
        {isDirty && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSorting(BY_AGENT)}
            className="h-7 text-[12px] text-slate-500 hover:text-slate-800"
          >
            <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
            Reset Sort
          </Button>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm table-fixed min-w-[720px] [&_th:first-child]:pl-4 [&_td:first-child]:pl-4 [&_th:last-child]:pr-4 [&_td:last-child]:pr-4">
          <thead>
            {table.getHeaderGroups().map(hg => (
              <tr key={hg.id} className="text-xs text-slate-400 border-b border-slate-200">
                <th className="w-8" aria-hidden />
                {hg.headers.map(header => (
                  <th
                    key={header.id}
                    className={`text-left pb-2 pr-4 font-medium select-none cursor-pointer ${metaWidth(header.column)}`}
                    onClick={header.column.getToggleSortingHandler()}
                  >
                    <span className="flex items-center gap-1">
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      <SortHeaderIcon sorted={header.column.getIsSorted()} canSort={header.column.getCanSort()} />
                    </span>
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {groups.map(group => (
              <Fragment key={group.department}>
                <tr className="border-b border-slate-200 bg-white">
                  <td />
                  <td colSpan={columns.length} className="pt-4 pb-1.5 pr-4 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    {group.department || '—'}
                  </td>
                </tr>
                {group.agents.map(agent => {
                  const isOpen = !!expanded[agent.agent]
                  return (
                    <Fragment key={agent.agent}>
                      <tr
                        className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer"
                        onClick={() => setExpanded(e => ({ ...e, [agent.agent]: !isOpen }))}
                      >
                        <td className="py-2.5 pl-4 text-slate-400">
                          {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </td>
                        <td className="py-2.5 pr-4 text-slate-600">{agent.agent}</td>
                        <td className="py-2.5 pr-4 text-slate-600">{fmtNum(agent.beginning)}</td>
                        <td className="py-2.5 pr-4 text-slate-600">{fmtNum(agent.newAssigned)}</td>
                        <td className="py-2.5 pr-4 text-slate-600">{fmtNum(agent.touched)}</td>
                        <td className="py-2.5 pr-4 text-slate-600">{fmtNum(agent.closed)}</td>
                      </tr>
                      {isOpen && (
                        <tr className="bg-slate-50 border-b border-slate-100">
                          <td />
                          <td colSpan={columns.length} className="py-2 pr-4">
                            <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
                              <table className="w-full text-[13px] table-fixed">
                                <thead>
                                  <tr className="text-[11px] text-slate-400 border-b border-slate-200">
                                    <th className="text-left font-medium py-1.5 pl-3 w-[28%]">By Day</th>
                                    <th className="text-left font-medium py-1.5 pr-3 w-[15%]">Beginning</th>
                                    <th className="text-left font-medium py-1.5 pr-3 w-[15%]">New Assigned</th>
                                    <th className="text-left font-medium py-1.5 pr-3 w-[15%]">Touched</th>
                                    <th className="text-left font-medium py-1.5 pr-3 w-[15%]">Closed</th>
                                    <th className="w-[12%]" aria-hidden />
                                  </tr>
                                </thead>
                                <tbody>
                                  {agent.days.map(day => (
                                    <tr key={day.date} className="border-b border-slate-50 last:border-0">
                                      <td className="py-1.5 pl-3 text-slate-500">{formatMetadataDate(day.date)}</td>
                                      <td className="py-1.5 pr-3 text-slate-600">{fmtNum(day.beginning)}</td>
                                      <td className="py-1.5 pr-3 text-slate-600">{fmtNum(day.newAssigned)}</td>
                                      <td className="py-1.5 pr-3 text-slate-600">{fmtNum(day.touched)}</td>
                                      <td className="py-1.5 pr-3 text-slate-600">{fmtNum(day.closed)}</td>
                                      <td className="py-1.5 pr-3 text-right">
                                        <button
                                          type="button"
                                          onClick={() => setDrill({ employeeKey: day.employeeKey, date: day.date, agent: agent.agent })}
                                          className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-primary transition-colors"
                                          title="View the task & ticket notes behind Touched"
                                          aria-label={`View touched detail for ${agent.agent} on ${day.date}`}
                                        >
                                          <Search className="h-3.5 w-3.5" />
                                          View
                                        </button>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
                <tr className="bg-slate-100 border-b-2 border-slate-200 font-semibold text-slate-900">
                  <td />
                  <td className="py-2.5 pr-4">Total &mdash; {group.department || '—'}</td>
                  <td className="py-2.5 pr-4">{fmtNum(group.subtotal.beginning)}</td>
                  <td className="py-2.5 pr-4">{fmtNum(group.subtotal.newAssigned)}</td>
                  <td className="py-2.5 pr-4">{fmtNum(group.subtotal.touched)}</td>
                  <td className="py-2.5 pr-4">{fmtNum(group.subtotal.closed)}</td>
                </tr>
              </Fragment>
            ))}
            {data.length === 0 && (
              <tr><td colSpan={colCount} className="py-8 text-center text-sm text-slate-400">No data for the selected filters.</td></tr>
            )}
            {groups.length > 1 && (
              <tr className="border-b-2 border-slate-300 font-bold text-slate-900">
                <td />
                <td className="py-2.5 pr-4">Grand Total</td>
                <td className="py-2.5 pr-4">{fmtNum(total.beginning)}</td>
                <td className="py-2.5 pr-4">{fmtNum(total.newAssigned)}</td>
                <td className="py-2.5 pr-4">{fmtNum(total.touched)}</td>
                <td className="py-2.5 pr-4">{fmtNum(total.closed)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <TouchDetailDialog
        open={!!drill}
        onOpenChange={(o) => { if (!o) setDrill(null) }}
        params={drill ? { area, employeeKey: drill.employeeKey, date: drill.date } : null}
        agentName={drill?.agent}
      />
    </div>
  )
}
