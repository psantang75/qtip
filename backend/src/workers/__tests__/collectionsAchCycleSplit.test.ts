/**
 * Guards on the ACH 1st/16th split, which lives entirely in SQL and so has no other
 * cover.
 *
 * ACH bills on the 1st and the 16th exactly as credit card does, but it was reported
 * under a single 'ACH' campaign whose cycle was recorded as 'NA' — the only instrument
 * whose two cycles could not be compared with each other, and a silent average of two
 * different books of accounts. Four things here can regress without any error:
 *
 *   1. THE DAY SOURCE PER FACT. invoice.order_date and billing.attempt_date ARE the run
 *      date, so the card rule transfers to them unchanged. A task's created date is NOT:
 *      a declined card raises its task within seconds, but an ACH return posts against
 *      the cycle and the task appears 3-21 days later (median ~6). Reusing DAY(CreatedOn)
 *      for ACH would scramble the very split it is meant to make — a 1st-run task raised
 *      on the 20th reads as the 16th, and a 16th-run task raised on the 3rd of the next
 *      month reads as the 1st. The two passes' task windows genuinely overlap, so no
 *      created-date rule can fix it and the RUN has to be looked up.
 *   2. WHICH BILLING GROUP THE RUN IS KEYED ON. tblOrders.BillingGroupID is rewritten by
 *      CRM to whichever group eventually PAID, so joining the run to the task through the
 *      header loses exactly the declines being attributed. tblRecurringItems.BillingGroupID
 *      is the group the run was configured to charge.
 *   3. ONE DERIVATION, NOT THREE. The touch and subscription facts used to re-derive the
 *      campaign from TaskTypeID with their own copy of the rule. Neither does now: touch
 *      inherits it from ie_fact_collections_task, and subscription — re-anchored when the
 *      report was rebuilt to start from the declined invoices — inherits it, and the task
 *      link, from ie_fact_collections_invoice. Both follow from point 1: the invoice IS
 *      the run, so a fact that can reach an invoice should never consult a created date.
 *   4. REOPENING A TEMP TABLE. MySQL cannot open a TEMPORARY table twice in one
 *      statement, so "the latest run at or before the task" has to be an aggregate rather
 *      than the NOT EXISTS idiom used against permanent tables elsewhere.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const sqlDir = path.resolve(__dirname, '../sql');
/** Line endings are normalised so an assertion spanning two lines is not CRLF-sensitive. */
const read = (f: string) =>
  fs.readFileSync(path.join(sqlDir, f), 'utf8').replace(/\r\n/g, '\n');

const invoiceTransform = read('collections_invoice.transform.sql');
const billingExtract = read('collections_billing.extract.sql');
const taskExtract = read('collections_task.extract.sql');
const touchExtract = read('collections_touch.extract.sql');
const touchTransform = read('collections_touch.transform.sql');
const subExtract = read('collections_subscription.extract.sql');
const subTransform = read('collections_subscription.transform.sql');
const callTransform = read('collections_call.transform.sql');

/** Strip comments the way the worker's splitter does, so prose never satisfies a guard. */
const code = (sql: string) =>
  sql.replace(/\/\*(?!\+)[\s\S]*?\*\//g, ' ').replace(/--[^\n]*$/gm, '');

const ALL_SQL: Array<[string, string]> = [
  ['collections_invoice.transform.sql', invoiceTransform],
  ['collections_billing.extract.sql', billingExtract],
  ['collections_task.extract.sql', taskExtract],
  ['collections_touch.extract.sql', touchExtract],
  ['collections_subscription.extract.sql', subExtract],
];

describe('ACH is split on the run date wherever the run date is known', () => {
  it('splits the invoice fact on the invoice own day, like card', () => {
    // order_date IS the run date by construction, so this is exact.
    expect(invoiceTransform).toContain(
      "WHEN s.recurring_payment_type = 3 AND DAY(s.order_date) < 16  THEN 'ACH_1_15'",
    );
    expect(invoiceTransform).toContain(
      "WHEN s.recurring_payment_type = 3 AND DAY(s.order_date) >= 16 THEN 'ACH_16_31'",
    );
  });

  it('splits the pm_type fallback arms too, not just the run arms', () => {
    // Order types 1 and 6 have no run, so they fall through to pm_type. Leaving those
    // arms unsplit would quietly reintroduce the single bucket for part of the fact.
    expect(invoiceTransform).toContain("AND DAY(s.order_date) < 16                               THEN 'ACH_1_15'");
    expect(invoiceTransform).toContain("AND DAY(s.order_date) >= 16                              THEN 'ACH_16_31'");
  });

  it('splits the gateway attempt log on the attempt day', () => {
    // An ACH return posts against the cycle it belongs to, so attempt_date is the run's
    // day and not the day the answer happened to arrive.
    expect(billingExtract).toContain(
      "WHEN bg.PMType = 3 AND DAY(l.attempt_date) < 16  THEN 'ACH_1_15'",
    );
    expect(billingExtract).toContain(
      "WHEN bg.PMType = 3 AND DAY(l.attempt_date) >= 16 THEN 'ACH_16_31'",
    );
  });

  it('leaves no single-bucket ACH campaign behind in any extract or transform', () => {
    // The whole point of the change. A stray "THEN 'ACH'" in one file would put part of
    // the population back into a campaign no report scopes to, so it would simply vanish.
    for (const [name, sql] of ALL_SQL) {
      expect(code(sql), name).not.toMatch(/THEN\s+'ACH'/);
    }
  });

  it('keeps every campaign key inside the column width', () => {
    // campaign_key is VARCHAR(20) on both staging and the facts. A longer value would be
    // truncated without error under a non-strict sql_mode and would stop matching.
    for (const [name, sql] of ALL_SQL) {
      const keys = [...code(sql).matchAll(/'(CC_\d+_\d+|ACH_\d+_\d+|CHECK|EXP_CC|SALES_AR)'/g)];
      for (const k of keys) expect(k[1].length, `${name}: ${k[1]}`).toBeLessThanOrEqual(20);
    }
  });
});

describe('collections_task extract — an ACH task is attributed to its RUN', () => {
  it('does not split ACH on the task own created date', () => {
    // The card arm may use DAY(CreatedOn) because a declined card raises its task in the
    // same second. The ACH arm must not: the return trails its run by 3-21 days.
    expect(taskExtract).toContain("WHEN 1  THEN IF(DAY(t.CreatedOn) <= 15, 'CC_1_15', 'CC_16_31')");
    expect(taskExtract).not.toContain("WHEN 34 THEN IF(DAY(t.CreatedOn) <= 15,");
  });

  it('takes the day from the run behind the task, falling back to the created date', () => {
    // The fallback is wrong only where the lag crosses a cycle boundary, and it always
    // yields one of the two real campaigns rather than a third "unattributed" bucket.
    expect(taskExtract).toContain(
      "WHEN 34 THEN IF(DAY(IFNULL(atr.RunDate, t.CreatedOn)) <= 15, 'ACH_1_15', 'ACH_16_31')",
    );
    expect(taskExtract).toContain('LEFT JOIN tmpAchTaskRun atr\n  ON atr.TaskID = t.TaskID');
  });

  it('reads the run off the group the run charged, never the invoice header', () => {
    // tblOrders.BillingGroupID is repointed at whichever group later paid, which is the
    // documented reason a header-keyed join loses the decline it is looking for.
    expect(taskExtract).toContain('INNER JOIN tblRecurringItems ri\n  ON ri.newOrderID = o.OrderID');
    expect(taskExtract).toContain('SELECT ri.BillingGroupID, DATE(o.OrderDate)');
    expect(code(taskExtract)).not.toContain('o.BillingGroupID');
  });

  it('restricts the run lookup to the ACH payment type', () => {
    // PaymentType 3 on tblRecurring is the immutable record of an ACH run. Reading
    // bg.PMType instead would be the billing group's method TODAY, which drifts.
    expect(taskExtract).toContain('AND r.PaymentType = 3');
    expect(code(taskExtract)).not.toContain('bg.PMType');
  });

  it('reaches back past the window start so an early task can find its run', () => {
    // A return can trail its run by ~21 days and that run can sit in the prior month, so
    // a run-date window that started at :pFromDate would orphan tasks at the window edge.
    expect(taskExtract).toContain('o.OrderDate >= DATE_SUB(@pFrom, INTERVAL 45 DAY)');
    expect(taskExtract).toContain('ar.RunDate > DATE_SUB(DATE(t.CreatedOn), INTERVAL 30 DAY)');
  });

  it('picks the latest qualifying run with an aggregate, not a second scan of the temp table', () => {
    // MySQL cannot reopen a TEMPORARY table twice in one statement, so the NOT EXISTS
    // "pick the nearest" idiom used against permanent tables would error here.
    expect(taskExtract).toContain('SELECT t.TaskID, MAX(ar.RunDate)');
    expect(taskExtract).toContain('GROUP BY t.TaskID');
    const insert = taskExtract.slice(taskExtract.indexOf('INSERT INTO tmpAchTaskRun'));
    expect(insert).not.toContain('tmpAchRun ar2');
  });

  it('indexes the run lookup rather than scanning CRM per task', () => {
    expect(taskExtract).toContain('PRIMARY KEY (BillingGroupID, RunDate)');
    expect(taskExtract).toContain('PRIMARY KEY (TaskID)');
  });

  it('is a procedure-style extract whose last statement is the result set', () => {
    // The worker loads the final result-set-producing statement into staging, and temp
    // tables are connection-scoped, so the ordering here is load-bearing.
    expect(taskExtract).toContain('SET SESSION max_execution_time');
    expect(taskExtract).toContain('SET @pFrom := :pFromDate');
    const statements = code(taskExtract)
      .split(/;\s*(?:\r?\n|$)/)
      .map((s) => s.trim())
      .filter(Boolean);
    expect(statements.length).toBeGreaterThan(1);
    expect(statements[statements.length - 1]).toMatch(/^SELECT/);
    // Every temp table is dropped before it is created, so a re-run on a pooled
    // connection cannot inherit the previous run's rows.
    for (const t of ['tmpAchRun', 'tmpAchTaskRun']) {
      expect(taskExtract).toContain(`DROP TEMPORARY TABLE IF EXISTS ${t}`);
      expect(taskExtract.indexOf(`DROP TEMPORARY TABLE IF EXISTS ${t}`))
        .toBeLessThan(taskExtract.indexOf(`CREATE TEMPORARY TABLE ${t}(`));
    }
  });

  it('window-bounds the task scan on the session variables it set', () => {
    // Mixing :pFromDate into later statements alongside @pFrom is how the two silently
    // drift apart when one is edited.
    expect(taskExtract).toContain('AND t.CreatedOn >= @pFrom\n  AND t.CreatedOn < @pTo;');
  });
});

describe('no fact re-derives the campaign; each inherits it from the fact that owns it', () => {
  it('has the touch fact inherit the campaign from the task it belongs to', () => {
    expect(touchTransform).toContain('COALESCE(tk.campaign_key, s.campaign_key)');
    expect(touchTransform).toContain('LEFT JOIN ie_fact_collections_task tk\n  ON tk.task_id = s.task_id');
  });

  it('has the subscription fact inherit BOTH the task and the campaign from the invoice', () => {
    // Subscriptions were re-anchored from the task to the invoice when the report was
    // rebuilt to start from "the invoices this run declined on". That is a strengthening
    // of this file's own rule, not an exception to it: point 1 above says a task's
    // created date cannot see which run it belongs to, and the invoice can — it IS the
    // run. So the campaign is taken from the invoice that billed the service, and the
    // task link comes with it rather than being matched a second time here.
    expect(subTransform).toContain('inv.campaign_key');
    expect(subTransform).toContain('inv.task_id');
    expect(subTransform).toContain('JOIN ie_fact_collections_invoice inv\n  ON inv.order_id = s.order_id');
    // The task fact is still joined, but only for the chasing task's final status —
    // never for the campaign, and reached THROUGH the invoice's task_id.
    expect(subTransform).toContain('LEFT JOIN ie_fact_collections_task tk\n  ON tk.task_id = inv.task_id');
    expect(subTransform).not.toContain('COALESCE(tk.campaign_key');
  });

  it('leaves the call fact inheriting from the task, as it already did', () => {
    // The call fact carries campaign_key too and was already on this pattern, which is
    // why it needed no change here. Asserting it stops a future edit from giving the
    // call fact its own copy of the rule — the drift this change removed everywhere else.
    expect(callTransform).toContain('LEFT JOIN ie_fact_collections_task t');
    expect(callTransform).toContain('  t.campaign_key,');
    expect(code(callTransform)).not.toContain('TaskTypeID');
  });

  it('keeps the staging value as a cheap fallback in the touch extract, not a second run lookup', () => {
    // A touch on a task older than the task fact's window has nothing to inherit. The
    // fallback must still name a real campaign, but reproducing the run lookup here
    // would be the duplicated rule this change removed.
    expect(touchExtract).toContain(
      "WHEN 34 THEN IF(DAY(t.CreatedOn) <= 15, 'ACH_1_15', 'ACH_16_31')",
    );
    expect(touchExtract).not.toContain('tmpAchRun');
  });

  it('leaves the subscription extract with no campaign rule of its own at all', () => {
    // The strongest form of "one derivation": the subscription extract does not carry a
    // campaign column, so there is no fallback here to drift. It windows on the invoice's
    // OrderDate and the transform inherits the campaign from that same invoice. A CASE on
    // TaskTypeID reappearing in this file is the regression this asserts against.
    expect(subExtract).not.toContain('TaskTypeID');
    expect(subExtract).not.toContain('tmpAchRun');
    expect(subExtract).not.toContain('ACH_1_15');
  });
});
