/**
 * Adherence point bands, discipline ladder and settings, surfaced in List
 * Management next to Attendance. Same reasoning for living here: this is
 * OPERATIONAL POLICY, not report configuration.
 *
 * Bands are entered as M:SS, effective-dated on save. Settings carry the two
 * things bands cannot express: the report-only switch (points-active date) and
 * the asymmetric phone tolerance (how early the phone may go Break/Meal before
 * the punch, and how late it may stay after).
 */
import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { RefreshCw, Save } from 'lucide-react'

import { ListLoadingSkeleton } from '@/components/common/ListLoadingSkeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useToast } from '@/hooks/use-toast'
import { t } from '@/lib/t'
import {
  getAdherenceConfig, saveAdherenceRules, saveAdherenceThresholds,
  saveAdherenceSettings, recalculateAdherence,
} from '@/services/insightsAdherenceService'
import type {
  AdherencePointRuleConfig, AdherenceThresholdConfig, AdherencePointRuleSavePayload,
  AdherenceThresholdSavePayload, AdherenceSettings,
} from '@/services/insightsAdherenceService'
import {
  CARD, SUBHEAD, today, addDays, toMmSs, fromMmSs,
} from './listEditorShared'
import { EffectiveFromFooter } from './EffectiveFromFooter'

const CONFIG_KEY = ['admin-adherence-config']

const KIND_LABEL: Record<string, string> = {
  BREAK_DURATION: 'Break too long',
  LUNCH_DURATION: 'Lunch too long',
  BREAK_START: 'Break start time',
  LUNCH_START: 'Lunch start time',
  BREAK_PHONE_START: 'Break phone start match',
  BREAK_PHONE_STOP: 'Break phone stop match',
  LUNCH_PHONE_START: 'Lunch phone start match',
  LUNCH_PHONE_STOP: 'Lunch phone stop match',
  BREAK_MISSED: 'Break missed',
  LUNCH_MISSED: 'Lunch missed',
}

const isMissed = (kind: string) => kind === 'BREAK_MISSED' || kind === 'LUNCH_MISSED'

export function AdherencePointBandsEditor() {
  const { toast } = useToast()
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({ queryKey: CONFIG_KEY, queryFn: getAdherenceConfig })

  const [draft, setDraft] = useState<AdherencePointRuleConfig[]>([])
  const [effectiveFrom, setEffectiveFrom] = useState(today())
  const [settings, setSettings] = useState<AdherenceSettings | null>(null)

  useEffect(() => {
    if (data) {
      setDraft(data.rules.filter(r => r.effectiveTo === null))
      setSettings(data.settings)
    }
  }, [data])

  const save = useMutation({
    mutationFn: () => saveAdherenceRules(effectiveFrom, draft.map(toPayload)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: CONFIG_KEY })
      toast({ title: `Point bands saved, effective ${effectiveFrom}` })
    },
    onError: (e) => toast(t.fromError(e)),
  })

  const recalc = useMutation({
    mutationFn: () => recalculateAdherence(addDays(today(), -90), today()),
    onSuccess: (r) => toast({ title: `Rescored ${r.daysScored} days through ${r.to}` }),
    onError: (e) => toast(t.fromError(e)),
  })

  const saveSettings = useMutation({
    mutationFn: () => saveAdherenceSettings(settings!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: CONFIG_KEY })
      toast({ title: 'Adherence settings saved' })
    },
    onError: (e) => toast(t.fromError(e)),
  })

  const patch = (id: number, p: Partial<AdherencePointRuleConfig>) =>
    setDraft(rs => rs.map(r => (r.id === id ? { ...r, ...p } : r)))
  const patchSettings = (p: Partial<AdherenceSettings>) =>
    setSettings(s => (s ? { ...s, ...p } : s))

  if (isLoading || !data || !settings) return <ListLoadingSkeleton />

  const retired = data.rules.filter(r => r.effectiveTo !== null)

  return (
    <div className="space-y-4">
      <div className={CARD}>
        <p className="text-[13px] text-slate-500 mb-4">
          How much each break/lunch deviation is worth. Ranges are inclusive on both ends; anything below the lowest
          range is the grace period and earns nothing. Leave a maximum blank for no upper limit. Start-time bands are
          seeded at zero points so they log as occurrences only until you decide to score them.
        </p>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className={SUBHEAD}>Band</TableHead>
              <TableHead className={SUBHEAD}>Applies To</TableHead>
              <TableHead className={`${SUBHEAD} w-[110px]`}>Min (M:SS)</TableHead>
              <TableHead className={`${SUBHEAD} w-[110px]`}>Max (M:SS)</TableHead>
              <TableHead className={`${SUBHEAD} w-[100px]`}>Points</TableHead>
              <TableHead className={`${SUBHEAD} w-[80px]`}>Active</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {draft.map(r => (
              <TableRow key={r.id}>
                <TableCell>
                  <Input
                    value={r.label}
                    onChange={e => patch(r.id, { label: e.target.value })}
                    className="h-8 text-[13px]"
                  />
                </TableCell>
                <TableCell className="text-[13px] text-slate-500">{KIND_LABEL[r.kind] ?? r.kind}</TableCell>
                <TableCell>
                  {isMissed(r.kind) ? (
                    <span className="text-[13px] text-slate-400">Whole segment</span>
                  ) : (
                    <Input
                      value={toMmSs(r.minSeconds)}
                      onChange={e => patch(r.id, { minSeconds: fromMmSs(e.target.value) ?? 0 })}
                      className="h-8 text-[13px] tabular-nums"
                    />
                  )}
                </TableCell>
                <TableCell>
                  {isMissed(r.kind) ? (
                    <span className="text-[13px] text-slate-400">—</span>
                  ) : (
                    <Input
                      value={toMmSs(r.maxSeconds)}
                      placeholder="No limit"
                      onChange={e => patch(r.id, { maxSeconds: fromMmSs(e.target.value) })}
                      className="h-8 text-[13px] tabular-nums"
                    />
                  )}
                </TableCell>
                <TableCell>
                  <Input
                    type="number"
                    step="0.25"
                    min="0"
                    value={r.points}
                    onChange={e => patch(r.id, { points: Number(e.target.value) })}
                    className="h-8 text-[13px] tabular-nums"
                  />
                </TableCell>
                <TableCell>
                  <Switch checked={r.isActive} onCheckedChange={v => patch(r.id, { isActive: v })} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        <EffectiveFromFooter
          effectiveFrom={effectiveFrom}
          onChange={setEffectiveFrom}
          onSave={() => save.mutate()}
          saving={save.isPending}
        />
      </div>

      <div className={CARD}>
        <div className="flex items-center justify-between">
          <p className={SUBHEAD}>Settings</p>
          {!data.pointsActive && (
            <span className="text-[11px] font-medium text-warning">Report-only — points not yet counting</span>
          )}
        </div>
        <div className="grid grid-cols-2 gap-4 mt-3">
          <div className="space-y-1">
            <Label className={SUBHEAD}>Start date</Label>
            <Input
              type="date"
              value={settings.startDate}
              onChange={e => patchSettings({ startDate: e.target.value })}
              className="h-8 w-[160px] text-[13px]"
            />
            <p className="text-[11px] text-slate-400">Earliest date scored. History before it is never counted.</p>
          </div>
          <div className="space-y-1">
            <Label className={SUBHEAD}>Points active from</Label>
            <Input
              type="date"
              value={settings.pointsActiveFrom}
              onChange={e => patchSettings({ pointsActiveFrom: e.target.value })}
              className="h-8 w-[160px] text-[13px]"
            />
            <p className="text-[11px] text-slate-400">Before this date, occurrences are logged but score no points.</p>
          </div>
          <div className="space-y-1">
            <Label className={SUBHEAD}>Phone grace before (M:SS)</Label>
            <Input
              value={toMmSs(settings.phoneGraceBeforeSec)}
              onChange={e => patchSettings({ phoneGraceBeforeSec: fromMmSs(e.target.value) ?? 0 })}
              className="h-8 w-[160px] text-[13px] tabular-nums"
            />
            <p className="text-[11px] text-slate-400">How early the phone may go Break/Meal before the punch.</p>
          </div>
          <div className="space-y-1">
            <Label className={SUBHEAD}>Phone grace after (M:SS)</Label>
            <Input
              value={toMmSs(settings.phoneGraceAfterSec)}
              onChange={e => patchSettings({ phoneGraceAfterSec: fromMmSs(e.target.value) ?? 0 })}
              className="h-8 w-[160px] text-[13px] tabular-nums"
            />
            <p className="text-[11px] text-slate-400">How late the phone may stay Break/Meal after the punch.</p>
          </div>
          <div className="space-y-1">
            <Label className={SUBHEAD}>Compliance green ≥ (%)</Label>
            <Input
              type="number"
              min={0}
              max={100}
              value={settings.complianceGreenMin}
              onChange={e => patchSettings({ complianceGreenMin: Number(e.target.value) })}
              className="h-8 w-[160px] text-[13px] tabular-nums"
            />
            <p className="text-[11px] text-slate-400">At or above this compliance %, the roster cell is green.</p>
          </div>
          <div className="space-y-1">
            <Label className={SUBHEAD}>Compliance yellow ≥ (%)</Label>
            <Input
              type="number"
              min={0}
              max={100}
              value={settings.complianceYellowMin}
              onChange={e => patchSettings({ complianceYellowMin: Number(e.target.value) })}
              className="h-8 w-[160px] text-[13px] tabular-nums"
            />
            <p className="text-[11px] text-slate-400">At or above this is yellow; below it is red.</p>
          </div>
        </div>
        <div className="flex justify-end mt-4 pt-4 border-t border-slate-100">
          <Button type="button" size="sm" className="gap-1.5" disabled={saveSettings.isPending} onClick={() => saveSettings.mutate()}>
            <Save className="h-3.5 w-3.5" />
            {saveSettings.isPending ? 'Saving…' : 'Save settings'}
          </Button>
        </div>
      </div>

      <div className={CARD}>
        <p className={SUBHEAD}>Rescore</p>
        <div className="flex items-center justify-between gap-4 mt-2">
          <p className="text-[13px] text-slate-500">
            Days already scored keep the bands that were in force when they happened. To apply a change backwards on
            purpose, set the effective date into the past and then rescore the last 90 days.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0 gap-1.5"
            disabled={recalc.isPending}
            onClick={() => recalc.mutate()}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${recalc.isPending ? 'animate-spin' : ''}`} />
            Rescore last 90 days
          </Button>
        </div>
      </div>

      {retired.length > 0 && (
        <div className={CARD}>
          <p className={SUBHEAD}>Previous versions</p>
          <ul className="mt-2 space-y-1">
            {retired.map(r => (
              <li key={r.id} className="text-[12px] text-slate-500 tabular-nums">
                {r.label} · {isMissed(r.kind) ? 'whole segment' : `${toMmSs(r.minSeconds)}–${toMmSs(r.maxSeconds) || '∞'}`} ·{' '}
                {r.points} pts · {r.effectiveFrom} to {r.effectiveTo}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

export function AdherenceThresholdsEditor() {
  const { toast } = useToast()
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({ queryKey: CONFIG_KEY, queryFn: getAdherenceConfig })

  const [draft, setDraft] = useState<AdherenceThresholdConfig[]>([])
  const [effectiveFrom, setEffectiveFrom] = useState(today())

  useEffect(() => {
    if (data) setDraft(data.thresholds.filter(x => x.effectiveTo === null))
  }, [data])

  const save = useMutation({
    mutationFn: () =>
      saveAdherenceThresholds(
        effectiveFrom,
        draft.map((d): AdherenceThresholdSavePayload => ({
          levelKey: d.levelKey,
          label: d.label,
          pointsThreshold: d.pointsThreshold,
          sortOrder: d.sortOrder,
          isActive: d.isActive,
        })),
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: CONFIG_KEY })
      toast({ title: `Thresholds saved, effective ${effectiveFrom}` })
    },
    onError: (e) => toast(t.fromError(e)),
  })

  if (isLoading || !data) return <ListLoadingSkeleton />

  const patch = (levelKey: string, p: Partial<AdherenceThresholdConfig>) =>
    setDraft(ts => ts.map(x => (x.levelKey === levelKey ? { ...x, ...p } : x)))

  return (
    <div className={CARD}>
      <p className="text-[13px] text-slate-500 mb-4">
        Rolling 90-day point totals at which each step is recommended. The Adherence report highlights who has reached
        each step; it does not create write-ups or coaching sessions on its own. Each step must require more points than
        the one before it.
      </p>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className={SUBHEAD}>Step</TableHead>
            <TableHead className={`${SUBHEAD} w-[140px]`}>Points</TableHead>
            <TableHead className={`${SUBHEAD} w-[80px]`}>Active</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {[...draft].sort((a, b) => a.sortOrder - b.sortOrder).map(x => (
            <TableRow key={x.levelKey}>
              <TableCell>
                <Input
                  value={x.label}
                  onChange={e => patch(x.levelKey, { label: e.target.value })}
                  className="h-8 text-[13px]"
                />
              </TableCell>
              <TableCell>
                <Input
                  type="number"
                  step="0.5"
                  min="0"
                  value={x.pointsThreshold}
                  onChange={e => patch(x.levelKey, { pointsThreshold: Number(e.target.value) })}
                  className="h-8 text-[13px] tabular-nums"
                />
              </TableCell>
              <TableCell>
                <Switch checked={x.isActive} onCheckedChange={v => patch(x.levelKey, { isActive: v })} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <EffectiveFromFooter
        effectiveFrom={effectiveFrom}
        onChange={setEffectiveFrom}
        onSave={() => save.mutate()}
        saving={save.isPending}
      />
    </div>
  )
}

function toPayload(r: AdherencePointRuleConfig, index: number): AdherencePointRuleSavePayload {
  return {
    ruleKey: r.ruleKey,
    label: r.label,
    kind: r.kind,
    minSeconds: r.minSeconds,
    maxSeconds: r.maxSeconds,
    points: r.points,
    sortOrder: (index + 1) * 10,
    isActive: r.isActive,
  }
}
