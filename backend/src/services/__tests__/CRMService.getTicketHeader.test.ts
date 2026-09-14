/**
 * Ticket header isolation: the audit-form lookup must survive tickets
 * that blow up the AI-only site/device GROUP_CONCAT rollups, and must
 * not crash on CRM sentinel dates (`0000-00-00`).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { executeQueryMock } = vi.hoisted(() => ({ executeQueryMock: vi.fn() }));

vi.mock('../../utils/databaseUtils', () => ({
  executeQuery: (...args: unknown[]) => executeQueryMock(...args),
}));

import crmService from '../CRMService';
import { mapTicketCore, toCrmDate } from '../crmTicketHeader';

function coreRow(over: Record<string, unknown> = {}) {
  return {
    TicketID: 289255,
    ClassificationID: 10,
    ClassificationName: 'Audio',
    ParentName: 'Tech Support',
    Status: 'Open',
    Resolution: null,
    AssignedToUserID: 12,
    AssignedToName: 'System',
    CustomerID: 99,
    CreatedOn: '2020-01-15 10:00:00',
    ModifiedOn: '2020-01-16 10:00:00',
    Description: 'Speaker crackle',
    SiteID: 0,
    ContactID: 0,
    ContactFirstName: null,
    ContactLastName: null,
    ContactEmail: null,
    JobID: 0,
    JobPartnerNumber: null,
    OrderID: 0,
    OrderNumber: null,
    PONumber: null,
    DeviceTypeID: 0,
    DeviceTypeName: null,
    RadioIDNum: '',
    ...over,
  };
}

beforeEach(() => vi.clearAllMocks());

describe('toCrmDate', () => {
  it('returns null for CRM zero / year-1 sentinels instead of throwing', () => {
    expect(toCrmDate('0000-00-00 00:00:00')).toBeNull();
    expect(toCrmDate('0001-01-01 05:00:00')).toBeNull();
    expect(toCrmDate(new Date(NaN))).toBeNull();
  });

  it('keeps a real timestamp', () => {
    const d = toCrmDate('2020-01-15 10:00:00');
    expect(d).toBeInstanceOf(Date);
    expect(d!.getFullYear()).toBe(2020);
  });
});

describe('CRMService.getTicketHeader — isolated core', () => {
  it('uses CAST dates and no GROUP_CONCAT on the audit-form path', async () => {
    executeQueryMock
      .mockResolvedValueOnce([coreRow()])
      .mockResolvedValueOnce([]);

    await crmService.getTicketHeader(289255);

    const [sql] = executeQueryMock.mock.calls[0];
    const text = String(sql);
    expect(text).toContain('CAST(t.CreatedOn AS CHAR)');
    expect(text).toContain('CAST(t.ModifiedOn AS CHAR)');
    expect(text).not.toContain('GROUP_CONCAT');
    expect(text).toContain('FROM tblTicket t');
    expect(executeQueryMock.mock.calls.every(([s]) => !String(s).includes('GROUP_CONCAT'))).toBe(true);
  });

  it('returns the core header when the ticket exists', async () => {
    executeQueryMock
      .mockResolvedValueOnce([coreRow()])
      .mockResolvedValueOnce([]);

    const header = await crmService.getTicketHeader(289255);
    expect(header).not.toBeNull();
    expect(header!.ticket_id).toBe(289255);
    expect(header!.class_name).toBe('Tech Support');
    expect(header!.subclass_name).toBe('Audio');
    expect(header!.status).toBe('Open');
    expect(header!.sites_all).toBeNull();
    expect(header!.devices_all_with_site).toBeNull();
  });

  it('returns null when the ticket is missing (not a reach error)', async () => {
    executeQueryMock.mockResolvedValueOnce([]);
    expect(await crmService.getTicketHeader(289255)).toBeNull();
  });

  it('still returns the core header when site lookup throws', async () => {
    executeQueryMock
      .mockResolvedValueOnce([coreRow()])
      .mockRejectedValueOnce(new Error('Subquery returns more than 1 row'));

    const header = await crmService.getTicketHeader(289255);
    expect(header!.ticket_id).toBe(289255);
    expect(header!.status).toBe('Open');
  });

  it('still returns the core header when AI rollups throw', async () => {
    executeQueryMock
      .mockResolvedValueOnce([coreRow({ SiteID: 5 })])
      .mockResolvedValueOnce([{
        SiteID: 5, Name: 'Main', ShipAddress1: '1 Main', ShipAddress2: null,
        ShipCity: 'Cleveland', ShipState: 'OH',
      }])
      .mockRejectedValueOnce(new Error('Got a packet bigger than max_allowed_packet'));

    const header = await crmService.getTicketHeader(289255, { includeRollups: true });
    expect(header!.ticket_id).toBe(289255);
    expect(header!.site_name).toBe('Main');
    expect(header!.sites_all).toBeNull();
  });

  it('maps sentinel CreatedOn to null so mysql2 zero dates cannot take the header down', () => {
    const header = mapTicketCore(coreRow({
      CreatedOn: '0000-00-00 00:00:00',
      ModifiedOn: '0001-01-01 05:00:00',
    }));
    expect(header.created_on).toBeNull();
    expect(header.modified_on).toBeNull();
    expect(header.ticket_id).toBe(289255);
  });
});
