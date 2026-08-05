/**
 * Attendance point bands and the discipline ladder, surfaced in List Management.
 *
 * WHY HERE and not under Admin -> Insights: these are OPERATIONAL POLICY, not
 * report configuration. Insights reads them; it does not own them. Putting them on
 * the Insights admin page would imply that changing a report changes the policy,
 * and the next reporting surface that needed them would have to reach into
 * Insights to find them.
 *
 * Time is entered as MM:SS because that is how the policy is written ("Late 3+",
 * "0:03:59"); seconds are the storage unit and never appear in the UI.
 *
 * Saving asks for an EFFECTIVE DATE and inserts a new version from that date
 * forward. Nothing already scored is rewritten — that is what keeps a delivered
 * warning defensible months later.
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
  getAttendanceConfig, savePointRules, saveWarningThresholds, recalculateAttendance,
  savePointsStartDate,
} from '@/services/insightsCsrService'
import type {
  AttendancePointRuleConfig, AttendanceThresholdConfig, PointRuleSavePayload, ThresholdSavePayload,
} from '@/services/insightsCsrService'

const CARD = 'bg-white rounded-xl border border-slate-200 p-4'
const SUBHEAD = 'text-[10px] font-semibold uppercase tracking-wide text-slate-400'

const today = () => new Date().toISOString().slice(0, 10)

/** 'M:SS' from seconds — how the policy table is written. Blank means unbounded. */
function toMmSs(seconds: number | null): string {
  if (seconds === null) return ''
  const m = Math.floor(seconds / 60)
  return `${m}:${String(seconds % 60).padStart(2, '0')}`
}

/** Parse 'M:SS' or plain minutes back to seconds. Returns null for blank. */
function fromMmSs(value: string): number | null {
  const trimmed = value.trim()
  if (trimmed === '') return null
  const parts = trimmed.split(':')
  const m = Number(parts[0]) || 0
  const s = parts.length > 1 ? Number(parts[1]) || 0 : 0
  return m * 60 + s
}

const KIND_LABEL: Record<string, string> = {
  LATE: 'Late arrival',
  EARLY_LEAVE: 'Left early',
  ABSENT: 'Absent',
  EXCEPTION: 'Logged exception',
}

export function AttendancePointBandsEditor() {
  const { toast } = useToast()
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({ queryKey: ['admin-attendance-config'], queryFn: getAttendanceConfig })

  const [draft, setDraft] = useState<AttendancePointRuleConfig[]>([])
  const [effectiveFrom, setEffectiveFrom] = useState(today())
  const [pointsStart, setPointsStart] = useState('')

  // Only the CURRENT version of each band is editable; retired versions are
  // history and are shown read-only below.
  useEffect(() => {
    if (data) {
      setDraft(data.rules.filter(r => r.effectiveTo === null))
      setPointsStart(data.pointsStartDate)
    }
  }, [data])

  const save = useMutation({
    mutationFn: () => savePointRules(effectiveFrom, draft.map(toPayload)),
    // Order is the display order the admin sees; it never affects which band
    // matches, because bands may not overlap.
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-attendance-config'] })
      toast({ title: `Point bands saved, effective ${effectiveFrom}` })
    },
    onError: (e) => toast(t.fromError(e)),
  })

  const recalc = useMutation({
    mutationFn: () => recalculateAttendance(addDays(today(), -90), today()),
    onSuccess: (r) => toast({ title: `Rescored ${r.daysScored} days through ${r.to}` }),
    onError: (e) => toast(t.fromError(e)),
  })

  const saveStart = useMutation({
    mutationFn: () => savePointsStartDate(pointsStart),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-attendance-config'] })
      toast({ title: `Points start date saved (${pointsStart})` })
    },
    onError: (e) => toast(t.fromError(e)),
  })

  const patch = (id: number, p: Partial<AttendancePointRuleConfig>) =>
    setDraft(rs => rs.map(r => (r.id === id ? { ...r, ...p } : r)))

  if (isLoading || !data) return <ListLoadingSkeleton />

  const retired = data.rules.filter(r => r.effectiveTo !== null)

  return (
    <div className="space-y-4">
      <div className={CARD}>
        <p className="text-[13px] text-slate-500 mb-4">
          How much a late arrival, an early departure or an absence is worth. Ranges are inclusive on both ends;
          anything below the lowest range is the grace period and earns nothing. Leave a maximum blank for no upper
          limit.
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
            {draft.map(r => {
              const bounded = r.kind === 'LATE' || r.kind === 'EARLY_LEAVE'
              return (
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
                    {bounded ? (
                      <Input
                        value={toMmSs(r.minSeconds)}
                        onChange={e => patch(r.id, { minSeconds: fromMmSs(e.target.value) ?? 0 })}
                        className="h-8 text-[13px] tabular-nums"
                      />
                    ) : (
                      <span className="text-[13px] text-slate-400">Full day</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {bounded ? (
                      <Input
                        value={toMmSs(r.maxSeconds)}
                        placeholder="No limit"
                        onChange={e => patch(r.id, { maxSeconds: fromMmSs(e.target.value) })}
                        className="h-8 text-[13px] tabular-nums"
                      />
                    ) : (
                      <span className="text-[13px] text-slate-400">Full day</span>
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
              )
            })}
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
        <p className={SUBHEAD}>Points start date</p>
        <div className="flex items-end justify-between gap-4 mt-2">
          <div className="space-y-1">
            <p className="text-[13px] text-slate-500 max-w-xl">
              The day the point system took effect. Punches and schedules before this date are never scored or counted,
              even though earlier history exists. After changing it, rescore the last 90 days to drop points that now
              fall before the new date.
            </p>
            <Input
              type="date"
              value={pointsStart}
              onChange={e => setPointsStart(e.target.value)}
              className="h-8 w-[160px] text-[13px]"
            />
          </div>
          <Button
            type="button"
            size="sm"
            className="gap-1.5 shrink-0"
            disabled={saveStart.isPending || !pointsStart}
            onClick={() => saveStart.mutate()}
          >
            <Save className="h-3.5 w-3.5" />
            {saveStart.isPending ? 'Saving…' : 'Save'}
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
                {r.label} · {toMmSs(r.minSeconds)}–{toMmSs(r.maxSeconds) || '∞'} · {r.points} pts ·{' '}
                {r.effectiveFrom} to {r.effectiveTo}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

export function AttendanceThresholdsEditor() {
  const { toast } = useToast()
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({ queryKey: ['admin-attendance-config'], queryFn: getAttendanceConfig })

  const [draft, setDraft] = useState<AttendanceThresholdConfig[]>([])
  const [effectiveFrom, setEffectiveFrom] = useState(today())

  useEffect(() => {
    if (data) setDraft(data.thresholds.filter(t2 => t2.effectiveTo === null))
  }, [data])

  const save = useMutation({
    mutationFn: () =>
      saveWarningThresholds(
        effectiveFrom,
        draft.map((d): ThresholdSavePayload => ({
          levelKey: d.levelKey,
          label: d.label,
          pointsThreshold: d.pointsThreshold,
          sortOrder: d.sortOrder,
          isActive: d.isActive,
        })),
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-attendance-config'] })
      toast({ title: `Thresholds saved, effective ${effectiveFrom}` })
    },
    onError: (e) => toast(t.fromError(e)),
  })

  if (isLoading || !data) return <ListLoadingSkeleton />

  const patch = (levelKey: string, p: Partial<AttendanceThresholdConfig>) =>
    setDraft(ts => ts.map(x => (x.levelKey === levelKey ? { ...x, ...p } : x)))

  return (
    <div className={CARD}>
      <p className="text-[13px] text-slate-500 mb-4">
        Rolling 90-day point totals at which each step is recommended. The Attendance report highlights who has
        reached each step; it does not create write-ups or coaching sessions on its own. Each step must require more
        points than the one before it.
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

function EffectiveFromFooter({ effectiveFrom, onChange, onSave, saving }: {
  effectiveFrom: string
  onChange: (v: string) => void
  onSave: () => void
  saving: boolean
}) {
  return (
    <div className="flex items-end justify-between gap-4 mt-4 pt-4 border-t border-slate-100">
      <div className="space-y-1">
        <Label htmlFor="effective-from" className={SUBHEAD}>Effective From</Label>
        <Input
          id="effective-from"
          type="date"
          value={effectiveFrom}
          onChange={e => onChange(e.target.value)}
          className="h-8 w-[160px] text-[13px]"
        />
        <p className="text-[11px] text-slate-400">Days before this date keep the rules they were scored under.</p>
      </div>
      <Button type="button" size="sm" className="gap-1.5 shrink-0" disabled={saving} onClick={onSave}>
        <Save className="h-3.5 w-3.5" />
        {saving ? 'Saving…' : 'Save'}
      </Button>
    </div>
  )
}

function toPayload(r: AttendancePointRuleConfig, index: number): PointRuleSavePayload {
  return {
    ruleKey: r.ruleKey,
    label: r.label,
    kind: r.kind,
    minSeconds: r.minSeconds,
    maxSeconds: r.maxSeconds,
    points: r.points,
    exceptionTypeId: r.exceptionTypeId,
    sortOrder: (index + 1) * 10,
    isActive: r.isActive,
  }
}

function addDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(y, m - 1, d + n)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}
