/**
 * Shared mutation for the per-form AI Reviewer settings PATCH endpoint.
 *
 * The detail page used to bundle every editable AI field into one giant
 * `saveAll` mutation. After splitting Setup into multiple tabs, each
 * settings sub-card owns its own slice (mode, guidance, sampling, budget)
 * and calls this hook so they all share invalidation + toast behaviour.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { getErrorMessage } from '@/utils/errorHandling'
import aiReviewerService from '@/services/aiReviewerService'
import { useToast } from '@/hooks/use-toast'

export type AISettingsPayload = {
  ai_review_guidance?: string | null
  ai_submit_as_draft?: boolean
  ai_sample_review_pct?: number
  ai_sample_low_score_always?: boolean
  ai_sample_low_confidence_threshold?: number | null
  ai_disagreement_route_threshold?: number | null
  ai_monthly_cost_budget_usd?: number | null
  ai_model_provider?: 'anthropic' | 'openai'
}

export function useAISettingsMutation(formId: number) {
  const qc = useQueryClient()
  const { toast } = useToast()

  return useMutation({
    mutationFn: (payload: AISettingsPayload) =>
      aiReviewerService.updateCalibrationSettings(formId, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ai-reviewer-form', formId] })
      qc.invalidateQueries({ queryKey: ['ai-reviewer-cost', formId] })
      qc.invalidateQueries({ queryKey: ['ai-reviewer-forms'] })
      qc.invalidateQueries({ queryKey: ['ai-reviewer-prompt-preview', formId] })
      toast({ title: 'Saved' })
    },
    onError: (e: any) => {
      toast({
        title: "Couldn't save settings",
        description: getErrorMessage(e, 'Try again.'),
        variant: 'destructive',
      })
    },
  })
}
