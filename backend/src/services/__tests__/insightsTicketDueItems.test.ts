/**
 * The Past Due / Due Today drill-in behind a Tickets & Tasks count. A row cell,
 * an agent's total and the Grand Total each open the same list; what changes is
 * how far the scope narrows. The guards (CSR role, department subtree, SELF scope)
 * must hold for every one of them.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { execute, query } = vi.hoisted(() => ({ execute: vi.fn(), query: vi.fn() }));

vi.mock('../../config/database', () => ({
  default: { execute, query },
  getDatabasePool: vi.fn(),
}));

import { getTicketsPastDue } from '../insightsAgentActivity.service';

const sqlOf = () => String(query.mock.calls[0][0]);
const paramsOf = () => query.mock.calls[0][1] as unknown[];

beforeEach(() => {
  vi.clearAllMocks();
  execute.mockResolvedValue([[{ 1: 1 }]]); // factTableExists → true
  query.mockResolvedValue([[]]);
});

describe('getTicketsPastDue scope', () => {
  it('narrows a row cell to the agent and classification', async () => {
    await getTicketsPastDue({ agent: 'Ann', classification: 'Billing', bucket: 'past_due' });
    expect(sqlOf()).toContain('f.agent_name = ?');
    expect(sqlOf()).toContain('f.classification = ?');
    const params = paramsOf();
    expect(params.slice(-3, -1)).toEqual(['Ann', 'Billing']);
  });

  it("lists every classification for an agent's total", async () => {
    await getTicketsPastDue({ agent: 'Ann', bucket: 'due_today' });
    expect(sqlOf()).toContain('f.agent_name = ?');
    expect(sqlOf()).not.toContain('f.classification = ?');
    expect(sqlOf()).toContain('DATE(f.next_contact) = ?');
  });

  it('applies the page filters, and no agent, for the Grand Total', async () => {
    await getTicketsPastDue({ users: ['Ann', 'Bo'], departments: ['Sales East'], bucket: 'past_due' });
    const sql = sqlOf();
    expect(sql).not.toContain('f.agent_name = ?');
    expect(sql).toContain('dpt.department_name IN (?)');
    expect(sql).toContain('f.agent_name IN (?,?)');
    expect(paramsOf()).toEqual(expect.arrayContaining(['Sales East', 'Ann', 'Bo']));
  });

  it('keeps SELF scope on a Grand Total', async () => {
    await getTicketsPastDue({ selfEmployeeKey: 42, bucket: 'past_due' });
    expect(sqlOf()).toContain('e.employee_key = ?');
    expect(paramsOf()).toContain(42);
  });

  it('binds the business-day date last, after every scope param', async () => {
    await getTicketsPastDue({ agent: 'Ann', users: ['Ann'], bucket: 'past_due' });
    const params = paramsOf();
    expect(String(params[params.length - 1])).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('carries the assigned agent on each item', async () => {
    query.mockResolvedValueOnce([[{
      agent_name: 'Ann', process_type: 'Task', task_id: 7, ticket_id: null, customer_name: 'Acme',
      classification: 'Follow Up', sub_classification: 'Task', status: 'Open', crm_url: null,
      next_contact: '2026-10-01',
    }]]);
    const [item] = await getTicketsPastDue({ bucket: 'past_due' });
    expect(item).toMatchObject({ agent: 'Ann', referenceId: 7, taskType: 'Follow Up', classification: null });
  });
});
