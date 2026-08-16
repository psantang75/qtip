import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select'
import { InsightsSection } from '@/components/insights'
import TouchDetailPanel from '@/components/insights/agentActivity/TouchDetailPanel'
import { getTicketProductivity, type TouchDetailParams } from '@/services/insightsService'
import { getCsrTicketProductivity } from '@/services/insightsCsrService'

type Area = 'sales' | 'csr'

/** Yesterday (local) as YYYY-MM-DD — the most recent fully-closed day. */
function yesterdayISO(): string {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * On-demand validation for the Workload "touched" metric. Pick one agent + one
 * day and read the underlying CRM task actions / ticket notes live, so a manager
 * can see exactly which items make up a count that looks high. Nothing loads
 * until Run is pressed — the CRM read only fires on an explicit request. The same
 * detail view is also reachable inline from each Workload day row's "View" action.
 */
export default function WorkloadTouchValidationPage() {
  const [area, setArea] = useState<Area>('sales')
  const [employeeKey, setEmployeeKey] = useState<string>('')
  const [date, setDate] = useState<string>(yesterdayISO())
  const [submitted, setSubmitted] = useState<TouchDetailParams | null>(null)

  // Agent options come from the (cheap, warehouse-backed) Workload roster for the
  // selected area, deduped to one entry per employee. Loading this list does NOT
  // touch the CRM — only the touch-detail run does.
  const { data: roster, isLoading: rosterLoading } = useQuery({
    queryKey: ['touch-agents', area],
    queryFn: () => (area === 'csr'
      ? getCsrTicketProductivity({ period: 'current_month' })
      : getTicketProductivity({ period: 'current_month' })),
    staleTime: 5 * 60 * 1000,
  })

  const agents = useMemo(() => {
    const byKey = new Map<number, string>()
    for (const r of roster ?? []) if (!byKey.has(r.employeeKey)) byKey.set(r.employeeKey, r.agent)
    return [...byKey.entries()].map(([key, name]) => ({ key, name })).sort((a, b) => a.name.localeCompare(b.name))
  }, [roster])

  const canRun = !!employeeKey && !!date
  const run = () => { if (canRun) setSubmitted({ area, employeeKey: Number(employeeKey), date }) }

  // Reset the agent selection when the area changes (its roster differs).
  const onAreaChange = (v: string) => { setArea(v as Area); setEmployeeKey(''); setSubmitted(null) }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Workload Touch Validation</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Reconcile a Workload “touched” count: pick one agent and one day to list the individual CRM task actions and ticket notes behind it. Read live from the CRM on Run.
        </p>
      </div>

      <InsightsSection title="Pick an agent and a day">
        <div className="flex flex-wrap items-end gap-4">
          <div className="w-40">
            <Label className="text-xs text-slate-500">Section</Label>
            <Select value={area} onValueChange={onAreaChange}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="sales">Sales</SelectItem>
                <SelectItem value="csr">CSR</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="w-64">
            <Label className="text-xs text-slate-500">Agent</Label>
            <Select value={employeeKey} onValueChange={setEmployeeKey} disabled={rosterLoading || agents.length === 0}>
              <SelectTrigger className="mt-1">
                <SelectValue placeholder={rosterLoading ? 'Loading agents…' : 'Select agent'} />
              </SelectTrigger>
              <SelectContent>
                {agents.map((a) => (
                  <SelectItem key={a.key} value={String(a.key)}>{a.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="w-44">
            <Label className="text-xs text-slate-500">Day</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-1" />
          </div>

          <Button onClick={run} disabled={!canRun} className="bg-primary hover:bg-primary/90 text-white">
            <Search className="h-4 w-4 mr-2" />
            Run
          </Button>
        </div>
      </InsightsSection>

      {submitted && (
        <InsightsSection title="Touch detail">
          <TouchDetailPanel params={submitted} />
        </InsightsSection>
      )}
    </div>
  )
}
