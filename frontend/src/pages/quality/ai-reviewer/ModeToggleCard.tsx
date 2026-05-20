/**
 * Mode toggle card — controls whether AI submissions land as DRAFT
 * (Calibrating) or SUBMITTED (Trusted). Owns its own dirty state and
 * save button so it stands alone on the Settings tab.
 */

import { useEffect, useState } from 'react'
import { Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { useIsAdmin } from '@/hooks/useIsAdmin'
import { useAISettingsMutation } from './useAISettingsMutation'

interface Props {
  formId: number
  initialSubmitAsDraft: boolean
}

export function ModeToggleCard({ formId, initialSubmitAsDraft }: Props) {
  const [submitAsDraft, setSubmitAsDraft] = useState(initialSubmitAsDraft)
  const mut = useAISettingsMutation(formId)
  const isAdmin = useIsAdmin()

  useEffect(() => {
    setSubmitAsDraft(initialSubmitAsDraft)
  }, [initialSubmitAsDraft])

  const dirty = submitAsDraft !== initialSubmitAsDraft

  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between gap-4">
        <div>
          <h2 className="text-[14px] font-semibold text-slate-900">Submission mode</h2>
          <p className="text-[12px] text-slate-500">
            Whether AI submissions wait for human approval (Calibrating) or post directly (Trusted).
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => mut.mutate({ ai_submit_as_draft: submitAsDraft })}
          disabled={!isAdmin || !dirty || mut.isPending}
          title={!isAdmin ? 'Admin only' : undefined}
          className="bg-primary hover:bg-primary/90 text-white"
        >
          <Save className="h-3.5 w-3.5 mr-1" />
          {mut.isPending ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}
        </Button>
      </div>

      <div className="p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <Label className="text-[13px] font-medium text-slate-800">
              Save AI submissions as DRAFT for human approval
            </Label>
            <p className="text-[12px] text-slate-500 mt-0.5">
              {submitAsDraft
                ? 'Calibrating: AI submissions wait in the AI Inbox until a QA reviewer promotes them. Promotions feed the rolling agreement.'
                : 'Trusted: AI submissions go straight to SUBMITTED + scored. A sample is routed back to the AI Inbox for re-audit (configured below).'}
            </p>
          </div>
          <Switch checked={submitAsDraft} onCheckedChange={setSubmitAsDraft} disabled={!isAdmin} />
        </div>
      </div>
    </section>
  )
}
