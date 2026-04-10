import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  useReactTable, getCoreRowModel, getSortedRowModel,
  flexRender, createColumnHelper, type SortingState,
} from '@tanstack/react-table'
import { ChevronUp, ChevronDown } from 'lucide-react'
import { InsightsFilterBar, InsightsSection, StatusBadge, StatusDot, SkeletonTable, ErrorCard } from '@/components/insights'
import { useQCFilters } from '@/hooks/useQCFilters'
import { getKpiDef } from '@/constants/kpiDefs'
import { getQCAgents, getFilterOptions } from '@/services/insightsQCService'
import type { AgentSummary } from '@/services/insightsQCService'
import QCAgentProfile from './QCAgentProfile'

const col = createColumnHelper<AgentSummary>()

const COLUMNS = [
  col.accessor('name', {
    header: 'Agent',
    cell: i => <span className="font-medium text-primary">{i.getValue()}</span>,
  }),
  col.accessor('dept', { header: 'Department', cell: i => <span className="text-slate-500 text-xs">{i.getValue()}</span> }),
  col.accessor('qa', {
    header: 'QA Score',
    cell: i => {
      const v = i.getValue()
      return v != null ? (
        <span className="flex items-center gap-1">
          <StatusDot value={v} thresholds={getKpiDef('avg_qa_score') ?? { direction: 'UP_IS_GOOD', goal: 90, warn: 80, crit: 70 }} />
          <span className="font-semibold">{v.toFixed(1)}%</span>
        </span>
      ) : <span className="text-slate-400">—</span>
    },
  }),
  col.accessor('trend', {
    header: 'Trend',
    cell: i => {
      const v = i.getValue()
      return <span className={`font-medium text-xs ${v.startsWith('+') ? 'text-emerald-600' : v.startsWith('-') ? 'text-red-500' : 'text-slate-400'}`}>{v}</span>
    },
  }),
  col.accessor('cadence', {
    header: 'Cadence',
    cell: i => {
      const a = i.row.original
      const color = a.cadence >= a.expected ? 'text-emerald-600' : a.cadence >= a.expected * 0.75 ? 'text-orange-500' : 'text-red-600'
      return <span className={`font-semibold text-sm ${color}`}>{a.cadence}/{a.expected}</span>
    },
  }),
  col.accessor('quiz', {
    header: 'Quiz',
    cell: i => {
      const v = i.getValue()
      return (
        <span className="flex items-center gap-1">
          <StatusDot value={v} thresholds={getKpiDef('avg_quiz_score') ?? { direction: 'UP_IS_GOOD', goal: 82, warn: 70, crit: 60 }} />
          <span className="text-sm">{v}%</span>
        </span>
      )
    },
  }),
  col.accessor('coaching', { header: 'Sessions', cell: i => <span className="text-slate-600 text-sm">{i.getValue()}</span> }),
  col.accessor('disputes', {
    header: 'Disputes',
    cell: i => {
      const v = i.getValue()
      return v > 0 ? <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold bg-orange-50 text-orange-600 border border-orange-200">{v}</span> : <span className="text-slate-400">0</span>
    },
  }),
  col.accessor('writeups', {
    header: 'Warnings',
    cell: i => {
      const v = i.getValue()
      return v > 0 ? <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold bg-red-50 text-red-600 border border-red-200">{v}</span> : <span className="text-slate-400">0</span>
    },
  }),
  col.accessor('risk', {
    header: 'Status',
    cell: i => i.getValue() ? <StatusBadge label="At Risk" variant="bad" /> : <StatusBadge label="OK" variant="good" />,
  }),
]

export default function QCAgentsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const agentId = searchParams.get('agent') ? parseInt(searchParams.get('agent')!, 10) : null

  const { departments, setDepartments, period, setPeriod,
          customStart, setCustomStart, customEnd, setCustomEnd,
          resetFilters, params } = useQCFilters()
  const [selectedForms, setSelectedForms]  = useState<string[]>([])
  const [sorting, setSorting]              = useState<SortingState>([{ id: 'qa', desc: false }])

  const apiParams = useMemo(() => ({ ...params }), [params])

  const { data: filterOpts } = useQuery({ queryKey: ['qc-filter-opts', apiParams], queryFn: () => getFilterOptions(apiParams) })
  const deptOptions = filterOpts?.departments ?? []
  const { data: agents = [], isLoading, isError, refetch } = useQuery({ queryKey: ['qc-agents', apiParams], queryFn: () => getQCAgents(apiParams) })

  const selectedAgent = useMemo(() => {
    if (!agentId) return null
    return agents.find(a => a.userId === agentId) ?? null
  }, [agentId, agents])

  useEffect(() => {
    if (agentId) {
      document.querySelector('main')?.scrollTo({ top: 0 })
    }
  }, [agentId])

  function selectAgent(agent: AgentSummary) {
    setSearchParams({ agent: String(agent.userId) })
  }

  function clearAgent() {
    setSelectedForms([])
    setSearchParams({})
  }

  const table = useReactTable({
    data: agents, columns: COLUMNS,
    state: { sorting }, onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel(),
  })

  const deptLabel = departments.length === 0 ? 'All Departments' : departments.join(', ')

  if (selectedAgent) {
    return (
      <QCAgentProfile
        agent={selectedAgent}
        apiParams={apiParams}
        selectedForms={selectedForms}
        onFormsChange={setSelectedForms}
        onBack={clearAgent}
        deptOptions={deptOptions}
        departments={departments}
        setDepartments={setDepartments}
        period={period} setPeriod={setPeriod}
        customStart={customStart} setCustomStart={setCustomStart}
        customEnd={customEnd} setCustomEnd={setCustomEnd}
      />
    )
  }

  return (
    <div>
      <InsightsFilterBar
        selectedDepts={departments} onDeptsChange={setDepartments} availableDepts={deptOptions}
        period={period} onPeriodChange={setPeriod}
        customStart={customStart} customEnd={customEnd}
        onCustomStartChange={setCustomStart} onCustomEndChange={setCustomEnd}
        onReset={resetFilters}
      />
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Agent Performance</h1>
          <p className="text-sm text-slate-500 mt-0.5">{deptLabel} · {period} · Click any agent to view their full profile</p>
        </div>
        {isLoading && <SkeletonTable rows={8} />}
        {isError   && <ErrorCard onRetry={refetch} />}
        {!isLoading && !isError && <InsightsSection className="overflow-x-auto">
          <table className="w-full text-sm min-w-[900px]">
            <thead>
              {table.getHeaderGroups().map(hg => (
                <tr key={hg.id} className="border-b-2 border-slate-200">
                  {hg.headers.map(header => (
                    <th key={header.id} className="text-left pb-2.5 pr-4 text-xs font-semibold text-slate-400 cursor-pointer select-none" onClick={header.column.getToggleSortingHandler()}>
                      <span className="flex items-center gap-1">
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {header.column.getIsSorted() === 'asc'  && <ChevronUp size={12} />}
                        {header.column.getIsSorted() === 'desc' && <ChevronDown size={12} />}
                      </span>
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.map(row => (
                <tr key={row.id} className="border-b border-slate-100 last:border-0 hover:bg-[#eff6ff] cursor-pointer"
                  onClick={() => selectAgent(row.original)}>
                  {row.getVisibleCells().map(cell => (
                    <td key={cell.id} className="py-2.5 pr-4">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))}
              {agents.length === 0 && (
                <tr><td colSpan={10} className="py-8 text-center text-sm text-slate-400">No agents match the selected filters.</td></tr>
              )}
            </tbody>
          </table>
        </InsightsSection>}
      </div>
    </div>
  )
}
