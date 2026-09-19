/**
 * Resolver tests — which CRM records a reviewed call belongs to.
 *
 * These are the September 17 production failures as fixtures. The old resolver
 * did not just miss records, it MISREPRESENTED what it found: Lakeland and Keys
 * were both attached to an unrelated La Mesa task and saved as confident links,
 * and Taste Buds landed on the Dynamic Media Test account. Four mechanisms
 * produced that, and each has a test below:
 *
 *   - it matched contacts against every number on the conversation, ours
 *     included, so our own DID could resolve to whatever account carries it;
 *   - it read `CompletedOn IS NULL` on a NOT NULL column, so no task was ever
 *     open and selection fell through to nearest-note;
 *   - it never expanded through CustomerID, so the account's Contact Manager —
 *     where an existing customer's history lives — was invisible;
 *   - it called a single returned candidate a strong match, and the worker
 *     overwrote the model's citation with it.
 *
 * The outcome is now part of the answer, so the tests assert the outcome as well
 * as the id: "we found one record" and "we know this is the right record" have to
 * be distinguishable, because only the latter may override a citation.
 *
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
  startedAt: new Date(2026, 8, 4, 14, 30),
  dateKey: 20260904,
  direction: 'inbound',
  talkSecs: 420,
  remoteParty: 'Sappington MO',
  wrapUpCode: null,
  ...over,
});

/** An inbound customer leg: their number is the ANI, ours is the DNIS. */
const inboundLeg = (customerNumber: string, ourNumber = '8005551000') => ({
  ParticipantID: 'p-cust',
  purpose: 'customer',
  Direction: 'inbound',
  ANI: customerNumber,
  Dnis: ourNumber,
  Remote: customerNumber,
});

/** The salesperson's own leg on that conversation. */
const agentLeg = (customerNumber: string, participantId = 'p-agent') => ({
  ParticipantID: participantId,
  purpose: 'agent',
  Direction: 'inbound',
  ANI: customerNumber,
  Dnis: '4045552000',
  Remote: customerNumber,
});

/**
 * A candidate task row in the shape TASK_SELECT returns. Open by default —
 * `statusClosed: 0` plus the `1-1-1` CompletedOn sentinel a real open task
 * carries, which is precisely what the old `CompletedOn IS NULL` test missed.
 */
const task = (over: Record<string, unknown> = {}) => ({
  TaskID: 500,
  TaskTypeID: 11,
  taskType: 'Lead Manager',
  statusTitle: 'Working',
  statusClosed: 0,
  ContactID: 10,
  CustomerID: 200,
  CustomerLeadID: 100,
  accountName: 'Lakeland Imaging',
  completedOn: '0001-01-01 05:00:00',
  createdOn: '2026-08-20 09:00:00',
  dueOn: '2026-09-18 00:00:00',
  AssignedTo: 7,
  ownerName: 'Jane Rep',
  lastActionOn: '2026-09-01 10:00:00',
  actionCount: 2,
  ...over,
});

const action = (over: Record<string, unknown> = {}) => ({
  ActionID: 8100,
  TaskID: 500,
  Note: 'Scoped three MRI zones and registered as a vendor.',
  createdOn: '2026-09-01 10:00:00',
  completedOn: '2026-09-01 10:05:00',
  dueOn: null,
  actionResult: 'Left Message',
  createdByName: 'Jane Rep',
  completedByName: 'Jane Rep',
  ...over,
});

interface Rows {
  sessions?: unknown[];
  contactPhone?: unknown[];
  leads?: unknown[];
  contacts?: unknown[];
  tasks?: unknown[];
  /** Tasks returned for a by-id lookup (duplicate-note reference validation). */
  tasksById?: unknown[];
  actions?: unknown[];
  tickets?: unknown[];
  ticketNotes?: unknown[];
}

/**
 * Route each executeQuery by the shape of its SQL. Counts are checked first
 * because the count queries name the same tables as the row queries.
 */
function route(rows: Rows) {
  return (sql: string) => {
    const s = String(sql);
    if (/COUNT\(\*\) AS n FROM tblAction/.test(s)) {
      return Promise.resolve([{ n: (rows.actions ?? []).length }]);
    }
    if (/COUNT\(\*\) AS n FROM tblTicketNote/.test(s)) {
      return Promise.resolve([{ n: (rows.ticketNotes ?? []).length }]);
    }
    if (/FROM tblSessions/.test(s)) return Promise.resolve(rows.sessions ?? []);
    if (/FROM tblContactPhone/.test(s)) return Promise.resolve(rows.contactPhone ?? []);
    if (/FROM tblCustomerLead\b/.test(s) && /SELECT CustomerLeadID/.test(s)) {
      return Promise.resolve(rows.leads ?? []);
    }
    if (/FROM tblContacts/.test(s)) return Promise.resolve(rows.contacts ?? []);
    if (/FROM tblTicketNote tn/.test(s)) return Promise.resolve(rows.ticketNotes ?? []);
    if (/FROM tblTicket ti/.test(s)) return Promise.resolve(rows.tickets ?? []);
    if (/WHERE t\.TaskID IN/.test(s)) return Promise.resolve(rows.tasksById ?? []);
    if (/FROM tblTask t/.test(s)) return Promise.resolve(rows.tasks ?? []);
    if (/FROM tblAction a/.test(s)) return Promise.resolve(rows.actions ?? []);
    return Promise.resolve([]);
  };
}

/** The happy path: one open lead on an account the call names. */
const resolvedAccount = (over: Rows = {}): Rows => ({
  sessions: [inboundLeg('(586) 555-1234'), agentLeg('(586) 555-1234')],
  contactPhone: [{ ContactID: 10 }],
  leads: [{ CustomerLeadID: 100, CustomerID: 200, Name: 'Lakeland Imaging' }],
  contacts: [{ CustomerID: 200, Name: 'Lakeland Imaging' }],
  tasks: [task()],
  actions: [action()],
  ...over,
});

/** Corroborating call text, so an account can reach `verified`. */
const withName = { callText: 'Customer: this is Lakeland Imaging calling about the MRI zones.' };

beforeEach(() => vi.clearAllMocks());

describe('resolveCallCrmRecord — an outcome is always returned', () => {
  // Returning null collapsed "no record", "lookup broke" and "several accounts
  // we cannot separate" into one silent fallback to the salesperson's day-wide
  // notes — another customer's history, presented as this account's.
  it('reports a phone-system failure as unavailable, not as an empty account', async () => {
    executeQueryMock.mockImplementation((sql: string) => (
      /FROM tblSessions/.test(String(sql))
        ? Promise.reject(new Error('phone db down'))
        : Promise.resolve([])
    ));
    const res = await resolveCallCrmRecord(candidate());
    expect(res.outcome).toBe('unavailable');
    expect(res.id).toBeNull();
    expect(res.crm.unavailable).toBe(true);
    expect(res.crm.resolution?.reason).toContain('phone system');
  });

  it('reports no customer-side number as unmatched', async () => {
    executeQueryMock.mockImplementation(route({ sessions: [] }));
    const res = await resolveCallCrmRecord(candidate());
    expect(res.outcome).toBe('unmatched');
    expect(res.crm.unavailable).toBeUndefined();
  });

  it('reports a number that matches no contact as unmatched, with the number kept', async () => {
    executeQueryMock.mockImplementation(route({
      sessions: [inboundLeg('5865551234')],
      contactPhone: [],
    }));
    const res = await resolveCallCrmRecord(candidate());
    expect(res.outcome).toBe('unmatched');
    expect(res.crm.resolution?.numbers).toEqual([
      { digits: '5865551234', source: 'customer-participant' },
    ]);
  });

  it('reports a CRM task-lookup failure as unavailable', async () => {
    executeQueryMock.mockImplementation((sql: string) => (
      /FROM tblTask t/.test(String(sql))
        ? Promise.reject(new Error('crm timeout'))
        : route(resolvedAccount())(String(sql))
    ));
    const res = await resolveCallCrmRecord(candidate());
    expect(res.outcome).toBe('unavailable');
    expect(res.crm.resolution?.reason).toContain('task lookup failed');
  });
});

describe('resolveCallCrmRecord — the customer number, not ours', () => {
  // The mechanism behind Lakeland and Keys both resolving to a La Mesa task: our
  // own DID went into the contact lookup alongside the customer's number.
  it('never looks our own near-end numbers up as contacts', async () => {
    executeQueryMock.mockImplementation(route(resolvedAccount()));
    await resolveCallCrmRecord(candidate());
    const [, params] = executeQueryMock.mock.calls
      .find(([sql]) => /FROM tblContactPhone/.test(String(sql))) as [string, string[]];
    expect(params).toContain('5865551234');
    expect(params).not.toContain('8005551000');
    expect(params).not.toContain('4045552000');
  });

  it('records where each number came from, so a match can be judged', async () => {
    executeQueryMock.mockImplementation(route(resolvedAccount()));
    const res = await resolveCallCrmRecord(candidate(), withName);
    expect(res.crm.resolution?.numbers).toEqual([
      { digits: '5865551234', source: 'customer-participant' },
    ]);
  });

  it('refuses to attribute a conversation with a crowd of outside numbers', async () => {
    executeQueryMock.mockImplementation(route({
      sessions: Array.from({ length: 6 }, (_, i) => inboundLeg(`60255510${i}0`)),
    }));
    const res = await resolveCallCrmRecord(candidate());
    expect(res.outcome).toBe('ambiguous');
    expect(res.crm.resolution?.reason).toContain('too many outside numbers');
  });
});

describe('resolveCallCrmRecord — open leads and real CRM date sentinels', () => {
  it('treats the 1-1-1 sentinel plus an open status as open', async () => {
    executeQueryMock.mockImplementation(route(resolvedAccount()));
    const res = await resolveCallCrmRecord(candidate(), withName);
    expect(res.kind).toBe('TASK');
    expect(res.id).toBe(500);
    expect(res.crm.resolution?.reason).toContain('one open lead');
  });

  it('does not resurrect a completed task as open', async () => {
    executeQueryMock.mockImplementation(route(resolvedAccount({
      tasks: [task({ completedOn: '2026-08-30 16:00:00', statusTitle: 'Closed', statusClosed: 1 })],
    })));
    const res = await resolveCallCrmRecord(candidate(), withName);
    expect(res.id).toBe(500);
    expect(res.crm.resolution?.reason).toContain('no open lead');
  });

  // The CRM's authoritative terminal flag is tblTaskStatus.Closed, because a
  // source bug leaves many finished tasks with no CompletedOn at all.
  it('honours a closed status even when CompletedOn is the open sentinel', async () => {
    executeQueryMock.mockImplementation(route(resolvedAccount({
      tasks: [task({ statusTitle: 'Sold', statusClosed: 1 })],
    })));
    const res = await resolveCallCrmRecord(candidate(), withName);
    expect(res.crm.resolution?.reason).toContain('no open lead');
  });

  it('keeps the one documented exception open — Contact Past Due is actionable', async () => {
    executeQueryMock.mockImplementation(route(resolvedAccount({
      tasks: [task({ statusTitle: 'Contact Past Due', statusClosed: 1 })],
    })));
    const res = await resolveCallCrmRecord(candidate(), withName);
    expect(res.crm.resolution?.reason).toContain('one open lead');
  });

  it('reports an unreadable date as unknown rather than promoting it to open', async () => {
    executeQueryMock.mockImplementation(route(resolvedAccount({
      tasks: [task({ completedOn: 'not-a-date', statusClosed: null })],
    })));
    const res = await resolveCallCrmRecord(candidate(), withName);
    expect(res.crm.resolution?.reason).toContain('open state could not be established');
  });

  it('rejects a lead-type task carrying CustomerLeadID 0 — that is not a lead', async () => {
    executeQueryMock.mockImplementation(route(resolvedAccount({
      tasks: [task({ CustomerLeadID: 0 })],
    })));
    const res = await resolveCallCrmRecord(candidate(), withName);
    expect(res.outcome).toBe('unmatched');
    expect(res.crm.resolution?.rejected).toEqual([
      { ref: 'TASK 500', reason: 'lead-type task with no real CustomerLeadID' },
    ]);
  });
});

describe('resolveCallCrmRecord — the account Contact Manager', () => {
  // A CM normally carries CustomerLeadID 0 and often a null ContactID, so the
  // old contact/lead-only search could not see it — and for an existing customer
  // the CM is where the sales history is.
  it('finds the CM by expanding through the verified CustomerID', async () => {
    executeQueryMock.mockImplementation(route(resolvedAccount({
      tasks: [
        task(),
        task({
          TaskID: 880, TaskTypeID: 4, taskType: 'Contact Manager', CustomerLeadID: 0,
          ContactID: null, lastActionOn: '2026-08-15 11:00:00',
        }),
      ],
    })));
    const res = await resolveCallCrmRecord(candidate(), withName);
    expect(res.id).toBe(500);
    expect(res.crm.refs).toEqual(['TASK 500', 'TASK 880']);

    const [taskSql, params] = executeQueryMock.mock.calls
      .find(([sql]) => /FROM tblTask t/.test(String(sql))) as [string, unknown[]];
    expect(taskSql).toContain('t.CustomerID IN');
    expect(params).toContain(200);
  });

  it('never turns lead id 0 into a shared lead relationship in SQL', async () => {
    executeQueryMock.mockImplementation(route(resolvedAccount({
      leads: [{ CustomerLeadID: 0, CustomerID: 200, Name: 'Lakeland Imaging' }],
    })));
    await resolveCallCrmRecord(candidate(), withName);
    const [sql, params] = executeQueryMock.mock.calls
      .find(([s]) => /FROM tblTask t/.test(String(s))) as [string, unknown[]];
    expect(sql).not.toContain('t.CustomerLeadID IN');
    expect(params).not.toContain(0);
  });

  it('uses the CM as the sales record when the account has no lead at all', async () => {
    executeQueryMock.mockImplementation(route(resolvedAccount({
      tasks: [task({
        TaskID: 816551, TaskTypeID: 4, taskType: 'Contact Manager', CustomerLeadID: 0,
        accountName: 'Taste Buds Kitchen',
      })],
      leads: [],
      contacts: [{ CustomerID: 200, Name: 'Taste Buds Kitchen' }],
    })));
    const res = await resolveCallCrmRecord(candidate(), {
      callText: 'Customer: Taste Buds Kitchen, we are testing the player tomorrow.',
    });
    expect(res.id).toBe(816551);
    expect(res.crm.resolution?.reason).toContain('Contact Manager is the sales record');
  });
});

describe('resolveCallCrmRecord — separate accounts stay separate', () => {
  const twoAccounts = () => resolvedAccount({
    contactPhone: [{ ContactID: 10 }, { ContactID: 11 }],
    leads: [
      { CustomerLeadID: 100, CustomerID: 200, Name: 'Lakeland Imaging' },
      { CustomerLeadID: 101, CustomerID: 999, Name: 'La Mesa Auto' },
    ],
    contacts: [
      { CustomerID: 200, Name: 'Lakeland Imaging' },
      { CustomerID: 999, Name: 'La Mesa Auto' },
    ],
    tasks: [
      task(),
      task({ TaskID: 1058436, CustomerID: 999, CustomerLeadID: 101, accountName: 'La Mesa Auto' }),
    ],
  });

  // Lakeland #113–114 and Keys #131–133. A shared number reached two accounts and
  // the resolver picked one and called it strong.
  it('refuses to choose between two accounts the call does not separate', async () => {
    executeQueryMock.mockImplementation(route(twoAccounts()));
    const res = await resolveCallCrmRecord(candidate());
    expect(res.outcome).toBe('ambiguous');
    expect(res.id).toBeNull();
    expect(res.crm.resolution?.rejected.map((r) => r.ref)).toContain('TASK 1058436');
  });

  it('picks the account the call itself names and rejects the other by name', async () => {
    executeQueryMock.mockImplementation(route(twoAccounts()));
    const res = await resolveCallCrmRecord(candidate(), withName);
    expect(res.id).toBe(500);
    expect(res.crm.resolution?.rejected).toEqual([
      { ref: 'TASK 1058436', reason: 'different account; the call names another' },
    ]);
  });

  // Taste Buds #130 landed on task 508288, Dynamic Media Test. A candidate with
  // no contact, lead or customer link to the matched account is not a candidate.
  it('drops a candidate with no verified relationship to the matched account', async () => {
    executeQueryMock.mockImplementation(route(resolvedAccount({
      tasks: [
        task(),
        task({
          TaskID: 508288, ContactID: null, CustomerID: 4, CustomerLeadID: 9,
          accountName: 'Dynamic Media Test',
        }),
      ],
    })));
    const res = await resolveCallCrmRecord(candidate(), withName);
    expect(res.crm.refs).not.toContain('TASK 508288');
    expect(res.crm.resolution?.rejected).toEqual([
      { ref: 'TASK 508288', reason: 'no verified contact/lead/customer relationship' },
    ]);
  });
});

describe('resolveCallCrmRecord — confidence has to be earned', () => {
  // One candidate is not identity. The worker may only overwrite the model's
  // citation on `verified`, so this distinction decides whether a manager gets
  // deep-linked into someone else's record.
  it('is provisional on a bare phone match, however few candidates came back', async () => {
    executeQueryMock.mockImplementation(route(resolvedAccount()));
    const res = await resolveCallCrmRecord(candidate());
    expect(res.id).toBe(500);
    expect(res.outcome).toBe('provisional');
  });

  it('is verified only when the call independently corroborates the account', async () => {
    executeQueryMock.mockImplementation(route(resolvedAccount()));
    expect((await resolveCallCrmRecord(candidate(), withName)).outcome).toBe('verified');
  });

  // Lakeland #1775 / Apple #1809: a matching account NAME is not opportunity
  // verification. A fulfilled or historical closed lead must stay provisional so
  // the worker never overwrites the model's citation with an old record.
  it('never verifies a historical closed-lead fallback, however well the name matches', async () => {
    executeQueryMock.mockImplementation(route(resolvedAccount({
      tasks: [task({ completedOn: '2026-07-30 16:00:00', statusTitle: 'Sold', statusClosed: 1 })],
    })));
    const res = await resolveCallCrmRecord(candidate(), withName);
    expect(res.id).toBe(500);
    expect(res.outcome).toBe('provisional');
    expect(res.crm.resolution?.reason).toContain('historical record');
  });

  it('never verifies the account Contact Manager fallback', async () => {
    executeQueryMock.mockImplementation(route(resolvedAccount({
      tasks: [task({
        TaskID: 847008, TaskTypeID: 4, taskType: 'Contact Manager', CustomerLeadID: 0,
      })],
      leads: [],
      contacts: [{ CustomerID: 200, Name: 'Lakeland Imaging' }],
    })));
    const res = await resolveCallCrmRecord(candidate(), withName);
    expect(res.id).toBe(847008);
    expect(res.outcome).toBe('provisional');
  });

  it('does not accept a generic word as corroboration', async () => {
    executeQueryMock.mockImplementation(route(resolvedAccount({
      tasks: [task({ accountName: 'The Store Company' })],
      leads: [{ CustomerLeadID: 100, CustomerID: 200, Name: 'The Store Company' }],
    })));
    const res = await resolveCallCrmRecord(candidate(), {
      callText: 'Customer: I run a store and a company.',
    });
    expect(res.outcome).toBe('provisional');
  });

  it('stays ambiguous when several open leads share one account', async () => {
    executeQueryMock.mockImplementation(route(resolvedAccount({
      tasks: [
        task({ TaskID: 501, lastActionOn: '2026-06-01 09:00:00' }),
        task({ TaskID: 502, lastActionOn: '2026-07-01 09:00:00' }),
      ],
    })));
    const res = await resolveCallCrmRecord(candidate(), withName);
    expect(res.outcome).toBe('ambiguous');
    expect(res.id).toBeNull();
    expect(res.crm.resolution?.reason).toContain('2 open leads');
  });

  // Fair Oaks #109: an old completed task was chosen over the relevant open lead
  // because the old one had the closest recent action. Same-day work on the
  // reviewed day is the opportunity evidence, not raw proximity.
  it('separates several open leads by work on the reviewed day', async () => {
    executeQueryMock.mockImplementation(route(resolvedAccount({
      tasks: [
        task({ TaskID: 1074398, lastActionOn: '2026-08-01 09:00:00' }),
        task({ TaskID: 1120485, lastActionOn: '2026-09-04 09:15:00' }),
      ],
    })));
    const res = await resolveCallCrmRecord(candidate(), withName);
    expect(res.id).toBe(1120485);
    expect(res.crm.resolution?.reason).toContain('worked on the reviewed day');
  });
});

describe('resolveCallCrmRecord — duplicate-closed leads', () => {
  const duplicateNote = action({
    ActionID: 8495653,
    TaskID: 1109240,
    Note: 'Closing as a duplicate — see task 1110112 for the active order.',
    actionResult: 'Closed',
  });

  const closedDuplicate = () => resolvedAccount({
    tasks: [task({
      TaskID: 1109240, statusTitle: 'Closed', statusClosed: 1,
      completedOn: '2026-09-02 12:00:00',
    })],
    actions: [duplicateNote],
    tasksById: [task({
      TaskID: 1110112, statusTitle: 'Working', statusClosed: 0,
      lastActionOn: '2026-09-03 08:00:00',
    })],
  });

  it('follows the duplicate to its validated successor and grades against that', async () => {
    executeQueryMock.mockImplementation(route(closedDuplicate()));
    const res = await resolveCallCrmRecord(candidate(), withName);
    expect(res.id).toBe(1110112);
    expect(res.crm.resolution?.duplicatePath.join(' ')).toContain('TASK 1109240 duplicate-closed');
    expect(res.crm.resolution?.duplicatePath.join(' ')).toContain('-> TASK 1110112');
  });

  it('keeps the duplicate in the record set — it is where the decisions were written', async () => {
    executeQueryMock.mockImplementation(route(closedDuplicate()));
    const res = await resolveCallCrmRecord(candidate(), withName);
    expect(res.crm.refs).toContain('TASK 1109240');
  });

  it('says so plainly when a duplicate names no successor', async () => {
    executeQueryMock.mockImplementation(route(resolvedAccount({
      tasks: [task({
        TaskID: 1120480, statusTitle: 'Closed', statusClosed: 1,
        completedOn: '2026-09-02 12:00:00',
      })],
      actions: [action({ Note: 'Duplicate of an existing dealer relationship.' })],
    })));
    const res = await resolveCallCrmRecord(candidate(), withName);
    expect(res.crm.resolution?.reason).toContain('successor not established');
    // The duplicate itself remains the historical record; no lead is invented.
    expect(res.id).toBe(1120480);
  });

  it('does not follow a fulfilment closure as though it were a duplicate', async () => {
    executeQueryMock.mockImplementation(route(resolvedAccount({
      tasks: [task({
        TaskID: 856216, statusTitle: 'Closed', statusClosed: 1,
        completedOn: '2026-09-01 12:00:00',
      })],
      actions: [action({ Note: 'Task closed because a new lead was created.' })],
      tasksById: [task({ TaskID: 856321 })],
    })));
    const res = await resolveCallCrmRecord(candidate(), withName);
    expect(res.id).toBe(856216);
    expect(res.crm.resolution?.duplicatePath.join(' ')).toContain('fulfilment/system');
  });

  // Toyota of Gladstone #128: interaction 1120470 / customer 149020 and web
  // fulfilment 1120469 / customer 149019 are genuinely related, and are still two
  // accounts. Following the reference is allowed; calling the result verified is
  // not, because a record on an account the phone match never established cannot
  // corroborate itself.
  it('downgrades a verified match to provisional when the successor is cross-account', async () => {
    executeQueryMock.mockImplementation(route(resolvedAccount({
      tasks: [task({
        TaskID: 1120470, statusTitle: 'Closed', statusClosed: 1,
        completedOn: '2026-09-02 12:00:00',
      })],
      actions: [action({ Note: 'Duplicate — fulfilled on task 1120469 instead.' })],
      tasksById: [task({
        TaskID: 1120469, CustomerID: 149019, CustomerLeadID: 193194,
        accountName: 'Toyota of Gladstone Web',
      })],
    })));
    const res = await resolveCallCrmRecord(candidate(), withName);
    expect(res.crm.resolution?.duplicatePath.join(' ')).toContain('-> TASK 1120469');
    expect(res.crm.resolution?.crossAccount).toBe(true);
    expect(res.outcome).toBe('provisional');
  });

  it('does not claim cross-account when no cross-account record was used', async () => {
    executeQueryMock.mockImplementation(route(resolvedAccount()));
    const res = await resolveCallCrmRecord(candidate(), withName);
    expect(res.crm.resolution?.crossAccount).toBe(false);
  });
});

describe('resolveCallCrmRecord — tickets keep their own role', () => {
  const withTicket = () => resolvedAccount({
    tickets: [{
      TicketID: 289807, CustomerID: 200, ContactID: 10,
      accountName: "Patrick's", assignedToName: 'Support Team', at: '2026-09-03 08:00:00',
    }],
    ticketNotes: [{
      TicketNoteID: 4001,
      TicketID: 289807,
      Note: 'Explained the standard one year and the additional five year option.',
      createdOn: '2026-09-03 08:10:00',
      noteTitle: 'Warranty question',
      createdByName: 'Support Team',
    }],
  });

  // Jason #112. The warranty explanation lives on a support ticket; rendering it
  // in the sales block is what let it read as the salesperson's documentation.
  it('renders ticket notes separately from the sales history', async () => {
    executeQueryMock.mockImplementation(route(withTicket()));
    const res = await resolveCallCrmRecord(candidate(), withName);
    expect(res.crm.ticketNotes).toContain('five year option');
    expect(res.crm.notes).not.toContain('five year option');
  });

  it('still cites the sales task, not the ticket, as the primary record', async () => {
    executeQueryMock.mockImplementation(route(withTicket()));
    const res = await resolveCallCrmRecord(candidate(), withName);
    expect(res.kind).toBe('TASK');
    expect(res.id).toBe(500);
    expect(res.crm.resolution?.ticketRefs).toEqual(['TICKET 289807']);
    expect(res.crm.refs).toContain('TICKET 289807');
  });

  it('keeps a TASK and a TICKET with the same number apart', async () => {
    executeQueryMock.mockImplementation(route(resolvedAccount({
      tickets: [{
        TicketID: 500, CustomerID: 200, ContactID: 10,
        accountName: 'Lakeland Imaging', assignedToName: null, at: '2026-09-03 08:00:00',
      }],
      ticketNotes: [{
        TicketNoteID: 4002, TicketID: 500, Note: 'Return shipping label issued to the customer.',
        createdOn: '2026-09-03 08:10:00', noteTitle: null, createdByName: 'Support Team',
      }],
    })));
    const res = await resolveCallCrmRecord(candidate(), withName);
    expect(res.kind).toBe('TASK');
    expect(res.crm.refs).toEqual(['TASK 500', 'TICKET 500']);
  });
});

describe('resolveCallCrmRecord — history is bounded at the reviewed day', () => {
  // Unbounded, a re-grade of a day three weeks ago read notes written since and
  // judged the salesperson against outcomes they could not have known.
  const paramsOf = (fragment: string) => executeQueryMock.mock.calls
    .find(([sql]) => String(sql).includes(fragment))?.[1] as unknown[];

  it('bounds the note read at the end of the call day', async () => {
    executeQueryMock.mockImplementation(route(resolvedAccount()));
    await resolveCallCrmRecord(candidate({ startedAt: new Date(2026, 8, 4, 14, 30) }));
    expect(paramsOf('FROM tblAction a')).toEqual([500, '2026-09-04 23:59:59']);
  });

  it('bounds the candidate activity aggregate the same way', async () => {
    // Ranking on all-time latest activity let a record touched after the call
    // outrank the record the call was actually about.
    executeQueryMock.mockImplementation(route(resolvedAccount()));
    await resolveCallCrmRecord(candidate({ startedAt: new Date(2026, 8, 4, 14, 30) }));
    const params = paramsOf('FROM tblTask t');
    expect(params[0]).toBe('2026-09-04 23:59:59');
    expect(params[1]).toBe('2026-09-04 23:59:59');
  });

  it('keeps the rest of the call day, so post-call follow-through still counts', async () => {
    executeQueryMock.mockImplementation(route(resolvedAccount()));
    await resolveCallCrmRecord(candidate({ startedAt: new Date(2026, 8, 4, 9, 5) }));
    expect(paramsOf('FROM tblAction a')?.[1]).toBe('2026-09-04 23:59:59');
  });

  it("uses the call's own local day, not today", async () => {
    executeQueryMock.mockImplementation(route(resolvedAccount()));
    await resolveCallCrmRecord(candidate({ startedAt: new Date(2025, 11, 31, 18, 0) }));
    expect(paramsOf('FROM tblAction a')?.[1]).toBe('2025-12-31 23:59:59');
  });

  it('splits the notes into before-call and same-day follow-through', async () => {
    executeQueryMock.mockImplementation(route(resolvedAccount({
      actions: [
        action({ ActionID: 8100, completedOn: '2026-09-04 09:00:00', createdOn: '2026-09-04 09:00:00', Note: 'Discussed the three zones before the call.' }),
        action({ ActionID: 8200, completedOn: '2026-09-04 16:00:00', createdOn: '2026-09-04 16:00:00', Note: 'Logged the quote and set Monday follow-up.' }),
      ],
    })));
    const res = await resolveCallCrmRecord(candidate({ startedAt: new Date(2026, 8, 4, 14, 30) }), withName);
    expect(res.crm.notes).toContain('BEFORE THIS CALL');
    expect(res.crm.notes).toContain('SAME DAY, AFTER THIS CALL');
    expect(res.crm.notes.indexOf('BEFORE THIS CALL'))
      .toBeLessThan(res.crm.notes.indexOf('SAME DAY, AFTER THIS CALL'));
  });

  it('reports coverage so a gap cannot read as a complete history', async () => {
    executeQueryMock.mockImplementation(route(resolvedAccount()));
    const res = await resolveCallCrmRecord(candidate(), withName);
    expect(res.crm.coverage).toMatchObject({
      recordsRead: ['TASK 500'],
      rowsRetrieved: 1,
      rowsRendered: 1,
      rowsOmitted: 0,
      cutoff: '2026-09-04 23:59:59',
      truncated: false,
    });
  });

  it('marks the record unavailable when its own note read fails', async () => {
    executeQueryMock.mockImplementation((sql: string) => (
      /FROM tblAction a/.test(String(sql)) && !/COUNT/.test(String(sql))
        ? Promise.reject(new Error('crm timeout'))
        : route(resolvedAccount())(String(sql))
    ));
    const res = await resolveCallCrmRecord(candidate(), withName);
    expect(res.crm.unavailable).toBe(true);
    expect(res.crm.coverage?.errors).toContain('TASK 500: history read failed');
  });
});

describe('resolveCallCrmRecord — notes survive retrieval intact', () => {
  it('keeps the substantive remainder of a status-change note', async () => {
    // The old loader dropped the whole row when it opened with an auto-status
    // prefix, so the customer's scope — the only place it was written down —
    // vanished.
    executeQueryMock.mockImplementation(route(resolvedAccount({
      actions: [action({
        Note: 'Task Status Changed from Open to Working - customer wants the other two stores quoted',
      })],
    })));
    const res = await resolveCallCrmRecord(candidate(), withName);
    expect(res.crm.notes).toContain('customer wants the other two stores quoted');
    expect(res.crm.notes).toContain('auto:');
  });

  it('renders a scheduled follow-up that has a due date but no note text', async () => {
    executeQueryMock.mockImplementation(route(resolvedAccount({
      actions: [action({
        ActionID: 8557155, Note: '', dueOn: '2026-09-24 00:00:00',
        completedOn: '0001-01-01 05:00:00', actionResult: null,
      })],
    })));
    const res = await resolveCallCrmRecord(candidate(), withName);
    expect(res.crm.notes).toContain('action 8557155');
    expect(res.crm.notes).toContain('next contact due 2026-09-24');
    expect(res.crm.notes).toContain('SCHEDULED, not completed');
  });

  it('carries the author on every line, so a colleague\'s note is not the reviewed person\'s', async () => {
    executeQueryMock.mockImplementation(route(resolvedAccount({
      actions: [action({ createdByName: 'Adrian Cole', completedByName: 'Adrian Cole' })],
    })));
    const res = await resolveCallCrmRecord(candidate(), withName);
    expect(res.crm.notes).toContain('by Adrian Cole');
  });
});
