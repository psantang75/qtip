-- Collections Invoice extract (source pool: crm). Grain: one collectible AR
-- invoice (tblOrders, OrderTypeID IN (3 Recurring, 1 Order, 6 Reactivation)),
-- window-bound by :pFromDate / :pToDate on OrderDate.
-- invoice_amount = Σ order parts (Quantity*UnitCost + PartTax).
--
-- This is a PROCEDURE-STYLE extract: it builds connection-scoped TEMPORARY
-- tables and ends in a single SELECT. The SourceReportSyncWorker runs every
-- statement on one dedicated connection and loads the final result set into
-- staging. Comments are line-comments only and the per-statement timeout is
-- lifted with SET SESSION, matching order_margin.extract.sql — the worker's
-- splitter strips block comments before mysql2 sees them.
--
-- SCOPE IS THE WHOLE BILLING RUN, not just billing groups with an AR task.
-- Channel Effectiveness starts from "everything we billed" and works down to
-- "what fell into a campaign", so the invoices that processed cleanly have to be
-- in the fact too — they are the denominator. July 2026: 15,625 recurring
-- invoices / $1.68M billed, of which ~1,028 sat on a billing group with a
-- collections task.
--
-- Restricting to task billing groups also silently broke the trigger-invoice
-- link. The old filter took billing groups with a task created inside
-- [pFrom-60d, pTo], so a task raised in August could never see the July invoice
-- that caused it: the July load simply never extracted that row. Widening the
-- scope is what fixes the ~38% task->invoice coverage, not a change to the
-- transform's matching rule.
--
-- THE RUN, NOT THE BILLING GROUP'S CURRENT METHOD, ASSIGNS THE CAMPAIGN.
-- tblRecurring is the immutable record of each recurring run:
--   RecurringID (PK) | StartedOn | PaymentType (1 Credit Card, 2 Check, 3 ACH)
-- One run per payment type per month, all kicked off on the 1st — August 2026 is
-- 520 (card), 521 (check), 522 (ACH). Both passes share a RecurringID: 520 wrote
-- 7,942 invoices on 08-01 and another 6,017 on 08-16, so the campaign needs the
-- run's payment type AND the invoice's own date. The transform does that split.
--
-- bg.PMType is still carried as pm_type, but it is the billing group's method
-- TODAY and it drifts from what the run charged: on 08-01 the check run held 75
-- invoices whose group now reads credit card and the ACH run held 5. Deriving
-- the campaign from it counted all 80 as Declined CC (1st). Order types 1 and 6
-- have no run, so they keep the pm_type fallback in the transform.
--
-- "NEVER ATTEMPTED" IS NOT ONE THING, AND MOSTLY IT IS NOT THE CARD.
-- On 2026-08-01, 7,917 of 7,942 recurring card invoices had a payment request sent
-- and confirmed, 23 had a request sent that was never confirmed, and 2 never had a
-- request sent at all. Nineteen of the invoices reported that day as "never
-- attempted, no card explanation" are in the unconfirmed group and their cards are
-- fine — 1922043's runs to 07/2031. The run began charging them between 04:03:57
-- and 04:04:10 and never finished.
--
-- IT TAKES TWO SOURCES TO SAY WHAT ACTUALLY HAPPENED, so pay_request_state reads
-- both. tblRecurringItems records CRM's INTENT per service item (PayAuthStartedOn /
-- PayAuthFinishedOn — the payment request going out and the confirmation coming
-- back, NOT a card authorisation hold; that wording stays out of anything a user
-- reads). tblPaymentResponseLog records what was actually SUBMITTED: every charge
-- writes a request row with a NULL ProcessorResponseMessage first, then the
-- processor's answer. An item stamp alone only proves our own code entered the
-- payment step.
--
-- The difference is real, not theoretical. Of the 19 unconfirmed invoices on
-- 2026-08-01, 17 have a request row in the gateway log and no answer — invoice
-- 1922467 is row 3454889 at 04:04:07 for $1,149.93 on last4 1008, and it settled
-- untouched on that same card three days later. The other two (1923231, 1924392)
-- have NO gateway row at all, and their item stamps are 04:04:10 and 04:04:09 — the
-- two LATEST in the whole run. The run wrote the CRM stamp, then wrote the gateway
-- row, and died between the two on its last two invoices. Calling those an attempt
-- would be wrong: nothing reached the processor.
--
--   CONFIRMED    every item came back
--   NO_RESPONSE  submitted to the gateway, no answer ever recorded
--   UNSUBMITTED  CRM started the payment step, nothing reached the gateway log
--   NOT_SENT     no payment step started
--   NULL         no recurring items at all (order types 1 and 6, plus a few strays)
--
-- RESULT_CASE reports NO_RESPONSE on its own and folds the other three together —
-- from the customer's side nothing went out either way — but the column keeps the
-- distinction so the split can be drilled into.
--
-- THE CARD BELONGS TO THE GROUP THE RUN CHARGED, NOT THE INVOICE HEADER.
-- tblOrders.BillingGroupID is rewritten by CRM to whichever group eventually
-- PAID the invoice — the same behaviour collections_recovery.extract.sql already
-- documents. Reading the card off the header therefore describes a group that in
-- many cases did not exist on the 1st, which manufactured a bogus "card replaced"
-- state that was really "we are looking at the wrong billing group". On 09-01,
-- invoice 1939451's header points at group 114062 (created 09-04) while the run
-- charged 79881, whose card expired 6/2026; 1941143 -> 72667 (exp 8/2026) and
-- 1942657 -> 95114 (exp 8/2026) behave the same way. Three of the five invoices
-- previously bucketed as "replaced" were plain expired cards.
--
-- tblRecurringItems.BillingGroupID IS the group the run was configured to charge,
-- keyed to the invoice by newOrderID (indexed). The grain there is one row per
-- SERVICE ITEM, not per invoice — invoice 1936470 alone carries several hundred
-- rows — so it is collapsed to one group per order with MIN() before anything
-- joins to it, otherwise the whole fact fans out. Order types 1 and 6 have no
-- recurring run, so they fall back to the header; the resolved group is emitted as
-- card_billing_group_id so every card_state can be checked against CRM by hand.
--
-- THE CARD IS READ AS OF THE INVOICE DATE, NOT AS OF NOW — same reason.
-- tblBillingGroups holds the card TODAY, and the invoice transform is
-- FULL_RELOAD_WINDOW, so a card read live is rewritten on every reload and an
-- invoice silently stops looking "expired" the moment the customer fixes it. On
-- 2026-09-01 the live card says 10 of the 25 never-attempted invoices were
-- expired; the as-of card says 16. Faulkner Infiniti reads as a valid 06/2028
-- card today — on the 1st it was a different card that expired in 12/2024.
--
-- tblBillingGroupsArchive holds every prior version of a billing group with an
-- ArchivedOn stamp, so the EARLIEST archived row on or after the invoice date is
-- the card the run charged. No archived row means the live row has not changed
-- since and is used instead. It has no index other than its primary key, so the
-- candidate rows are copied into an indexed temporary table first — a correlated
-- lookup straight against 609k unindexed rows will not finish.
--
-- The winning row is picked with MIN() over a fixed-width sortable string rather
-- than a self-join, because MySQL cannot reopen a TEMPORARY table twice in one
-- statement. It also settles ties deterministically, which matters: 818
-- (billing group, ArchivedOn) pairs in a 15-month window carry more than one
-- archive row, and a plain join on MIN(ArchivedOn) would fan out and
-- double-count those invoices. Layout is
--   1-14 ArchivedOn | 15-18 ExpireYear | 19-20 ExpireMonth | 21-24 Last4
-- with Last4 right-padded with '~' so a NULL stays distinguishable from '0000'.
--
-- UnitCost — NOT NormalPrice — is the billed price: on June's 15,367 paid
-- recurring invoices the applied cash equals the UnitCost total on 15,354
-- (99.9%) but the NormalPrice total on only 12,763 (83%), because NormalPrice is
-- blank on ~18% of parts. Reading NormalPrice understated amount-at-risk and
-- inflated recovery rate.
-- Applied money from vwPaymentsCreditsOrdersApproved (validated 2026-09-07):
-- cash = Payment+Credit; credit memo / write-off / refund tracked as their own
-- non-cash measures; OrderStatusID is intentionally NOT used. task_id/campaign_key
-- are attributed in the transform by joining ie_fact_collections_task on billing
-- group + cycle date. Aliases match ie_stg_collections_invoice.
SET SESSION max_execution_time = 200000;
SET @pFrom := :pFromDate, @pTo := DATE_ADD(:pToDate, INTERVAL 1 DAY);

-- One billing group per order: the group the recurring run was pointed at. MIN()
-- collapses the per-service-item grain deterministically before anything joins.
--
-- The same pass counts how far CRM thought it got. Counted rather than MIN'd because
-- the grain is per service item: an invoice where three of five items confirmed must
-- not read as fully confirmed.
DROP TEMPORARY TABLE IF EXISTS tmpRunGroup;
CREATE TEMPORARY TABLE tmpRunGroup(
  OrderID INT NOT NULL,
  PRIMARY KEY (OrderID),
  BillingGroupID INT NOT NULL,
  ItemsTotal INT NOT NULL,
  ItemsUnsent INT NOT NULL,
  ItemsUnconfirmed INT NOT NULL);

INSERT INTO tmpRunGroup(OrderID, BillingGroupID, ItemsTotal, ItemsUnsent, ItemsUnconfirmed)
SELECT ri.newOrderID,
       MIN(ri.BillingGroupID),
       COUNT(*),
       SUM(ri.PayAuthStartedOn IS NULL),
       SUM(ri.PayAuthFinishedOn IS NULL)
FROM tblOrders o
INNER JOIN tblRecurringItems ri
  ON ri.newOrderID = o.OrderID
WHERE o.OrderTypeID IN (3, 1, 6)
  AND o.OrderDate >= @pFrom
  AND o.OrderDate < @pTo
  AND IFNULL(ri.BillingGroupID, 0) > 0
GROUP BY ri.newOrderID;

-- What the run actually put on the wire. Unanswered request rows only: a row whose
-- ProcessorResponseMessage is still NULL was submitted and never answered, which is
-- precisely the evidence tblRecurringItems cannot provide. Answered rows are ignored
-- here — they already produce a billing fact row, and RESULT_CASE never reaches the
-- request-state arms when one exists.
--
-- Keyed by request DATE as well as order, so a later unanswered retry by an agent
-- cannot be read as the run having attempted the invoice. idxCreatedOn carries the
-- window scan; PaymentOrderId is varchar here, hence the numeric guard before CAST,
-- matching collections_billing.extract.sql.
DROP TEMPORARY TABLE IF EXISTS tmpGatewayReq;
CREATE TEMPORARY TABLE tmpGatewayReq(
  OrderID INT NOT NULL,
  ReqDate DATE NOT NULL,
  PRIMARY KEY (OrderID, ReqDate));

INSERT INTO tmpGatewayReq(OrderID, ReqDate)
SELECT CAST(p.PaymentOrderId AS UNSIGNED), DATE(p.CreatedOn)
FROM tblPaymentResponseLog p
WHERE p.CreatedOn >= @pFrom
  AND p.CreatedOn < @pTo
  AND p.ProcessorResponseMessage IS NULL
  AND p.PaymentOrderId REGEXP '^[0-9]+$'
GROUP BY CAST(p.PaymentOrderId AS UNSIGNED), DATE(p.CreatedOn);

DROP TEMPORARY TABLE IF EXISTS tmpBgArchive;
CREATE TEMPORARY TABLE tmpBgArchive(
  BillingGroupID INT NOT NULL,
  ArchivedOn DATETIME NOT NULL,
  ExpireYear INT NULL,
  ExpireMonth INT NULL,
  Last4 CHAR(4) NULL,
  INDEX ix_bg_archived (BillingGroupID, ArchivedOn));

-- Only versions archived inside the window can be the as-of row for an invoice
-- in the window, because the invoice date is itself >= @pFrom.
INSERT INTO tmpBgArchive(BillingGroupID, ArchivedOn, ExpireYear, ExpireMonth, Last4)
SELECT a.BillingGroupID, a.ArchivedOn, a.ExpireYear, a.ExpireMonth, a.Last4
FROM tblBillingGroupsArchive a
WHERE a.ArchivedOn >= @pFrom;

DROP TEMPORARY TABLE IF EXISTS tmpCardAsOf;
CREATE TEMPORARY TABLE tmpCardAsOf(
  OrderID INT NOT NULL,
  PRIMARY KEY (OrderID),
  pick CHAR(24) NOT NULL);

INSERT INTO tmpCardAsOf(OrderID, pick)
SELECT o.OrderID,
       MIN(CONCAT(DATE_FORMAT(a.ArchivedOn, '%Y%m%d%H%i%s'),
                  LPAD(IFNULL(a.ExpireYear, 0), 4, '0'),
                  LPAD(IFNULL(a.ExpireMonth, 0), 2, '0'),
                  RPAD(IFNULL(a.Last4, ''), 4, '~')))
FROM tblOrders o
LEFT JOIN tmpRunGroup rg
  ON rg.OrderID = o.OrderID
INNER JOIN tmpBgArchive a
  ON a.BillingGroupID = IFNULL(rg.BillingGroupID, o.BillingGroupID)
 AND a.ArchivedOn >= o.OrderDate
WHERE o.OrderTypeID IN (3, 1, 6)
  AND o.OrderDate >= @pFrom
  AND o.OrderDate < @pTo
GROUP BY o.OrderID;

SELECT
  o.OrderID                                    AS order_id,
  o.BillingGroupID                             AS billing_group_id,
  o.CustomerID                                 AS customer_id,
  /* THE LINK CRM RECORDED, not one we inferred. tblTaskOrder is a general order↔task
     table and most of what it holds for these invoices is provisioning work, so it is
     restricted to the AR task types this report already uses. What survives is small
     and authoritative: it is the only evidence that reaches invoice 1919833, whose AR
     task sits on the group that PAID rather than the one that declined. The count comes
     across too — several AR tasks can link to one invoice, and the transform reports
     that as AMBIGUOUS instead of silently picking one. */
  tl.crm_task_id                               AS crm_task_id,
  tl.crm_task_count                            AS crm_task_count,
  o.OrderTypeID                                AS order_type_id,
  NULLIF(o.RecurringID, 0)                     AS recurring_id,
  r.PaymentType                                AS recurring_payment_type,
  bg.PMType                                    AS pm_type,
  IFNULL(rg.BillingGroupID, o.BillingGroupID)  AS card_billing_group_id,
  CASE
    WHEN rg.OrderID IS NULL                    THEN NULL
    WHEN rg.ItemsUnsent = rg.ItemsTotal        THEN 'NOT_SENT'
    WHEN rg.ItemsUnconfirmed = 0               THEN 'CONFIRMED'
    WHEN gq.OrderID IS NOT NULL                THEN 'NO_RESPONSE'
    ELSE 'UNSUBMITTED'
  END                                          AS pay_request_state,
  CASE WHEN ca.pick IS NULL
       THEN NULLIF(IFNULL(bgr.ExpireYear, 0) * 100 + IFNULL(bgr.ExpireMonth, 0), 0)
       ELSE NULLIF(CAST(SUBSTRING(ca.pick, 15, 6) AS UNSIGNED), 0)
  END                                          AS card_expire_ym,
  CASE WHEN ca.pick IS NULL
       THEN bgr.Last4
       ELSE NULLIF(REPLACE(SUBSTRING(ca.pick, 21, 4), '~', ''), '')
  END                                          AS card_last4,
  DATE(bgr.CreatedOn)                          AS card_group_created_on,
  CASE WHEN ca.pick IS NULL THEN 0 ELSE 1 END  AS card_from_archive,
  CASE WHEN o.OrderTypeID = 6 THEN 1 ELSE 0 END AS is_reactivation,
  DATE(o.OrderDate)                            AS order_date,
  DATE(o.DueDate)                              AS due_date,
  IFNULL(parts.invoice_amount, 0)             AS invoice_amount,
  /* Reported separately, never converted or combined. CurrencyTypeID 1 = US Dollar,
     2 = Canadian Dollar in tblCurrencyType; the suffix is stored so consumers do not
     repeat the lookup. Left NULL when the order carries no currency, so an invoice we
     cannot denominate stays visibly unresolved rather than defaulting to USD. */
  cur.Suffix                                  AS currency_code,
  IFNULL(ap.cash_collected, 0)                AS cash_collected,
  IFNULL(ap.credit_memo_amount, 0)            AS credit_memo_amount,
  IFNULL(ap.writeoff_amount, 0)               AS writeoff_amount,
  IFNULL(ap.refund_amount, 0)                 AS refund_amount,
  GREATEST(IFNULL(parts.invoice_amount, 0) - IFNULL(ap.total_applied, 0), 0) AS open_balance,
  CASE
    WHEN IFNULL(parts.invoice_amount, 0) <= 0.01 THEN 'OPEN'
    WHEN IFNULL(ap.cash_collected, 0) >= IFNULL(parts.invoice_amount, 0) - 0.01 THEN 'CASH_PAID'
    WHEN IFNULL(parts.invoice_amount, 0) - IFNULL(ap.total_applied, 0) <= 0.01
      AND IFNULL(ap.credit_memo_amount, 0) + IFNULL(ap.writeoff_amount, 0) > 0 THEN 'MEMO_WRITEOFF'
    WHEN IFNULL(ap.cash_collected, 0) > 0 THEN 'PARTIAL'
    WHEN IFNULL(ap.refund_amount, 0) > 0 THEN 'REFUNDED'
    ELSE 'OPEN'
  END                                          AS outcome,
  CASE WHEN IFNULL(parts.invoice_amount, 0) > 0.01
        AND IFNULL(ap.cash_collected, 0) >= IFNULL(parts.invoice_amount, 0) - 0.01
       THEN 1 ELSE 0 END                       AS is_cash_paid,
  ap.cash_paid_on                              AS paid_on,
  ap.first_cash_on                             AS first_cash_on,
  ap.credit_memo_on                            AS credit_memo_on
FROM tblOrders o
LEFT JOIN tblBillingGroups bg
  ON bg.BillingGroupID = o.BillingGroupID
LEFT JOIN tblRecurring r
  ON r.RecurringID = o.RecurringID
LEFT JOIN tmpRunGroup rg
  ON rg.OrderID = o.OrderID
LEFT JOIN tblBillingGroups bgr
  ON bgr.BillingGroupID = IFNULL(rg.BillingGroupID, o.BillingGroupID)
LEFT JOIN tmpCardAsOf ca
  ON ca.OrderID = o.OrderID
LEFT JOIN tmpGatewayReq gq
  ON gq.OrderID = o.OrderID
 AND gq.ReqDate = DATE(o.OrderDate)
LEFT JOIN tblCurrencyType cur
  ON cur.CurrencyTypeID = o.CurrencyTypeID
/* Earliest AR task explicitly linked to the invoice, plus how many there were. MIN on
   the concatenation rather than MIN(TaskID) because the earliest-created task is the
   one that chased it, and ids are not issued strictly in creation order across types. */
LEFT JOIN (
  SELECT tx.OrderID,
         CAST(SUBSTRING(MIN(CONCAT(DATE_FORMAT(tk.CreatedOn, '%Y%m%d%H%i%s'),
                                   LPAD(tx.TaskID, 12, '0'))), 15, 12) AS UNSIGNED)
                                               AS crm_task_id,
         COUNT(DISTINCT tx.TaskID)             AS crm_task_count
  FROM tblTaskOrder tx
  JOIN tblTask tk
    ON tk.TaskID = tx.TaskID
   AND tk.TaskTypeID IN (1, 33, 34, 4, 9)
  JOIN tblOrders otl
    ON otl.OrderID = tx.OrderID
   AND otl.OrderTypeID IN (3, 1, 6)
   AND otl.OrderDate >= @pFrom
   AND otl.OrderDate < @pTo
  GROUP BY tx.OrderID
) tl ON tl.OrderID = o.OrderID
LEFT JOIN (
  SELECT op.OrderID,
         SUM(op.Quantity * op.UnitCost + op.PartTax) AS invoice_amount
  FROM tblOrderParts op
  JOIN tblOrders o2
    ON o2.OrderID = op.OrderID
   AND o2.OrderTypeID IN (3, 1, 6)
   AND o2.OrderDate >= @pFrom
   AND o2.OrderDate < @pTo
  GROUP BY op.OrderID
) parts ON parts.OrderID = o.OrderID
LEFT JOIN (
  SELECT v.OrderID,
         SUM(ABS(v.Amount)) AS total_applied,
         SUM(CASE WHEN v.Type IN ('Payment','Credit') THEN ABS(v.Amount) ELSE 0 END) AS cash_collected,
         SUM(CASE WHEN v.Type IN ('Credit Memo','Return/Credit Memo - Old') THEN ABS(v.Amount) ELSE 0 END) AS credit_memo_amount,
         SUM(CASE WHEN v.Type IN ('Forgiven','Uncollectibles') THEN ABS(v.Amount) ELSE 0 END) AS writeoff_amount,
         SUM(CASE WHEN v.Type = 'Return' THEN ABS(v.Amount) ELSE 0 END) AS refund_amount,
         /* Three different moments, and the report needs all three kept apart:
            cash_paid_on is the LAST cash application, i.e. when the balance was fully
            settled; first_cash_on is the FIRST, which is when outreach stopped being
            what recovered the money; credit_memo_on is when it was written off
            instead. They coincide on a single-payment invoice and diverge on every
            instalment and every partial-cash-plus-memo case. */
         MAX(CASE WHEN v.Type IN ('Payment','Credit') THEN v.AppliedOn END) AS cash_paid_on,
         MIN(CASE WHEN v.Type IN ('Payment','Credit') THEN v.AppliedOn END) AS first_cash_on,
         MIN(CASE WHEN v.Type IN ('Credit Memo','Return/Credit Memo - Old',
                                  'Forgiven','Uncollectibles')
                  THEN v.AppliedOn END)                                     AS credit_memo_on
  FROM vwPaymentsCreditsOrdersApproved v
  JOIN tblOrders o3
    ON o3.OrderID = v.OrderID
   AND o3.OrderTypeID IN (3, 1, 6)
   AND o3.OrderDate >= @pFrom
   AND o3.OrderDate < @pTo
  GROUP BY v.OrderID
) ap ON ap.OrderID = o.OrderID
WHERE o.OrderTypeID IN (3, 1, 6)
  AND o.OrderDate >= @pFrom
  AND o.OrderDate < @pTo;
