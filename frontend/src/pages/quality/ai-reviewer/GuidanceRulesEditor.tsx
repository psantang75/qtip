/**
 * GuidanceRulesEditor — Phase A structured replacement for the free-text
 * `ai_review_guidance` textarea on the AI Reviewer per-form page.
 *
 * Why structured: free-text guidance drifted into walls of unstructured
 * prose where the AI couldn't tell which line was the rule and which was
 * the rationale. Structured (criterion, instruction) rows mirror the
 * autorubric / Gong pattern of "name the dimension, then state the rule"
 * and give the form author a checklist instead of a blank page.
 *
 * Persistence: the parent serializes the rule list back to text via
 * `serializeRulesToText` and pushes that text through the existing
 * `ai_review_guidance` column. No schema change. The reverse parser
 * (`parseRulesFromText`) detects rule-style bullets and falls back to a
 * single "legacy" rule when the text doesn't match — so existing
 * forms migrate cleanly the first time someone opens the editor.
 *
 * UI conformance:
 *   - shadcn primitives only (Input, Button, Label).
 *   - Tailwind 8-pt spacing scale.
 *   - lucide-react icons (Plus, Trash2, Lightbulb).
 *   - Brand-palette colors via `text-primary`, `border-slate-*`.
 */

import { Plus, Trash2, Lightbulb } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export interface GuidanceRule {
  criterion: string
  instruction: string
}

interface GuidanceRulesEditorProps {
  rules: GuidanceRule[]
  onChange: (rules: GuidanceRule[]) => void
}

/**
 * Gong's published scoring tips, surfaced inline so a form author writing
 * a new rule sees the "AI grader bias" guidance at the moment they're
 * about to introduce a rule. Wording trimmed to fit the panel.
 */
const SCORING_TIPS: string[] = [
  'Be specific about WHO performed the action (agent vs customer vs system).',
  'One rule per row — avoid compound questions ("X and Y").',
  'Prefer 0–2 ranges over 1–10 — narrow scales are easier to grade consistently.',
  'AI graders bias toward "yes" — require a quote or note date as evidence.',
  'Keep instructions short and absolute — "must", "never", "only when…".',
]

/**
 * Parse the persisted free-text guidance back into structured rules.
 *
 * Recognised shapes (newest first wins):
 *   1. `- <criterion>: <instruction>` (the format we serialize today)
 *   2. `* <criterion>: <instruction>`
 *   3. `<criterion>: <instruction>` (no leading bullet)
 *
 * If NONE of the lines match, we treat the entire content as one legacy
 * rule with an empty criterion and the full text as the instruction —
 * the form author can split it manually on save. Empty input → empty
 * array.
 */
export function parseRulesFromText(raw: string | null | undefined): GuidanceRule[] {
  const text = (raw ?? '').trim()
  if (!text) return []

  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0)
  const rules: GuidanceRule[] = []
  for (const line of lines) {
    const match = line.match(/^[-*•]\s*(.+?):\s+(.+)$/)
    if (match) {
      rules.push({ criterion: match[1].trim(), instruction: match[2].trim() })
      continue
    }
    const noBullet = line.match(/^([^:]{1,80}):\s+(.+)$/)
    if (noBullet) {
      rules.push({ criterion: noBullet[1].trim(), instruction: noBullet[2].trim() })
      continue
    }
    // Bare line — append to previous rule's instruction or treat as a
    // standalone legacy rule.
    if (rules.length > 0) {
      rules[rules.length - 1].instruction += ' ' + line
    } else {
      rules.push({ criterion: '', instruction: line })
    }
  }
  return rules
}

/**
 * Serialize structured rules back into the column's free-text form.
 * Empty rows are dropped silently — the editor's add-row affordance
 * leaves blanks at the bottom that the user may not have filled in.
 */
export function serializeRulesToText(rules: GuidanceRule[]): string {
  return rules
    .map((r) => ({ criterion: r.criterion.trim(), instruction: r.instruction.trim() }))
    .filter((r) => r.criterion.length > 0 || r.instruction.length > 0)
    .map((r) =>
      r.criterion ? `- ${r.criterion}: ${r.instruction}` : `- ${r.instruction}`
    )
    .join('\n')
}

export function GuidanceRulesEditor({ rules, onChange }: GuidanceRulesEditorProps) {
  const updateAt = (index: number, patch: Partial<GuidanceRule>) => {
    const next = rules.map((r, i) => (i === index ? { ...r, ...patch } : r))
    onChange(next)
  }
  const removeAt = (index: number) => {
    onChange(rules.filter((_, i) => i !== index))
  }
  const addRow = () => {
    onChange([...rules, { criterion: '', instruction: '' }])
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {rules.length === 0 ? (
          <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 px-3 py-4 text-[12px] text-slate-500">
            No form-specific rules yet. Click <strong>Add rule</strong> to teach the AI a graduating rule for this form
            (e.g. <em>"NA: only when the agent has explicitly noted the issue resolved before reaching the step"</em>).
          </div>
        ) : (
          rules.map((rule, idx) => (
            <div
              key={idx}
              className="rounded-md border border-slate-200 bg-white p-3 space-y-2"
            >
              <div className="flex items-start justify-between gap-2">
                <Label className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">
                  Rule {idx + 1}
                </Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-slate-500 hover:text-destructive"
                  onClick={() => removeAt(idx)}
                  aria-label={`Remove rule ${idx + 1}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
              <div>
                <Label
                  htmlFor={`rule-criterion-${idx}`}
                  className="text-[11px] text-slate-600"
                >
                  Criterion <span className="text-slate-400">(short label, e.g. "NA discipline", "Note quality")</span>
                </Label>
                <Input
                  id={`rule-criterion-${idx}`}
                  value={rule.criterion}
                  onChange={(e) => updateAt(idx, { criterion: e.target.value })}
                  placeholder="e.g. NA discipline"
                  className="mt-1 h-8 text-[13px]"
                  maxLength={80}
                />
              </div>
              <div>
                <Label
                  htmlFor={`rule-instruction-${idx}`}
                  className="text-[11px] text-slate-600"
                >
                  Instruction <span className="text-slate-400">(absolute rule the AI must apply)</span>
                </Label>
                <textarea
                  id={`rule-instruction-${idx}`}
                  value={rule.instruction}
                  onChange={(e) => updateAt(idx, { instruction: e.target.value })}
                  rows={2}
                  placeholder='e.g. "Only mark NA when an earlier note documents the issue resolved before that step."'
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-[13px] text-slate-800 leading-snug focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                />
              </div>
            </div>
          ))
        )}
      </div>

      <div className="flex items-center justify-between">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={addRow}
          className="text-[12px]"
        >
          <Plus className="h-3.5 w-3.5 mr-1" /> Add rule
        </Button>
        <span className="text-[11px] text-slate-400">
          {rules.length} rule{rules.length === 1 ? '' : 's'}
        </span>
      </div>

      <div className="rounded-md border border-slate-200 bg-slate-50 p-3 space-y-1.5">
        <div className="flex items-center gap-1.5">
          <Lightbulb className="h-3.5 w-3.5 text-primary" />
          <span className="text-[12px] font-medium text-slate-700">Writing tips for AI scoring</span>
        </div>
        <ul className="space-y-1 text-[11px] text-slate-600">
          {SCORING_TIPS.map((tip) => (
            <li key={tip} className="flex gap-1.5">
              <span className="text-slate-400">•</span>
              <span>{tip}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

export default GuidanceRulesEditor
