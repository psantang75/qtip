import { describe, it, expect } from 'vitest';
import { buildSubmissionData } from '../submissionPayload';

const phoneCallBody = {
  form_id: 7,
  call_id: -123,
  call_ids: [-123],
  call_data: [{ call_id: 'EXT-123', call_date: '2026-09-28T12:00:00Z', duration: 300 }],
  ticket_tasks: [],
  csr_id: 42,
  answers: [{ question_id: 1, answer: 'yes', notes: '' }],
  metadata: [{ field_id: 1, value: 'x' }],
};

describe('buildSubmissionData', () => {
  it('forwards call_data and csr_id so phone-system calls can be resolved', () => {
    const data = buildSubmissionData(phoneCallBody, 9);
    expect(data.call_ids).toEqual([-123]);
    expect(data.call_data).toEqual(phoneCallBody.call_data);
    expect(data.csr_id).toBe(42);
    expect(data.submitted_by).toBe(9);
    expect(data.form_id).toBe(7);
  });

  it('always uses the authenticated reviewer as submitted_by', () => {
    const data = buildSubmissionData({ ...phoneCallBody, submitted_by: 999 }, 9);
    expect(data.submitted_by).toBe(9);
  });

  it('coerces a numeric-string csr_id and drops invalid ones', () => {
    expect(buildSubmissionData({ ...phoneCallBody, csr_id: '42' }, 9).csr_id).toBe(42);
    expect(buildSubmissionData({ ...phoneCallBody, csr_id: null }, 9).csr_id).toBeNull();
    expect(buildSubmissionData({ ...phoneCallBody, csr_id: 'abc' }, 9).csr_id).toBeNull();
    expect(buildSubmissionData({ ...phoneCallBody, csr_id: 0 }, 9).csr_id).toBeNull();
  });

  it('defaults answers and metadata to empty arrays', () => {
    const data = buildSubmissionData({ form_id: 7 }, 9);
    expect(data.answers).toEqual([]);
    expect(data.metadata).toEqual([]);
    expect(data.call_data).toBeUndefined();
  });
});
