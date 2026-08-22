/**
 * Serialize/parse helpers for the structured AI Reviewer guidance rules.
 *
 * Extracted from `GuidanceRulesEditor.tsx` so that component file only exports
 * a component (keeps Vite fast-refresh working). The parent card imports these
 * to round-trip the free-text `forms.ai_review_guidance` column.
 */

export interface GuidanceRule {
  criterion: string
  instruction: string
}

/**
 * Parse the free-text `ai_review_guidance` column into structured rules.
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
