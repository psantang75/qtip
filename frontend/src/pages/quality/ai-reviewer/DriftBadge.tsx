/**
 * DriftBadge — page-header chip surfacing input/output distribution drift
 * for the AI Reviewer.
 *
 * Drift comes from the daily AIDriftDetector snapshot. We render three
 * states so a QA admin can tell at a glance whether the form is healthy:
 *
 *   - "Drift" pill (amber/red): one or more metrics are >= 2 SD off the
 *     12-week baseline. Tooltip lists the metric, today's reading, the
 *     baseline mean, and the z-score.
 *   - "Drift OK" pill (green): we have a baseline and today's snapshot
 *     looks normal. Quiet but visible — confirms the daily job is
 *     running.
 *   - Hidden when there's no snapshot yet (fresh form / first-day
 *     deploy). Showing "no data" here would be noise during onboarding.
 */

import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, ShieldCheck } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import aiReviewerService, { type DriftMetricKey } from '@/services/aiReviewerService'

interface Props {
  formId: number
}

const METRIC_LABELS: Record<DriftMetricKey, string> = {
  avg_score: 'avg score',
  avg_nominal_confidence: 'avg confidence (nominal)',
  avg_calibrated_confidence: 'avg confidence (calibrated)',
  score_variance: 'score variance',
}

export function DriftBadge({ formId }: Props) {
  const driftQ = useQuery({
    queryKey: ['ai-reviewer-drift', formId],
    queryFn: () => aiReviewerService.getDriftStatus(formId),
    staleTime: 60 * 1000,
    enabled: Number.isFinite(formId) && formId > 0,
  })

  const status = driftQ.data
  if (!status || !status.latest) return null

  const hasAlerts = status.alerts.length > 0

  const tooltipBody = hasAlerts
    ? status.alerts
        .map(
          (a) =>
            `${METRIC_LABELS[a.metric]}: today ${a.today.toFixed(3)}, baseline ${a.baseline_mean.toFixed(3)} \u00B1 ${a.baseline_sd.toFixed(3)} (z=${a.z_score.toFixed(1)})`
        )
        .join('\n')
    : `No drift today (${status.latest.submissions} submissions in the last 24h, baseline window ${Object.values(status.baseline)[0]?.n ?? 0} days).`

  const className = hasAlerts
    ? 'text-amber-700 bg-amber-50 border-amber-200'
    : 'text-emerald-700 bg-emerald-50 border-emerald-200'

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={
              'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ' +
              className
            }
          >
            {hasAlerts ? <AlertTriangle className="h-3 w-3" /> : <ShieldCheck className="h-3 w-3" />}
            {hasAlerts ? `Drift (${status.alerts.length})` : 'Drift OK'}
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-sm whitespace-pre-line text-[11px] leading-snug">
          {tooltipBody}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
