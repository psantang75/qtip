/**
 * `getTaskNotes` date-basis tests.
 *
 * The bug this guards against: a `tblAction` row is CREATED when the follow-up
 * is scheduled and COMPLETED when the agent actually works it and writes the
 * note (on self-chained tasks CreatedOn == the prior row's CompletedOn). The
 * CRM UI dates and attributes each note by its COMPLETION, so QTIP must too —
 * otherwise every note is shown one "step" early (e.g. 8/26 instead of 9/2 for
 * TaskID 1098997 / ActionID 8507976, the real case that surfaced this).
 *
 * The CompletedOn/CompletedBy fall-back and ordering happen in SQL, so we both
 *   (a) assert the query carries that logic (regression lock on the SQL), and
 *   (b) assert the row mapping keys `created_on` / `created_by` /
 *       `is_after_audit` off the effective (completed) values it returns.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { executeQueryMock } = vi.hoisted(() => ({ executeQueryMock: vi.fn() }));

vi.mock('../../utils/databaseUtils', () => ({
  executeQuery: (...args: unknown[]) => executeQueryMock(...args),
}));

import crmService from '../CRMService';

beforeEach(() => vi.clearAllMocks());

describe('CRMService.getTaskNotes — completed-date basis', () => {
  it('queries CompletedOn/CompletedBy and orders by the effective date', async () => {
    executeQueryMock.mockResolvedValue([]);
    await crmService.getTaskNotes(1098997);

    const [sql, params, poolName] = executeQueryMock.mock.calls[0];
    const text = String(sql);
    expect(text).toContain('a.CompletedOn');
    expect(text).toContain('a.CompletedBy');
    // Falls back to CreatedOn/CreatedBy only when there is no completion stamp.
    expect(text).toContain('a.CreatedOn');
    expect(text).toContain('a.CreatedBy');
    // Newest WORKED note first, not newest scheduled.
    expect(text).toMatch(/ORDER BY\s+EffectiveOn DESC/);
    expect(params).toEqual([1098997]);
    expect(poolName).toBe('crm');
  });

  it('stamps the note with the completed date/actor the query surfaced', async () => {
    // Mirrors the real ActionID 8507976: created 8/26, completed 9/2.
    executeQueryMock.mockResolvedValue([
      {
        ActionID: 8507976,
        Note: 'Sebastian thanked me for calling.',
        EffectiveOn: '2026-09-02 16:09:29',
        EffectiveBy: 36,
        CreatedByName: 'Vince Deleon',
        StatusAfter: 'Proposal Issued',
      },
    ]);

    const [note] = await crmService.getTaskNotes(1098997);

    expect(note.created_on).toBe(new Date('2026-09-02 16:09:29').toISOString());
    expect(note.created_by).toBe(36);
    expect(note.created_by_name).toBe('Vince Deleon');
    expect(note.status_after).toBe('Proposal Issued');
  });

  it('splits before/after audit on the completed date, not the created date', async () => {
    // Worked (completed) on 9/2; an audit submitted 8/28 must see this as
    // activity SINCE the audit — the created date (8/26) would wrongly bucket
    // it as at-time-of-audit.
    executeQueryMock.mockResolvedValue([
      {
        ActionID: 8507976,
        Note: 'Logged after the audit.',
        EffectiveOn: '2026-09-02 16:09:29',
        EffectiveBy: 36,
        CreatedByName: 'Vince Deleon',
        StatusAfter: null,
      },
    ]);

    const [note] = await crmService.getTaskNotes(1098997, new Date('2026-08-28 00:00:00'));
    expect(note.is_after_audit).toBe(true);
  });

  it('drops the still-open follow-up row (empty note, no completion)', async () => {
    executeQueryMock.mockResolvedValue([
      { ActionID: 8529033, Note: '', EffectiveOn: '2026-09-02 16:09:29', EffectiveBy: 0, CreatedByName: null, StatusAfter: null },
      { ActionID: 8507976, Note: 'real work', EffectiveOn: '2026-09-02 16:09:29', EffectiveBy: 36, CreatedByName: 'Vince Deleon', StatusAfter: null },
    ]);

    const notes = await crmService.getTaskNotes(1098997);
    expect(notes).toHaveLength(1);
    expect(notes[0].id).toBe(8507976);
  });
});
