/**
 * CalibrationMapChip — page-header pill that surfaces which version of
 * the empirical calibration map is currently shipping for the form
 * (Phase 4). Hidden when the form has no active map (identity mapping).
 *
 * Why it matters in the header: the calibrated confidence drives inbox
 * routing decisions. Knowing whether routing is using the v3 map vs.
 * the raw model output is the difference between "tweaked the prompt"
 * and "actually changed how submissions get routed."
 */

import { useQuery } from '@tanstack/react-query'
import { Sliders } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import aiReviewerService from '@/services/aiReviewerService'

interface Props {
  formId: number
}

export function CalibrationMapChip({ formId }: Props) {
  const q = useQuery({
    queryKey: ['ai-reviewer-calibration-map', formId],
    queryFn: () => aiReviewerService.getCalibrationMap(formId),
    staleTime: 60 * 1000,
    enabled: Number.isFinite(formId) && formId > 0,
  })

  const detail = q.data
  if (!detail || !detail.active) return null

  const tooltip =
    `Active calibration map v${detail.active.version}. ` +
    `${detail.active.bins.length} bin(s); fallback = ${detail.active.fallback.toFixed(2)}. ` +
    `Inbox low-confidence routing uses calibrated confidence (not nominal) for this form.`

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold text-indigo-700 bg-indigo-50 border-indigo-200">
            <Sliders className="h-3 w-3" />
            Calib v{detail.active.version}
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-sm whitespace-pre-line text-[11px] leading-snug">
          {tooltip}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
