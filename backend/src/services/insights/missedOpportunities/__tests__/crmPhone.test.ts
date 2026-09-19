/**
 * Which number on a conversation is the CUSTOMER — with transfers.
 *
 * DEFECT 2 REGRESSION. The near-end exclusion is a heuristic about our own
 * numbers, and a transfer breaks it: a handed-off leg is recorded inbound with
 * the customer's own number as its DNIS, so the customer number lands in the
 * near-end set with the direction flipped. On Fair Oaks and Irish Isle both the
 * real number and ours were then excluded and the resolver returned no customer
 * at all. The two conversation shapes below are those patterns, sanitized; a
 * positive `customer`/`external` participant sighting must survive the transfer
 * artifact.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { executeQueryMock } = vi.hoisted(() => ({ executeQueryMock: vi.fn() }));
vi.mock('../../../../utils/databaseUtils', () => ({
  executeQuery: (...a: unknown[]) => executeQueryMock(...a),
}));
vi.mock('../../../../config/logger', () => ({
  default: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import { resolveExternalNumbers } from '../crmPhone';

const OUR_DID = '8005551000';
const CUSTOMER = '5865559999';

beforeEach(() => vi.clearAllMocks());

describe('resolveExternalNumbers — a transfer must not erase the customer', () => {
  // Fair Oaks: we called the customer (outbound customer leg), the call was then
  // handed to another queue/agent recorded inbound with the SAME ANI/DNIS pair,
  // so the customer's number appears as that leg's near-end DNIS.
  const fairOaks = [
    { ParticipantID: 'p-cust', purpose: 'customer', Direction: 'outbound', ANI: OUR_DID, Dnis: CUSTOMER, Remote: CUSTOMER },
    { ParticipantID: 'p-agent', purpose: 'agent', Direction: 'outbound', ANI: OUR_DID, Dnis: CUSTOMER, Remote: CUSTOMER },
    { ParticipantID: 'p-queue', purpose: 'acd', Direction: 'inbound', ANI: OUR_DID, Dnis: CUSTOMER, Remote: CUSTOMER },
  ];

  it('keeps the customer number the participant leg identified, despite the transfer near-end', async () => {
    executeQueryMock.mockResolvedValue(fairOaks);
    const res = await resolveExternalNumbers('conv-fair-oaks');
    expect(res.unavailable).toBe(false);
    expect(res.ambiguous).toBe(false);
    expect(res.numbers.map((n) => n.digits)).toEqual([CUSTOMER]);
    expect(res.numbers[0].source).toBe('customer-participant');
  });

  it('does not report the reconciled customer number as excluded', async () => {
    executeQueryMock.mockResolvedValue(fairOaks);
    const res = await resolveExternalNumbers('conv-fair-oaks');
    expect(res.excluded).not.toContain(CUSTOMER);
    expect(res.excluded).toContain(OUR_DID);
  });

  it('records the near-end reconciliation in provenance', async () => {
    executeQueryMock.mockResolvedValue(fairOaks);
    const res = await resolveExternalNumbers('conv-fair-oaks');
    expect(res.numbers[0].provenance.some((p) => p.includes('near-end reconciled'))).toBe(true);
  });

  // Irish Isle: inbound customer leg, transfer leg recorded outbound with the
  // customer's number as the near-end ANI. The mirror image of Fair Oaks.
  const irishIsle = [
    { ParticipantID: 'p-cust', purpose: 'customer', Direction: 'inbound', ANI: CUSTOMER, Dnis: OUR_DID, Remote: CUSTOMER },
    { ParticipantID: 'p-agent', purpose: 'agent', Direction: 'outbound', ANI: CUSTOMER, Dnis: OUR_DID, Remote: CUSTOMER },
  ];

  it('survives the mirrored outbound-transfer near-end artifact too', async () => {
    executeQueryMock.mockResolvedValue(irishIsle);
    const res = await resolveExternalNumbers('conv-irish-isle');
    expect(res.numbers.map((n) => n.digits)).toEqual([CUSTOMER]);
    expect(res.numbers[0].source).toBe('customer-participant');
  });
});

describe('resolveExternalNumbers — the exclusion still removes our own numbers', () => {
  it('still withholds a queue/agent number no participant leg vouched for', async () => {
    // A pure inbound call: customer is the ANI, our DID the DNIS, plus an agent
    // leg on our own second line. Only the customer should come back.
    executeQueryMock.mockResolvedValue([
      { ParticipantID: 'p-cust', purpose: 'customer', Direction: 'inbound', ANI: CUSTOMER, Dnis: OUR_DID, Remote: CUSTOMER },
      { ParticipantID: 'p-agent', purpose: 'agent', Direction: 'inbound', ANI: CUSTOMER, Dnis: '4045552000', Remote: CUSTOMER },
    ]);
    const res = await resolveExternalNumbers('conv-simple');
    expect(res.numbers.map((n) => n.digits)).toEqual([CUSTOMER]);
    expect(res.excluded).toEqual(expect.arrayContaining([OUR_DID, '4045552000']));
  });

  it('reports a phone-DB failure as unavailable, not as no customer', async () => {
    executeQueryMock.mockRejectedValue(new Error('phone db down'));
    const res = await resolveExternalNumbers('conv-down');
    expect(res.unavailable).toBe(true);
    expect(res.numbers).toEqual([]);
  });
});
