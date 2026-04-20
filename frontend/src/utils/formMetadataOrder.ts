import type { FormMetadataField } from '@/types/form.types'

/**
 * Standard order for the first four required audit metadata fields.
 * Aliases cover legacy / alternate labels.
 */
const SLOT_MATCHERS: ((name: string) => boolean)[] = [
  n => n === 'reviewer name' || n === 'auditor name',
  n => n === 'review date' || n === 'audit date',
  n => n === 'agent' || n === 'csr',
  n => n === 'interaction date',
]

/**
 * Reorders metadata fields so the standard four appear first (when present), then all others
 * in their previous relative order. Updates `sort_order` sequentially.
 */
export function normalizeStandardMetadataOrder(fields: FormMetadataField[]): FormMetadataField[] {
  if (!fields.length) return fields
  const remaining = [...fields]
  const head: FormMetadataField[] = []
  for (const match of SLOT_MATCHERS) {
    const idx = remaining.findIndex(f => match(f.field_name.trim().toLowerCase()))
    if (idx >= 0) {
      head.push(remaining[idx]!)
      remaining.splice(idx, 1)
    }
  }
  const ordered = [...head, ...remaining]
  return ordered.map((f, i) => ({ ...f, sort_order: i }))
}

export function isAgentMetadataField(field: FormMetadataField): boolean {
  const name = field.field_name.trim().toLowerCase()
  return name === 'agent' || name === 'csr'
}

/** Map legacy "CSR" field labels to "Agent" for display. All other names pass through unchanged. */
export function displayFieldName(fieldName: string): string {
  return fieldName.trim().toLowerCase() === 'csr' ? 'Agent' : fieldName
}
