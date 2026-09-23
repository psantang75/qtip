/**
 * Missed Opportunities engine settings — the report's methodology in one place,
 * split into tabs so no single area (especially Sales Plays mining) crowds the
 * page: Grading (thresholds, persona, KB grounding), Rules (the rule sets the
 * model applies), Sales Plays (the learning-loop miner + plays review), and
 * Re-grade a day (a manual re-run after a rule change).
 *
 * Lives under Admin → Insights Engine (not on the reporting page): these are
 * engine controls, and every write is Admin-only, enforced server-side and
 * surfaced here via `canEdit`. See .cursor/rules/insights-report-page.mdc.
 *
 * Props are optional so it can render standalone on the admin page; when a
 * report passes the day it is showing, the re-grade defaults to that day.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Play, ShieldAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useToast } from '@/hooks/use-toast'
import { getErrorMessage } from '@/utils/errorHandling'
import {
  createMissedOpportunityRule,
  getMissedOpportunityRules,
  getMissedOpportunityRunStatus,
  runMissedOpportunities,
  saveMissedOpportunitySettings,
  updateMissedOpportunityRule,
} from '@/services/missedOpportunitiesService'
import type {
  CreateRuleInput,
  MissedOpportunityRunInfo,
  MissedOpportunityRunStatus,
  MissedOpportunitySettings,
  UpdateRuleInput,
} from '@/types/missedOpportunities'
import { useEffect, useState } from 'react'
import KbGroundingCard from './KbGroundingCard'
import NewRuleCard from './NewRuleCard'
import PersonaCard from './PersonaCard'
import RuleCard from './RuleCard'
import SalesPlaysCard from './SalesPlaysCard'
import ScheduleCard from './ScheduleCard'
import ThresholdsCard from './ThresholdsCard'

const RULES_KEY = ['insights', 'sales', 'missed-opportunities', 'rules'] as const

interface SettingsTabProps {
  /** The day a report is showing (ISO) — the default target for a re-grade. Omitted on the admin page. */
  selectedDay?: string
  /** That day's run, or null if it was never graded. Omitted on the admin page. */
  run?: MissedOpportunityRunInfo | null
}

/** Yesterday, ISO — the newest day the nightly run can have graded. */
const yesterdayISO = () => {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const TERMINAL = new Set(['SUCCESS', 'PARTIAL', 'FAILED'])
const POLL_MS = 4000
const RUN_TIMEOUT_MS = 8 * 60 * 1000

/**
 * Start a re-grade and follow the background run to completion. The POST returns
 * immediately (the run is minutes of LLM calls); we then poll the run row until
 * it leaves RUNNING with a fresh finish stamp, so the button reflects the real
 * outcome instead of the old synchronous request that timed out.
 */
async function runAndWait(date: string): Promise<MissedOpportunityRunStatus> {
  const prevFinished = (await getMissedOpportunityRunStatus(date))?.finishedAt ?? null
  await runMissedOpportunities(date)
  const deadline = Date.now() + RUN_TIMEOUT_MS
  let sawRunning = false
  for (;;) {
    await sleep(POLL_MS)
    const s = await getMissedOpportunityRunStatus(date)
    if (s?.status === 'RUNNING') sawRunning = true
    if (s?.status && TERMINAL.has(s.status) && (sawRunning || s.finishedAt !== prevFinished)) {
      return s
    }
    if (Date.now() > deadline) {
      throw new Error('The re-grade is taking longer than expected — it may still finish. Refresh in a minute.')
    }
  }
}

export default function MissedOpportunitySettingsTab({ selectedDay, run }: SettingsTabProps) {
  const qc = useQueryClient()
  const { toast } = useToast()
  // Follows the report's day when embedded; defaults to yesterday on the admin page.
  const [runDate, setRunDate] = useState(selectedDay ?? yesterdayISO())
  useEffect(() => { if (selectedDay) setRunDate(selectedDay) }, [selectedDay])

  const { data, isLoading } = useQuery({
    queryKey: RULES_KEY,
    queryFn: getMissedOpportunityRules,
  })

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: RULES_KEY })
  }

  const onError = (title: string) => (e: unknown) => {
    toast({ title, description: getErrorMessage(e, 'Try again.'), variant: 'destructive' })
  }

  const updateMut = useMutation({
    mutationFn: ({ ruleId, patch }: { ruleId: number; patch: UpdateRuleInput }) =>
      updateMissedOpportunityRule(ruleId, patch),
    onSuccess: () => { invalidate(); toast({ title: 'Rule saved' }) },
    onError: onError("Couldn't save rule"),
  })

  const createMut = useMutation({
    mutationFn: (input: CreateRuleInput) => createMissedOpportunityRule(input),
    onSuccess: () => { invalidate(); toast({ title: 'Rule added' }) },
    onError: onError("Couldn't add rule"),
  })

  const settingsMut = useMutation({
    mutationFn: (patch: Partial<MissedOpportunitySettings>) => saveMissedOpportunitySettings(patch),
    onSuccess: () => { invalidate(); toast({ title: 'Settings saved' }) },
    onError: onError("Couldn't save settings"),
  })

  const runMut = useMutation({
    mutationFn: (date: string) => runAndWait(date || yesterdayISO()),
    onSuccess: (s) => {
      // Re-grading replaces that day's findings, so the report must refetch.
      qc.invalidateQueries({ queryKey: ['insights', 'sales', 'missed-opportunities'] })
      if (s.status === 'FAILED') {
        toast({
          title: 'Re-grade failed',
          description: s.errorText ?? 'The run did not complete.',
          variant: 'destructive',
        })
        return
      }
      toast({
        title: `Re-graded ${s.runDate ?? 'the prior business day'}`,
        description:
          `${s.findingsCount} finding(s) across ${s.callsAnalyzed} analyzed call(s)` +
          `${s.callsFailed ? `, ${s.callsFailed} failed` : ''}. $${s.usdCost.toFixed(2)}.`,
      })
    },
    onError: onError('Run failed'),
  })

  if (isLoading || !data) {
    return <p className="py-8 text-center text-sm text-slate-400">Loading rule sets…</p>
  }

  const { rules, settings, salesAgents, canEdit } = data
  const activeCount = rules.filter((r) => r.is_active).length

  return (
    <div className="space-y-4">
      {!canEdit && (
        <div className="flex items-start gap-2 rounded-xl border border-slate-200 bg-surface px-4 py-3">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
          <p className="text-[12.5px] text-slate-600">
            Read-only. These are the rules the report graded against — only an Administrator can
            change them or re-run a day.
          </p>
        </div>
      )}

      <Tabs defaultValue="grading" className="space-y-4">
        <TabsList>
          <TabsTrigger value="grading">Grading</TabsTrigger>
          <TabsTrigger value="rules">Rules</TabsTrigger>
          <TabsTrigger value="plays">Sales Plays</TabsTrigger>
          {canEdit && <TabsTrigger value="regrade">Re-grade a day</TabsTrigger>}
        </TabsList>

        <TabsContent value="grading" className="space-y-4">
          <ScheduleCard
            settings={settings}
            canEdit={canEdit}
            saving={settingsMut.isPending}
            onSave={(patch) => settingsMut.mutate(patch)}
          />

          <ThresholdsCard
            settings={settings}
            salesAgents={salesAgents ?? []}
            canEdit={canEdit}
            saving={settingsMut.isPending}
            onSave={(patch) => settingsMut.mutate(patch)}
          />

          <PersonaCard
            settings={settings}
            canEdit={canEdit}
            saving={settingsMut.isPending}
            onSave={(patch) => settingsMut.mutate(patch)}
          />

          <KbGroundingCard
            settings={settings}
            canEdit={canEdit}
            saving={settingsMut.isPending}
            onSave={(patch) => settingsMut.mutate(patch)}
          />
        </TabsContent>

        <TabsContent value="rules" className="space-y-4">
          <section className="rounded-xl border border-slate-200 bg-white">
            <div className="border-b border-slate-100 px-4 py-3">
              <h2 className="text-[14px] font-semibold text-slate-900">Rule sets</h2>
              <p className="text-[12px] text-slate-500">
                {activeCount} of {rules.length} active. Every active rule is sent to the model with
                each call; a finding always names the rule it came from, so turning a rule off stops
                that category of miss from being reported going forward.
              </p>
            </div>
            <div className="space-y-3 p-4">
              {rules.map((rule) => (
                <RuleCard
                  key={rule.rule_id}
                  rule={rule}
                  canEdit={canEdit}
                  saving={updateMut.isPending}
                  onSave={(ruleId, patch) => updateMut.mutate({ ruleId, patch })}
                />
              ))}
              {canEdit && (
                <NewRuleCard saving={createMut.isPending} onCreate={(input) => createMut.mutate(input)} />
              )}
            </div>
          </section>
        </TabsContent>

        <TabsContent value="plays" className="space-y-4">
          <SalesPlaysCard salesAgents={salesAgents ?? []} />
        </TabsContent>

        {canEdit && (
          <TabsContent value="regrade" className="space-y-4">
            <section className="rounded-xl border border-slate-200 bg-white">
              <div className="border-b border-slate-100 px-4 py-3">
                <h2 className="text-[14px] font-semibold text-slate-900">Re-grade a day</h2>
                <p className="text-[12px] text-slate-500">
                  Rule changes only affect future runs. Re-grade a day to apply them retroactively —
                  this replaces that day's findings and spends against the daily cap.
                </p>
              </div>
              <div className="flex flex-wrap items-end gap-3 p-4">
                <div>
                  <Label className="text-[12px] font-medium text-slate-800">Business day</Label>
                  <Input
                    type="date"
                    value={runDate}
                    onChange={(e) => setRunDate(e.target.value)}
                    className="mt-1 w-44"
                  />
                </div>
                <Button
                  size="sm"
                  onClick={() => runMut.mutate(runDate)}
                  disabled={runMut.isPending}
                  className="bg-primary text-white hover:bg-primary/90"
                >
                  <Play className="mr-1 h-3.5 w-3.5" />
                  {runMut.isPending ? 'Running…' : 'Re-grade'}
                </Button>
                <p className="text-[11px] text-slate-400">
                  {runMut.isPending
                    ? 'Grading runs in the background — this can take a few minutes. Leave this open.'
                    : run
                      ? `${run.runDate}: ${run.status}, ${run.findingsCount} finding(s), $${run.usdCost.toFixed(2)}.`
                      : 'Re-grades the selected business day and replaces its findings.'}
                </p>
              </div>
            </section>
          </TabsContent>
        )}
      </Tabs>
    </div>
  )
}
