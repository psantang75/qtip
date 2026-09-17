/**
 * KB grounding card for the Missed Opportunities Settings tab (Phase 1) — the
 * BookStack sales-playbook pages whose methodology grounds every recommended
 * approach (ARP objection handling, one-call closing, the inbound call flow).
 *
 * One page URL per line. The worker fetches these once per run and injects them
 * into the prompt; clearing the box turns grounding off. Stored in `ie_config`;
 * the server re-validates each URL on save.
 */
import { useEffect, useState } from 'react'
import { Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import type { MissedOpportunitySettings } from '@/types/missedOpportunities'

interface KbGroundingCardProps {
  settings: MissedOpportunitySettings
  canEdit: boolean
  saving: boolean
  onSave: (patch: Partial<MissedOpportunitySettings>) => void
}

const toText = (urls: string[]) => urls.join('\n')
const toList = (text: string) =>
  text.split(/\r?\n/).map((s) => s.trim()).filter((s) => s.length > 0)

export default function KbGroundingCard({ settings, canEdit, saving, onSave }: KbGroundingCardProps) {
  const [text, setText] = useState(toText(settings.kbAnchorUrls))

  useEffect(() => {
    setText(toText(settings.kbAnchorUrls))
  }, [settings.kbAnchorUrls])

  const list = toList(text)
  const dirty = toText(list) !== toText(settings.kbAnchorUrls)

  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <div className="flex items-center justify-between gap-4 border-b border-slate-100 px-4 py-3">
        <div>
          <h2 className="text-[14px] font-semibold text-slate-900">KB grounding</h2>
          <p className="text-[12px] text-slate-500">
            Sales playbook pages that shape each recommended approach. One BookStack page URL per
            line. Leave empty to turn grounding off.
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => onSave({ kbAnchorUrls: list })}
          disabled={!canEdit || !dirty || saving}
          title={!canEdit ? 'Admin only' : undefined}
          className="bg-primary text-white hover:bg-primary/90"
        >
          <Save className="mr-1 h-3.5 w-3.5" />
          {saving ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}
        </Button>
      </div>

      <div className="p-4">
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={!canEdit}
          rows={6}
          className="font-mono text-[12px] leading-relaxed"
          placeholder="http://know.crm.dm-us.com/books/job-account-executive/page/…"
        />
        <p className="mt-2 text-[11px] text-slate-400">
          {list.length} page{list.length === 1 ? '' : 's'}. Each URL must be a BookStack page link
          (…/page/…). The worker reads these once per run.
        </p>
      </div>
    </section>
  )
}
