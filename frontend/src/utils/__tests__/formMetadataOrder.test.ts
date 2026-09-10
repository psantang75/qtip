import { describe, expect, it } from 'vitest'
import type { FormMetadataField } from '@/types/form.types'
import { isCallIdMetadataField } from '../formMetadataOrder'

function field(field_name: string): FormMetadataField {
  return { interaction_type: 'CALL', field_name, field_type: 'TEXT', is_required: true }
}

describe('isCallIdMetadataField', () => {
  it('matches the labels the call-form and form-builder templates seed', () => {
    expect(isCallIdMetadataField(field('Call ID'))).toBe(true)
    expect(isCallIdMetadataField(field('Call Conversation ID'))).toBe(true)
    expect(isCallIdMetadataField(field('Conversation ID'))).toBe(true)
  })

  it('ignores label casing and stray whitespace', () => {
    expect(isCallIdMetadataField(field('  call id  '))).toBe(true)
    expect(isCallIdMetadataField(field('CALL CONVERSATION ID'))).toBe(true)
  })

  it('leaves every other metadata field alone', () => {
    expect(isCallIdMetadataField(field('Agent'))).toBe(false)
    expect(isCallIdMetadataField(field('Call Date'))).toBe(false)
    expect(isCallIdMetadataField(field('Customer ID'))).toBe(false)
    expect(isCallIdMetadataField(field('Ticket ID'))).toBe(false)
  })
})
