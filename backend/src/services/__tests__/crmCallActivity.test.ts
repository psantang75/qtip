/**
 * `getCallActivity` — phone calls (with wrap-up) linked to a CRM ticket/task.
 *
 * Fixture mirrors the real CallActivityID 2634 on Task 375130: an outbound
 * Contact Manager call by Jamie Waldie (UserID 81) to Brent Heid, 463s,
 * disposition "Spoke With Intended Contact", wrap-up saved 5:11:49 PM.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { executeQueryMock } = vi.hoisted(() => ({ executeQueryMock: vi.fn() }));

vi.mock('../../utils/databaseUtils', () => ({
  executeQuery: (...args: unknown[]) => executeQueryMock(...args),
}));

import { getCallActivity } from '../crmCallActivity';

const row = (over: Record<string, unknown> = {}) => ({
  CallActivityID: 2634,
  ConversationID: 'conv-2634',
  OccurredOn: '2026-11-18 17:11:49',
  Direction: 'Outbound',
  FromNumber: null,
  ToNumber: '+17017723971',
  ContactName: 'Brent Heid',
  DurationSec: 463,
  Disposition: 'Spoke With Intended Contact',
  AgentUserID: 81,
  AgentName: 'Jamie Waldie',
  Notes: 'During the CM call Brent mentioned a new location.',
  ...over,
});

beforeEach(() => vi.clearAllMocks());

describe('getCallActivity', () => {
  it('selects calls through tblCallActivityLink by item type + id on the crm pool', async () => {
    executeQueryMock.mockResolvedValue([]);
    await getCallActivity('TASK', 375130);

    const [sql, params, poolName] = executeQueryMock.mock.calls[0];
    const text = String(sql);
    expect(text).toContain('FROM tblCallActivity a');
    expect(text).toContain('tblCallActivityLink l WHERE l.ItemType = ? AND l.ItemID = ?');
    expect(text).toContain('tblCallDispositions');
    expect(text).toMatch(/ORDER BY OccurredOn DESC/);
    expect(params).toEqual(['task', 375130]);
    expect(poolName).toBe('crm');
  });

  it('uses the ticket item type for tickets', async () => {
    executeQueryMock.mockResolvedValue([]);
    await getCallActivity('TICKET', 294113);
    expect(executeQueryMock.mock.calls[0][1]).toEqual(['ticket', 294113]);
  });

  it('maps the CRM row to the display shape', async () => {
    executeQueryMock.mockResolvedValue([row()]);
    const [call] = await getCallActivity('TASK', 375130);

    expect(call).toEqual({
      id: 2634,
      conversation_id: 'conv-2634',
      occurred_on: new Date('2026-11-18 17:11:49').toISOString(),
      direction: 'Outbound',
      phone_number: '+17017723971',
      contact_name: 'Brent Heid',
      duration_sec: 463,
      disposition: 'Spoke With Intended Contact',
      agent_id: 81,
      agent_name: 'Jamie Waldie',
      wrap_up: 'During the CM call Brent mentioned a new location.',
      is_after_audit: false,
    });
  });

  it('takes the caller number (FromNumber) on inbound calls', async () => {
    executeQueryMock.mockResolvedValue([
      row({ Direction: 'Inbound', FromNumber: '+15551234567', ToNumber: '+18005550000' }),
    ]);
    const [call] = await getCallActivity('TICKET', 1);
    expect(call.phone_number).toBe('+15551234567');
  });

  it('keeps a call with no wrap-up, disposition or duration', async () => {
    executeQueryMock.mockResolvedValue([
      row({ Notes: null, Disposition: null, DurationSec: null, ContactName: '  ' }),
    ]);
    const [call] = await getCallActivity('TASK', 375130);
    expect(call.wrap_up).toBe('');
    expect(call.disposition).toBeNull();
    expect(call.duration_sec).toBeNull();
    expect(call.contact_name).toBeNull();
  });

  it('splits before/after the audit on the wrap-up time', async () => {
    executeQueryMock.mockResolvedValue([row()]);
    const [before] = await getCallActivity('TASK', 375130, new Date('2026-11-19 09:00:00'));
    expect(before.is_after_audit).toBe(false);

    executeQueryMock.mockResolvedValue([row()]);
    const [after] = await getCallActivity('TASK', 375130, new Date('2026-11-18 12:00:00'));
    expect(after.is_after_audit).toBe(true);
  });

  it('rethrows a friendly error when the CRM query fails', async () => {
    executeQueryMock.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(getCallActivity('TASK', 375130)).rejects.toThrow('Failed to retrieve call activity for task 375130');
  });
});
