/**
 * One rule set from the Missed Opportunities Settings tab.
 *
 * These rules ARE the report's methodology — `body_md` is injected verbatim
 * into the model's system prompt, and `guidance_md` steers how the recommended
 * approach is worded. Editing is Admin-only (`canEdit`); everyone with the page
 * grant can read the rule so they can see how the report graded their team.
 *
 * `rule_key` is never editable: stored findings reference it, so renaming a key
 * would orphan history.
 */
import { useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import type {
  MissedOpportunityRule,
  MissedOpportunitySeverity,
  UpdateRuleInput,
} from '@/types/missedOpportunities'

const SEVERITIES: MissedOpportunitySeverity[] = ['low', 'medium', 'high']

/** Canonical QTIP segmented-pill classes, matching `optionCls` in formRendererComponents. */
const pillCls = (selected: boolean, disabled: boolean) => cn(
  'rounded-full border px-3 py-1 text-[12px] font-medium capitalize transition-colors',
  selected
    ? 'border-[#00aeef] bg-primary/10 text-primary'
    : 'border-slate-200 bg-white text-slate-500',
  disabled ? 'cursor-not-allowed opacity-60' : 'hover:border-slate-300',
)

interface RuleCardProps {
  rule: MissedOpportunityRule
  canEdit: boolean
  saving: boolean
  onSave: (ruleId: number, patch: UpdateRuleInput) => void
}

export default function RuleCard({ rule, canEdit: mayEdit, saving, onSave }: RuleCardProps) {
  const canEdit = mayEdit
  const [expanded, setExpanded] = useState(false)
  const [name, setName] = useState(rule.rule_name)
  const [category, setCategory] = useState(rule.category)
  const [severity, setSeverity] = useState<MissedOpportunitySeverity>(rule.severity)
  const [body, setBody] = useState(rule.body_md)
  const [guidance, setGuidance] = useState(rule.guidance_md ?? '')
  const [isOmission, setIsOmission] = useState(rule.is_omission)

  // Re-sync when the query refetches after a save elsewhere on the tab.
  useEffect(() => {
    setName(rule.rule_name)
    setCategory(rule.category)
    setSeverity(rule.severity)
    setBody(rule.body_md)
    setGuidance(rule.guidance_md ?? '')
    setIsOmission(rule.is_omission)
  }, [rule])

  const dirty =
    name !== rule.rule_name ||
    category !== rule.category ||
    severity !== rule.severity ||
    body !== rule.body_md ||
    guidance !== (rule.guidance_md ?? '') ||
    isOmission !== rule.is_omission

  return (
    <section className={cn(
      'rounded-xl border bg-white',
      rule.is_active ? 'border-slate-200' : 'border-slate-200 opacity-70',
    )}>
      <div className="flex items-start justify-between gap-4 px-4 py-3">
        <Button
          variant="ghost"
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex h-auto min-w-0 flex-1 items-start justify-start gap-2 whitespace-normal p-0 text-left hover:bg-transparent"
        >
          {expanded
            ? <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
            : <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />}
          <span className="min-w-0">
            <span className="block truncate text-[14px] font-semibold text-slate-900">
              {rule.rule_name}
            </span>
            <span className="mt-0.5 block text-[12px] text-slate-500">
              {rule.category} · {rule.severity} severity · <code className="text-[11px]">{rule.rule_key}</code>
            </span>
          </span>
        </Button>

        <div className="flex shrink-0 items-center gap-2">
          <Label className="text-[11px] text-slate-500">
            {rule.is_active ? 'Active' : 'Off'}
          </Label>
          <Switch
            checked={rule.is_active}
            onCheckedChange={(v) => onSave(rule.rule_id, { is_active: v })}
            disabled={!canEdit || saving}
          />
        </div>
      </div>

      {expanded && (
        <div className="space-y-4 border-t border-slate-100 p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label className="text-[12px] font-medium text-slate-800">Rule name</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={!canEdit}
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-[12px] font-medium text-slate-800">Category</Label>
              <Input
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                disabled={!canEdit}
                className="mt-1"
              />
            </div>
          </div>

          <div>
            <Label className="text-[12px] font-medium text-slate-800">Default severity</Label>
            <p className="text-[11px] text-slate-500">
              Starting point for findings from this rule; the model may raise or lower it per call.
            </p>
            <div className="mt-1.5 flex gap-2">
              {SEVERITIES.map((s) => (
                <Button
                  variant="ghost"
                  key={s}
                  type="button"
                  onClick={() => canEdit && setSeverity(s)}
                  disabled={!canEdit}
                  className={pillCls(severity === s, !canEdit)}
                >
                  {s}
                </Button>
              ))}
            </div>
          </div>

          <div className="flex items-start justify-between gap-4 rounded-lg border border-slate-200 bg-surface p-3">
            <div className="min-w-0">
              <Label className="text-[12px] font-medium text-slate-800">
                Miss is a step the rep skipped
              </Label>
              <p className="mt-0.5 text-[11px] text-slate-500">
                {isOmission
                  ? 'A second pass checks the transcript before this rule reports a miss, and drops it if the rep did make the move and the customer declined.'
                  : 'This rule is graded on the content of something the rep did do — a voicemail they left, what they said on the line — so the second pass leaves its findings alone.'}
              </p>
            </div>
            <Switch
              checked={isOmission}
              onCheckedChange={setIsOmission}
              disabled={!canEdit}
              className="mt-0.5 shrink-0"
            />
          </div>

          <div>
            <Label className="text-[12px] font-medium text-slate-800">What to look for</Label>
            <p className="text-[11px] text-slate-500">
              Goes into the model's system prompt verbatim. Be specific about what does and does
              not count — vague rules produce vague findings.
            </p>
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              disabled={!canEdit}
              rows={6}
              className="mt-1 font-mono text-[12px]"
            />
          </div>

          <div>
            <Label className="text-[12px] font-medium text-slate-800">Coaching guidance (optional)</Label>
            <p className="text-[11px] text-slate-500">
              Shapes the recommended approach the report shows for this rule.
            </p>
            <Textarea
              value={guidance}
              onChange={(e) => setGuidance(e.target.value)}
              disabled={!canEdit}
              rows={3}
              className="mt-1 font-mono text-[12px]"
            />
          </div>

          <div className="flex items-center justify-between gap-3">
            <p className="text-[11px] text-slate-400">
              {'Changes apply to the next run. Re-run a day below to re-grade it.'}
            </p>
            <Button
              size="sm"
              onClick={() => onSave(rule.rule_id, {
                rule_name: name,
                category,
                severity,
                body_md: body,
                guidance_md: guidance.trim() || null,
                is_omission: isOmission,
              })}
              disabled={!canEdit || !dirty || saving}
              title={!canEdit ? 'Admin only' : undefined}
              className="bg-primary text-white hover:bg-primary/90"
            >
              <Save className="mr-1 h-3.5 w-3.5" />
              {saving ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}
            </Button>
          </div>
        </div>
      )}
    </section>
  )
}
