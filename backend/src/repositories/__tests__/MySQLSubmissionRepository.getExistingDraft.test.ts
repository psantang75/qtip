/**
 * getExistingDraft — dedup key tests.
 *
 * Locks in the rule that when a `case_id` is supplied we MUST scope dedup off
 * the case (not just call_id). Otherwise multi-source AI Reviewer runs (which
 * leave the legacy `call_id` column null and instead link sources via
 * submission_calls / submission_ticket_tasks) would silently clobber an
 * unrelated stale DRAFT row that shares (form_id, submitted_by, call_id IS NULL).
 *
 * This was the real bug behind "I ran a ticket + conversation review, it said
 * it ran, but I didn't see a completed review" — the new run merged into an
 * older draft from a different case and showed nothing new in the inbox.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { findFirstMock } = vi.hoisted(() => ({
  findFirstMock: vi.fn(),
}));

vi.mock('../../config/prisma', () => ({
  default: {
    submission: { findFirst: findFirstMock },
  },
}));

import { MySQLSubmissionRepository } from '../MySQLSubmissionRepository';

describe('MySQLSubmissionRepository.getExistingDraft', () => {
  const repo = new MySQLSubmissionRepository();

  beforeEach(() => {
    findFirstMock.mockReset();
    findFirstMock.mockResolvedValue(null);
  });

  it('keys on case_id when supplied (multi-source / case-aware path)', async () => {
    await repo.getExistingDraft(null, 99017, 99004, 'CALL:2e1aa67f-c994-4a75-9aba-eec4c93aeb54');

    expect(findFirstMock).toHaveBeenCalledTimes(1);
    const where = findFirstMock.mock.calls[0][0].where;
    expect(where).toEqual({
      form_id: 99017,
      submitted_by: 99004,
      status: 'DRAFT',
      case_id: 'CALL:2e1aa67f-c994-4a75-9aba-eec4c93aeb54',
    });
    expect(where).not.toHaveProperty('call_id');
  });

  it('keys on case_id even when call_id is also supplied', async () => {
    await repo.getExistingDraft(1308, 99017, 99004, 'TICKET:279875');

    const where = findFirstMock.mock.calls[0][0].where;
    expect(where.case_id).toBe('TICKET:279875');
    expect(where).not.toHaveProperty('call_id');
  });

  it('falls back to call_id when case_id is undefined (legacy callers)', async () => {
    await repo.getExistingDraft(1308, 99017, 99004);

    const where = findFirstMock.mock.calls[0][0].where;
    expect(where).toEqual({
      form_id: 99017,
      submitted_by: 99004,
      status: 'DRAFT',
      call_id: 1308,
    });
  });

  it('falls back to call_id IS NULL when both call_id and case_id are null/undefined', async () => {
    await repo.getExistingDraft(null, 99017, 99004, null);

    const where = findFirstMock.mock.calls[0][0].where;
    expect(where).toEqual({
      form_id: 99017,
      submitted_by: 99004,
      status: 'DRAFT',
      call_id: null,
    });
  });

  it('treats an empty-string case_id as "no case_id" (falls back to call_id)', async () => {
    await repo.getExistingDraft(null, 99017, 99004, '');

    const where = findFirstMock.mock.calls[0][0].where;
    expect(where).not.toHaveProperty('case_id');
    expect(where.call_id).toBeNull();
  });
});
