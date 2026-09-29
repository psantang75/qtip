import type { CreateSubmissionDTO } from '../models/Submission';

/**
 * Submit and Save Draft must forward the same call payload: phone-system calls
 * carry a negative id and only become real `calls` rows when `call_data` and
 * `csr_id` accompany them, otherwise the `submission_calls.call_id` FK fails.
 */
export function buildSubmissionData(body: any, qaId: number): CreateSubmissionDTO {
  const csrId = Number(body?.csr_id);
  return {
    form_id:      body?.form_id,
    call_id:      body?.call_id,
    call_ids:     body?.call_ids,
    call_data:    body?.call_data,
    ticket_tasks: body?.ticket_tasks,
    csr_id:       Number.isInteger(csrId) && csrId > 0 ? csrId : null,
    submitted_by: qaId,
    answers:      body?.answers  || [],
    metadata:     body?.metadata || [],
  };
}
