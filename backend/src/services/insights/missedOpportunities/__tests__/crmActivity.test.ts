/**
 * CRM day-activity tests.
 *
 * Two things here are load-bearing beyond "does it return text":
 *
 *   1. BOTH SOURCES. Task actions (tblAction) and ticket notes (tblTicketNote)
 *      are separate tables. Reading only one would hide half a rep's
 *      follow-through and make the report accuse them of not logging work they
 *      did log, so the union and its chronological interleave are asserted.
 *   2. THE REF CONTRACT. `refs` is the allow-list the analyzer validates model
 *      citations against. If a ref escapes into that list for a note the model
 *      never saw — because the note was dropped as bookkeeping or fell past the
 *      length cap — the model could "cite" it and we would deep-link a manager
 *      into an unrelated CRM record. Those cases are asserted explicitly.
 *
 * Resilience matters too: one side of the CRM being down must cost that context
 * only, never the run.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { executeQueryMock } = vi.hoisted(() => ({ executeQueryMock: vi.fn() }));

vi.mock('../../../../utils/databaseUtils', () => ({
  executeQuery: (...args: unknown[]) => executeQueryMock(...args),
}));

import { loadCrmActivityForDay } from '../crmActivity';

const RUN_DATE = '2026-09-04';
const AGENT = 'Jane Rep';

const taskRow = (over: Record<string, unknown> = {}) => ({
  RecordID: 12345,
  CreatedOn: '2026-09-04 09:42:00',
  Note: '<p>Sent pricing for two zones.</p>',
  Label: 'Call',
  ActionResult: 'Quote Sent',
  CustomerName: 'Mabels Diner',
  DueOn: null,
  ...over,
});

const ticketRow = (over: Record<string, unknown> = {}) => ({
  RecordID: 987,
  CreatedOn: '2026-09-04 14:10:00',
  Note: 'Customer asked about adding a second zone.',
  Label: 'Follow-up',
  ActionResult: null,
  CustomerName: 'Mabels Diner',
  DueOn: null,
  ...over,
});

/** The module reads tasks then tickets; route each mock call by its SQL. */
function stubSources(tasks: unknown[], tickets: unknown[]) {
  executeQueryMock.mockImplementation(async (sql: string) =>
    String(sql).includes('tblTicketNote') ? tickets : tasks,
  );
}

beforeEach(() => vi.clearAllMocks());

describe('loadCrmActivityForDay', () => {
  it('reads both task actions and ticket notes, bound to the day and the agent', async () => {
    stubSources([], []);
    await loadCrmActivityForDay(AGENT, RUN_DATE);

    const sqls = executeQueryMock.mock.calls.map((c) => String(c[0]));
    expect(sqls.some((s) => s.includes('tblAction'))).toBe(true);
    expect(sqls.some((s) => s.includes('tblTicketNote'))).toBe(true);
    for (const call of executeQueryMock.mock.calls) {
      expect(call[1]).toEqual([RUN_DATE, AGENT]);
      expect(call[2]).toBe('crm');
    }
  });

  it('buckets and attributes task actions by CompletedOn/CompletedBy, not CreatedOn', async () => {
    // A tblAction row is created when the follow-up is scheduled and completed
    // when the agent works it; keying off CreatedOn/CreatedBy would put the note
    // on the wrong day and the wrong rep. The whole Touched pipeline uses the
    // completed basis, and so must this.
    stubSources([], []);
    await loadCrmActivityForDay(AGENT, RUN_DATE);

    const taskSql = executeQueryMock.mock.calls
      .map((c) => String(c[0]))
      .find((s) => s.includes('tblAction')) as string;
    expect(taskSql).toContain('sp.UserID = a.CompletedBy');
    expect(taskSql).toContain('DATE(a.CompletedOn) = ?');
    expect(taskSql).not.toMatch(/DATE\(a\.CreatedOn\)/);
    expect(taskSql).not.toMatch(/sp\.UserID = a\.CreatedBy/);
  });

  it('labels each line with its own ref so the model can cite one record', async () => {
    stubSources([taskRow()], [ticketRow()]);
    const { notes, refs } = await loadCrmActivityForDay(AGENT, RUN_DATE);
    expect(notes).toContain('TASK 12345');
    expect(notes).toContain('TICKET 987');
    expect(refs).toEqual(['TASK 12345', 'TICKET 987']);
  });

  it('interleaves the two sources by time, not by table', async () => {
    stubSources(
      [taskRow({ RecordID: 1, CreatedOn: '2026-09-04 16:00:00', Note: 'late task' })],
      [ticketRow({ RecordID: 2, CreatedOn: '2026-09-04 08:00:00', Note: 'early ticket' })],
    );
    const { notes } = await loadCrmActivityForDay(AGENT, RUN_DATE);
    expect(notes.indexOf('early ticket')).toBeLessThan(notes.indexOf('late task'));
  });

  it('strips HTML and keeps the type, result, and customer label', async () => {
    stubSources([taskRow()], []);
    const { notes } = await loadCrmActivityForDay(AGENT, RUN_DATE);
    expect(notes).not.toContain('<p>');
    expect(notes).toContain('Sent pricing for two zones.');
    expect(notes).toContain('Call / Quote Sent / Mabels Diner');
  });

  it('surfaces a recorded next-contact date, which the dated-next-step rule needs', async () => {
    stubSources([taskRow({ DueOn: '2026-09-11 00:00:00' })], []);
    const { notes } = await loadCrmActivityForDay(AGENT, RUN_DATE);
    expect(notes).toContain('next contact due 2026-09-11');
  });

  it('drops auto-generated bookkeeping, and its ref with it', async () => {
    stubSources(
      [
        taskRow({ RecordID: 111, Note: 'Task created' }),
        taskRow({ RecordID: 333, Note: 'Created Contact Update Manager Task' }),
        taskRow({ RecordID: 222, Note: 'Talked to owner about a second location.' }),
      ],
      [],
    );
    const { notes, refs } = await loadCrmActivityForDay(AGENT, RUN_DATE);
    expect(notes).not.toContain('Task created');
    expect(notes).toContain('second location');
    // 111 was never shown to the model, so it must not be citable.
    expect(refs).toEqual(['TASK 222']);
  });

  it('never lists a ref for a note cut off by the length cap', async () => {
    const long = 'x'.repeat(5900);
    stubSources(
      [
        taskRow({ RecordID: 1, CreatedOn: '2026-09-04 08:00:00', Note: long }),
        taskRow({ RecordID: 2, CreatedOn: '2026-09-04 09:00:00', Note: long }),
      ],
      [],
    );
    const { notes, refs } = await loadCrmActivityForDay(AGENT, RUN_DATE);
    expect(refs).toEqual(['TASK 1']);
    expect(notes).not.toContain('TASK 2');
  });

  it('de-duplicates refs when a rep wrote several notes on one record', async () => {
    stubSources(
      [
        taskRow({ RecordID: 12345, Note: 'first touch' }),
        taskRow({ RecordID: 12345, Note: 'second touch' }),
      ],
      [],
    );
    expect((await loadCrmActivityForDay(AGENT, RUN_DATE)).refs).toEqual(['TASK 12345']);
  });

  it('renders a note with an unusable record id but leaves it uncitable', async () => {
    stubSources([taskRow({ RecordID: null })], []);
    const { notes, refs } = await loadCrmActivityForDay(AGENT, RUN_DATE);
    expect(notes).toContain('Sent pricing for two zones.');
    expect(refs).toEqual([]);
  });

  it('keeps the other source when one side of the CRM is unreachable', async () => {
    executeQueryMock.mockImplementation(async (sql: string) => {
      if (String(sql).includes('tblTicketNote')) throw new Error('ECONNREFUSED');
      return [taskRow()];
    });
    const { notes, refs } = await loadCrmActivityForDay(AGENT, RUN_DATE);
    expect(notes).toContain('Sent pricing for two zones.');
    expect(refs).toEqual(['TASK 12345']);
  });

  it('degrades to nothing when the whole CRM is down instead of failing the run', async () => {
    executeQueryMock.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(loadCrmActivityForDay(AGENT, RUN_DATE)).resolves.toEqual({ notes: '', refs: [], scope: 'day', unavailable: true });
  });

  it('returns empty for an agent who logged nothing — absence is itself evidence', async () => {
    stubSources([], []);
    expect(await loadCrmActivityForDay(AGENT, RUN_DATE)).toEqual({ notes: '', refs: [], scope: 'day' });
  });

  it('does not query at all for an unnamed agent', async () => {
    expect(await loadCrmActivityForDay('', RUN_DATE)).toEqual({ notes: '', refs: [] });
    expect(executeQueryMock).not.toHaveBeenCalled();
  });
});
