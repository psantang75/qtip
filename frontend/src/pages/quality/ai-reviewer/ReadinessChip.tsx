/**
 * ReadinessChip — small inline status pill that tells the QA admin
 * whether the form is ready to flip between Calibrating and Trusted.
 *
 * The flip itself is still a manual click on the existing toggle in the
 * Settings card. This chip is advisory only — it shows when the rolling
 * agreement metric crosses a configured threshold so the human doesn't
 * have to stare at raw percentages to know when it's safe.
 *
 * Hidden when the recommendation is STAY_CALIBRATING (no nag) so the
 * UI stays quiet during normal calibration runs.
 */

import { useQuery } from '@tanstack/react-query'
import { CheckCircle2, AlertTriangle, Hourglass } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import aiReviewerService from '@/services/aiReviewerService'

interface Props {
  formId: number
}

export function ReadinessChip({ formId }: Props) {
  const readinessQ = useQuery({
    queryKey: ['ai-reviewer-readiness', formId],
    queryFn: () => aiReviewerService.getModeReadiness(formId),
    staleTime: 30 * 1000,
    enabled: Number.isFinite(formId) && formId > 0,
  })

  const r = readinessQ.data
  if (!r) return null

  if (r.recommendation === 'STAY_CALIBRATING') return null

  const kappa = r.rolling_kappa
  const kappaStr = kappa != null ? kappa.toFixed(2) : '—'
  const pct = r.rolling_agreement != null ? `${Math.round(r.rolling_agreement * 1000) / 10}%` : '—'
  const remaining = Math.max(0, r.thresholds.promote_min_samples - r.sample_count)

  let icon, label, className, tooltip
  switch (r.recommendation) {
    case 'PROMOTE_TO_TRUSTED':
      icon = <CheckCircle2 className="h-3 w-3" />
      label = `Ready to promote (\u03BA ${kappaStr})`
      className = 'text-emerald-700 bg-emerald-50 border-emerald-200'
      tooltip = `Cohen's kappa is ${kappaStr} across ${r.sample_count} samples (\u2265 ${r.thresholds.promote_kappa.toFixed(2)} kappa / ${r.thresholds.promote_min_samples} samples required). Raw agreement: ${pct}. Kappa is chance-corrected so a skewed-distribution question doesn't make the AI look great by always picking the majority class. Toggle "Save AI submissions as DRAFT" off to switch to Trusted.`
      break
    case 'CONSIDER_DEMOTE':
      icon = <AlertTriangle className="h-3 w-3" />
      label = `Consider demoting (\u03BA ${kappaStr})`
      className = 'text-amber-700 bg-amber-50 border-amber-200'
      tooltip = `Cohen's kappa dropped to ${kappaStr} across ${r.sample_count} samples (last 30d: ${r.last_30d_count}). Below ${r.thresholds.demote_kappa.toFixed(2)} suggests the AI is drifting \u2014 flip back to Calibrating to gather more human corrections.`
      break
    case 'INSUFFICIENT_DATA':
    default:
      icon = <Hourglass className="h-3 w-3" />
      label =
        remaining > 0
          ? `Calibrating \u2014 ${remaining} more sample${remaining === 1 ? '' : 's'} to evaluate`
          : 'Calibrating \u2014 gathering data'
      className = 'text-slate-600 bg-slate-50 border-slate-200'
      tooltip = `${r.sample_count} of ${r.thresholds.promote_min_samples} samples collected. The system needs at least ${r.thresholds.promote_min_samples} promoted drafts or sample re-audits before it can recommend a mode change.`
      break
  }

  return (
    <TooltipProvider delayDuration={100}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={cn(
              'inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border cursor-help',
              className,
            )}
          >
            {icon}
            {label}
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs text-[12px] leading-snug">
          {tooltip}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
