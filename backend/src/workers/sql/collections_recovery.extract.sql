/* Collections Recovery extract (source pool: crm). Grain: one real-money
   application (Type Payment/Credit) to a collectible AR invoice, window-bound by
   :pFromDate / :pToDate on AppliedOn. Non-cash lines (Credit Memo, Forgiven,
   Uncollectibles, Warranty, Return) never enter — this fact is collected cash only.
   processor_kind = AGENT when the paying tblPaymentsCredits.CreatedBy resolves via
   the DEDUPED agent table (isDisplayInCRM=1, DeptID IN (1,2,3)); else NO_AGENT
   (CreatedBy 0 auto/portal, 12 system, or a customer portal login). task_id/
   campaign_key are attributed in the transform. Aliases match ie_stg_collections_recovery.

   RELEVANCE GATE IS BY CUSTOMER, NOT BILLING GROUP (changed 2026-09-10). This used to
   require the INVOICE HEADER's billing group to have an AR task, which silently threw
   away most recovered cash: when a customer pays a declined invoice on a different
   card, CRM rewrites the invoice header to the group that paid, and that new group has
   no AR task — so the payment failed the gate and vanished. On the 2026-08-01 cycle
   that dropped 125 of 276 declined invoices, every one of them marked CASH_PAID with a
   zero balance on ie_fact_collections_invoice, making genuine recoveries look like
   write-offs. Gating on the CUSTOMER having an AR task keeps the same "cash from an
   account we were chasing" intent while surviving the header rewrite.

   THE CUSTOMER IS TAKEN FROM THE TASK, NOT ONLY FROM ITS BILLING GROUP (2026-09-15).
   Resolving it solely through tblBillingGroups required BillingGroupID > 0, so an AR task
   raised without a group could never put its customer in the gate and every payment that
   customer made was dropped. That left 33 declined invoices — 2025-06-16 through
   2026-03-16, $8,355.48 — reading as recovered on ie_fact_collections_invoice while
   ie_fact_collections_recovery had no row at all, which surfaced on Cycle Performance as
   invoices with no cash from anyone and no credit memo either. 351 of the 26,810 AR tasks
   since 2025-03 have no billing group; tblTask.CustomerID is populated on ALL of them,
   and collections_task.extract.sql already trusts that column.

   UNION, NOT A SWAP. The two sources disagree on 81 of 26,459 tasks that do have a group,
   so replacing one with the other would have dropped customers the gate currently admits.
   Taking both can only widen it. Measured on 2026-08: 2,982 payment rows before, 2,995
   after — 13 rows and $804.76 recovered, nothing lost.

   NAME THE PAYER (added 2026-09-11). processor_kind stays a two-way AGENT/NO_AGENT flag
   so the funnel and PROCESSOR_RANK are unchanged, but NO_AGENT was being rendered as
   "No agent" when CreatedBy in fact identifies the payer exactly. tblSalesPeople.UserID
   tops out at 201, so the id space splits cleanly: <= 201 is staff, > 201 is a
   tblContacts.ContactID (a customer portal login). The contact join is additionally
   constrained to the ORDER'S OWN CustomerID, so a name is only ever attached when the
   contact genuinely belongs to the paying account — across 2026-09-01..05 every one of
   the above-staff ids matched its own customer, so the guard costs no coverage. 0 is the
   automated recurring charge and 12 the "Recurring Service" system account; both are
   labelled rather than left blank. */
SELECT /*+ MAX_EXECUTION_TIME(120000) */
  v.PaymentsCreditsOrderID                     AS payments_credits_order_id,
  v.PaymentCreditID                            AS payment_credit_id,
  v.OrderID                                    AS order_id,
  /* Still the order header, and deliberately so: the recovery transform links tasks on
     this column, and an AR task is raised against the group that DECLINED, not the one
     that later paid. Swapping it to pc.BillingGroupID would silently break that link.
     The header is unreliable in its own right — CRM rewrites it to whichever group
     settled — which is part of why task linkage is being reworked separately; until
     then card identity is answered by payment_last4 below rather than by this group. */
  o.BillingGroupID                             AS billing_group_id,
  /* WHICH CARD ACTUALLY PAID (2026-09-14). The recovery path used to infer this from
     billing groups: it compared the order header against the run's group and fell back
     to a proxy that looked for any later success on the group. Neither describes the
     payment that settled THIS invoice, so anything unmatched dropped to the "Original
     card retried" ELSE arm — including 1919833, which declined 08-01 on group 68054
     last4 1781 and was paid 08-03 on group 112957 last4 4587. Keyed on the gateway's
     own PaymentCreditID so it is this payment's card. A card payment writes an approval
     and a settlement row carrying the same Last4, so MIN is deterministic rather than
     an arbitrary pick; a non-card payment yields NULL and the instrument stays unknown.
     Different last four proves a different card; identical last four does NOT prove the
     same card, so downstream only ever draws the negative conclusion from it. */
  pcard.Last4                                  AS payment_last4,
  v.Type                                       AS payment_type,
  pc.CreatedBy                                 AS processor_crm_id,
  CASE WHEN ag.UserID IS NOT NULL THEN 'AGENT' ELSE 'NO_AGENT' END AS processor_kind,
  ag.email                                     AS agent_email,
  CASE
    WHEN pc.CreatedBy IS NULL THEN NULL
    WHEN pc.CreatedBy = 0     THEN 'Automatic recurring run'
    WHEN pc.CreatedBy = 12    THEN 'Recurring Service (system)'
    ELSE COALESCE(
           sp.name,
           NULLIF(TRIM(CONCAT(IFNULL(ct.FirstName, ''), ' ', IFNULL(ct.LastName, ''))), ''),
           ag.email)
  END                                          AS processor_name,
  ABS(v.Amount)                                AS amount,
  v.AppliedOn                                  AS applied_on,
  DATE(v.AppliedOn)                            AS applied_date,
  0                                            AS is_reversed
FROM vwPaymentsCreditsOrdersApproved v
JOIN tblOrders o
  ON o.OrderID = v.OrderID
 AND o.OrderTypeID IN (3, 1, 6)
JOIN (
  SELECT t.CustomerID
  FROM tblTask t
  WHERE t.TaskTypeID IN (1, 33, 34, 4, 9)
    AND t.CustomerID > 0
    AND t.CreatedOn >= DATE_SUB(:pFromDate, INTERVAL 90 DAY)
    AND t.CreatedOn < DATE_ADD(:pToDate, INTERVAL 1 DAY)
  UNION
  SELECT bgt.CustomerID
  FROM tblTask t
  JOIN tblBillingGroups bgt ON bgt.BillingGroupID = t.BillingGroupID
  WHERE t.TaskTypeID IN (1, 33, 34, 4, 9)
    AND t.BillingGroupID > 0
    AND t.CreatedOn >= DATE_SUB(:pFromDate, INTERVAL 90 DAY)
    AND t.CreatedOn < DATE_ADD(:pToDate, INTERVAL 1 DAY)
) cust ON cust.CustomerID = o.CustomerID
LEFT JOIN tblPaymentsCredits pc
  ON pc.PaymentCreditID = v.PaymentCreditID
LEFT JOIN (
  SELECT UserID, MIN(EMail) AS email
  FROM tblSalesPeople
  WHERE isDisplayInCRM = 1 AND DeptID IN (1, 2, 3)
  GROUP BY UserID
) ag ON ag.UserID = pc.CreatedBy
LEFT JOIN (
  SELECT UserID, MIN(NULLIF(TRIM(SalesPersonName), '')) AS name
  FROM tblSalesPeople
  GROUP BY UserID
) sp ON sp.UserID = pc.CreatedBy
    AND pc.CreatedBy BETWEEN 1 AND 201
LEFT JOIN tblContacts ct
  ON ct.ContactID = pc.CreatedBy
 AND ct.CustomerID = o.CustomerID
 AND pc.CreatedBy > 201
/* The card the gateway actually charged for this payment. Keyed on PaymentCreditID so
   it is the payment's own card, not a later success on the same group. A card payment
   writes an approval and a settlement row with the same Last4, so MIN is deterministic
   rather than an arbitrary pick; a payment with no card row (cheque, credit) yields
   NULL and the path rule falls back to treating the instrument as unknown. Bounded to
   the load window plus a week so a settlement landing just after the window still
   resolves. */
LEFT JOIN (
  SELECT prl.PaymentCreditID, MIN(NULLIF(prl.Last4, '')) AS Last4
  FROM tblPaymentResponseLog prl
  WHERE prl.PaymentCreditID IS NOT NULL
    AND prl.ProcessorResponseMessage IN ('SETTLED', 'Approved')
    AND prl.CreatedOn >= DATE_SUB(:pFromDate, INTERVAL 7 DAY)
    AND prl.CreatedOn < DATE_ADD(:pToDate, INTERVAL 8 DAY)
  GROUP BY prl.PaymentCreditID
) pcard ON pcard.PaymentCreditID = v.PaymentCreditID
WHERE v.Type IN ('Payment', 'Credit')
  AND v.AppliedOn >= :pFromDate
  AND v.AppliedOn < DATE_ADD(:pToDate, INTERVAL 1 DAY);
