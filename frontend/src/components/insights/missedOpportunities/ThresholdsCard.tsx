/**
 * Thresholds card for the Missed Opportunities Settings tab — the scalars that
 * decide which calls get graded and how much a run may spend. Stored in
 * `ie_config`; the server re-validates every range, so this form is a
 * convenience, not the guard.
 */
import { useEffect, useState } from 'react'
import { Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { StagedMultiSelect } from '@/components/common/StagedMultiSelect'
import { cn } from '@/lib/utils'
import type { MissedOpportunitySettings } from '@/types/missedOpportunities'

const TIERS = [
  { value: 'cheap' as const, label: 'Cheap', hint: 'Fast, low cost per call' },
  { value: 'reasoning' as const, label: 'Reasoning', hint: 'Slower, catches subtler misses' },
]

const pillCls = (selected: boolean, disabled: boolean) => cn(
  'rounded-full border px-3 py-1 text-[12px] font-medium transition-colors',
  selected
    ? 'border-[#00aeef] bg-primary/10 text-primary'
    : 'border-slate-200 bg-white text-slate-500',
  disabled ? 'cursor-not-allowed opacity-60' : 'hover:border-slate-300',
)

interface ThresholdsCardProps {
  settings: MissedOpportunitySettings
  /** Sales roster from the phone system — the exact names the worker matches. */
  salesAgents: string[]
  canEdit: boolean
  saving: boolean
  onSave: (patch: Partial<MissedOpportunitySettings>) => void
}

export default function ThresholdsCard({
  settings, salesAgents, canEdit, saving, onSave,
}: ThresholdsCardProps) {
  const [minTalk, setMinTalk] = useState(String(settings.minTalkSecs))
  const [excluded, setExcluded] = useState<string[]>(settings.excludedAgents)
  const [cap, setCap] = useState(String(settings.dailyUsdCap))
  const [maxCalls, setMaxCalls] = useState(String(settings.maxCallsPerRun))
  const [tier, setTier] = useState(settings.modelTier)

  useEffect(() => {
    setMinTalk(String(settings.minTalkSecs))
    setExcluded(settings.excludedAgents)
    setCap(String(settings.dailyUsdCap))
    setMaxCalls(String(settings.maxCallsPerRun))
    setTier(settings.modelTier)
  }, [settings])

  const sameAgents = (a: string[], b: string[]) =>
    a.length === b.length && [...a].sort().every((v, i) => v === [...b].sort()[i])

  const dirty =
    minTalk !== String(settings.minTalkSecs) ||
    !sameAgents(excluded, settings.excludedAgents) ||
    cap !== String(settings.dailyUsdCap) ||
    maxCalls !== String(settings.maxCallsPerRun) ||
    tier !== settings.modelTier

  // A stored exclusion whose rep has left the phone roster would silently vanish
  // from a picker that only offers current names, so keep it selectable.
  const agentOptions = [...new Set([...salesAgents, ...settings.excludedAgents])]
    .sort((a, b) => a.localeCompare(b))

  const save = () => onSave({
    minTalkSecs: Number(minTalk),
    excludedAgents: excluded,
    dailyUsdCap: Number(cap),
    maxCallsPerRun: Number(maxCalls),
    modelTier: tier,
  })

  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <div className="flex items-center justify-between gap-4 border-b border-slate-100 px-4 py-3">
        <div>
          <h2 className="text-[14px] font-semibold text-slate-900">Run thresholds</h2>
          <p className="text-[12px] text-slate-500">
            Which calls the nightly run grades, and the ceiling on what it may spend.
          </p>
        </div>
        <Button
          size="sm"
          onClick={save}
          disabled={!canEdit || !dirty || saving}
          title={!canEdit ? 'Admin only' : undefined}
          className="bg-primary text-white hover:bg-primary/90"
        >
          <Save className="mr-1 h-3.5 w-3.5" />
          {saving ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2">
        <div>
          <Label className="text-[12px] font-medium text-slate-800">Minimum talk time (seconds)</Label>
          <p className="text-[11px] text-slate-500">
            Calls shorter than this are never graded — there is no opportunity to miss on a 20-second dial.
          </p>
          <Input
            type="number" min={30} max={3600}
            value={minTalk}
            onChange={(e) => setMinTalk(e.target.value)}
            disabled={!canEdit}
            className="mt-1"
          />
        </div>

        <div>
          <Label className="text-[12px] font-medium text-slate-800">Max calls per run</Label>
          <p className="text-[11px] text-slate-500">
            Safety cap. If a day exceeds it the run stops early and reports PARTIAL rather than overspending.
          </p>
          <Input
            type="number" min={1} max={2000}
            value={maxCalls}
            onChange={(e) => setMaxCalls(e.target.value)}
            disabled={!canEdit}
            className="mt-1"
          />
        </div>

        <div>
          <Label className="text-[12px] font-medium text-slate-800">Daily cost cap (USD)</Label>
          <p className="text-[11px] text-slate-500">
            Hard ceiling per run. Checked before each call, so the run stops at the cap instead of after it.
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
          <Label className="text-[12px] font-medium text-slate-800">Model tier</Label>
          <p className="text-[11px] text-slate-500">
            {TIERS.find((t) => t.value === tier)?.hint}
          </p>
          <div className="mt-1.5 flex gap-2">
            {TIERS.map((t) => (
              <button
                key={t.value}
                type="button"
                onClick={() => canEdit && setTier(t.value)}
                disabled={!canEdit}
                className={pillCls(tier === t.value, !canEdit)}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className="sm:col-span-2">
          <Label className="text-[12px] font-medium text-slate-800">Excluded agents</Label>
          <p className="text-[11px] text-slate-500">
            Reps skipped entirely — for those whose calls this rule set does not apply to
            (e.g. BDRs booking appointments rather than closing).
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            {canEdit ? (
              <StagedMultiSelect
                options={agentOptions}
                selected={excluded}
                onApply={setExcluded}
                placeholder="No one excluded"
                width="w-[260px]"
              />
            ) : (
              <span className="text-[12.5px] text-slate-600">
                {settings.excludedAgents.length > 0
                  ? settings.excludedAgents.join(', ')
                  : 'No one excluded'}
              </span>
            )}
            {canEdit && excluded.length > 0 && (
              <span className="text-[11px] text-slate-400">{excluded.join(', ')}</span>
            )}
          </div>
          {canEdit && agentOptions.length === 0 && (
            <p className="mt-1 text-[11px] text-warning">
              The Sales roster could not be read from the phone system, so there is nothing to pick.
            </p>
          )}
        </div>
      </div>
    </section>
  )
}
