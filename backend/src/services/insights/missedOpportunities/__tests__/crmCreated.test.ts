/**
 * Created-leads tests.
 *
 * This module exists to answer one question the rest of the CRM layer cannot:
 * "the customer mentioned three stores — did the rep actually open a lead for
 * the other two?" So the assertions that matter are about the DEFINITION and the
 * two empty cases:
 *
 *   1. THE LEAD DEFINITION must stay identical to workers/sql/lead.extract.sql
 *      (a tblCustomerLead with its TaskTypeID = 11 lead-task, owned through
 *      AssignedTo). If it drifts, this report and the Leads dashboard will
 *      disagree about whether a lead exists.
 *   2. CREATED-NONE vs COULD-NOT-LOOK both render as '', on purpose. The prompt
 *      contract forbids asserting an omission the CRM cannot confirm, so a CRM
 *      outage must degrade toward "cannot confirm", never toward an accusation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { executeQueryMock } = vi.hoisted(() => ({ executeQueryMock: vi.fn() }));

vi.mock('../../../../utils/databaseUtils', () => ({
  executeQuery: (...args: unknown[]) => executeQueryMock(...args),
}));

import { loadCreatedLeadsByAgent, loadCreatedLeadsForDay } from '../crmCreated';
import type { CallCandidate } from '../types';

const RUN_DATE = '2026-09-09';
const AGENT = 'Jane Rep';

const leadRow = (over: Record<string, unknown> = {}) => ({
  LeadID: 4455,
  TaskID: 1116999,
  CreatedOn: '2026-09-09 16:58:00',
  AccountName: 'Mercado California Oakland',
  LeadSource: 'Inbound Call',
  ...over,
});

const candidate = (agentName: string): CallCandidate => ({
  conversationId: `conv-${agentName}`,
  agentName,
  agentEmail: null,
  phoneUserId: null,
  startedAt: new Date('2026-09-09T14:30:00Z'),
  dateKey: 20260909,
  direction: 'inbound',
  talkSecs: 300,
  remoteParty: null,
  wrapUpCode: null,
});

beforeEach(() => vi.clearAllMocks());

describe('loadCreatedLeadsForDay', () => {
  it('reads the CRM pool, bound to the day and the agent', async () => {
    executeQueryMock.mockResolvedValue([]);
    await loadCreatedLeadsForDay(AGENT, RUN_DATE);
    expect(executeQueryMock).toHaveBeenCalledTimes(1);
    expect(executeQueryMock.mock.calls[0][1]).toEqual([RUN_DATE, AGENT]);
    expect(executeQueryMock.mock.calls[0][2]).toBe('crm');
  });

  it('defines a new lead exactly as the warehouse lead extract does', async () => {
    executeQueryMock.mockResolvedValue([]);
    await loadCreatedLeadsForDay(AGENT, RUN_DATE);
    const sql = String(executeQueryMock.mock.calls[0][0]);
    expect(sql).toContain('tblCustomerLead');
    expect(sql).toContain('t.TaskTypeID = 11');
    expect(sql).toContain('u.id = t.AssignedTo');
    expect(sql).toContain('DATE(cl.CreatedOn) = ?');
  });

  it('renders the lead id, its task, and the account so the model can match a site', async () => {
    executeQueryMock.mockResolvedValue([leadRow()]);
    const block = await loadCreatedLeadsForDay(AGENT, RUN_DATE);
    expect(block).toContain('LEAD 4455');
    expect(block).toContain('TASK 1116999');
    expect(block).toContain('Mercado California Oakland / Inbound Call');
  });

  it('renders a lead with no usable task id rather than dropping it', async () => {
    executeQueryMock.mockResolvedValue([leadRow({ TaskID: null })]);
    const block = await loadCreatedLeadsForDay(AGENT, RUN_DATE);
    expect(block).toContain('LEAD 4455');
    expect(block).not.toContain('TASK');
  });

  it('skips a row with no usable lead id, which would render as a phantom record', async () => {
    executeQueryMock.mockResolvedValue([leadRow({ LeadID: null })]);
    expect(await loadCreatedLeadsForDay(AGENT, RUN_DATE)).toBe('');
  });

  it('labels an unnamed lead instead of rendering a bare bracket', async () => {
    executeQueryMock.mockResolvedValue([leadRow({ AccountName: null, LeadSource: null })]);
    expect(await loadCreatedLeadsForDay(AGENT, RUN_DATE)).toContain('unnamed lead');
  });

  it('stops at the character cap so one prospecting day cannot crowd the prompt', async () => {
    const long = 'x'.repeat(800);
    executeQueryMock.mockResolvedValue([
      leadRow({ LeadID: 1, AccountName: long }),
      leadRow({ LeadID: 2, AccountName: long }),
      leadRow({ LeadID: 3, AccountName: long }),
    ]);
    const block = await loadCreatedLeadsForDay(AGENT, RUN_DATE);
    expect(block).toContain('LEAD 1');
    expect(block).not.toContain('LEAD 3');
  });

  it('returns empty for a rep who created nothing — the answer the rule needs', async () => {
    executeQueryMock.mockResolvedValue([]);
    expect(await loadCreatedLeadsForDay(AGENT, RUN_DATE)).toBe('');
  });

  // Not '': that is the answer for a rep who created nothing, and returning it
  // for an outage made the prompt assert a negative nobody could check.
  it('returns null when the CRM is unreachable, distinct from "created none"', async () => {
    executeQueryMock.mockRejectedValue(new Error('ECONNREFUSED'));
    expect(await loadCreatedLeadsForDay(AGENT, RUN_DATE)).toBeNull();
  });

  it('does not query at all for an unnamed agent', async () => {
    expect(await loadCreatedLeadsForDay('', RUN_DATE)).toBe('');
    expect(executeQueryMock).not.toHaveBeenCalled();
  });
});

describe('loadCreatedLeadsByAgent', () => {
  it('reads once per distinct agent, not once per call', async () => {
    executeQueryMock.mockResolvedValue([leadRow()]);
    const map = await loadCreatedLeadsByAgent(
      [candidate('Jane Rep'), candidate('Jane Rep'), candidate('Sam Rep')],
      RUN_DATE,
    );
    expect(executeQueryMock).toHaveBeenCalledTimes(2);
    expect(map.get('Jane Rep')).toContain('LEAD 4455');
    expect(map.get('Sam Rep')).toContain('LEAD 4455');
  });
});
