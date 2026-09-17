/**
 * crmLink resolves the ONE task/ticket a sales call was about, from the call's
 * phone number, and returns that record's note history. These tests pin the
 * bridge rules the product asked for:
 *   - a single open lead-task is a 'strong' match;
 *   - several candidates are narrowed to the note closest to the call ('weak');
 *   - a number on too many accounts, or on none, resolves to null so the caller
 *     falls back to day-wide notes rather than linking a stranger's record.
 * Every DB call is mocked; this is behaviour, not integration.
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
  stripHtmlToPlaintext: (s: string) => s,
}));

import { resolveCallCrmRecord } from '../crmLink';
import type { CallCandidate } from '../types';

const candidate = (over: Partial<CallCandidate> = {}): CallCandidate => ({
  conversationId: 'conv-1',
  agentName: 'Jane Rep',
  agentEmail: 'jane@example.com',
  phoneUserId: 'pu-1',
  startedAt: new Date('2026-09-04T14:30:00Z'),
  dateKey: 20260904,
  direction: 'inbound',
  talkSecs: 420,
  remoteParty: 'Sappington MO',
  wrapUpCode: null,
  ...over,
});

/** Route each executeQuery call by the table it reads, in the module's own order. */
interface Rows {
  sessions?: unknown[];
  contactPhone?: unknown[];
  leads?: unknown[];
  contacts?: unknown[];
  tasks?: unknown[];
  actions?: unknown[];
  tickets?: unknown[];
  ticketNotes?: unknown[];
}
function route(rows: Rows) {
  return (sql: string) => {
    if (/FROM tblSessions/.test(sql)) return Promise.resolve(rows.sessions ?? []);
    if (/FROM tblContactPhone/.test(sql)) return Promise.resolve(rows.contactPhone ?? []);
    if (/FROM tblCustomerLead/.test(sql)) return Promise.resolve(rows.leads ?? []);
    if (/FROM tblContacts/.test(sql)) return Promise.resolve(rows.contacts ?? []);
    if (/FROM tblTicketNote/.test(sql)) return Promise.resolve(rows.ticketNotes ?? []);
    if (/FROM tblTask/.test(sql)) return Promise.resolve(rows.tasks ?? []);
    if (/FROM tblAction/.test(sql)) return Promise.resolve(rows.actions ?? []);
    if (/FROM tblTicket/.test(sql)) return Promise.resolve(rows.tickets ?? []);
    return Promise.resolve([]);
  };
}

beforeEach(() => vi.clearAllMocks());

describe('resolveCallCrmRecord', () => {
  it('returns null when the conversation has no far-end number', async () => {
    executeQueryMock.mockImplementation(route({ sessions: [] }));
    expect(await resolveCallCrmRecord(candidate())).toBeNull();
  });

  it('returns null when the number matches no contact', async () => {
    executeQueryMock.mockImplementation(route({
      sessions: [{ ANI: '(586) 555-1234', Dnis: null, Remote: null }],
      contactPhone: [],
    }));
    expect(await resolveCallCrmRecord(candidate())).toBeNull();
  });

  it('resolves a single open lead-task as a strong TASK with its history', async () => {
    executeQueryMock.mockImplementation(route({
      sessions: [{ ANI: '(586) 555-1234', Dnis: null, Remote: null }],
      contactPhone: [{ ContactID: 10 }],
      leads: [{ CustomerLeadID: 100, CustomerID: 200 }],
      contacts: [{ CustomerID: 200 }],
      tasks: [{
        TaskID: 500, CustomerLeadID: 100, CompletedOn: null,
        taskType: 'New Business Lead', accountName: 'Acme Co', lastActionOn: '2026-09-01T10:00:00Z',
      }],
      actions: [{ Note: 'Called and discussed pricing', at: '2026-09-01T10:00:00Z', meta: 'Left Message' }],
    }));

    const res = await resolveCallCrmRecord(candidate());
    expect(res).not.toBeNull();
    expect(res!.kind).toBe('TASK');
    expect(res!.id).toBe(500);
    expect(res!.confidence).toBe('strong');
    expect(res!.crm.scope).toBe('record');
    expect(res!.crm.refs).toEqual(['TASK 500']);
    expect(res!.crm.notes).toContain('discussed pricing');
    expect(res!.crm.recordLabel).toContain('TASK 500');
    const taskSql = executeQueryMock.mock.calls
      .map((c) => String(c[0]))
      .find((s) => s.includes('FROM tblTask'));
    expect(taskSql).toContain('t.TaskTypeID = 11');
    expect(taskSql).toContain("tt.Title = 'Contact Manager'");
  });

  it('narrows several open lead-tasks to the note closest to the call (weak)', async () => {
    executeQueryMock.mockImplementation(route({
      sessions: [{ ANI: '5865551234', Dnis: null, Remote: null }],
      contactPhone: [{ ContactID: 10 }],
      leads: [{ CustomerLeadID: 100, CustomerID: 200 }],
      contacts: [{ CustomerID: 200 }],
      tasks: [
        { TaskID: 502, CustomerLeadID: 100, CompletedOn: null, taskType: 'Lead', accountName: 'Acme', lastActionOn: '2026-06-01T00:00:00Z' },
        { TaskID: 501, CustomerLeadID: 100, CompletedOn: null, taskType: 'Lead', accountName: 'Acme', lastActionOn: '2026-09-04T13:00:00Z' },
      ],
      actions: [{ Note: 'note', at: '2026-09-04T13:00:00Z', meta: null }],
    }));

    const res = await resolveCallCrmRecord(candidate());
    expect(res!.kind).toBe('TASK');
    expect(res!.id).toBe(501); // closest note to the 14:30 call
    expect(res!.confidence).toBe('weak');
  });

  it('appends the Contact Manager thread on the same lead, and cites the lead-task', async () => {
    executeQueryMock.mockImplementation(route({
      sessions: [{ ANI: '5865551234', Dnis: null, Remote: null }],
      contactPhone: [{ ContactID: 10 }],
      leads: [{ CustomerLeadID: 100, CustomerID: 200 }],
      contacts: [{ CustomerID: 200 }],
      tasks: [
        {
          TaskID: 501, CustomerLeadID: 100, CompletedOn: null,
          taskType: 'Lead Manager', accountName: 'Mercado', lastActionOn: '2026-09-04T13:00:00Z',
        },
        {
          TaskID: 880, CustomerLeadID: 100, CompletedOn: null,
          taskType: 'Contact Manager', accountName: 'Mercado', lastActionOn: '2026-09-04T12:00:00Z',
        },
      ],
      actions: [{ Note: '2 locations, just wants 1', at: '2026-09-04T13:00:00Z', meta: null }],
    }));

    const res = await resolveCallCrmRecord(candidate());
    expect(res!.id).toBe(501);
    expect(res!.crm.refs).toEqual(['TASK 501', 'TASK 880']);
    expect(res!.crm.notes).toContain('just wants 1');
  });

  it('falls back to a ticket when the account has no tasks', async () => {
    executeQueryMock.mockImplementation(route({
      sessions: [{ ANI: '5865551234', Dnis: null, Remote: null }],
      contactPhone: [{ ContactID: 10 }],
      leads: [],
      contacts: [{ CustomerID: 200 }],
      tasks: [],
      tickets: [{ TicketID: 900, accountName: 'Acme Co', at: '2026-09-02T00:00:00Z' }],
      ticketNotes: [{ Note: 'ticket thread', at: '2026-09-02T00:00:00Z', meta: 'Update' }],
    }));

    const res = await resolveCallCrmRecord(candidate());
    expect(res!.kind).toBe('TICKET');
    expect(res!.id).toBe(900);
    expect(res!.crm.refs).toEqual(['TICKET 900']);
    expect(res!.crm.notes).toContain('ticket thread');
  });

  it('returns null when the number sits on too many accounts to trust', async () => {
    executeQueryMock.mockImplementation(route({
      sessions: [{ ANI: '5865551234', Dnis: null, Remote: null }],
      contactPhone: Array.from({ length: 30 }, (_, i) => ({ ContactID: i + 1 })),
    }));
    expect(await resolveCallCrmRecord(candidate())).toBeNull();
  });
});

/**
 * The thread is the account's history, and history means what existed when the
 * call happened. Unbounded, a re-grade of a day three weeks ago read notes
 * written since and judged the rep against outcomes they could not have known.
 */
describe('resolveCallCrmRecord — the thread is bounded at the call day', () => {
  const withTask = () => route({
    sessions: [{ ANI: '5865551234', Dnis: null, Remote: null }],
    contactPhone: [{ ContactID: 10 }],
    leads: [{ CustomerLeadID: 100, CustomerID: 200 }],
    contacts: [{ CustomerID: 200 }],
    tasks: [{
      TaskID: 500, CustomerLeadID: 100, CompletedOn: null,
      taskType: 'New Business Lead', accountName: 'Acme Co', lastActionOn: '2026-09-01T10:00:00Z',
    }],
    actions: [{ Note: 'Called and discussed pricing', at: '2026-09-01T10:00:00Z', meta: null }],
  });

  const callAt = (sqlFragment: string) => executeQueryMock.mock.calls
    .find(([sql]) => String(sql).includes(sqlFragment));

  it('bounds the task thread at the end of the call day', async () => {
    executeQueryMock.mockImplementation(withTask());
    await resolveCallCrmRecord(candidate({ startedAt: new Date(2026, 8, 4, 14, 30) }));

    const [sql, params] = callAt('FROM tblAction') as [string, unknown[]];
    expect(String(sql)).toContain('COALESCE(a.CompletedOn, a.CreatedOn) <= ?');
    expect(params).toEqual([500, '2026-09-04 23:59:59']);
  });

  it('bounds the ticket thread the same way', async () => {
    executeQueryMock.mockImplementation(route({
      sessions: [{ ANI: '5865551234', Dnis: null, Remote: null }],
      contactPhone: [{ ContactID: 10 }],
      contacts: [{ CustomerID: 200 }],
      tasks: [],
      tickets: [{ TicketID: 900, accountName: 'Acme Co', at: '2026-09-02T00:00:00Z' }],
      ticketNotes: [{ Note: 'ticket thread', at: '2026-09-02T00:00:00Z', meta: null }],
    }));
    await resolveCallCrmRecord(candidate({ startedAt: new Date(2026, 8, 4, 14, 30) }));

    const [sql, params] = callAt('FROM tblTicketNote') as [string, unknown[]];
    expect(String(sql)).toContain('tn.CreatedOn <= ?');
    expect(params).toEqual([900, '2026-09-04 23:59:59']);
  });

  // End of day, not call time: the rep's own post-call note is where the dated
  // next step gets recorded, and cutting at the call would make the
  // follow-through rules fire on evidence that exists minutes later.
  it('keeps the rest of the call day, so post-call follow-through still counts', async () => {
    executeQueryMock.mockImplementation(withTask());
    await resolveCallCrmRecord(candidate({ startedAt: new Date(2026, 8, 4, 9, 5) }));

    const [, params] = callAt('FROM tblAction') as [string, unknown[]];
    expect(params[1]).toBe('2026-09-04 23:59:59');
  });

  it('uses the call\'s own local day, not today', async () => {
    executeQueryMock.mockImplementation(withTask());
    await resolveCallCrmRecord(candidate({ startedAt: new Date(2025, 11, 31, 18, 0) }));

    const [, params] = callAt('FROM tblAction') as [string, unknown[]];
    expect(params[1]).toBe('2025-12-31 23:59:59');
  });
});
