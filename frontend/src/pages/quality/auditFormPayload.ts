import type { SubmissionPayload } from '@/services/submissionService'
import type { Call } from '@/services/callService'
import type { TicketTaskRef } from '@/components/common/TicketTaskSelector'
import type { Form } from '@/types/form.types'

interface AuditFormPayloadInput {
  form: Pick<Form, 'metadata_fields'>
  formId: string | number
  callId: string | null
  userId: number
  selectedCalls: Call[]
  linkedTicketTasks: TicketTaskRef[]
  answers: Record<string, { answer: string; notes?: string }>
  metadataValues: Record<string, string>
}

/**
 * Submit and Save Draft must send the same call payload: calls picked live
 * from the phone system carry a negative `id` and only become real `calls`
 * rows when `call_data` (+ `csr_id`) accompany them. Without it the backend
 * links the negative id and the `submission_calls.call_id` FK rejects it.
 */
export function buildAuditFormPayload({
  form,
  formId,
  callId,
  userId,
  selectedCalls,
  linkedTicketTasks,
  answers,
  metadataValues,
}: AuditFormPayloadInput): SubmissionPayload {
  let customerId: string | null = null
  let agentUserId: number | null = null
  for (const f of form.metadata_fields ?? []) {
    const key = (f.id && f.id !== 0) ? f.id.toString() : f.field_name
    const val = metadataValues[key]
    if (!val) continue
    if (f.field_name?.toLowerCase().includes('customer')) customerId = val
    if (f.field_type === 'DROPDOWN' && !f.dropdown_source) {
      const parsed = parseInt(val, 10)
      if (!isNaN(parsed) && parsed > 0) agentUserId = parsed
    }
  }

  return {
    form_id: Number(formId),
    call_id: callId ? Number(callId) : null,
    call_ids: selectedCalls.map(c => c.id),
    call_data: selectedCalls.map(c => ({
      call_id: c.call_id, customer_id: customerId || c.customer_id,
      call_date: c.call_date, duration: c.duration, recording_url: c.recording_url, transcript: c.transcript,
    })),
    ticket_tasks: linkedTicketTasks,
    csr_id: agentUserId,
    submitted_by: userId,
    answers: Object.entries(answers).map(([qId, a]) => ({ question_id: Number(qId), answer: a.answer, notes: a.notes || '' })),
    metadata: Object.entries(metadataValues).map(([fieldId, value]) => ({ field_id: fieldId, value })),
  }
}
