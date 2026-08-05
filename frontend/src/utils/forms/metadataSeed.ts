/**
 * Seeds the audit form's metadata values when the form first loads.
 *
 * The interesting case is the difference between the two prefill modes:
 *
 * - `promote` / `overlay` (AI Reviewer): the human is signing this work for the
 *   first time, so the AUTO fields hold their name and today's date. The AI's
 *   saved values fill everything else.
 * - `resume` (a reopened review being corrected): the audit already happened.
 *   Re-stamping AUTO would replace the original reviewer with whoever is
 *   correcting it and the original review date with today — erasing who did the
 *   audit and contradicting `submitted_at`, which the re-submit deliberately
 *   preserves. So every saved value survives, AUTO included.
 */

export type MetadataPrefillMode = 'promote' | 'overlay' | 'resume' | null

interface SeedableField {
  id?: number
  field_name: string
  field_type: string
}

interface SavedMetadata {
  field_id: number | string
  value: string | null
}

const AUTO_NAME_FIELDS = ['Reviewer Name', 'Auditor Name']
const AUTO_DATE_FIELDS = ['Review Date', 'Audit Date']

export const metadataFieldKey = (field: SeedableField): string =>
  field.id && field.id !== 0 ? field.id.toString() : field.field_name

export function buildInitialMetadata({
  metadataFields,
  savedMetadata,
  prefillMode,
  currentUsername,
  today,
}: {
  metadataFields: SeedableField[]
  savedMetadata?: SavedMetadata[] | null
  prefillMode: MetadataPrefillMode
  currentUsername?: string
  today: string
}): Record<string, string> {
  const seeded: Record<string, string> = {}

  for (const field of metadataFields) {
    if (field.field_type !== 'AUTO') continue
    const key = metadataFieldKey(field)
    if (AUTO_NAME_FIELDS.includes(field.field_name) && currentUsername) seeded[key] = currentUsername
    else if (AUTO_DATE_FIELDS.includes(field.field_name)) seeded[key] = today
  }

  if (!prefillMode || !savedMetadata) return seeded

  const keepSavedAutoFields = prefillMode === 'resume'
  const autoFieldKeys = new Set(
    metadataFields.filter(f => f.field_type === 'AUTO').map(metadataFieldKey),
  )

  for (const saved of savedMetadata) {
    const key = String(saved.field_id)
    if (autoFieldKeys.has(key) && !keepSavedAutoFields) continue
    if (saved.value != null && saved.value !== '') seeded[key] = String(saved.value)
  }

  return seeded
}
