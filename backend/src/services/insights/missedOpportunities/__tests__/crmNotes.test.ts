/**
 * Note retrieval and boilerplate handling.
 *
 * `splitNote` exists because the previous loader dropped a whole row whose first
 * words matched an auto-status prefix. "Task Status Changed from Open to Working —
 * customer wants the other two stores quoted" disappeared entirely, and the
 * customer's scope was frequently the ONLY place that requirement was written
 * down. Separating the stamp from the sentence keeps both: the row can say it was
 * system-generated and still show what a person typed after the stamp.
 *
 * Retrieval is paged and reports coverage for the same reason. "Newest 25" was
 * presented as the account's whole history, so a topic decision older than 25
 * rows — the prior warranty decline an exception turns on — could not be found,
 * and its absence was then read as proof the step was missed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { executeQueryMock } = vi.hoisted(() => ({ executeQueryMock: vi.fn() }));

vi.mock('../../../../utils/databaseUtils', () => ({
  executeQuery: (...a: unknown[]) => executeQueryMock(...a),
}));
vi.mock('../../../../config/logger', () => ({
  default: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));
vi.mock('../../../../utils/htmlText', () => ({
  stripHtmlToPlaintext: (s: string) => String(s ?? '').replace(/<[^>]*>/g, ' '),
}));

import { loadTaskActions, loadTicketNotes, splitNote, MAX_RECORD_ROWS } from '../crmNotes';

beforeEach(() => vi.clearAllMocks());

describe('splitNote — the stamp is boilerplate, the sentence is evidence', () => {
  it('keeps the substantive remainder of a status-change note', () => {
    const out = splitNote('Task Status Changed from Open to Working - customer wants the other two stores quoted');
    expect(out.prefix).toContain('Task Status Changed');
    expect(out.body).toBe('customer wants the other two stores quoted');
  });

  it('keeps the customer request after a lead-creation stamp', () => {
    const out = splitNote('Created Lead by J. Smith — customer asked for a quote on five dealerships');
    expect(out.body).toBe('customer asked for a quote on five dealerships');
  });

  it('keeps the remainder after a closure stamp', () => {
    const out = splitNote('Task closed because a new lead was created. Customer declined the extended warranty.');
    expect(out.body).toBe('Customer declined the extended warranty.');
  });

  it('reports a pure boilerplate row as having no body, while keeping the stamp', () => {
    const out = splitNote('Task Status Changed from Open to Working');
    expect(out.body).toBe('');
    expect(out.prefix).toBe('Task Status Changed from Open to Working');
  });

  it('leaves a human note completely alone', () => {
    const out = splitNote('Offered the five year extended warranty; customer declined for now.');
    expect(out.prefix).toBeNull();
    expect(out.body).toBe('Offered the five year extended warranty; customer declined for now.');
  });

  it('treats a fragment left after the stamp as no body', () => {
    // Two words are not a documented decision; claiming they are would be worse
    // than reporting the row as auto-status only.
    expect(splitNote('Task created - ok').body).toBe('');
  });

  it('strips HTML and collapses whitespace before deciding', () => {
    const out = splitNote('<p>Task Created</p> <div>customer wants a second player</div>');
    expect(out.body).toBe('customer wants a second player');
  });

  it('handles an empty or null note', () => {
    expect(splitNote(null)).toEqual({ prefix: null, body: '' });
    expect(splitNote('   ')).toEqual({ prefix: null, body: '' });
  });
});

describe('loadTaskActions — coverage is reported, not implied', () => {
  const row = (i: number) => ({
    ActionID: 1000 + i,
    TaskID: 500,
    Note: `note ${i}`,
    createdOn: '2026-09-01 10:00:00',
    completedOn: '2026-09-01 10:05:00',
    dueOn: null,
    actionResult: null,
    createdByName: 'Jane Rep',
    completedByName: 'Jane Rep',
  });

  /** `total` rows exist; pages of 100 are served until they run out. */
  const serve = (total: number) => {
    executeQueryMock.mockImplementation(async (sql: string, params: unknown[]) => {
      if (/COUNT/.test(String(sql))) return [{ n: total }];
      const offset = Number(/OFFSET (\d+)/.exec(String(sql))?.[1] ?? 0);
      void params;
      const remaining = Math.max(0, Math.min(100, total - offset));
      return Array.from({ length: remaining }, (_, i) => row(offset + i));
    });
  };

  it('reads every row when the account history is small', async () => {
    serve(12);
    const load = await loadTaskActions(500, '2026-09-04 23:59:59');
    expect(load.rows).toHaveLength(12);
    expect(load.total).toBe(12);
    expect(load.truncated).toBe(false);
    expect(load.unavailable).toBe(false);
  });

  // The defect this replaces: 26 rows arrived as "the newest 25", with nothing
  // saying the rest existed.
  it('pages past the old 25-row ceiling', async () => {
    serve(260);
    const load = await loadTaskActions(500, '2026-09-04 23:59:59');
    expect(load.rows).toHaveLength(260);
    expect(load.truncated).toBe(false);
  });

  it('says so when the history is larger than the cap allows', async () => {
    serve(MAX_RECORD_ROWS + 50);
    const load = await loadTaskActions(500, '2026-09-04 23:59:59');
    expect(load.rows).toHaveLength(MAX_RECORD_ROWS);
    expect(load.total).toBe(MAX_RECORD_ROWS + 50);
    expect(load.truncated).toBe(true);
  });

  it('reports a read failure as unavailable rather than as an empty history', async () => {
    executeQueryMock.mockImplementation(async (sql: string) => {
      if (/COUNT/.test(String(sql))) return [{ n: 5 }];
      throw new Error('crm timeout');
    });
    const load = await loadTaskActions(500, '2026-09-04 23:59:59');
    expect(load.unavailable).toBe(true);
    expect(load.rows).toEqual([]);
  });

  it('bounds every read at the supplied cutoff', async () => {
    serve(1);
    await loadTaskActions(500, '2026-09-04 23:59:59');
    for (const call of executeQueryMock.mock.calls) {
      expect(call[1]).toEqual([500, '2026-09-04 23:59:59']);
    }
  });

  // A scheduled follow-up whose only evidence is its due date IS the record the
  // timeframe rules ask for; filtering on note text is what hid it.
  it('does not filter out a row with an empty note', async () => {
    executeQueryMock.mockImplementation(async (sql: string) => (
      /COUNT/.test(String(sql))
        ? [{ n: 1 }]
        : [{ ...row(1), Note: '', dueOn: '2026-09-24 00:00:00', completedOn: '0001-01-01 05:00:00' }]
    ));
    const load = await loadTaskActions(500, '2026-09-04 23:59:59');
    expect(load.rows).toHaveLength(1);
    expect(load.rows[0].dueOn).toBe('2026-09-24 00:00:00');
  });
});

describe('loadTicketNotes', () => {
  it('reads ticket notes with their own cutoff and reports failure', async () => {
    executeQueryMock.mockImplementation(async (sql: string) => {
      if (/COUNT/.test(String(sql))) return [{ n: 1 }];
      return [{
        TicketNoteID: 4001,
        TicketID: 289807,
        Note: 'RMA issued.',
        createdOn: '2026-09-03 08:10:00',
        noteTitle: 'Return',
        createdByName: 'Support Team',
      }];
    });
    const load = await loadTicketNotes(289807, '2026-09-04 23:59:59');
    expect(load.rows[0].TicketNoteID).toBe(4001);
    expect(executeQueryMock.mock.calls[0][1]).toEqual([289807, '2026-09-04 23:59:59']);
  });

  it('reports an unavailable ticket read instead of no notes', async () => {
    executeQueryMock.mockRejectedValue(new Error('offline'));
    expect((await loadTicketNotes(1, '2026-09-04 23:59:59')).unavailable).toBe(true);
  });
});
