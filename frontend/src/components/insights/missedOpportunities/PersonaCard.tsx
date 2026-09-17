/**
 * Review persona card for the Missed Opportunities Settings tab — the editable
 * "who you are and how to judge" narrative prepended to every call's prompt.
 *
 * This is where the review's judgment is tuned (act like an expert SMB closer,
 * fish out real opportunities, don't flag process the deal history already
 * answers) WITHOUT touching the fixed output contract or the rule set. Stored in
 * `ie_config`; the server re-validates on save.
 */
import { useEffect, useState } from 'react'
import { Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import type { MissedOpportunitySettings } from '@/types/missedOpportunities'

interface PersonaCardProps {
  settings: MissedOpportunitySettings
  canEdit: boolean
  saving: boolean
  onSave: (patch: Partial<MissedOpportunitySettings>) => void
}

export default function PersonaCard({ settings, canEdit, saving, onSave }: PersonaCardProps) {
  const [persona, setPersona] = useState(settings.systemPersona)

  useEffect(() => {
    setPersona(settings.systemPersona)
  }, [settings.systemPersona])

  const trimmed = persona.trim()
  const dirty = trimmed !== settings.systemPersona.trim()

  const save = () => onSave({ systemPersona: trimmed })

  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <div className="flex items-center justify-between gap-4 border-b border-slate-100 px-4 py-3">
        <div>
          <h2 className="text-[14px] font-semibold text-slate-900">Review persona</h2>
          <p className="text-[12px] text-slate-500">
            How the model judges every call — its expertise, focus, and what counts as a real miss.
            The fixed output format and the rules below are applied after this.
          </p>
        </div>
        <Button
          size="sm"
          onClick={save}
          disabled={!canEdit || !dirty || !trimmed || saving}
          title={!canEdit ? 'Admin only' : undefined}
          className="bg-primary text-white hover:bg-primary/90"
        >
          <Save className="mr-1 h-3.5 w-3.5" />
          {saving ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}
        </Button>
      </div>

      <div className="p-4">
        <Textarea
          value={persona}
          onChange={(e) => setPersona(e.target.value)}
          disabled={!canEdit}
          rows={10}
          className="font-mono text-[12.5px] leading-relaxed"
          placeholder="Describe who the reviewer is and how it should judge a call…"
        />
        <p className="mt-2 text-[11px] text-slate-400">
          Tip: tune the persona here rather than adding rules for judgment calls — it keeps the rule
          set short and steers every finding at once. Clearing it restores the default persona.
        </p>
      </div>
    </section>
  )
}
