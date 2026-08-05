import { describe, it, expect } from 'vitest'
import { buildInitialMetadata } from '../metadataSeed'

/**
 * The fields on the real QA forms (Contact / No Contact Call Review), whose
 * Reviewer Name and Review Date are AUTO.
 */
const metadataFields = [
  { id: 1612, field_name: 'Reviewer Name', field_type: 'AUTO' },
  { id: 1613, field_name: 'Review Date',   field_type: 'AUTO' },
  { id: 1614, field_name: 'CSR',           field_type: 'DROPDOWN' },
  { id: 1616, field_name: 'Customer ID',   field_type: 'TEXT' },
]

/** What the original reviewer saved when the audit was first submitted. */
const savedMetadata = [
  { field_id: 1612, value: 'Cheryl Campbell' },
  { field_id: 1613, value: '2026-03-23' },
  { field_id: 1614, value: '22' },
  { field_id: 1616, value: '(123379)' },
]

const TODAY = '2026-08-05'
const CORRECTOR = 'Pete Santangelo'

describe('buildInitialMetadata', () => {
  it('stamps the current user and today for a fresh audit', () => {
    const seeded = buildInitialMetadata({
      metadataFields,
      savedMetadata: null,
      prefillMode: null,
      currentUsername: CORRECTOR,
      today: TODAY,
    })

    expect(seeded['1612']).toBe(CORRECTOR)
    expect(seeded['1613']).toBe(TODAY)
    expect(seeded['1614']).toBeUndefined()
  })

  it('keeps the original reviewer and review date when correcting a reopened review', () => {
    const seeded = buildInitialMetadata({
      metadataFields,
      savedMetadata,
      prefillMode: 'resume',
      currentUsername: CORRECTOR,
      today: TODAY,
    })

    expect(seeded['1612']).toBe('Cheryl Campbell')
    expect(seeded['1613']).toBe('2026-03-23')
    expect(seeded['1614']).toBe('22')
    expect(seeded['1616']).toBe('(123379)')
  })

  it('stamps the promoting human on an AI draft rather than keeping the AI values', () => {
    const seeded = buildInitialMetadata({
      metadataFields,
      savedMetadata,
      prefillMode: 'promote',
      currentUsername: CORRECTOR,
      today: TODAY,
    })

    expect(seeded['1612']).toBe(CORRECTOR)
    expect(seeded['1613']).toBe(TODAY)
    // Everything the AI captured that isn't the human's own stamp survives.
    expect(seeded['1614']).toBe('22')
  })

  it('falls back to the auto stamp when a resumed review has no saved value', () => {
    const seeded = buildInitialMetadata({
      metadataFields,
      savedMetadata: [{ field_id: 1612, value: '' }],
      prefillMode: 'resume',
      currentUsername: CORRECTOR,
      today: TODAY,
    })

    expect(seeded['1612']).toBe(CORRECTOR)
    expect(seeded['1613']).toBe(TODAY)
  })
})
