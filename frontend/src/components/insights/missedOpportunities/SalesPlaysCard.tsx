/**
 * Sales Plays card (Phase 2 learning loop) for the Missed Opportunities Settings
 * tab. Self-contained: owns its query + mutations so the parent only supplies the
 * Sales roster for the picker.
 *
 * The `enabled` switch is the whole safety valve — off means the monthly miner
 * never runs AND approved plays are not injected into recommendations, so the
 * review reverts to KB-only grounding. Everything else (roster, seed window,
 * monthly cap) is re-validated server-side; this form is a convenience.
 */
import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Save, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { StagedMultiSelect } from '@/components/common/StagedMultiSelect'
import { useToast } from '@/hooks/use-toast'
import { getErrorMessage } from '@/utils/errorHandling'
import {
  getSalesPlays,
  mineSalesPlaysNow,
  saveSalesPlaysSettings,
  updateSalesPlay,
} from '@/services/salesPlaysService'
import type { SalesPlaysSettings, UpdatePlayInput } from '@/types/salesPlays'
import PlayRow from './PlayRow'

const PLAYS_KEY = ['insights', 'sales', 'missed-opportunities', 'plays'] as const
const STATUS_ORDER = ['proposed', 'active', 'archived'] as const

interface SalesPlaysCardProps {
  /** Sales roster from the phone system — the exact names the miner matches. */
  salesAgents: string[]
}

export default function SalesPlaysCard({ salesAgents }: SalesPlaysCardProps) {
  const qc = useQueryClient()
  const { toast } = useToast()
  const { data, isLoading } = useQuery({ queryKey: PLAYS_KEY, queryFn: getSalesPlays })

  const [roster, setRoster] = useState<string[]>([])
  const [seedDays, setSeedDays] = useState('')
  const [cap, setCap] = useState('')
  const [schedDay, setSchedDay] = useState('')
  const [schedHour, setSchedHour] = useState('')

  useEffect(() => {
    if (!data) return
    setRoster(data.settings.roster)
    setSeedDays(String(data.settings.seedDays))
    setCap(String(data.settings.monthlyUsdCap))
    setSchedDay(String(data.settings.scheduleDay))
    setSchedHour(String(data.settings.scheduleHour))
  }, [data])

  const invalidate = () => qc.invalidateQueries({ queryKey: PLAYS_KEY })
  const onError = (title: string) => (e: unknown) =>
    toast({ title, description: getErrorMessage(e, 'Try again.'), variant: 'destructive' })

  const settingsMut = useMutation({
    mutationFn: (patch: Partial<SalesPlaysSettings>) => saveSalesPlaysSettings(patch),
    onSuccess: () => { invalidate(); toast({ title: 'Sales plays settings saved' }) },
    onError: onError("Couldn't save settings"),
  })

  const playMut = useMutation({
    mutationFn: ({ playId, patch }: { playId: number; patch: UpdatePlayInput }) =>
      updateSalesPlay(playId, patch),
    onSuccess: () => { invalidate(); toast({ title: 'Play updated' }) },
    onError: onError("Couldn't update play"),
  })

  const mineMut = useMutation({
    mutationFn: () => mineSalesPlaysNow(),
    onSuccess: () => toast({
      title: 'Mining started',
      description: 'Runs in the background; new plays appear here as “proposed” when done.',
    }),
    onError: onError("Couldn't start mining"),
  })

  if (isLoading || !data) {
    return <p className="py-6 text-center text-sm text-slate-400">Loading sales plays…</p>
  }

  const { settings, plays, canEdit } = data
  const sameList = (a: string[], b: string[]) =>
    a.length === b.length && [...a].sort().every((v, i) => v === [...b].sort()[i])
  const dirty =
    !sameList(roster, settings.roster) ||
    seedDays !== String(settings.seedDays) ||
    cap !== String(settings.monthlyUsdCap) ||
    schedDay !== String(settings.scheduleDay) ||
    schedHour !== String(settings.scheduleHour)

  const rosterOptions = [...new Set([...salesAgents, ...settings.roster])]
    .sort((a, b) => a.localeCompare(b))

  const activeCount = plays.filter((p) => p.status === 'active').length
  const proposedCount = plays.filter((p) => p.status === 'proposed').length

  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-4 py-3">
        <div>
          <h2 className="text-[14px] font-semibold text-slate-900">Sales plays (learning loop)</h2>
          <p className="text-[12px] text-slate-500">
            Monthly, the miner reads the active team’s WON/LOST calls since it last ran and proposes
            reusable plays. Approve the good ones and they ground the review’s recommendations.
            {proposedCount > 0 && ` ${proposedCount} awaiting review.`}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-[12px] text-slate-500">{settings.enabled ? 'On' : 'Off'}</span>
          <Switch
            checked={settings.enabled}
            disabled={!canEdit || settingsMut.isPending}
            onCheckedChange={(v) => settingsMut.mutate({ enabled: v })}
          />
        </div>
      </div>

      {settings.enabled && (
        <>
          <div className="grid grid-cols-1 gap-4 border-b border-slate-100 p-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label className="text-[12px] font-medium text-slate-800">Reps to learn from</Label>
              <p className="text-[11px] text-slate-500">
                Only these reps’ calls are mined. Keep it to the current active sales team.
              </p>
              <div className="mt-1.5">
                {canEdit ? (
                  <StagedMultiSelect
                    options={rosterOptions}
                    selected={roster}
                    onApply={setRoster}
                    placeholder="No reps selected"
                    width="w-[260px]"
                  />
                ) : (
                  <span className="text-[12.5px] text-slate-600">
                    {settings.roster.join(', ') || 'No reps selected'}
                  </span>
                )}
              </div>
            </div>

            <div>
              <Label className="text-[12px] font-medium text-slate-800">First-run lookback (days)</Label>
              <p className="text-[11px] text-slate-500">
                Only used the first time (or after a reset). Later runs resume from the last mined day.
              </p>
              <Input
                type="number" min={7} max={365}
                value={seedDays}
                onChange={(e) => setSeedDays(e.target.value)}
                disabled={!canEdit}
                className="mt-1"
              />
            </div>

            <div>
              <Label className="text-[12px] font-medium text-slate-800">Monthly cost cap (USD)</Label>
              <p className="text-[11px] text-slate-500">
                Hard ceiling per mine. Checked before each call, so a run stops at the cap, not after it.
              </p>
              <Input
                type="number" min={1} max={500} step={0.5}
                value={cap}
                onChange={(e) => setCap(e.target.value)}
                disabled={!canEdit}
                className="mt-1"
              />
            </div>

            <div>
              <Label className="text-[12px] font-medium text-slate-800">Mine on day of month</Label>
              <p className="text-[11px] text-slate-500">
                1–28, so the schedule still fires in February. It mines once per month; a restart in
                between cannot trigger a second one.
              </p>
              <Input
                type="number" min={1} max={28}
                value={schedDay}
                onChange={(e) => setSchedDay(e.target.value)}
                disabled={!canEdit}
                className="mt-1"
              />
            </div>

            <div>
              <Label className="text-[12px] font-medium text-slate-800">Mine after hour</Label>
              <p className="text-[11px] text-slate-500">
                Earliest hour on that day, Eastern. Spend for every mine is on Admin → Insights → AI
                Spend.
              </p>
              <Input
                type="number" min={0} max={23}
                value={schedHour}
                onChange={(e) => setSchedHour(e.target.value)}
                disabled={!canEdit}
                className="mt-1"
              />
            </div>

            <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
              <Button
                size="sm"
                disabled={!canEdit || !dirty || settingsMut.isPending}
                onClick={() => settingsMut.mutate({
                  roster,
                  seedDays: Number(seedDays),
                  monthlyUsdCap: Number(cap),
                  scheduleDay: Number(schedDay),
                  scheduleHour: Number(schedHour),
                })}
                className="bg-primary text-white hover:bg-primary/90"
              >
                <Save className="mr-1 h-3.5 w-3.5" />
                {settingsMut.isPending ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}
              </Button>
              {canEdit && (
                <Button
                  size="sm" variant="outline"
                  disabled={mineMut.isPending}
                  onClick={() => mineMut.mutate()}
                >
                  <Sparkles className="mr-1 h-3.5 w-3.5" />
                  {mineMut.isPending ? 'Starting…' : 'Mine now'}
                </Button>
              )}
              <span className="text-[11px] text-slate-400">
                {settings.lastMined ? `Last mined ${settings.lastMined}.` : 'Never mined.'}
                {` ${activeCount} active play(s).`}
              </span>
            </div>
          </div>

          <div className="space-y-2.5 p-4">
            {plays.length === 0 ? (
              <p className="text-[12.5px] text-slate-500">
                No plays yet. Run “Mine now” or wait for the monthly run to propose some.
              </p>
            ) : (
              [...plays]
                .sort((a, b) =>
                  STATUS_ORDER.indexOf(a.status as (typeof STATUS_ORDER)[number]) -
                  STATUS_ORDER.indexOf(b.status as (typeof STATUS_ORDER)[number]))
                .map((play) => (
                  <PlayRow
                    key={play.playId}
                    play={play}
                    canEdit={canEdit}
                    saving={playMut.isPending}
                    onUpdate={(playId, patch) => playMut.mutate({ playId, patch })}
                  />
                ))
            )}
          </div>
        </>
      )}
    </section>
  )
}
