/**
 * Diagnostic dialog: "Show me what the AI sees."
 *
 * Renders the composed system prompt for the form's next AI run, broken
 * down by section with char counts and an approximate token estimate.
 * The breakdown body is rendered by `PromptPreviewPanel` so the AI Prompt
 * tab and this dialog share one source of truth.
 *
 * Kept as a button-triggered dialog for places that want the diagnostic
 * without taking up tab real estate (e.g. opened from a list page or a
 * troubleshooting hand-off). On the per-form detail page, the inline
 * `PromptPreviewPanel` on the AI Prompt tab is the primary surface.
 */

import { useQueryClient } from '@tanstack/react-query'
import { Eye } from 'lucide-react'
import aiReviewerService from '@/services/aiReviewerService'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { PromptPreviewPanel } from './PromptPreviewPanel'

interface Props {
  formId: number
}

export function PromptPreviewDialog({ formId }: Props) {
  const qc = useQueryClient()

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            qc.prefetchQuery({
              queryKey: ['ai-reviewer-prompt-preview', formId],
              queryFn: () => aiReviewerService.getPromptPreview(formId),
              staleTime: 30 * 1000,
            })
          }
          className="text-[12px]"
          title="See the exact system prompt the AI will receive on the next run for this form"
        >
          <Eye className="h-3.5 w-3.5 mr-1" />
          Preview prompt
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>System prompt preview</DialogTitle>
          <DialogDescription>
            What the AI Reviewer will see in its system message on the next run for this form. Break-down by section
            shows where prompt size is coming from. The user prompt (ticket-specific data) is omitted because it changes
            every run.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-auto">
          <PromptPreviewPanel formId={formId} mode="inline" />
        </div>
      </DialogContent>
    </Dialog>
  )
}
