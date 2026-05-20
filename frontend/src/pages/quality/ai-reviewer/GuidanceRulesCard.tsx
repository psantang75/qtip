/**
 * Per-form guidance card — wraps the structured GuidanceRulesEditor in
 * its own savable card. Lives on the AI Prompt tab as the
 * "Per-form guidance" section of the compiled prompt; the underlying
 * column is `forms.ai_review_guidance` and the AI reviewer injects
 * these rules immediately after the rule packs.
 */

import { useEffect, useState } from 'react'
import { Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { useIsAdmin } from '@/hooks/useIsAdmin'
import {
  GuidanceRulesEditor,
  parseRulesFromText,
  serializeRulesToText,
  type GuidanceRule,
} from './GuidanceRulesEditor'
import { useAISettingsMutation } from './useAISettingsMutation'

interface Props {
  formId: number
  initialGuidanceText: string
}

export function GuidanceRulesCard({ formId, initialGuidanceText }: Props) {
  const [rules, setRules] = useState<GuidanceRule[]>(() => parseRulesFromText(initialGuidanceText))
  const mut = useAISettingsMutation(formId)
  const isAdmin = useIsAdmin()

  useEffect(() => {
    setRules(parseRulesFromText(initialGuidanceText))
  }, [initialGuidanceText])

  const dirty = serializeRulesToText(rules) !== (initialGuidanceText ?? '').trim()

  const save = () => {
    const serialized = serializeRulesToText(rules)
    mut.mutate({ ai_review_guidance: serialized === '' ? null : serialized })
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between gap-4">
        <div>
          <h2 className="text-[14px] font-semibold text-slate-900">Per-form guidance</h2>
          <p className="text-[12px] text-slate-500">
            Extra grading rules for this form, applied alongside the universal base + rule packs.
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

      <div className="p-4 space-y-2">
        <Label className="text-[13px] font-medium text-slate-800">
          AI Reviewer Guidance
          <span className="ml-2 text-[11px] font-normal text-slate-400">
            (extra grading rules for this form — applied alongside the built-in rules)
          </span>
        </Label>
        <p className="text-[11px] text-slate-500">
          Each rule is one criterion + one absolute instruction. The AI applies these rules with the same weight as the
          built-in grading philosophy.
        </p>
        <fieldset disabled={!isAdmin} className="contents">
          <GuidanceRulesEditor rules={rules} onChange={setRules} />
        </fieldset>
      </div>
    </section>
  )
}
