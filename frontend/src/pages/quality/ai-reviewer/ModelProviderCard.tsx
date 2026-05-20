/**
 * Model provider card — picks which LLM the AI Reviewer synthesis pipeline
 * uses for this form (Claude vs ChatGPT). Side-by-side comparison is run
 * from the Manual Run tab; this card just pins the winner.
 */

import { useEffect, useState } from 'react'
import { Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { useIsAdmin } from '@/hooks/useIsAdmin'
import { useAISettingsMutation, type AISettingsPayload } from './useAISettingsMutation'

interface Props {
  formId: number
  initialProvider: 'anthropic' | 'openai'
}

type ProviderOption = {
  value: 'anthropic' | 'openai'
  label: string
  description: string
}

const PROVIDER_OPTIONS: ProviderOption[] = [
  {
    value: 'anthropic',
    label: 'Claude (Anthropic)',
    description: 'Default. Strong on long-context reasoning; tuned against the QTIP golden set.',
  },
  {
    value: 'openai',
    label: 'ChatGPT (OpenAI)',
    description: 'Alternate. Try when Claude grades feel off; compare runs from the Manual Run tab first.',
  },
]

// Matches the segmented-pill style of `optionCls` used across QTIP forms
// (see formRendererComponents.tsx) so the card visually reads as a
// "pick one of N" control without pulling in a new shadcn primitive.
const baseCls =
  'flex-1 rounded-md border px-3 py-2 text-[12px] text-left transition cursor-pointer select-none'
const idleCls = 'border-slate-200 bg-white text-neutral-700 hover:border-slate-300'
const activeCls = 'border-[#00aeef] bg-[#00aeef]/5 text-neutral-900'
const disabledCls = 'cursor-not-allowed opacity-60'

export function ModelProviderCard({ formId, initialProvider }: Props) {
  const [provider, setProvider] = useState<'anthropic' | 'openai'>(initialProvider)
  const mut = useAISettingsMutation(formId)
  const isAdmin = useIsAdmin()

  useEffect(() => {
    setProvider(initialProvider)
  }, [initialProvider])

  const dirty = provider !== initialProvider

  const handleSave = () => {
    const payload: AISettingsPayload = { ai_model_provider: provider }
    mut.mutate(payload)
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between gap-4">
        <div>
          <h2 className="text-[14px] font-semibold text-slate-900">AI model provider</h2>
          <p className="text-[12px] text-slate-500">
            Which LLM the synthesis pipeline (reasoning + answer chunks + verification) calls for this form.
          </p>
        </div>
        <Button
          size="sm"
          onClick={handleSave}
          disabled={!isAdmin || !dirty || mut.isPending}
          title={!isAdmin ? 'Admin only' : undefined}
          className="bg-primary hover:bg-primary/90 text-white"
        >
          <Save className="h-3.5 w-3.5 mr-1" />
          {mut.isPending ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}
        </Button>
      </div>

      <div className="p-4">
        <Label className="text-[13px] font-medium text-slate-800 mb-2 block">Provider</Label>
        <div className="flex flex-col sm:flex-row gap-2">
          {PROVIDER_OPTIONS.map((opt) => {
            const isActive = opt.value === provider
            const cls = [baseCls, isActive ? activeCls : idleCls, !isAdmin ? disabledCls : '']
              .filter(Boolean)
              .join(' ')
            return (
              <button
                key={opt.value}
                type="button"
                className={cls}
                onClick={() => isAdmin && setProvider(opt.value)}
                disabled={!isAdmin}
                aria-pressed={isActive}
              >
                <div className="font-semibold text-[13px]">{opt.label}</div>
                <div className="text-[11px] text-neutral-700 mt-0.5">{opt.description}</div>
              </button>
            )
          })}
        </div>
        <p className="text-[11px] text-slate-500 mt-3">
          Use the Manual Run tab&apos;s &quot;Run Both (Compare)&quot; option to A/B test the two providers on a single
          submission before pinning the winner here.
        </p>
      </div>
    </section>
  )
}
