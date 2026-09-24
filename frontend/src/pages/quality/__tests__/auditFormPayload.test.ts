import { describe, it, expect } from 'vitest'
import { buildAuditFormPayload } from '../auditFormPayload'
import type { Call } from '@/services/callService'

const form = {
  metadata_fields: [
    { id: 10, field_name: 'CSR', field_type: 'DROPDOWN', dropdown_source: null },
    { id: 11, field_name: 'Customer ID', field_type: 'TEXT' },
  ],
} as unknown as Parameters<typeof buildAuditFormPayload>[0]['form']

const phoneSystemCall = {
  id: -1,
  call_id: '10753842-b059-46f8-940c-a6350a671cc1',
  csr_id: 0,
  customer_id: null,
  call_date: '2026-09-24T14:00:00Z',
  duration: 170,
  recording_url: 'https://rec.example/1',
  transcript: 'hello',
} as Call

const base = {
  form,
  formId: '42',
  callId: null,
  userId: 7,
  selectedCalls: [phoneSystemCall],
  linkedTicketTasks: [],
  answers: { '5': { answer: 'Yes', notes: '' } },
  metadataValues: { '10': '22', '11': 'CUST-9' },
}

describe('buildAuditFormPayload', () => {
  it('sends call_data alongside a live phone-system (negative id) call', () => {
    const payload = buildAuditFormPayload(base)
    expect(payload.call_ids).toEqual([-1])
    expect(payload.call_data).toHaveLength(1)
    expect(payload.call_data?.[0]).toMatchObject({
      call_id: phoneSystemCall.call_id,
      customer_id: 'CUST-9',
      duration: 170,
      recording_url: 'https://rec.example/1',
      transcript: 'hello',
    })
  })

  it('resolves csr_id from the internal-user dropdown', () => {
    expect(buildAuditFormPayload(base).csr_id).toBe(22)
  })

  it('leaves csr_id null when no agent is selected', () => {
    const payload = buildAuditFormPayload({ ...base, metadataValues: {} })
    expect(payload.csr_id).toBeNull()
    expect(payload.call_data?.[0].customer_id).toBeNull()
  })

  it('maps form, submitter, answers and metadata', () => {
    const payload = buildAuditFormPayload(base)
    expect(payload.form_id).toBe(42)
    expect(payload.call_id).toBeNull()
    expect(payload.submitted_by).toBe(7)
    expect(payload.answers).toEqual([{ question_id: 5, answer: 'Yes', notes: '' }])
    expect(payload.metadata).toEqual([
      { field_id: '10', value: '22' },
      { field_id: '11', value: 'CUST-9' },
    ])
  })
})
