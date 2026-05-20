/**
 * Trusted-mode sampling card — random %, low-score auto-route,
 * low-confidence threshold, and per-question disagreement threshold.
 * All four fields save together because they're tightly related (they
 * all answer "which Trusted submissions should still be routed to QA?").
 */

import { useEffect, useState } from 'react'
import { Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useIsAdmin } from '@/hooks/useIsAdmin'
import { useAISettingsMutation, type AISettingsPayload } from './useAISettingsMutation'

interface Props {
  formId: number
  initialPct: number
  initialLowScoreAlways: boolean
  initialLowConfThreshold: number | null
  initialDisagreementThreshold: number | null
  criticalCap: number
}

function num2str(n: number | null): string {
  return n == null ? '' : String(Number(n))
}

export function SamplingCard({
  formId,
  initialPct,
  initialLowScoreAlways,
  initialLowConfThreshold,
  initialDisagreementThreshold,
  criticalCap,
}: Props) {
  const [pct, setPct] = useState(initialPct)
  const [lowScore, setLowScore] = useState(initialLowScoreAlways)
  const [lowConf, setLowConf] = useState(num2str(initialLowConfThreshold))
  const [disagree, setDisagree] = useState(num2str(initialDisagreementThreshold))
  const mut = useAISettingsMutation(formId)
  const isAdmin = useIsAdmin()

  useEffect(() => {
    setPct(initialPct)
    setLowScore(initialLowScoreAlways)
    setLowConf(num2str(initialLowConfThreshold))
    setDisagree(num2str(initialDisagreementThreshold))
  }, [initialPct, initialLowScoreAlways, initialLowConfThreshold, initialDisagreementThreshold])

  const dirty =
    pct !== initialPct ||
    lowScore !== initialLowScoreAlways ||
    lowConf.trim() !== num2str(initialLowConfThreshold) ||
    disagree.trim() !== num2str(initialDisagreementThreshold)

  const save = () => {
    const payload: AISettingsPayload = {
      ai_sample_review_pct: pct,
      ai_sample_low_score_always: lowScore,
    }
    const lc = lowConf.trim()
    if (lc === '') payload.ai_sample_low_confidence_threshold = null
    else {
      const n = Number(lc)
      if (Number.isFinite(n) && n >= 0 && n <= 1) payload.ai_sample_low_confidence_threshold = n
    }
    const dt = disagree.trim()
    if (dt === '') payload.ai_disagreement_route_threshold = null
    else {
      const n = Number(dt)
      if (Number.isFinite(n) && n >= 0 && n <= 1) payload.ai_disagreement_route_threshold = n
    }
    mut.mutate(payload)
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between gap-4">
        <div>
          <h2 className="text-[14px] font-semibold text-slate-900">Trusted-mode sampling</h2>
          <p className="text-[12px] text-slate-500">
            Only used when the form is in <span className="font-medium">Trusted</span> mode. A portion of AI-graded
            submissions is routed back to the AI Inbox for human re-audit.
          </p>
        </div>
        <Button
          size="sm"
          onClick={save}
          disabled={!isAdmin || !dirty || mut.isPending}
          title={!isAdmin ? 'Admin only' : undefined}
          className="bg-primary hover:bg-primary/90 text-white"
        >
          <Save className="h-3.5 w-3.5 mr-1" />
          {mut.isPending ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}
        </Button>
      </div>

      <div className="p-4 space-y-4 max-w-md">
        <div>
          <Label htmlFor="pct" className="text-[11px] text-slate-600">
            Random sample percentage: <span className="font-mono">{pct}%</span>
            <span className="ml-2 text-slate-400">— how often a SUBMITTED AI submission is randomly picked for human re-audit</span>
          </Label>
          <Input
            id="pct"
            type="range"
            min={0}
            max={100}
            step={5}
            value={pct}
            onChange={(e) => setPct(Number(e.target.value))}
            disabled={!isAdmin}
            className="w-full"
          />
        </div>

        <div className="flex items-start justify-between gap-3">
          <div>
            <Label htmlFor="lowscore" className="text-[12px] text-slate-700">
              Always re-audit submissions below the critical-fail cap
            </Label>
            <p className="text-[11px] text-slate-500 mt-0.5">
              On top of the random sample above, force a re-audit any time the AI's score lands below the form's
              Critical Fail Cap (currently <span className="font-mono">{criticalCap}%</span>, set on the form's
              Details tab). Catches the AI being too generous on weak interactions.
            </p>
          </div>
          <Switch id="lowscore" checked={lowScore} onCheckedChange={setLowScore} disabled={!isAdmin} />
        </div>

        <div>
          <Label htmlFor="lowconf" className="text-[12px] text-slate-700">
            Low-confidence routing threshold
            <span className="ml-2 text-[11px] font-normal text-slate-400">(0.00&ndash;1.00, blank = off)</span>
          </Label>
          <p className="text-[11px] text-slate-500 mt-0.5 mb-1.5">
            When the AI emits an <span className="font-mono">overall_confidence</span> below this number, the submission
            is automatically routed to the QA inbox &mdash; even if it wasn&rsquo;t in the random sample. Use this to
            shrink human review effort to the runs the AI itself was unsure about.
          </p>
          <Input
            id="lowconf"
            type="number"
            min={0}
            max={1}
            step={0.05}
            value={lowConf}
            onChange={(e) => setLowConf(e.target.value)}
            disabled={!isAdmin}
            placeholder="e.g. 0.7"
            className="max-w-[160px]"
          />
        </div>

        <div>
          <Label htmlFor="disagreethr" className="text-[12px] text-slate-700">
            Per-question disagreement route threshold
            <span className="ml-2 text-[11px] font-normal text-slate-400">(Cohen&rsquo;s &kappa; 0.00&ndash;1.00, blank = off)</span>
          </Label>
          <p className="text-[11px] text-slate-500 mt-0.5 mb-1.5">
            Routes a submission to QA when any one of its answers is on a question whose rolling per-question
            &kappa; (last 50 calibration data points) is below this floor. Useful for catching individual questions
            the AI is consistently wrong on, even when its overall confidence looks fine. Try <span className="font-mono">0.4</span>{' '}
            to start.
          </p>
          <Input
            id="disagreethr"
            type="number"
            min={0}
            max={1}
            step={0.05}
            value={disagree}
            onChange={(e) => setDisagree(e.target.value)}
            disabled={!isAdmin}
            placeholder="e.g. 0.4"
            className="max-w-[160px]"
          />
        </div>
      </div>
    </section>
  )
}
