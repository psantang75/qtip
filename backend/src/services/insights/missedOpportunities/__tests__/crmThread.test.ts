/**
 * Sales-thread rendering — the budget must protect the primary opportunity.
 *
 * DEFECT 5 REGRESSION. History is capped at MAX_THREAD_CHARS. Pooling every
 * record's notes into one global newest-first list let a chatty associated
 * Contact Manager crowd the primary opportunity's older-but-decisive
 * documentation — a prior offer or decline the exception rules turn on — out of
 * the budget. The budget is now spent record by record in priority order, so the
 * record the call is actually about is covered before any associated context.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { loadTaskActionsMock } = vi.hoisted(() => ({ loadTaskActionsMock: vi.fn() }));

// Partial mock: real splitNote/formatting, controlled row retrieval only.
vi.mock('../crmNotes', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../crmNotes')>()),
  loadTaskActions: (...a: unknown[]) => loadTaskActionsMock(...a),
}));

import { renderSalesThread } from '../crmThread';
import type { SalesRecord } from '../crmSelect';
import type { ActionRow } from '../crmNotes';

const record = (over: Partial<SalesRecord> = {}): SalesRecord => ({
  taskId: 500,
  taskType: 'Lead Manager',
  role: 'primary_sales',
  customerId: 200,
  customerLeadId: 100,
  accountName: 'Lakeland Imaging',
  open: 'open',
  statusTitle: 'Working',
  ownerName: 'Jane Rep',
  dueOn: null,
  lastActionAt: new Date(2026, 7, 20, 9, 0),
  actionCount: 1,
  matchedBy: ['contact'],
  ...over,
});

const action = (over: Partial<ActionRow> = {}): ActionRow => ({
  ActionID: 8100,
  TaskID: 500,
  Note: 'A note.',
  createdOn: '2026-08-20 09:00:00',
  completedOn: '2026-08-20 09:05:00',
  dueOn: null,
  actionResult: null,
  createdByName: 'Jane Rep',
  completedByName: 'Jane Rep',
  ...over,
});

const loaded = (rows: ActionRow[]) => ({ rows, total: rows.length, unavailable: false, truncated: false });

beforeEach(() => vi.clearAllMocks());

describe('renderSalesThread — primary opportunity is covered first', () => {
  it("keeps the primary's decisive older note even when an associated record floods the budget", async () => {
    const decisive = 'customer already declined the five-year warranty on the prior order';
    const primaryRow = action({ ActionID: 9001, TaskID: 500, Note: decisive });

    // ~40 recent, long notes on the associated CM — together far past the cap.
    const filler = Array.from({ length: 40 }, (_, i) => action({
      ActionID: 20000 + i,
      TaskID: 880,
      Note: `Associated research note ${i} — ` + 'x'.repeat(600),
      createdOn: '2026-09-16 10:00:00',
      completedOn: '2026-09-16 10:05:00',
    }));

    loadTaskActionsMock.mockImplementation((taskId: number) =>
      Promise.resolve(loaded(taskId === 500 ? [primaryRow] : filler)));

    const res = await renderSalesThread({
      records: [record(), record({ taskId: 880, role: 'account_cm', taskType: 'Contact Manager' })],
      callAt: new Date(2026, 8, 17, 14, 0),
      notAfter: '2026-09-17 23:59:59',
    });

    expect(res.notes).toContain(decisive);
    expect(res.coverage.truncated).toBe(true);
    expect(res.coverage.rowsOmitted).toBeGreaterThan(0);
    expect(res.refs).toEqual(['TASK 500', 'TASK 880']);
  });

  it('reports complete coverage when everything fits', async () => {
    loadTaskActionsMock.mockResolvedValue(loaded([action({ Note: 'Scoped three zones.' })]));
    const res = await renderSalesThread({
      records: [record()],
      callAt: new Date(2026, 8, 17, 14, 0),
      notAfter: '2026-09-17 23:59:59',
    });
    expect(res.coverage.truncated).toBe(false);
    expect(res.coverage.rowsOmitted).toBe(0);
    expect(res.notes).toContain('Scoped three zones.');
  });

  it('records a per-record read failure without losing the other records', async () => {
    loadTaskActionsMock.mockImplementation((taskId: number) =>
      Promise.resolve(taskId === 500
        ? { rows: [], total: 0, unavailable: true, truncated: false }
        : loaded([action({ TaskID: 880, Note: 'CM note survived.' })])));
    const res = await renderSalesThread({
      records: [record(), record({ taskId: 880, role: 'account_cm' })],
      callAt: new Date(2026, 8, 17, 14, 0),
      notAfter: '2026-09-17 23:59:59',
    });
    expect(res.coverage.errors).toContain('TASK 500: history read failed');
    expect(res.notes).toContain('CM note survived.');
  });
});
