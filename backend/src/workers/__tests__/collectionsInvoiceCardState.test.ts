/**
 * Guards on the card-state pipeline, which lives in SQL and so has no other cover.
 *
 * Three things here can break silently and produce a plausible-looking wrong number:
 *
 *   1. THE AS-OF READ. If the expiry is ever taken from tblBillingGroups instead of
 *      tblBillingGroupsArchive, the value becomes "the card today". The invoice
 *      transform is FULL_RELOAD_WINDOW, so every reload would rewrite it and an
 *      invoice would quietly stop looking expired the moment the customer fixed the
 *      card. Measured on 2026-09-01: live says 10 of 25 never-attempted invoices were
 *      expired, as-of says 16.
 *   2. WHICH BILLING GROUP. tblOrders.BillingGroupID is rewritten by CRM to whichever
 *      group eventually PAID, so reading the card off the invoice header describes a
 *      group that often did not exist on the run date. That is what manufactured the
 *      bogus "card replaced" bucket. The card must come from the group the recurring
 *      run was pointed at, and tblRecurringItems is one row per SERVICE ITEM, so it
 *      has to be collapsed before anything joins to it or the whole fact fans out.
 *   3. THE PICK STRING OFFSETS. The winning archive row is chosen with MIN() over a
 *      fixed-width sortable string, because MySQL cannot reopen a TEMPORARY table
 *      twice in one statement. Change a pad width without moving the SUBSTRING and
 *      the expiry silently reads off the wrong characters — still an integer, still
 *      plausible, completely wrong.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const sqlDir = path.resolve(__dirname, '../sql');
/** Line endings are normalised so an assertion spanning two lines is not CRLF-sensitive. */
const read = (f: string) =>
  fs.readFileSync(path.join(sqlDir, f), 'utf8').replace(/\r\n/g, '\n');
const extractSql = read('collections_invoice.extract.sql');
const transformSql = read('collections_invoice.transform.sql');

/** Width of a DATE_FORMAT mask, counting only the emitted digits. */
const MASK_WIDTH = '%Y%m%d%H%i%s'.replace(/%Y/g, 'yyyy').replace(/%[a-zA-Z]/g, 'xx').length;

describe('collections_invoice extract — the card is read as of the invoice date', () => {
  it('resolves expiry through the archive, never the live billing group', () => {
    expect(extractSql).toContain('FROM tblBillingGroupsArchive a');
    expect(extractSql).toContain('AND a.ArchivedOn >= o.OrderDate');
  });

  it('falls back to the live row only when no version was archived after the invoice', () => {
    // No archived row on or after the invoice date means the live row has not changed
    // since, so it IS the as-of state. Any other use of an ExpireYear off a live
    // billing group is the live-read bug this whole mechanism exists to avoid.
    const liveReads = extractSql.match(/\bbgr?\.Expire(Year|Month)/g) ?? [];
    expect(liveReads).toHaveLength(2);
    expect(extractSql).toContain('CASE WHEN ca.pick IS NULL');
  });

  it('reads the card off the group the run charged, never the invoice header', () => {
    // The header is repointed at whichever group later paid: on 2026-09-01 invoice
    // 1939451's header says 114062 (created 09-04) while the run charged 79881, whose
    // card expired 6/2026. Both the archive lookup and the live fallback must resolve
    // through tmpRunGroup, and card_billing_group_id makes the answer auditable.
    expect(extractSql).toContain('FROM tblOrders o\nINNER JOIN tblRecurringItems ri');
    expect(extractSql).toContain('ON a.BillingGroupID = IFNULL(rg.BillingGroupID, o.BillingGroupID)');
    expect(extractSql).toContain('ON bgr.BillingGroupID = IFNULL(rg.BillingGroupID, o.BillingGroupID)');
    expect(extractSql).toContain('IFNULL(rg.BillingGroupID, o.BillingGroupID)  AS card_billing_group_id');
  });

  it('collapses recurring items to one billing group per order before joining', () => {
    // tblRecurringItems is per SERVICE ITEM — invoice 1936470 alone carries several
    // hundred rows. A primary key on OrderID plus MIN() makes the fan-out impossible
    // rather than merely unlikely.
    expect(extractSql).toContain('PRIMARY KEY (OrderID),\n  BillingGroupID INT NOT NULL');
    expect(extractSql).toContain('SELECT ri.newOrderID,\n       MIN(ri.BillingGroupID),');
    expect(extractSql).toContain('GROUP BY ri.newOrderID');
  });

  it('copies the archive into an indexed temp table rather than scanning it per invoice', () => {
    // tblBillingGroupsArchive has no index but its primary key, and 609k rows. A
    // correlated lookup does not finish.
    expect(extractSql).toContain('INDEX ix_bg_archived (BillingGroupID, ArchivedOn)');
  });

  it('keeps the pick offsets in step with the pad widths', () => {
    const padWidth = (fn: string, col: string) => {
      const m = extractSql.match(new RegExp(`${fn}\\(IFNULL\\(a\\.${col},[^)]*\\),\\s*(\\d+),`));
      if (!m) throw new Error(`no ${fn} for ${col} in the pick string`);
      return Number(m[1]);
    };
    const year = padWidth('LPAD', 'ExpireYear');
    const month = padWidth('LPAD', 'ExpireMonth');
    const last4 = padWidth('RPAD', 'Last4');

    // 1..14 ArchivedOn | 15..18 year | 19..20 month | 21..24 last4
    expect(extractSql).toContain(`SUBSTRING(ca.pick, ${MASK_WIDTH + 1}, ${year + month})`);
    expect(extractSql).toContain(`SUBSTRING(ca.pick, ${MASK_WIDTH + year + month + 1}, ${last4})`);
    expect(extractSql).toContain(`pick CHAR(${MASK_WIDTH + year + month + last4})`);
  });

  it('pads Last4 with a character that cannot be mistaken for a card number', () => {
    // Right-padding with '~' keeps a NULL Last4 distinguishable from a real '0000',
    // and the REPLACE that strips it can never eat a digit.
    expect(extractSql).toContain("RPAD(IFNULL(a.Last4, ''), 4, '~')");
    expect(extractSql).toContain("REPLACE(SUBSTRING(ca.pick, 21, 4), '~', '')");
  });

  it('breaks ArchivedOn ties deterministically instead of joining on MIN', () => {
    // 818 (billing group, ArchivedOn) pairs in a 15-month window carry more than one
    // archive row. Joining back on MIN(ArchivedOn) fans out and double-counts those
    // invoices; MIN() over the whole string picks exactly one.
    expect(extractSql).toContain('MIN(CONCAT(');
  });
});

describe('collections_invoice transform — card_state', () => {
  const cardCase = transformSql.slice(
    transformSql.indexOf('WHEN s.card_billing_group_id IS NULL'),
    transformSql.indexOf('END                                                          AS card_state'),
  );

  it('has no replaced state at all', () => {
    // "The billing group is newer than the invoice" was measuring our own bad join,
    // not a customer action. Against the group the run really charged, 3 of the 5
    // invoices that carried it on 2026-09-01 were plain expired cards.
    expect(cardCase).not.toContain('REPLACED');
    expect(transformSql).not.toContain("'REPLACED'");
  });

  it('says UNKNOWN rather than guessing when a LIVE read post-dates the run', () => {
    // A live billing group newer than the invoice cannot be the card the run saw, so
    // neither EXPIRED nor VALID is honest. Checked before the expiry arms so it cannot
    // be overruled by them.
    expect(cardCase).toContain('s.card_group_created_on > s.order_date                THEN');
    expect(cardCase.indexOf("'UNKNOWN'")).toBeLessThan(cardCase.indexOf("'EXPIRED'"));
  });

  it('does not apply that guard when the archive answered', () => {
    // CRM REWRITES CreatedOn when a card is re-keyed in place, so the unguarded test
    // fired on exactly the customers who fixed their card. Group 76262 reads CreatedOn
    // 2026-08-03 — the moment the same card (last4 5032 either side) had its expiry
    // extended — while the archive shows it expired 07/2026, i.e. dead on the 08-01 run
    // that skipped it. Three August invoices were buried in UNKNOWN that way.
    expect(cardCase).toContain('IFNULL(s.card_from_archive, 0) = 0');
    expect(extractSql).toContain("CASE WHEN ca.pick IS NULL THEN 0 ELSE 1 END  AS card_from_archive");
  });

  it('rejects both sentinel expiry ranges instead of gating on payment type', () => {
    // The payment-type gate suppressed real expired cards (invoice 1944508, expiring
    // 202512, came out NULL) while still admitting epoch junk like 197001 as EXPIRED
    // (invoice 1936253). Bounding the year does both jobs: check groups carry 1/1970
    // and ACH groups CRM's 12/2100 default, so both fall out on their own.
    expect(cardCase).toContain('IFNULL(s.card_expire_ym, 0) < 200001');
    expect(cardCase).toContain('s.card_expire_ym >= 210001');
    expect(cardCase).not.toContain('recurring_payment_type');
  });

  it('compares expiry against the invoice own month, not today', () => {
    expect(cardCase).toContain('YEAR(s.order_date) * 100 + MONTH(s.order_date)');
  });

  it('judges the group the run charged, not the invoice header', () => {
    expect(cardCase).toContain('s.card_billing_group_id IS NULL');
    expect(cardCase).not.toContain('s.billing_group_id');
  });
});

describe('collections_invoice extract — did the run get as far as charging?', () => {
  it('counts unconfirmed items rather than taking the earliest stamp', () => {
    // tblRecurringItems is per SERVICE ITEM. MIN(PayAuthFinishedOn) would be non-null
    // the moment ANY item confirmed, so an invoice where three of five came back would
    // read as fully confirmed.
    expect(extractSql).toContain('SUM(ri.PayAuthStartedOn IS NULL)');
    expect(extractSql).toContain('SUM(ri.PayAuthFinishedOn IS NULL)');
    expect(extractSql).toContain('ItemsUnconfirmed INT NOT NULL');
  });

  it('reads the gateway log, not just CRM intent, to say a charge was submitted', () => {
    // An item stamp only proves our own code entered the payment step. The gateway log
    // is where a submitted charge actually lands: a request row with a NULL
    // ProcessorResponseMessage, then the processor's answer. Of the 19 unconfirmed
    // invoices on 2026-08-01, 17 have that request row and 2 have no gateway row at
    // all — so the two sources genuinely disagree and both are needed.
    expect(extractSql).toContain('p.ProcessorResponseMessage IS NULL');
    expect(extractSql).toContain('CREATE TEMPORARY TABLE tmpGatewayReq');
  });

  it('ignores answered rows, which already produce a billing fact row', () => {
    // RESULT_CASE only reaches the request-state arms when no billing row exists, so
    // an answered row here would be dead weight at best and could mask a real answer.
    const insert = extractSql.slice(
      extractSql.indexOf('INSERT INTO tmpGatewayReq'),
      extractSql.indexOf('DROP TEMPORARY TABLE IF EXISTS tmpBgArchive'),
    );
    expect(insert).not.toContain('IS NOT NULL');
    expect(insert).toContain("p.PaymentOrderId REGEXP '^[0-9]+$'");
  });

  it('matches the request to the run day so a later retry cannot be read as the run', () => {
    // An agent retrying on the 3rd and getting no answer is not evidence that the 1st's
    // run submitted anything.
    expect(extractSql).toContain('PRIMARY KEY (OrderID, ReqDate)');
    expect(extractSql).toContain('AND gq.ReqDate = DATE(o.OrderDate)');
  });

  it('tells a submitted-but-unanswered charge apart from one that never went out', () => {
    // 1922467 has a gateway row and is NO_RESPONSE; 1923231 and 1924392 do not and are
    // UNSUBMITTED. Their item stamps are 04:04:10 and 04:04:09 — the two latest in the
    // run — so the run wrote the CRM stamp and died before submitting.
    const stateCase = extractSql.slice(
      extractSql.indexOf('WHEN rg.OrderID IS NULL'),
      extractSql.indexOf('AS pay_request_state'),
    );
    expect(stateCase).toContain("rg.ItemsUnsent = rg.ItemsTotal        THEN 'NOT_SENT'");
    expect(stateCase).toContain("rg.ItemsUnconfirmed = 0               THEN 'CONFIRMED'");
    expect(stateCase).toContain("gq.OrderID IS NOT NULL                THEN 'NO_RESPONSE'");
    expect(stateCase).toContain("ELSE 'UNSUBMITTED'");
  });

  it('keeps every state inside the column width so no value is silently truncated', () => {
    // pay_request_state is VARCHAR(12). NO_RESPONSE and UNSUBMITTED are 11 each; a
    // 13-character value would be cut without error under a non-strict sql_mode and the
    // bucket would quietly stop matching.
    const stateCase = extractSql.slice(
      extractSql.indexOf('WHEN rg.OrderID IS NULL'),
      extractSql.indexOf('AS pay_request_state'),
    );
    const values = [...stateCase.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]);
    expect(values.length).toBeGreaterThan(0);
    for (const v of values) expect(v.length).toBeLessThanOrEqual(12);
  });

  it('leaves the state NULL when the invoice has no recurring items', () => {
    // Order types 1 and 6 have no run at all, and a few recurring invoices carry no
    // item rows either. RESULT_CASE folds NULL in with the never-attempted bucket — in
    // every one of those cases the charge did not reach the gateway.
    expect(extractSql).toContain('WHEN rg.OrderID IS NULL                    THEN NULL');
  });
});
