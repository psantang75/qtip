-- Leads extract (source pool: crm) — the live lead-level select from
-- ReportLeadsAllBySourceForPeriod_5yr, as a checked-in, parameterized SELECT.
--
-- The legacy proc carried a huge commented-out margin block (temp tables for
-- product/install/warranty/shipping margin, refunds, subs, SXM/SYB). That is all
-- dead code there and is dropped here — only the live lead-source select remains
-- (margin lives in its own Phase 5 report). One row per qualifying lead-task.
--
-- FULL_RELOAD_WINDOW: re-pull a trailing window (window_months) of leads by
-- created date; the transform deletes that window in fact then re-inserts, so a
-- lead's mutable status/conversion/paid flags refresh each run.
--
-- Improvements vs. the proc:
--   * Identity = salesperson EMAIL (tblSalesPeople.email via my_aspnet_users.id =
--     AssignedTo -> tblSalesPeople.UserID), conformed to ie_dim_employee downstream
--     — never a name lookup.
--   * Real DATETIME created_on (no DATE_FORMAT display string); week-of-month is
--     derived downstream from ie_dim_date, so the fnWeekOfMonth UDF is not needed.
--   * Collapsed the proc's tmpCustLeads (existence) + re-join of the lead task into
--     a single INNER JOIN on the lead task (TaskTypeID 11, open-ish statuses,
--     assignee not the house account) so each lead-task yields exactly one row.
SELECT
  cl.CustomerLeadID                                            AS customer_lead_id,
  cl.CreatedOn                                                 AS created_on,
  lsc.LSCategoryName                                           AS lead_source_category,
  ls.LeadSource                                                AS lead_source,
  ts.Title                                                     AS task_status,
  IFNULL(sp.SalesPersonName, 'Unknown')                        AS salesperson_name,
  sp.email                                                     AS email,
  o.OrderID                                                    AS order_id,
  1                                                            AS lead_total,
  CASE WHEN o.OrderID    IS NOT NULL THEN 1 ELSE 0 END         AS lead_converted_total,
  CASE WHEN pd.PaymentDate IS NOT NULL THEN 1 ELSE 0 END       AS lead_total_paid
FROM tblCustomerLead cl
INNER JOIN tblTask t
        ON t.CustomerLeadID = cl.CustomerLeadID
       AND t.TaskTypeID = 11
       AND t.TaskStatusID NOT IN (43, 97, 31, 99)
       AND t.AssignedTo <> 72
LEFT JOIN tblTaskStatus ts  ON t.TaskStatusID = ts.TaskStatusID
LEFT JOIN my_aspnet_users u ON u.id = t.AssignedTo
LEFT JOIN tblSalesPeople sp ON u.id = sp.UserID AND u.id NOT IN (0, 12, 52)
LEFT JOIN tblOrders o       ON cl.CustomerLeadID = o.CustomerLeadID AND o.OrderType = 'order'
LEFT JOIN (
  SELECT o.OrderID, MIN(pc.ProcessedDate) AS PaymentDate
  FROM tblCustomerLead cl
  INNER JOIN tblOrders o              ON cl.CustomerLeadID = o.CustomerLeadID AND o.OrderType = 'order'
  INNER JOIN tblPaymentsCreditsOrders pco ON o.OrderID = pco.OrderID
  INNER JOIN tblPaymentsCredits pc    ON pco.PaymentCreditID = pc.PaymentCreditID
  WHERE cl.CreatedOn >= :pFromDate
    AND cl.CreatedOn <  (:pToDate + INTERVAL 1 DAY)
    AND pc.PaymentsCreditsStatusID = 3
    AND pc.CheckNumber != 'Credit Memo'
  GROUP BY pco.OrderID
) pd ON pd.OrderID = o.OrderID
-- LeadSource 212 with no/agent channel rolls up to 197, matching the proc.
LEFT JOIN tblLeadSources ls ON
  CASE WHEN cl.LeadSourceID = 212 AND (IFNULL(o.ChannelID, -1) = 3 OR o.ChannelID IS NULL)
       THEN 197 ELSE cl.LeadSourceID END = ls.LeadSourceID
LEFT JOIN tblLeadSourceGroup    lsg ON ls.LeadSourceGroupID = lsg.LeadSourceGroupID
LEFT JOIN tblLeadSourceCategory lsc ON IFNULL(ls.LeadSourceCategoryID, 0) = lsc.LSCategoryID
WHERE cl.CreatedOn >= :pFromDate
  AND cl.CreatedOn <  (:pToDate + INTERVAL 1 DAY);
