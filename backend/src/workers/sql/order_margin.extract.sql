-- Order margin extract (source pool: crm) — a checked-in, parameterized port of
-- ReportLeadsAllBySourceWithSalesMarginForPeriod_5yr_v2, reduced to the margin
-- grain the Sales Margin page needs (one row per order/refund).
--
-- This is a PROCEDURE-STYLE extract: it builds connection-scoped TEMPORARY tables
-- and ends in a single SELECT. The SourceReportSyncWorker runs every statement on
-- one dedicated connection and loads the final result set into staging.
--
-- Trimmed vs. the proc: the whole lead-attribution layer (tmpCustLeads /
-- tmpLeadMargin) is dropped — "Leads by Salesperson" reuses ie_fact_lead. The
-- display-only SXM/SYB existing-customer flags and ActiveSubs are dropped too.
-- Kept verbatim: product/install/warranty/shipping margin, refunds (negative),
-- per-revenue-type margin adjustments, sub counts, sub-only, labor/radio, and saves
-- (tblSaves) — the rep-logged subscription adjustments the authoritative report folds
-- into each rep's "Sub #".
--
-- Improvements vs. the proc:
--   * Identity = salesperson EMAIL (tblSalesPeople.email), conformed to
--     ie_dim_employee downstream — never a name lookup.
--   * Real DATETIME margin_eligible_date / order_date (no display strings).
--   * Window is parameterized (:pFromDate/:pToDate) via session vars so the
--     backfill runner can re-extract fixed ranges in chunks. @pTo is the
--     exclusive upper bound (to-date + 1 day), matching the proc's pToDate bump.
--   * Comments are line-comments only — the worker's splitter strips block
--     comments (which would also eat an optimizer hint), so the per-statement
--     timeout is lifted with SET SESSION instead.
--   * Margin/shipping adjustments are dated by entry date (CreatedOn), not the
--     order's margin-eligibility month, and applied once per (order, month) — so
--     a correction keyed to a prior-month order lands in the month it was made,
--     matching the authoritative "Margin Report - By Month". (The proc keyed on
--     order month via tmpOrders, which silently dropped such corrections.)
SET SESSION max_execution_time = 200000;
SET @pFrom := :pFromDate, @pTo := DATE_ADD(:pToDate, INTERVAL 1 DAY);

DROP TEMPORARY TABLE IF EXISTS tmpOrderMargin;
CREATE TEMPORARY TABLE tmpOrderMargin(OrderID INT, INDEX (OrderID), RefundID INT, INDEX (RefundID), MarginGroupID INT, INDEX (MarginGroupID), RevenueTypeID INT, INDEX (RevenueTypeID),
  MarginCredit DECIMAL(10,2), INDEX (MarginCredit), Margin DECIMAL(10,2), INDEX (Margin), FlatRate DECIMAL(10,2), INDEX (FlatRate),
  Adjustment DECIMAL(10,2), INDEX (Adjustment), DM_Margin DECIMAL(10,2), INDEX (DM_Margin), ShippingMargin DECIMAL(10,2), INDEX (ShippingMargin));

DROP TEMPORARY TABLE IF EXISTS tmpRefundsOutsideOfMonth;
CREATE TEMPORARY TABLE tmpRefundsOutsideOfMonth(OrderID INT, INDEX (OrderID), RefundID INT, INDEX (RefundID));

DROP TEMPORARY TABLE IF EXISTS tmpOrders;
CREATE TEMPORARY TABLE tmpOrders(OrderID INT, INDEX (OrderID), MarginEligible DateTime);
INSERT INTO tmpOrders(OrderID, MarginEligible)
SELECT DISTINCT o.OrderID, o.MarginEligible
FROM tblOrders o
INNER JOIN tblPaymentsCreditsOrders pco ON pco.OrderID = o.OrderID
INNER JOIN tblPaymentsCredits pc ON pc.PaymentCreditID = pco.PaymentCreditID AND pc.PaymentsCreditsTypeID != 9
WHERE o.MarginEligible >= @pFrom AND o.MarginEligible < @pTo AND o.OrderType = 'order';

-- Margin adjustments are attributed to the month they were ENTERED
-- (opma.CreatedOn), not the order's margin-eligibility month. A correction can
-- be keyed to a prior-month order whose only activity this month is a refund
-- (e.g. order 1828726: a Feb-eligible order refunded in May, then a -289.01
-- warranty margin-credit entered in May to fix an over-applied "All Parts"
-- warranty refund). Keying on the order month dropped those entirely; keying on
-- CreatedOn lands the adjustment in the month it belongs to, matching the
-- authoritative "Margin Report - By Month". The adjustment then joins by
-- (OrderID, MarginYrMo) to whichever order/refund row(s) fall in that month and
-- is applied to exactly one of them (AdjRn = 1) in the final SELECT.
DROP TEMPORARY TABLE IF EXISTS tmpOrderMarginAdjustment;
CREATE TEMPORARY TABLE tmpOrderMarginAdjustment(OrderID INT, INDEX (OrderID), MarginGroupID INT, INDEX (MarginGroupID), RevenueTypeID INT, MarginYrMo VARCHAR(8), INDEX (RevenueTypeID), Adjustment DECIMAL(10,2));
INSERT INTO tmpOrderMarginAdjustment(OrderID, MarginGroupID, RevenueTypeID, MarginYrMo, Adjustment)
SELECT op.OrderID, mg.MarginGroupID,
CASE WHEN p.RevenueTypeID = 2 THEN 2 WHEN p.RevenueTypeID = 7 THEN 7 ELSE 1 END RevenueTypeID,
DATE_FORMAT(opma.CreatedOn, '%Y-%m') MarginYrMo, SUM(IFNULL(opma.Adjustment,0) * op.Quantity) Adjustment
FROM tblOrderPartMarginAdjustment opma
INNER JOIN tblOrderParts op ON opma.OrderPartID = op.OrderPartID
INNER JOIN tblMarginGroup mg ON mg.MarginGroupID = op.MarginGroupID
INNER JOIN tblParts p ON op.PartID = p.PartID
WHERE opma.CreatedOn >= @pFrom AND opma.CreatedOn < @pTo
GROUP BY op.OrderID, mg.MarginGroupID,
CASE WHEN p.RevenueTypeID = 2 THEN 2 WHEN p.RevenueTypeID = 7 THEN 7 ELSE 1 END,
DATE_FORMAT(opma.CreatedOn, '%Y-%m');

INSERT INTO tmpOrderMarginAdjustment(OrderID, MarginGroupID, RevenueTypeID, MarginYrMo, Adjustment)
SELECT os.OrderID, 0 MarginGroupID, 11 RevenueTypeID, DATE_FORMAT(osma.CreatedOn, '%Y-%m') MarginYrMo, SUM(osma.Adjustment) AS Adjustment
FROM tblOrderShippingMarginAdjustment osma
INNER JOIN tblOrderShipping os ON os.OrderShippingID = osma.OrderShippingID
WHERE osma.CreatedOn >= @pFrom AND osma.CreatedOn < @pTo
GROUP BY os.OrderID, DATE_FORMAT(osma.CreatedOn, '%Y-%m');

DROP TEMPORARY TABLE IF EXISTS tmpOrderShipping;
CREATE TEMPORARY TABLE tmpOrderShipping(OrderID INT, INDEX (OrderID), ShippingAdditional DECIMAL(10,2), INDEX (ShippingAdditional));
INSERT INTO tmpOrderShipping(OrderID, ShippingAdditional)
SELECT os.OrderID, SUM(os.ShippingAdditional) AS ShippingAdditional
FROM tblOrderShipping os
INNER JOIN (
  SELECT DISTINCT os.OrderID
  FROM tblOrderShipping os
  INNER JOIN tblOrderParts op ON os.OrderID = op.OrderID
  INNER JOIN tblParts p ON op.PartID = p.PartID
  WHERE p.Shippable = 1
) os2 ON os.OrderID = os2.OrderID
GROUP BY os.OrderID;

INSERT INTO tmpOrderMargin(OrderID, RefundID, MarginGroupID, RevenueTypeID, MarginCredit, Margin, FlatRate, Adjustment, DM_Margin, ShippingMargin)
SELECT t.OrderID, 0 AS RefundID, mg.MarginGroupID,
CASE WHEN p.RevenueTypeID = 2 THEN 2 WHEN p.RevenueTypeID = 7 THEN 7 ELSE 1 END RevenueTypeID,
SUM(CASE CASE mg.MarginGroupID WHEN 0 THEN 0 ELSE opxm.MarginTypeID END WHEN 1 THEN 0 WHEN 2 THEN 0 WHEN 3 THEN opxm.Value * op.Quantity ELSE 0 END) AS MarginCredit,
SUM(CASE CASE mg.MarginGroupID WHEN 0 THEN 0 ELSE opxm.MarginTypeID END WHEN 1 THEN 0 WHEN 2 THEN ((op.UnitCost - op.DMCost) * op.Quantity) WHEN 3 THEN 0 ELSE 0 END) AS Margin,
SUM(CASE CASE mg.MarginGroupID WHEN 0 THEN 0 ELSE opxm.MarginTypeID END WHEN 1 THEN opxm.Value * op.Quantity WHEN 2 THEN 0 WHEN 3 THEN 0 ELSE 0 END) AS FlatRate,
0 Adjustment,
SUM((op.UnitCost - op.DMCost) * op.Quantity) AS DM_Margin,
0 ShippingMargin
FROM tmpOrders t
INNER JOIN tblOrderParts op ON op.OrderID = t.OrderID
INNER JOIN tblMarginGroup mg ON mg.MarginGroupID = op.MarginGroupID
INNER JOIN tblParts p ON op.PartID = p.PartID
INNER JOIN tblOrderPartMarginTypeXref opxm ON opxm.OrderPartID = op.OrderPartID
WHERE mg.MarginGroupID > 0
GROUP BY t.OrderID, mg.Name, mg.MarginGroupID,
CASE WHEN p.RevenueTypeID = 2 THEN 2 WHEN p.RevenueTypeID = 7 THEN 7 ELSE 1 END;

INSERT INTO tmpOrderMargin(OrderID, RefundID, MarginGroupID, RevenueTypeID, MarginCredit, Margin, FlatRate, Adjustment, DM_Margin, ShippingMargin)
SELECT t.OrderID, 0 AS RefundID, 0 MarginGroupID, 11 RevenueTypeID, 0 MarginCredit,
ship.ShippingAdditional Margin, 0 FlatRate, 0 Adjustment, 0 DM_Margin, 0 ShippingMargin
FROM tmpOrders t
INNER JOIN tmpOrderShipping ship ON ship.OrderID = t.OrderID
GROUP BY t.OrderID, MarginGroupID, RevenueTypeID;

INSERT INTO tmpOrderMargin(OrderID, RefundID, MarginGroupID, RevenueTypeID, MarginCredit, Margin, FlatRate, Adjustment, DM_Margin, ShippingMargin)
SELECT oref.OrderID, oref.OrderRefundID AS RefundID, mg.MarginGroupID,
CASE WHEN p.RevenueTypeID = 2 THEN 2 WHEN p.RevenueTypeID = 7 THEN 7 ELSE 1 END RevenueTypeID,
SUM(CASE opxm.MarginTypeID WHEN 1 THEN 0 WHEN 2 THEN 0 WHEN 3 THEN opxm.Value * op.Quantity ELSE 0 END * -1) AS MarginCredit,
SUM((CASE opxm.MarginTypeID WHEN 1 THEN 0 WHEN 2 THEN ((op.UnitCost - op.DMCost) * opr.Quantity) WHEN 3 THEN 0 ELSE 0 END) * -1) AS Margin,
SUM(CASE opxm.MarginTypeID WHEN 1 THEN opxm.Value * op.Quantity WHEN 2 THEN 0 WHEN 3 THEN 0 ELSE 0 END * -1) AS FlatRate,
0 Adjustment,
SUM((op.UnitCost - op.DMCost) * opr.Quantity) * -1 AS DM_Margin,
0 ShippingMargin
FROM tblOrderRefunds oref
INNER JOIN tblOrders o ON o.OrderID = oref.OrderID
INNER JOIN tblOrderPartRefunds opr ON opr.OrderRefundID = oref.OrderRefundID
INNER JOIN tblOrderParts op ON op.OrderPartID = opr.OrderPartID
INNER JOIN tblMarginGroup mg ON mg.MarginGroupID = op.MarginGroupID
INNER JOIN tblParts p ON op.PartID = p.PartID
INNER JOIN tblOrderPartMarginTypeXref opxm ON opxm.OrderPartID = op.OrderPartID
WHERE mg.MarginGroupID > 0 AND opr.Quantity > 0
  AND GREATEST(o.MarginEligible, oref.CreatedOn) >= @pFrom AND GREATEST(o.MarginEligible, oref.CreatedOn) < @pTo
  AND o.MarginEligible IS NOT NULL AND DATE(o.MarginEligible) > '1-1-1' AND o.OrderType = 'order'
GROUP BY oref.OrderID, oref.OrderRefundID, mg.MarginGroupID,
CASE WHEN p.RevenueTypeID = 2 THEN 2 WHEN p.RevenueTypeID = 7 THEN 7 ELSE 1 END
ORDER BY oref.OrderID, oref.OrderRefundID, mg.MarginGroupID;

INSERT INTO tmpOrderMargin(OrderID, RefundID, MarginGroupID, RevenueTypeID, MarginCredit, Margin, FlatRate, Adjustment, DM_Margin, ShippingMargin)
SELECT oref.OrderID, oref.OrderRefundID RefundID, 0 MarginGroupID, 11 RevenueTypeID, 0 MarginCredit,
CASE WHEN ship.ShippingAdditional <= oref.ShippingAmount THEN ship.ShippingAdditional * -1 WHEN ship.ShippingAdditional > oref.ShippingAmount THEN oref.ShippingAmount * -1 ELSE 0 END AS Margin,
0 FlatRate, 0 Adjustment, 0 DM_Margin, 0 ShippingMargin
FROM tblOrderRefunds oref
INNER JOIN tblOrders o ON o.OrderID = oref.OrderID
INNER JOIN tmpOrderShipping ship ON o.OrderID = ship.OrderID
WHERE GREATEST(o.MarginEligible, oref.CreatedOn) >= @pFrom AND GREATEST(o.MarginEligible, oref.CreatedOn) < @pTo
  AND o.MarginEligible IS NOT NULL AND DATE(o.MarginEligible) > '1-1-1' AND o.OrderType = 'order'
GROUP BY oref.OrderID, MarginGroupID, RevenueTypeID;

DROP TEMPORARY TABLE IF EXISTS tmpSubCount;
CREATE TEMPORARY TABLE tmpSubCount(OrderID INT, INDEX (OrderID), RefundID INT, INDEX (RefundID), SubCount INT, INDEX (SubCount));
INSERT INTO tmpSubCount(OrderID, RefundID, SubCount)
SELECT t.OrderID, 0, SUM(op.Quantity) AS SubCnt
FROM tmpOrders t
INNER JOIN tblOrderParts op ON t.OrderID = op.OrderID
INNER JOIN tblParts p ON p.PartID = op.PartID
INNER JOIN tblPartService ps ON ps.PartID = op.PartID
WHERE p.NotASub = 0 AND p.ServiceRequired = 1
GROUP BY t.OrderID;

INSERT INTO tmpSubCount(OrderID, RefundID, SubCount)
SELECT oref.OrderID, oref.OrderRefundID, SUM(opef.Quantity)*-1 AS SubCnt
FROM tblOrderRefunds oref
INNER JOIN tblOrders o ON o.OrderID = oref.OrderID
INNER JOIN tblOrderPartRefunds opef ON opef.OrderRefundID = oref.OrderRefundID
INNER JOIN tblOrderParts op ON op.OrderPartID = opef.OrderPartID
INNER JOIN tblParts p ON p.PartID = op.PartID
INNER JOIN tblPartService ps ON ps.PartID = op.PartID
LEFT OUTER JOIN (
  SELECT pco.OrderID
  FROM tblOrderRefunds ordrr
  INNER JOIN tblOrders ordr ON ordr.OrderID = ordrr.OrderID
  INNER JOIN tblPaymentsCreditsOrders pco ON pco.OrderID = ordrr.OrderID
  INNER JOIN tblPaymentsCredits pc ON pco.PaymentCreditID = pc.PaymentCreditID
  WHERE pc.PaymentsCreditsTypeID = 1 AND pc.PaymentsCreditsStatusID = 3
    AND GREATEST(ordr.MarginEligible, ordrr.CreatedOn) >= @pFrom AND GREATEST(ordr.MarginEligible, ordrr.CreatedOn) < @pTo
    AND ordr.MarginEligible IS NOT NULL AND DATE(ordr.MarginEligible) > '1-1-1' AND ordr.OrderType = 'order'
  GROUP BY pco.OrderID
  HAVING SUM(pc.PaymentAmount) > 0
) t ON o.OrderID = t.OrderID
WHERE p.NotASub = 0
  AND GREATEST(o.MarginEligible, oref.CreatedOn) >= @pFrom AND GREATEST(o.MarginEligible, oref.CreatedOn) < @pTo
  AND o.MarginEligible IS NOT NULL AND DATE(o.MarginEligible) > '1-1-1' AND o.OrderType = 'order'
GROUP BY oref.OrderID, oref.OrderRefundID;

DROP TEMPORARY TABLE IF EXISTS tmpMissingOrders;
CREATE TEMPORARY TABLE tmpMissingOrders(OrderID INT, INDEX (OrderID));
INSERT INTO tmpMissingOrders(OrderID)
SELECT t.OrderID
FROM tmpOrders t
LEFT OUTER JOIN tmpOrderMargin t2 ON t2.OrderID = t.OrderID AND t2.RefundID = 0 AND t2.MarginGroupID = 1
WHERE t2.OrderID IS NULL;

INSERT INTO tmpOrderMargin(OrderID, RefundID, MarginGroupID, RevenueTypeID, MarginCredit, Margin, FlatRate, Adjustment, DM_Margin)
SELECT OrderID, 0, 1, 0, 0, 0, 0, 0, 0 FROM tmpMissingOrders;

INSERT INTO tmpOrderMargin(OrderID, RefundID, MarginGroupID, RevenueTypeID, MarginCredit, Margin, FlatRate, Adjustment, DM_Margin)
SELECT t.OrderID, 0, 0, 0, 0, 0, 0, 0, 0 FROM tmpOrders t;

INSERT INTO tmpRefundsOutsideOfMonth(OrderID, RefundID)
SELECT t.OrderID, t.RefundID FROM tmpSubCount t
LEFT OUTER JOIN tmpOrderMargin om ON om.OrderID = t.OrderID AND om.RefundID = t.RefundID AND om.MarginGroupID = 0
WHERE om.OrderID IS NULL;

INSERT INTO tmpOrderMargin(OrderID, RefundID, MarginGroupID, RevenueTypeID, MarginCredit, Margin, FlatRate, Adjustment, DM_Margin)
SELECT t.OrderID, t.RefundID, 0, 0, 0, 0, 0, 0, 0 FROM tmpRefundsOutsideOfMonth t;

DROP TEMPORARY TABLE IF EXISTS tmpSubOnlyOrders;
CREATE TEMPORARY TABLE tmpSubOnlyOrders(OrderID INT, INDEX (OrderID));
INSERT INTO tmpSubOnlyOrders(OrderID)
SELECT o.OrderID
FROM tblOrders o
INNER JOIN tmpOrders t ON t.OrderID = o.OrderID
INNER JOIN tblOrderParts op ON o.OrderID = op.OrderID
LEFT OUTER JOIN (
  SELECT PartID FROM tblParts
  WHERE (ServiceRequired = 1 AND NotASub = 0)
     OR PartName LIKE '%Fee'
     OR PartName LIKE '%Customer Owned%'
     OR PartName LIKE '%Customer-Owned%'
) AS p ON p.PartID = op.PartID
GROUP BY o.OrderID
HAVING SUM(CASE WHEN p.PartID IS NULL THEN 0 ELSE 1 END) = COUNT(*);

DROP TEMPORARY TABLE IF EXISTS tmpLaborRadio;
CREATE TEMPORARY TABLE tmpLaborRadio(OrderID INT, INDEX (OrderID), Labor INT, Radio INT);
INSERT INTO tmpLaborRadio(OrderID, Labor, Radio)
SELECT o.OrderID, COUNT(pLabor.PartID) AS Labor, COUNT(pRadio.PartID) AS Radio
FROM tmpOrders o
LEFT OUTER JOIN tblOrderParts op ON op.OrderID = o.OrderID
LEFT OUTER JOIN tblParts pLabor ON op.PartID = pLabor.PartID AND pLabor.DMModelNumber IN('PROFIN', 'PRO-INSTALL')
LEFT OUTER JOIN tblParts pRadio ON op.PartID = pRadio.PartID AND pRadio.RadioRequired = 1 AND pRadio.Shippable = 1
GROUP BY o.OrderID
HAVING COUNT(pLabor.PartID) > 0 OR COUNT(pRadio.PartID) > 0;

DROP TEMPORARY TABLE IF EXISTS tmpAllOrders;
CREATE TEMPORARY TABLE tmpAllOrders(OrderID INT, INDEX (OrderID), RefundID INT, INDEX (RefundID));
INSERT INTO tmpAllOrders SELECT DISTINCT m.OrderID, m.RefundID FROM tmpOrderMargin m;

DROP TEMPORARY TABLE IF EXISTS tmpPMG;
CREATE TEMPORARY TABLE tmpPMG(OrderID INT, INDEX (OrderID), RefundID INT, INDEX (RefundID), Margin DECIMAL(10, 2), ShippingMargin DECIMAL(10, 2), Adjustment DECIMAL(10,2));
INSERT INTO tmpPMG SELECT p.OrderID, p.RefundID, p.Margin, p.ShippingMargin, p.Adjustment FROM tmpOrderMargin p WHERE p.MarginGroupID = 1 AND p.RevenueTypeID = 1;

DROP TEMPORARY TABLE IF EXISTS tmpIMG;
CREATE TEMPORARY TABLE tmpIMG(OrderID INT, INDEX (OrderID), RefundID INT, INDEX (RefundID), Margin DECIMAL(10, 2), Adjustment DECIMAL(10,2));
INSERT INTO tmpIMG SELECT i.OrderID, i.RefundID, i.Margin, i.Adjustment FROM tmpOrderMargin i WHERE i.MarginGroupID = 1 AND i.RevenueTypeID = 2;

DROP TEMPORARY TABLE IF EXISTS tmpWMG;
CREATE TEMPORARY TABLE tmpWMG(OrderID INT, INDEX (OrderID), RefundID INT, INDEX (RefundID), Margin DECIMAL(10, 2), Adjustment DECIMAL(10,2));
INSERT INTO tmpWMG SELECT w.OrderID, w.RefundID, w.Margin, w.Adjustment FROM tmpOrderMargin w WHERE w.MarginGroupID = 2 AND w.RevenueTypeID = 7;

DROP TEMPORARY TABLE IF EXISTS tmpShpMG;
CREATE TEMPORARY TABLE tmpShpMG(OrderID INT, INDEX (OrderID), RefundID INT, INDEX (RefundID), Margin DECIMAL(10, 2), Adjustment DECIMAL(10,2));
INSERT INTO tmpShpMG SELECT s.OrderID, s.RefundID, s.Margin, s.Adjustment FROM tmpOrderMargin s WHERE s.MarginGroupID = 0 AND s.RevenueTypeID = 11;

DROP TEMPORARY TABLE IF EXISTS tmpPMAdj;
CREATE TEMPORARY TABLE tmpPMAdj(OrderID INT, INDEX (OrderID), MarginGroupID INT, INDEX (MarginGroupID), RevenueTypeID INT, MarginYrMo VARCHAR(8), INDEX (RevenueTypeID), Adjustment DECIMAL(10,2));
INSERT INTO tmpPMAdj(OrderID, MarginGroupID, RevenueTypeID, MarginYrMo, Adjustment)
SELECT p.OrderID, p.MarginGroupID, p.RevenueTypeID, p.MarginYrMo, p.Adjustment FROM tmpOrderMarginAdjustment p WHERE p.MarginGroupID = 1 AND p.RevenueTypeID = 1;

DROP TEMPORARY TABLE IF EXISTS tmpIMAdj;
CREATE TEMPORARY TABLE tmpIMAdj(OrderID INT, INDEX (OrderID), MarginGroupID INT, INDEX (MarginGroupID), RevenueTypeID INT, MarginYrMo VARCHAR(8), INDEX (RevenueTypeID), Adjustment DECIMAL(10,2));
INSERT INTO tmpIMAdj(OrderID, MarginGroupID, RevenueTypeID, MarginYrMo, Adjustment)
SELECT i.OrderID, i.MarginGroupID, i.RevenueTypeID, i.MarginYrMo, i.Adjustment FROM tmpOrderMarginAdjustment i WHERE i.MarginGroupID = 1 AND i.RevenueTypeID = 2;

DROP TEMPORARY TABLE IF EXISTS tmpWMAdj;
CREATE TEMPORARY TABLE tmpWMAdj(OrderID INT, INDEX (OrderID), MarginGroupID INT, INDEX (MarginGroupID), RevenueTypeID INT, MarginYrMo VARCHAR(8), INDEX (RevenueTypeID), Adjustment DECIMAL(10,2));
INSERT INTO tmpWMAdj(OrderID, MarginGroupID, RevenueTypeID, MarginYrMo, Adjustment)
SELECT w.OrderID, w.MarginGroupID, w.RevenueTypeID, w.MarginYrMo, w.Adjustment FROM tmpOrderMarginAdjustment w WHERE w.MarginGroupID = 2 AND w.RevenueTypeID = 7;

DROP TEMPORARY TABLE IF EXISTS tmpShpMAdj;
CREATE TEMPORARY TABLE tmpShpMAdj(OrderID INT, INDEX (OrderID), MarginGroupID INT, INDEX (MarginGroupID), RevenueTypeID INT, MarginYrMo VARCHAR(8), INDEX (RevenueTypeID), Adjustment DECIMAL(10,2));
INSERT INTO tmpShpMAdj(OrderID, MarginGroupID, RevenueTypeID, MarginYrMo, Adjustment)
SELECT s.OrderID, s.MarginGroupID, s.RevenueTypeID, s.MarginYrMo, s.Adjustment FROM tmpOrderMarginAdjustment s WHERE s.MarginGroupID = 0 AND s.RevenueTypeID = 11;

-- Exactly one carrier row per (OrderID, MarginYrMo) to receive that order-month's
-- adjustment, so a same-month refund never multiplies it. MIN(RefundID) picks the
-- deal row (RefundID 0) when present, else the lowest-numbered refund row in the
-- month. (MySQL 5.7 source has no window functions, hence the temp table.)
DROP TEMPORARY TABLE IF EXISTS tmpAdjCarrier;
CREATE TEMPORARY TABLE tmpAdjCarrier(OrderID INT, INDEX (OrderID), MarginYrMo VARCHAR(8), INDEX (MarginYrMo), RefundID INT, INDEX (RefundID));
INSERT INTO tmpAdjCarrier(OrderID, MarginYrMo, RefundID)
SELECT om.OrderID,
  DATE_FORMAT(GREATEST(o.MarginEligible, IFNULL(oref.CreatedOn, '1-1-1')), '%Y-%m') MarginYrMo,
  MIN(om.RefundID) RefundID
FROM tmpAllOrders om
INNER JOIN tblOrders o ON o.OrderID = om.OrderID
LEFT JOIN tblOrderRefunds oref ON om.OrderID = oref.OrderID AND om.RefundID = oref.OrderRefundID
GROUP BY om.OrderID, DATE_FORMAT(GREATEST(o.MarginEligible, IFNULL(oref.CreatedOn, '1-1-1')), '%Y-%m');

SELECT
  sm.OrderID                                                       AS order_id,
  sm.RefundID                                                      AS refund_id,
  sm.OrderType                                                     AS order_type,
  sm.OrderDate                                                     AS order_date,
  sm.MarginEligible                                                AS margin_eligible_date,
  sm.SalesPersonID                                                 AS salesperson_id,
  sm.OrderSalesPersonName                                          AS salesperson_name,
  sm.email                                                         AS email,
  sm.DeptID                                                        AS dept_id,
  sm.CustomerID                                                    AS customer_id,
  sm.CustomerName                                                  AS customer_name,
  sm.LeadSource                                                    AS lead_source,
  -- Adjustments are at (OrderID, MarginYrMo) grain but join to every order/refund
  -- row in that month; gate on the carrier row (ac) so each adjustment is added
  -- exactly once (never multiplied across an order's same-month refund rows).
  (IFNULL(sm.ProductMargin, 0)  + CASE WHEN ac.OrderID IS NOT NULL THEN IFNULL(pa.Adjustment, 0) ELSE 0 END)  AS product_margin,
  (IFNULL(sm.InstallMargin, 0)  + CASE WHEN ac.OrderID IS NOT NULL THEN IFNULL(ia.Adjustment, 0) ELSE 0 END)  AS install_margin,
  (IFNULL(sm.ShippingMargin, 0) + CASE WHEN ac.OrderID IS NOT NULL THEN IFNULL(sa.Adjustment, 0) ELSE 0 END)  AS shipping_margin,
  (IFNULL(sm.Warranty, 0)       + CASE WHEN ac.OrderID IS NOT NULL THEN IFNULL(wa.Adjustment, 0) ELSE 0 END)  AS warranty_margin,
  (IFNULL(sm.Margin, 0) + CASE WHEN ac.OrderID IS NOT NULL
        THEN IFNULL(pa.Adjustment, 0) + IFNULL(ia.Adjustment, 0) + IFNULL(sa.Adjustment, 0) + IFNULL(wa.Adjustment, 0)
        ELSE 0 END) AS total_margin,
  sm.OrderSubCount                                                 AS order_sub_count,
  CASE WHEN sm.SubOnly = 1 THEN sm.OrderSubCount ELSE 0 END        AS order_sub_count_sub_only,
  sm.SubOnly                                                       AS sub_only,
  sm.WithLabor                                                     AS with_labor,
  sm.WithRadio                                                     AS with_radio
FROM (
  SELECT
    o.OrderID,
    IFNULL(om.RefundID, 0) RefundID,
    CASE WHEN IFNULL(om.RefundID, 0) > 0 THEN 'Return' ELSE 'Order' END OrderType,
    CASE WHEN IFNULL(om.RefundID, 0) > 0 THEN oref.CreatedOn ELSE o.OrderDate END OrderDate,
    GREATEST(o.MarginEligible, IFNULL(oref.CreatedOn, '1-1-1')) MarginEligible,
    DATE_FORMAT(GREATEST(o.MarginEligible, IFNULL(oref.CreatedOn, '1-1-1')), '%Y-%m') MarginYrMo,
    c.CustomerID, c.Name CustomerName,
    pm.Margin ProductMargin,
    IFNULL(im.Margin, 0) AS InstallMargin,
    IFNULL(shpm.Margin, 0) AS ShippingMargin,
    (IFNULL(pm.Margin, 0) + IFNULL(im.Margin, 0) + IFNULL(shpm.Margin, 0) + IFNULL(wm.Margin, 0)) AS Margin,
    IFNULL(wm.Margin, 0) Warranty,
    IFNULL(sc.SubCount, 0) OrderSubCount,
    sp.SalesPersonID, sp.SalesPersonName OrderSalesPersonName, sp.email, sp.DeptID,
    ls.LeadSource,
    CASE WHEN soo.OrderID IS NULL THEN 0 ELSE 1 END AS SubOnly,
    IFNULL(CASE om.RefundID WHEN 0 THEN CASE IFNULL(lr.Labor, 0) WHEN 0 THEN 0 ELSE 1 END END, 0) AS WithLabor,
    IFNULL(CASE om.RefundID WHEN 0 THEN CASE IFNULL(lr.Radio, 0) WHEN 0 THEN 0 ELSE 1 END END, 0) AS WithRadio
  FROM tmpAllOrders om
  INNER JOIN tblOrders o ON o.OrderID = om.OrderID
  INNER JOIN tblSalesPeople sp ON o.SalespersonID = sp.SalesPersonID
  INNER JOIN tblBillingGroups bg ON o.BillingGroupID = bg.BillingGroupID
  INNER JOIN tblCustomers c ON o.CustomerID = c.CustomerID
  LEFT JOIN tmpPMG pm ON om.OrderID = pm.OrderID AND om.RefundID = pm.RefundID
  LEFT JOIN tmpIMG im ON om.OrderID = im.OrderID AND om.RefundID = im.RefundID
  LEFT JOIN tmpShpMG shpm ON om.OrderID = shpm.OrderID AND om.RefundID = shpm.RefundID
  LEFT JOIN tmpWMG wm ON om.OrderID = wm.OrderID AND om.RefundID = wm.RefundID
  LEFT JOIN tblLeadSources ls ON o.LeadSourceID = ls.LeadSourceID AND ls.LeadSourceID > 0
  -- Sub count attaches directly to the (order, refund) row. tmpSubCount holds exactly
  -- one row per order (deal, RefundID 0) and one per refund, so a direct join counts
  -- each once. (The proc routes this through its MarginGroupID=0 service row; we keep
  -- the grain denormalized to one fact row per order/refund, so a refund whose only
  -- MarginGroupID=0 row is a shipping-refund row would otherwise lose its sub.)
  LEFT JOIN tmpSubCount sc ON sc.OrderID = om.OrderID AND sc.RefundID = om.RefundID
  LEFT JOIN tmpSubOnlyOrders soo ON soo.OrderID = om.OrderID
  LEFT JOIN tmpLaborRadio lr ON lr.OrderID = om.OrderID
  LEFT JOIN tblOrderRefunds oref ON om.OrderID = oref.OrderID AND om.RefundID = oref.OrderRefundID
) sm
LEFT JOIN tmpAdjCarrier ac ON ac.OrderID = sm.OrderID AND ac.MarginYrMo = sm.MarginYrMo AND ac.RefundID = sm.RefundID
LEFT JOIN tmpPMAdj pa  ON sm.OrderID = pa.OrderID AND sm.MarginYrMo = pa.MarginYrMo
LEFT JOIN tmpIMAdj ia  ON sm.OrderID = ia.OrderID AND sm.MarginYrMo = ia.MarginYrMo
LEFT JOIN tmpShpMAdj sa ON sm.OrderID = sa.OrderID AND sm.MarginYrMo = sa.MarginYrMo
LEFT JOIN tmpWMAdj wa  ON sm.OrderID = wa.OrderID AND sm.MarginYrMo = wa.MarginYrMo

-- Saves (tblSaves): rep-logged subscription adjustments with no order, dated by
-- SavedOn. The authoritative "Margin Report - By Month" adds these to each rep's
-- "Sub #", so they are emitted here as synthetic rows: order_id = 0 and a -1
-- refund_id sentinel so they never count as a deal (refund_id = 0) or a return
-- (refund_id > 0), carry zero margin, and only contribute order_sub_count. One row
-- per save record so each conforms to its own SavedOn date_key.
UNION ALL
SELECT
  0                                                                AS order_id,
  -1                                                               AS refund_id,
  'Save'                                                           AS order_type,
  sv.SavedOn                                                       AS order_date,
  sv.SavedOn                                                       AS margin_eligible_date,
  sp.SalesPersonID                                                 AS salesperson_id,
  sp.SalesPersonName                                               AS salesperson_name,
  sp.email                                                         AS email,
  sp.DeptID                                                        AS dept_id,
  0                                                                AS customer_id,
  NULL                                                             AS customer_name,
  NULL                                                             AS lead_source,
  0                                                                AS product_margin,
  0                                                                AS install_margin,
  0                                                                AS shipping_margin,
  0                                                                AS warranty_margin,
  0                                                                AS total_margin,
  sv.SubscriptionCount                                             AS order_sub_count,
  0                                                                AS order_sub_count_sub_only,
  0                                                                AS sub_only,
  0                                                                AS with_labor,
  0                                                                AS with_radio
FROM tblSaves sv
INNER JOIN tblSalesPeople sp ON sp.SalesPersonID = sv.SalesPersonID
WHERE sv.SavedOn >= @pFrom AND sv.SavedOn < @pTo;
