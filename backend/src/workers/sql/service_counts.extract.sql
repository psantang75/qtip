/* Service Counts extract (source pool: crm). Set-based port of
   dmcms_prod.sp_ReportServiceCountsByMonthByProviderByZoneType — the same
   procedure behind the "ServiceCountsByProvider" Excel workbook.

   Faithful to the proc except:
     - The month scaffold that the proc built with a WHILE loop is created with a
       recursive CTE (extract SQL runs as plain statements, not a routine).
     - The final SELECT collapses ZoneType (as the proc's final SELECT does),
       maps each canonical provider bucket to a report segment_key, emits the
       9 buckets that carry data, and adds month_date so staging can partition.
     - Sonos Platform (ProviderID 12) is INCLUDED here as its own `sonos` bucket
       (the proc excludes it). It is mapped as the FIRST CASE branch so its parts —
       which carry ZoneType=3 — cannot fall into the MOH/ISP (10) bucket; every
       other bucket is therefore byte-for-byte identical to the proc's output.

   Full-history, deterministic — no :pFromDate/:pToDate binding here; the window
   lives in the transform (FULL_RELOAD_WINDOW spanning all months). Runs on ONE
   connection (temp tables are connection-scoped); the last SELECT feeds staging. */

DROP TEMPORARY TABLE IF EXISTS tmpMonths;

CREATE TEMPORARY TABLE tmpMonths (YearMonth VARCHAR(6));

INSERT INTO tmpMonths (YearMonth)
SELECT DATE_FORMAT(NOW() - INTERVAL seqs.seq MONTH, '%Y%m') AS YearMonth
FROM (
  SELECT ones.n + tens.n * 10 + huns.n * 100 AS seq
  FROM (SELECT 0 n UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9) ones
  CROSS JOIN (SELECT 0 n UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9) tens
  CROSS JOIN (SELECT 0 n UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3) huns
) seqs
WHERE DATE_FORMAT(NOW() - INTERVAL seqs.seq MONTH, '%Y%m') >= '200608';

DROP TEMPORARY TABLE IF EXISTS tmpServices;

CREATE TEMPORARY TABLE tmpServices(ProviderID INT, ZoneType INT, YearMonth VARCHAR(6), Started INT, Stopped INT, ActiveServiceTotal INT, Reactivated INT) DEFAULT COLLATE = utf8_general_ci;

INSERT INTO tmpServices(ProviderID, ZoneType, YearMonth)
SELECT pr.ProviderID, z.zt, mm.YearMonth
FROM tmpMonths mm
CROSS JOIN tblProviders pr
CROSS JOIN (SELECT 0 AS zt UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3) z
WHERE pr.ProviderID NOT IN (5, 13, 15);

UPDATE tmpServices SET ActiveServiceTotal = 0;

UPDATE tmpServices tmp
INNER JOIN (
  SELECT
    IFNULL(CASE
      WHEN pr.ProviderID = 12 THEN 12
      WHEN p.PartTypeID = 5 THEN 9
      WHEN ps.ZoneType = 3 AND p.DiscountItem = false THEN 10
      WHEN pr.ProviderID = 2 THEN 1
      WHEN pr.ProviderID = 5 THEN 8
      WHEN pr.ProviderID = 4 THEN 8
      ELSE pr.ProviderID END, 8) AS ProviderID,
    IFNULL(ps.ZoneType, 0) AS ZoneType,
    DATE_FORMAT(srv.ServiceEndDate, '%Y%m') AS YearMonth,
    COUNT(DISTINCT srv.RadioID) AS Stopped
  FROM tblService srv
  INNER JOIN tblOrderParts op ON srv.OrderPartID = op.OrderPartID AND op.PartID != 194
  INNER JOIN tblParts p ON p.PartID = op.PartID AND p.DiscountItem = 0 AND DMModelNumber NOT LIKE '%RENT%'
  LEFT JOIN tblPartService ps ON ps.PartID = op.PartID
  LEFT JOIN tblProviders pr ON pr.ProviderID = ps.ProviderID
  WHERE srv.ServiceEndDate > '1-1-2' AND ps.ProviderID NOT IN (5, 13, 15)
  GROUP BY IFNULL(CASE
      WHEN pr.ProviderID = 12 THEN 12
      WHEN p.PartTypeID = 5 THEN 9
      WHEN ps.ZoneType = 3 AND p.DiscountItem = 0 THEN 10
      WHEN pr.ProviderID = 2 THEN 1
      WHEN pr.ProviderID = 5 THEN 8
      WHEN pr.ProviderID = 4 THEN 8
      ELSE pr.ProviderID END, 8), IFNULL(ps.ZoneType, 0), DATE_FORMAT(srv.ServiceEndDate, '%Y%m')
) grp ON grp.YearMonth = tmp.YearMonth AND grp.ProviderID = tmp.ProviderID AND grp.ZoneType = tmp.ZoneType
SET tmp.Stopped = grp.Stopped;

UPDATE tmpServices SET Stopped = 0 WHERE Stopped IS NULL;

UPDATE tmpServices tmp
INNER JOIN (
  SELECT
    IFNULL(CASE
      WHEN pr.ProviderID = 12 THEN 12
      WHEN p.PartTypeID = 5 THEN 9
      WHEN ps.ZoneType = 3 AND p.DiscountItem = false THEN 10
      WHEN pr.ProviderID = 2 THEN 1
      WHEN pr.ProviderID = 5 THEN 8
      WHEN pr.ProviderID = 4 THEN 8
      ELSE pr.ProviderID END, 8) AS ProviderID,
    IFNULL(ps.ZoneType, 0) AS ZoneType,
    DATE_FORMAT(srv.ServiceStartDate, '%Y%m') AS YearMonth,
    COUNT(DISTINCT srv.RadioID) AS Started
  FROM tblService srv
  INNER JOIN tblOrderParts op ON srv.OrderPartID = op.OrderPartID AND op.PartID != 194
  INNER JOIN tblParts p ON p.PartID = op.PartID AND p.DiscountItem != true AND DMModelNumber NOT LIKE '%RENT%'
  LEFT JOIN tblPartService ps ON ps.PartID = op.PartID
  LEFT JOIN tblProviders pr ON pr.ProviderID = ps.ProviderID
  WHERE srv.ServiceStartDate > '1-1-2' AND ps.ProviderID NOT IN (5, 13, 15)
  GROUP BY IFNULL(CASE
      WHEN pr.ProviderID = 12 THEN 12
      WHEN p.PartTypeID = 5 THEN 9
      WHEN ps.ZoneType = 3 AND p.DiscountItem = false THEN 10
      WHEN pr.ProviderID = 2 THEN 1
      WHEN pr.ProviderID = 5 THEN 8
      WHEN pr.ProviderID = 4 THEN 8
      ELSE pr.ProviderID END, 8), IFNULL(ps.ZoneType, 0), DATE_FORMAT(srv.ServiceStartDate, '%Y%m')
) grp ON grp.YearMonth = tmp.YearMonth AND grp.ProviderID = tmp.ProviderID AND grp.ZoneType = tmp.ZoneType
SET tmp.Started = grp.Started;

UPDATE tmpServices SET Started = 0 WHERE Started IS NULL;

UPDATE tmpServices tmp
INNER JOIN (
  SELECT
    IFNULL(CASE
      WHEN pr.ProviderID = 12 THEN 12
      WHEN p.PartTypeID = 5 THEN 9
      WHEN ps.ZoneType = 3 AND p.DiscountItem = false THEN 10
      WHEN pr.ProviderID = 2 THEN 1
      WHEN pr.ProviderID = 5 THEN 8
      WHEN pr.ProviderID = 4 THEN 8
      ELSE pr.ProviderID END, 8) AS ProviderID,
    IFNULL(ps.ZoneType, 0) AS ZoneType,
    DATE_FORMAT(srv.ServiceEndDate, '%Y%m') AS YearMonth,
    COUNT(DISTINCT srvAct.RadioID) AS Reactivated
  FROM tblService srv
  LEFT JOIN tblServiceTermination srvt ON srvt.ServiceID = srv.ServiceID
  LEFT JOIN tblServiceTermReason srvtr ON srvtr.TerminationReasonID = srvt.TerminationReasonID
  INNER JOIN tblOrderParts op ON srv.OrderPartID = op.OrderPartID AND op.PartID != 194
  INNER JOIN tblParts p ON p.PartID = op.PartID AND p.DiscountItem = 0 AND DMModelNumber NOT LIKE '%RENT%'
  LEFT JOIN tblPartService ps ON ps.PartID = op.PartID
  LEFT JOIN tblProviders pr ON pr.ProviderID = ps.ProviderID
  INNER JOIN (
    SELECT DISTINCT s.RadioID, s.ServiceStartDate, ps.ProviderId
    FROM tblService s
    INNER JOIN tblOrderParts op ON s.OrderPartID = op.OrderPartID AND op.PartID != 194
    INNER JOIN tblParts p ON p.PartID = op.PartID AND p.DiscountItem != true AND DMModelNumber NOT LIKE '%RENT%'
    LEFT JOIN tblPartService ps ON p.PartID = ps.PartID
    WHERE (s.ServiceStartDate > '1-1-1') AND ps.ProviderID NOT IN (5, 13, 15)
  ) AS srvAct ON srvAct.RadioID = srv.RadioID AND srv.ServiceEndDate <= srvAct.ServiceStartDate AND srvAct.ProviderId = pr.ProviderId
  WHERE srv.ServiceEndDate > '1-1-2' AND ps.ProviderID NOT IN (5, 13, 15) AND IFNULL(srvtr.TerminationReasonID, 0) <> 7 AND srvtr.TerminationReasonID IS NOT NULL
  GROUP BY IFNULL(CASE
      WHEN pr.ProviderID = 12 THEN 12
      WHEN p.PartTypeID = 5 THEN 9
      WHEN ps.ZoneType = 3 AND p.DiscountItem = 0 THEN 10
      WHEN pr.ProviderID = 2 THEN 1
      WHEN pr.ProviderID = 5 THEN 8
      WHEN pr.ProviderID = 4 THEN 8
      ELSE pr.ProviderID END, 8), IFNULL(ps.ZoneType, 0), DATE_FORMAT(srv.ServiceEndDate, '%Y%m')
) grp ON grp.YearMonth = tmp.YearMonth AND grp.ProviderID = tmp.ProviderID AND grp.ZoneType = tmp.ZoneType
SET tmp.Reactivated = grp.Reactivated;

UPDATE tmpServices SET Reactivated = 0 WHERE Reactivated IS NULL;

DROP TEMPORARY TABLE IF EXISTS tmpServiceYM;

CREATE TEMPORARY TABLE tmpServiceYM AS SELECT DISTINCT YearMonth FROM tmpServices;

UPDATE tmpServices tmp
INNER JOIN (
  SELECT srvd.YearMonth, IFNULL(CASE
      WHEN pr.ProviderID = 12 THEN 12
      WHEN p.PartTypeID = 5 THEN 9
      WHEN ps.ZoneType = 3 AND p.DiscountItem = false THEN 10
      WHEN pr.ProviderID = 2 THEN 1
      WHEN pr.ProviderID = 5 THEN 8
      WHEN pr.ProviderID = 4 THEN 8
      ELSE pr.ProviderID END, 8) AS ProviderID,
    IFNULL(ps.ZoneType, 0) AS ZoneType, COUNT(DISTINCT srv.RadioID) AS ActiveServiceTotal
  FROM tmpServiceYM srvd
  INNER JOIN tblService srv ON
       (DATE_FORMAT(srv.ServiceStartDate, '%Y%m') <= srvd.YearMonth AND DATE_FORMAT(srv.ServiceStartDate, '%Y%m') > 000102)
   AND (DATE_FORMAT(srv.ServiceEndDate, '%Y%m') > srvd.YearMonth OR DATE_FORMAT(srv.ServiceEndDate, '%Y%m') = 000101)
   AND DATE_FORMAT(srv.ServiceStartDate, '%Y%m') <> DATE_FORMAT(srv.ServiceEndDate, '%Y%m')
  INNER JOIN tblOrderParts op ON srv.OrderPartID = op.OrderPartID AND op.PartID != 194
  INNER JOIN tblParts p ON p.PartID = op.PartID AND p.DiscountItem != true AND DMModelNumber NOT LIKE '%RENT%'
  LEFT JOIN tblPartService ps ON ps.PartID = op.PartID
  LEFT JOIN tblProviders pr ON pr.ProviderID = IFNULL(ps.ProviderID, 8)
  WHERE ps.ProviderID NOT IN (5, 13, 15)
  GROUP BY srvd.YearMonth, IFNULL(CASE
      WHEN pr.ProviderID = 12 THEN 12
      WHEN p.PartTypeID = 5 THEN 9
      WHEN ps.ZoneType = 3 AND p.DiscountItem = false THEN 10
      WHEN pr.ProviderID = 2 THEN 1
      WHEN pr.ProviderID = 5 THEN 8
      WHEN pr.ProviderID = 4 THEN 8
      ELSE pr.ProviderID END, 8), IFNULL(ps.ZoneType, 0)
) grp ON grp.YearMonth = tmp.YearMonth AND grp.ProviderID = tmp.ProviderID AND grp.ZoneType = tmp.ZoneType
SET tmp.ActiveServiceTotal = grp.ActiveServiceTotal;

DROP TEMPORARY TABLE IF EXISTS tmpReactCountAdj;

CREATE TEMPORARY TABLE tmpReactCountAdj AS
SELECT DATE_FORMAT(termc.ServiceEndDate, '%Y%m') AS YearMonth, termc.ProviderID, termc.ZoneType, COUNT(DISTINCT termc.RadioID) Reactivated
FROM (
  SELECT
    srv.ServiceEndDate,
    IFNULL(CASE
      WHEN pr.ProviderID = 12 THEN 12
      WHEN p.PartTypeID = 5 THEN 9
      WHEN ps.ZoneType = 3 AND p.DiscountItem = false THEN 10
      WHEN pr.ProviderID = 2 THEN 1
      WHEN pr.ProviderID = 5 THEN 8
      WHEN pr.ProviderID = 4 THEN 8
      ELSE pr.ProviderID END, 8) AS ProviderID,
    IFNULL(ps.ZoneType, 0) AS ZoneType,
    CASE
      WHEN srvtr.TerminationReasonText IS NULL AND srv.ServiceStatus = 'Box Swapped' THEN 'Box Swap'
      ELSE srvtr.TerminationReasonText
    END TerminationReasonText, srvtr.TerminationReasonID, srv.RadioID
  FROM tblService srv
  LEFT JOIN tblServiceTermination srvt ON srvt.ServiceID = srv.ServiceID
  LEFT JOIN tblServiceTermReason srvtr ON srvtr.TerminationReasonID = srvt.TerminationReasonID
  INNER JOIN tblOrderParts op ON srv.OrderPartID = op.OrderPartID
  INNER JOIN tblParts p ON p.PartID = op.PartID AND p.DiscountItem != true AND DMModelNumber NOT LIKE '%RENT%'
  LEFT JOIN tblPartService ps ON ps.PartID = op.PartID
  LEFT JOIN tblProviders pr ON pr.ProviderID = IFNULL(ps.ProviderID, 8)
  WHERE DATE_FORMAT(srv.ServiceEndDate, '%Y%m') >= DATE_FORMAT(NOW() - INTERVAL 120 MONTH, '%Y%m')
    AND ps.ProviderID NOT IN (5, 13, 15) AND (srvtr.TerminationReasonID = 7 OR srvtr.TerminationReasonID IS NULL)
) termc
WHERE IFNULL(termc.TerminationReasonText, '') <> ''
GROUP BY DATE_FORMAT(termc.ServiceEndDate, '%Y%m'), termc.ProviderID, termc.ZoneType;

UPDATE tmpServices tmp
INNER JOIN tmpReactCountAdj rca ON tmp.YearMonth = rca.YearMonth AND tmp.ProviderID = rca.ProviderID AND tmp.ZoneType = rca.ZoneType
SET tmp.Reactivated = (tmp.Reactivated + rca.Reactivated);

SELECT
  STR_TO_DATE(CONCAT(t.YearMonth, '01'), '%Y%m%d') AS month_date,
  t.YearMonth AS `year_month`,
  t.ProviderID AS provider_bucket_id,
  CASE t.ProviderID
    WHEN 1 THEN 'sxm_satellite'
    WHEN 7 THEN 'sxm_internet'
    WHEN 11 THEN 'syb'
    WHEN 10 THEN 'moh'
    WHEN 3 THEN 'playnetwork'
    WHEN 6 THEN 'dmx'
    WHEN 9 THEN 'warranty'
    WHEN 8 THEN 'unknown'
    WHEN 12 THEN 'sonos'
  END AS segment_key,
  SUM(IFNULL(t.Started, 0)) AS started,
  SUM(IFNULL(t.Stopped, 0)) AS stopped,
  SUM(IFNULL(t.ActiveServiceTotal, 0)) AS active_total,
  SUM(IFNULL(t.Reactivated, 0)) AS reactivated
FROM tmpServices t
WHERE t.ProviderID IN (1, 3, 6, 7, 8, 9, 10, 11, 12)
GROUP BY t.YearMonth, t.ProviderID
ORDER BY t.YearMonth, t.ProviderID;
