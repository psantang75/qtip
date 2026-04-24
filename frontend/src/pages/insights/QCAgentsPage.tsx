import React, { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  useReactTable, getCoreRowModel, getSortedRowModel,
  flexRender, createColumnHelper, type SortingState,
} from '@tanstack/react-table'
import { ChevronUp, ChevronDown } from 'lucide-react'
import { InsightsFilterBar, InsightsSection, StatusDot, SkeletonTable, ErrorCard } from '@/components/insights'
import { useQCFilters } from '@/hooks/useQCFilters'
import { useQualityRole } from '@/hooks/useQualityRole'
import { useAuth } from '@/contexts/AuthContext'
import { getKpiDef } from '@/constants/kpiDefs'
import { getQCAgents, getFilterOptions } from '@/services/insightsQCService'
import type { AgentSummary } from '@/services/insightsQCService'
import { useToast } from '@/hooks/use-toast'
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
  col.accessor('qaCount', {
    header: 'QA Reviews',
    cell: i => <span className="text-slate-600 text-sm">{i.getValue()}</span>,
  }),
  col.accessor('coaching', {
    header: 'Coaching Sessions',
    cell: i => <span className="text-slate-600 text-sm">{i.getValue()}</span>,
  }),
  col.accessor('writeups', {
    header: 'Warnings',
    cell: i => {
      const v = i.getValue()
      return v > 0 ? <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold bg-red-50 text-red-600 border border-red-200">{v}</span> : <span className="text-slate-400">0</span>
    },
  }),
]

export default function QCAgentsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const agentId = searchParams.get('agent') ? parseInt(searchParams.get('agent')!, 10) : null
  const { toast } = useToast()
  const { isAgent } = useQualityRole()
  const { user } = useAuth()

  const { departments, setDepartments, period, setPeriod,
          customStart, setCustomStart, customEnd, setCustomEnd,
          forms, setForms, resetFilters, params } = useQCFilters()
  const [sorting, setSorting] = useState<SortingState>([{ id: 'qa', desc: false }])

  const apiParams = useMemo(() => ({ ...params }), [params])

  // CSRs short-circuit the entire list flow: render their own profile
  // directly off auth context. We never call /qc/agents for them — that
  // endpoint can be slow or unavailable for SELF-scoped users, and there's
  // nothing for them to choose from anyway.
  if (isAgent && user) {
    const selfAgent: AgentSummary = {
      userId:   user.id,
      name:     user.username,
      dept:     user.department_name ?? '',
      qa:       null,
      trend:    '—',
      qaCount:  0,
      coaching: 0,
      writeups: 0,
    }
    return (
      <QCAgentProfile
        agent={selfAgent}
        apiParams={apiParams}
        selectedForms={forms}
        onFormsChange={setForms}
        onBack={() => { /* no list to return to */ }}
        period={period} setPeriod={setPeriod}
        customStart={customStart} setCustomStart={setCustomStart}
        customEnd={customEnd} setCustomEnd={setCustomEnd}
        showBackButton={false}
      />
    )
  }

  // Admin / manager / QA / director path — full list view follows.
  return (
    <AdminAgentsList
      agentId={agentId}
      setSearchParams={setSearchParams}
      apiParams={apiParams}
      sorting={sorting} setSorting={setSorting}
      departments={departments} setDepartments={setDepartments}
      period={period} setPeriod={setPeriod}
      customStart={customStart} setCustomStart={setCustomStart}
      customEnd={customEnd} setCustomEnd={setCustomEnd}
      forms={forms} setForms={setForms}
      resetFilters={resetFilters}
      toast={toast}
    />
  )
}

interface AdminAgentsListProps {
  agentId: number | null
  setSearchParams: ReturnType<typeof useSearchParams>[1]
  apiParams: ReturnType<typeof useQCFilters>['params']
  sorting: SortingState
  setSorting: React.Dispatch<React.SetStateAction<SortingState>>
  departments: string[]; setDepartments: (v: string[]) => void
  period: string; setPeriod: (v: string) => void
  customStart: string; setCustomStart: (v: string) => void
  customEnd: string; setCustomEnd: (v: string) => void
  forms: string[]; setForms: (v: string[]) => void
  resetFilters: () => void
  toast: ReturnType<typeof useToast>['toast']
}

function AdminAgentsList({
  agentId, setSearchParams, apiParams, sorting, setSorting,
  departments, setDepartments, period, setPeriod,
  customStart, setCustomStart, customEnd, setCustomEnd,
  forms, setForms, resetFilters, toast,
}: AdminAgentsListProps) {
  const { data: filterOpts } = useQuery({ queryKey: ['qc-filter-opts', apiParams], queryFn: () => getFilterOptions(apiParams) })
  const deptOptions = filterOpts?.departments ?? []
  const formOptions = filterOpts?.forms ?? []
  const { data: agents = [], isLoading, isError, refetch } = useQuery({ queryKey: ['qc-agents', apiParams], queryFn: () => getQCAgents(apiParams) })

  const selectedAgent = useMemo(() => {
    if (!agentId) return null
    return agents.find(a => a.userId === agentId) ?? null
  }, [agentId, agents])

  // Guard against URL tampering: if the user requests an agent they cannot
  // see, strip the param and surface an access-denied toast instead of
  // silently swapping data.
  useEffect(() => {
    if (!agentId) return
    if (isLoading || isError) return
    if (selectedAgent) return
    toast({
      title: 'Access denied',
      description: "You don't have access to that agent's profile.",
      variant: 'destructive',
    })
    setSearchParams({}, { replace: true })
  }, [agentId, isLoading, isError, selectedAgent, toast, setSearchParams])

  useEffect(() => {
    if (agentId) {
      document.querySelector('main')?.scrollTo({ top: 0 })
    }
  }, [agentId])

  function selectAgent(agent: AgentSummary) {
    setSearchParams({ agent: String(agent.userId) })
  }

  function clearAgent() {
    setForms([])
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
        selectedForms={forms}
        onFormsChange={setForms}
        onBack={clearAgent}
        period={period} setPeriod={setPeriod}
        customStart={customStart} setCustomStart={setCustomStart}
        customEnd={customEnd} setCustomEnd={setCustomEnd}
      />
    )
  }

  // An agent was requested via URL but the list is still loading — show a
  // skeleton so we don't flash the table before the access guard runs.
  if (agentId && isLoading) {
    return <SkeletonTable rows={6} />
  }

  return (
    <div>
      <InsightsFilterBar
        selectedDepts={departments} onDeptsChange={setDepartments} availableDepts={deptOptions}
        period={period} onPeriodChange={setPeriod}
        customStart={customStart} customEnd={customEnd}
        onCustomStartChange={setCustomStart} onCustomEndChange={setCustomEnd}
        showFormFilter selectedForms={forms} onFormsChange={setForms}
        availableForms={formOptions}
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
                <tr><td colSpan={7} className="py-8 text-center text-sm text-slate-400">No agents match the selected filters.</td></tr>
              )}
            </tbody>
          </table>
        </InsightsSection>}
      </div>
    </div>
  )
}
