import { beforeEach, describe, expect, it, vi } from 'vitest';

const { crmQuery, crmEnd, openCrmConnection, phoneQuery } = vi.hoisted(() => {
  const crmQuery = vi.fn();
  const crmEnd = vi.fn().mockResolvedValue(undefined);
  return {
    crmQuery, crmEnd, phoneQuery: vi.fn(),
    openCrmConnection: vi.fn(async () => ({ query: crmQuery, end: crmEnd })),
  };
});

vi.mock('../../config/database', () => ({ default: { query: vi.fn() }, getDatabasePool: () => ({ query: phoneQuery }) }));
vi.mock('../../config/environment', () => ({ phoneDatabaseConfig: { host: 'phone' }, crmDatabaseConfig: null }));
vi.mock('../insights/crmAgentConnection', () => ({ openCrmConnection }));

import { buildLeadEvents, loadSalesDay } from '../insightsProductivitySales.service';
import { buildTicketEvents } from '../insightsProductivityDay.service';
import {
  classifyProposal, hmMinus, isProposalTransition, salesTouchKind, type QuotePartFlags,
} from '../insights/salesWorkClassify';
import type { TouchDetailResult, TouchDetailRow } from '../insightsTouchDetail.service';

const row = (over: Partial<TouchDetailRow>): TouchDetailRow => ({
  itemType: 'task', itemId: 1, taskTypeId: 11, subject: 'Lead Manager', segment: 'other',
  actor: 'Agent', crmUserId: 7, note: 'called', occurredAt: '2026-09-24 09:00:00',
  crmUrl: 'https://crm/task/1', isSystem: false, ...over,
});

const touch = (rows: TouchDetailRow[], crmUserIds = [7]): TouchDetailResult => ({
  date: '2026-09-24', area: 'sales', employeeKey: 1, email: 'a@x.com', crmUserIds, rows,
  rawEventCount: rows.length, distinctItemCount: rows.length, storedTouched: null, reason: 'ok',
});

const flags = (over: Partial<QuotePartFlags> = {}): QuotePartFlags => ({
  hasSub: false, hasPlayer: false, hasHardware: false, hasInstall: false, ...over,
});

describe('classifyProposal', () => {
  it('is Sub Only when the quote carries subscriptions and nothing shippable', () => {
    expect(classifyProposal([flags({ hasSub: true })])).toBe('sub_only');
  });
  it('is Sub + Player when a shippable player is on the quote', () => {
    expect(classifyProposal([flags({ hasSub: true, hasPlayer: true })])).toBe('sub_player');
  });
  it('is Audio System when any other hardware or pro install is present', () => {
    expect(classifyProposal([flags({ hasSub: true, hasPlayer: true, hasHardware: true })])).toBe('audio_system');
    expect(classifyProposal([flags({ hasSub: true }), flags({ hasInstall: true })])).toBe('audio_system');
  });
  it('is Unclassified with no recognisable parts', () => {
    expect(classifyProposal([])).toBe('unclassified');
    expect(classifyProposal([flags()])).toBe('unclassified');
  });
});

describe('isProposalTransition / salesTouchKind', () => {
  it('matches the CRM status stamp into Proposal Issued on a lead task', () => {
    expect(isProposalTransition(row({ note: 'Task Status Changed from [Verbal Contact] to [Proposal Issued] by [Jo]\r\nsent' }))).toBe(true);
  });
  it('ignores other transitions, plain notes and non-lead tasks', () => {
    expect(isProposalTransition(row({ note: 'Task Status Changed from [Proposal Issued] to [Commitment to Buy] by [Jo]' }))).toBe(false);
    expect(isProposalTransition(row({ note: 'proposal issued, emailed pdf' }))).toBe(false);
    expect(isProposalTransition(row({ taskTypeId: 10, note: 'Task Status Changed from [A] to [Proposal Issued]' }))).toBe(false);
  });
  it('buckets Lead Manager (11/55) and Contact Manager (10); everything else stays a ticket', () => {
    expect(salesTouchKind(row({ taskTypeId: 55 }))).toBe('lead');
    expect(salesTouchKind(row({ taskTypeId: 10 }))).toBe('contact_manager');
    expect(salesTouchKind(row({ taskTypeId: 25 }))).toBeNull();
    expect(salesTouchKind(row({ itemType: 'ticket', taskTypeId: null }))).toBeNull();
  });
});

describe('hmMinus', () => {
  it('stretches back by the minutes spent and clamps at midnight', () => {
    expect(hmMinus('11:13', 20)).toBe('10:53');
    expect(hmMinus('00:10', 30)).toBe('00:00');
  });
});

describe('buildLeadEvents', () => {
  it('counts each lead / contact manager task once, at its first touch, skipping machine notes', () => {
    const events = buildLeadEvents([
      row({ itemId: 1, occurredAt: '2026-09-24 09:00:00' }),
      row({ itemId: 1, occurredAt: '2026-09-24 09:30:00' }),
      row({ itemId: 2, taskTypeId: 10, occurredAt: '2026-09-24 09:00:40' }),
      row({ itemId: 3, isSystem: true }),
      row({ itemId: 4, taskTypeId: 25 }),
    ]);
    expect(events).toEqual([{ time: '09:00', leads: 1, contactManager: 1, ids: expect.any(Array) }]);
    expect(events[0].ids.map((i) => i.itemId)).toEqual([1, 2]);
  });
});

describe('buildTicketEvents', () => {
  const rows = [row({ itemId: 1, taskTypeId: 11 }), row({ itemId: 2, taskTypeId: 10 }), row({ itemId: 3, taskTypeId: 25 })];
  it('leaves CSR tickets untouched', () => {
    expect(buildTicketEvents('csr', rows)[0].updated).toBe(3);
  });
  it('drops Lead / Contact Manager work from the Sales tickets row', () => {
    const ev = buildTicketEvents('sales', rows);
    expect(ev[0].updated).toBe(1);
    expect(ev[0].ids[0].itemId).toBe(3);
  });
});

describe('loadSalesDay', () => {
  beforeEach(() => { crmQuery.mockReset(); phoneQuery.mockReset(); crmEnd.mockClear(); openCrmConnection.mockClear(); });

  it('types proposals from the base package, draws floor plans back from upload and keeps held demos', async () => {
    phoneQuery.mockResolvedValue([[{ t: '10:00', subject: 'Quote' }, { t: '10:00', subject: 'Follow up' }]]);
    crmQuery
      .mockResolvedValueOnce([[{ taskId: 1, agreementId: 50 }, { taskId: 1, agreementId: 40 }]])
      .mockResolvedValueOnce([[
        { agreementId: 50, base: 1, hasSub: 1, hasPlayer: 1, hasHardware: 0, hasInstall: 0 },
        { agreementId: 50, base: 0, hasSub: 1, hasPlayer: 1, hasHardware: 1, hasInstall: 0 },
      ]])
      .mockResolvedValueOnce([[{ taskId: 9, minutes: 20, createdOn: '2026-09-24 11:13:21', players: 1, amplifiers: 1, speakers: 8, volumeControls: 0, taskTypeId: 11, newScreen: 'LeadManager' }]])
      .mockResolvedValueOnce([[{ taskId: 9, s: '13:00', e: '13:30', note: 'Great demo', taskTypeId: 11, newScreen: 'LeadManager' }]]);

    const day = await loadSalesDay(
      touch([row({ note: 'Task Status Changed from [Lead Received] to [Proposal Issued] by [Jo]', isSystem: true })]),
      'a@x.com', '2026-09-24', '2026-09-24 00:00:00', '2026-09-24 23:59:59',
    );

    expect(day.proposals).toEqual([{ time: '09:00', taskId: 1, url: 'https://crm/task/1', type: 'sub_player' }]);
    expect(day.floorPlans[0]).toMatchObject({ start: '10:53', end: '11:13', minutes: 20, speakers: 8 });
    expect(day.demos[0]).toMatchObject({ start: '13:00', end: '13:30', note: 'Great demo' });
    expect(day.emails).toEqual([{ time: '10:00', count: 2, subjects: ['Quote', 'Follow up'] }]);
    expect(day.leads).toEqual([]);
    expect(crmEnd).toHaveBeenCalledOnce();
  });

  it('skips the CRM entirely when the agent has no CRM user', async () => {
    phoneQuery.mockResolvedValue([[]]);
    const day = await loadSalesDay(touch([], []), 'a@x.com', '2026-09-24', 'a', 'b');
    expect(day).toEqual({ leads: [], proposals: [], floorPlans: [], demos: [], emails: [] });
    expect(openCrmConnection).not.toHaveBeenCalled();
  });
});
