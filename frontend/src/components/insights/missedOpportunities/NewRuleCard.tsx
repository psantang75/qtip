/**
 * "Add a rule" form for the Missed Opportunities Settings tab. Collapsed by
 * default so the tab reads as the current methodology rather than a form.
 *
 * `rule_key` is set once here and never again — stored findings reference it.
 */
import { useState } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import type { CreateRuleInput } from '@/types/missedOpportunities'

/** Lowercase snake_case, matching the seeded keys (e.g. `no_dated_next_step`). */
const toKey = (name: string): string =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 64)

interface NewRuleCardProps {
  saving: boolean
  onCreate: (input: CreateRuleInput) => void
}

export default function NewRuleCard({ saving, onCreate }: NewRuleCardProps) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [category, setCategory] = useState('')
  const [body, setBody] = useState('')
  const [isOmission, setIsOmission] = useState(true)

  const ruleKey = toKey(name)
  const valid = ruleKey.length >= 3 && name.trim().length > 0 && body.trim().length > 0

  const submit = () => {
    onCreate({
      rule_key: ruleKey,
      rule_name: name.trim(),
      category: category.trim() || 'General',
      body_md: body.trim(),
      is_omission: isOmission,
    })
    setName(''); setCategory(''); setBody(''); setIsOmission(true); setOpen(false)
  }

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Plus className="mr-1 h-3.5 w-3.5" />
        Add a rule
      </Button>
    )
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <div className="border-b border-slate-100 px-4 py-3">
        <h2 className="text-[14px] font-semibold text-slate-900">New rule</h2>
        <p className="text-[12px] text-slate-500">
          Applies from the next run onward. Re-run a day below to grade it against the new rule.
        </p>
      </div>

      <div className="space-y-4 p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <Label className="text-[12px] font-medium text-slate-800">Rule name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Financing not offered"
              className="mt-1"
            />
            {ruleKey && (
              <p className="mt-1 text-[11px] text-slate-400">
                Key: <code>{ruleKey}</code> (permanent)
              </p>
            )}
          </div>
          <div>
            <Label className="text-[12px] font-medium text-slate-800">Category</Label>
            <Input
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="Closing"
              className="mt-1"
            />
          </div>
        </div>

        <div>
          <Label className="text-[12px] font-medium text-slate-800">What to look for</Label>
          <p className="text-[11px] text-slate-500">
            Goes into the model's system prompt verbatim. State what counts and what does not.
          </p>
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={5}
            className="mt-1 font-mono text-[12px]"
            placeholder="Flag when the customer raises budget as the blocker and the rep never mentions financing or a payment plan…"
          />
        </div>

        <div className="flex items-start justify-between gap-4 rounded-lg border border-slate-200 bg-surface p-3">
          <div className="min-w-0">
            <Label className="text-[12px] font-medium text-slate-800">
              Miss is a step the rep skipped
            </Label>
            <p className="mt-0.5 text-[11px] text-slate-500">
              {isOmission
                ? 'A second pass checks the transcript before this rule reports a miss, and drops it if the rep did make the move and the customer declined.'
                : 'Turn on for rules about something the rep failed to do. Leave off for rules that grade the content of something they did — a voicemail they left, what they said on the line.'}
            </p>
          </div>
          <Switch
            checked={isOmission}
            onCheckedChange={setIsOmission}
            className="mt-0.5 shrink-0"
          />
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            size="sm"
            onClick={submit}
            disabled={!valid || saving}
            className="bg-primary text-white hover:bg-primary/90"
          >
            {saving ? 'Adding…' : 'Add rule'}
          </Button>
        </div>
      </div>
    </section>
  )
}
