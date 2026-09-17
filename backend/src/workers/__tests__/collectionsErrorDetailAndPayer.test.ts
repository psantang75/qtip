/**
 * Guards on two pieces of CRM detail the Collections pipeline used to compute and
 * then throw away. Both live entirely in SQL, so nothing else covers them.
 *
 *   1. THE GATEWAY'S MESSAGE. The billing extract worked out the processor's response
 *      text and kept it only for DECLINED, which left every ERROR row unexplainable —
 *      all 15 on 2026-09-01 rendered as a bare "Submission error" with no way to tell
 *      an over-sized request from a malformed one.
 *   2. THE PAYER'S NAME. The recovery extract resolved tblPaymentsCredits.CreatedBy
 *      only against AR staff and labelled everything else NO_AGENT with a NULL email,
 *      so a customer paying through the portal read as "No agent" even though
 *      CreatedBy names them exactly.
 *
 * The dangerous failure in the second one is a WRONG name rather than a missing one:
 * tblSalesPeople.UserID and tblContacts.ContactID overlap below 201, so both the id
 * split and the customer guard have to stay put.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const sqlDir = path.resolve(__dirname, '../sql');
/** Line endings are normalised so an assertion spanning two lines is not CRLF-sensitive. */
const read = (f: string) =>
  fs.readFileSync(path.join(sqlDir, f), 'utf8').replace(/\r\n/g, '\n');

const billingExtract = read('collections_billing.extract.sql');
const billingTransform = read('collections_billing.transform.sql');
const recoveryExtract = read('collections_recovery.extract.sql');
const recoveryTransform = read('collections_recovery.transform.sql');

describe('collections_billing — the gateway message survives every result', () => {
  it('emits the raw message regardless of outcome', () => {
    expect(billingExtract).toContain('l.first_message                              AS result_message');
  });

  it('still withholds decline_reason outside DECLINED', () => {
    // Narrowing it was the bug, but widening decline_reason instead would have changed
    // the meaning of the existing decline report and its index. The new column carries
    // the wider value; this one keeps its contract.
    expect(billingExtract).toContain(
      "CASE WHEN l.first_result = 'DECLINED' THEN l.first_message END AS decline_reason",
    );
  });

  it('carries the message through to the fact', () => {
    expect(billingTransform).toContain('result_message, transaction_type, settled_amount');
    expect(billingTransform).toContain('s.result_message,');
  });
});

/**
 * The classifier's last arm is `ELSE 'DECLINED'`, which is right for an unrecognised
 * REFUSAL and wrong for an answer that simply is not final yet. Two gateway states mean
 * "accepted, still settling", and being swept into the catch-all put 6,483 rows and
 * $372,614 into September 2026's declines the morning after the 16th run — 90% of the
 * month. It hid in closed months because it resolves within days.
 */
describe('collections_billing — an unsettled answer is not a decline', () => {
  /** The statement with the leading block comment removed, so ordering assertions
   *  measure the SQL rather than the prose that explains it. */
  const billingSql = billingExtract.replace(/^\s*\/\*[\s\S]*?\*\//, '');

  it('classes a captured card and an initiated ACH as in flight', () => {
    expect(billingExtract).toContain(
      "WHEN p.ProcessorResponseMessage IN ('CAPTURED', 'INITIATED')",
    );
    expect(billingExtract).toContain("THEN 'IN_FLIGHT'");
  });

  it('decides in flight BEFORE reaching the decline catch-all', () => {
    // Order is the whole fix: the arm is only reachable above `ELSE 'DECLINED'`.
    // Measured on the statement, not the file — the header comment discusses both.
    const inFlight = billingSql.indexOf("THEN 'IN_FLIGHT'");
    const catchAll = billingSql.indexOf("ELSE 'DECLINED'");
    expect(inFlight).toBeGreaterThan(-1);
    expect(inFlight).toBeLessThan(catchAll);
  });

  it('keeps the catch-all, so an unknown refusal still counts as a decline', () => {
    // The fix is not an allowlist of declines — the gateway has two dozen refusal
    // messages and adds more. Anything unrecognised must still land in the campaign.
    expect(billingExtract).toContain("ELSE 'DECLINED'");
  });

  it('leaves the genuine late failures as declines', () => {
    // RETURNED is an ACH return and FAILED is a failure; both arrive late but ARE the
    // answer, so neither may be named in any arm — they must reach the catch-all.
    expect(billingSql).not.toContain("'RETURNED'");
    expect(billingSql).not.toContain("'FAILED'");
  });

  it("keeps CREATED an error, because it never resolves", () => {
    // Looks transient, does not behave like one: 562 rows spread evenly over 15 months,
    // so it is a request that was never answered rather than one still in flight.
    expect(billingExtract).toMatch(/'Merchant \(Account\) configuration missing', 'CREATED'\)\s*\n\s*THEN 'ERROR'/);
  });

  it('never lets an in-flight row mask a finished answer for the same invoice', () => {
    const joins = fs
      .readFileSync(
        path.resolve(__dirname, '../../services/insights/collections/cycle/joins.ts'),
        'utf8',
      )
      .replace(/\r\n/g, '\n');
    // Ranked below OK, so a same-day row that actually resolved is the one reported.
    expect(joins).toContain("WHEN 'IN_FLIGHT' THEN 5 ELSE 6 END");
  });
});

describe('collections_billing — a void is not a submission error', () => {
  it('gives VOIDED its own result instead of filing it as our defect', () => {
    // 1936494's 09-01 04:25:01 SALE answers VOIDED, is voided at 15:13:35 and settles
    // next morning at 3,182.75 against an original 3,248.60. The gateway accepted it;
    // someone reversed it to re-bill a corrected amount. Nine September invoices worth
    // 12,618.35 were being reported as malformed submissions on that basis.
    expect(billingExtract).toContain("THEN 'VOIDED'");
    expect(billingExtract).not.toMatch(/'Merchant \(Account\) configuration missing', 'CREATED', 'VOIDED'/);
  });

  it('counts an approved VOID transaction as the reversal, not as a charge', () => {
    expect(billingExtract).toContain("UPPER(IFNULL(p.TransactionType, '')) = 'VOID'");
  });

  it('does not promote a reversed sale to a success', () => {
    // No money stuck from that sale, so VOIDED must not fold into OK either.
    const voidArm = billingExtract.indexOf("THEN 'VOIDED'");
    const okArm = billingExtract.indexOf("THEN 'OK'");
    expect(voidArm).toBeGreaterThan(-1);
    expect(voidArm).toBeLessThan(okArm);
  });

  it('keeps the transaction type so the lifecycle can be read later', () => {
    expect(billingExtract).toContain('AS first_txn_type');
    expect(billingExtract).toContain('l.first_txn_type                             AS transaction_type');
  });
});

describe('collections_recovery — the card that actually paid', () => {
  it('keys the card to the payment rather than to the billing group', () => {
    // 1919833 declined on group 68054 last4 1781 and was paid on group 112957 last4
    // 4587; a group-level lookup cannot see that.
    expect(recoveryExtract).toContain('pcard.PaymentCreditID = v.PaymentCreditID');
    expect(recoveryExtract).toContain('pcard.Last4                                  AS payment_last4');
  });

  it('reads only settled or approved gateway rows for the card', () => {
    expect(recoveryExtract).toContain("prl.ProcessorResponseMessage IN ('SETTLED', 'Approved')");
  });

  it('leaves the header billing group alone, since the task link depends on it', () => {
    // An AR task is raised against the group that DECLINED, not the one that paid.
    expect(recoveryExtract).toContain('o.BillingGroupID                             AS billing_group_id');
  });

  it('carries the card through to the fact', () => {
    expect(recoveryTransform).toContain('payment_last4');
    expect(recoveryTransform).toContain('s.payment_last4,');
  });
});

describe('collections_recovery — the payer is named, not just classified', () => {
  it('splits the id space at the top of the staff range', () => {
    // tblSalesPeople.UserID tops out at 201 and tblContacts.ContactID starts at 1, so
    // without the bound a staff id would match a stranger's contact row.
    expect(recoveryExtract).toContain('AND pc.CreatedBy BETWEEN 1 AND 201');
    expect(recoveryExtract).toContain('AND pc.CreatedBy > 201');
  });

  it('only accepts a contact that belongs to the paying account', () => {
    // The guard is what makes the id split safe rather than merely plausible. Across
    // 2026-09-01..05 every above-staff id matched its own customer, so it costs nothing.
    expect(recoveryExtract).toContain('ON ct.ContactID = pc.CreatedBy\n AND ct.CustomerID = o.CustomerID');
  });

  it('labels the automated run and the system account instead of leaving them blank', () => {
    expect(recoveryExtract).toContain("WHEN pc.CreatedBy = 0     THEN 'Automatic recurring run'");
    expect(recoveryExtract).toContain("WHEN pc.CreatedBy = 12    THEN 'Recurring Service (system)'");
  });

  it('leaves processor_kind alone so the funnel and processor rank are unchanged', () => {
    // The name is additive. AGENT/NO_AGENT still drives PROCESSOR_RANK, which the
    // stage-3 split and the agent-vs-self-service comparison are both built on.
    expect(recoveryExtract).toContain(
      "CASE WHEN ag.UserID IS NOT NULL THEN 'AGENT' ELSE 'NO_AGENT' END AS processor_kind",
    );
  });

  it('carries the name through to the fact', () => {
    expect(recoveryTransform).toContain('processor_name, employee_key');
    expect(recoveryTransform).toContain('s.processor_name,');
  });
});
