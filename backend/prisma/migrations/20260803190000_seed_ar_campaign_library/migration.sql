-- ─────────────────────────────────────────────────────────────────────────────
-- Seed: the AR call-campaign library, reconstructed from the "August AR
-- Calendar" spreadsheet, plus the Customer Service "AR Calendar" schedule.
--
-- MODEL
--   Each COLUMN of the spreadsheet becomes a campaign_category (with a color).
--   Each CELL becomes a campaign_item whose anchor rule reproduces the day it
--   falls on. Reference month is August 2026, which has 21 business days:
--     BD  1..5  = Aug 3,4,5,6,7      BD 11..15 = Aug 17,18,19,20,21
--     BD  6..10 = Aug 10,11,12,13,14 BD 16..21 = Aug 24,25,26,27,28,31
--
-- ANCHORS
--   BD_FROM_START        — a fixed Nth business day (the dunning cycle starts).
--   RELATIVE_TO_CAMPAIGN — the follow-up steps of a dunning sequence (+1 BD each)
--                          and the prior-month expiring-CC pass (same day, +0),
--                          so moving the first call drags the whole chain.
--   BD_FROM_END offset 1 — the month-end tasks, so they always land on the last
--                          business day regardless of month length.
--
-- KNOWN LIMITATION: the five "Term'd for Nonpay" passes fall on Fridays in the
-- source calendar (plus one extra mid-week pass). There is no weekly anchor type
-- yet, so they are pinned to the business days they occupy in August (5, 10, 15,
-- 17, 20). In months whose Fridays land on different business-day indexes these
-- will need a nudge in the day popover, or a future WEEKLY anchor type.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Categories (one per spreadsheet column, left to right) ───────────────────
INSERT IGNORE INTO `campaign_category` (`name`, `color`, `sort_order`) VALUES
  ('Declined CC 1-15',             '#00aeef', 10),
  ('Declined CC 16-31',            '#2980b9', 20),
  ('Declined ACH 1-15',            '#1abc9c', 30),
  ('Declined ACH 16-31',           '#16a085', 40),
  ('Check Termed',                 '#e74c3c', 50),
  ('Check Customer',               '#f39c12', 60),
  ('Expiring CC - Current Month',  '#8e44ad', 70),
  ('Expiring CC - Prior Month',    '#d35400', 80);

-- ─────────────────────────────────────────────────────────────────────────────
-- PASS 1 — items with an absolute anchor. These are the chain heads, so they
-- must exist before the RELATIVE items in pass 2 can point at them.
-- ─────────────────────────────────────────────────────────────────────────────

-- Declined CC 1-15 -----------------------------------------------------------
INSERT INTO `campaign_item` (`category_id`,`label`,`anchor_type`,`anchor_offset`,`not_on_friday`,`sort_order`)
SELECT c.id,'Declined CC #1','BD_FROM_START',1,FALSE,10 FROM `campaign_category` c
WHERE c.name='Declined CC 1-15' AND NOT EXISTS (SELECT 1 FROM `campaign_item` i WHERE i.category_id=c.id AND i.label='Declined CC #1');
INSERT INTO `campaign_item` (`category_id`,`label`,`anchor_type`,`anchor_offset`,`not_on_friday`,`sort_order`)
SELECT c.id,'Term''d for Nonpay - #1 (RM)','BD_FROM_START',5,FALSE,50 FROM `campaign_category` c
WHERE c.name='Declined CC 1-15' AND NOT EXISTS (SELECT 1 FROM `campaign_item` i WHERE i.category_id=c.id AND i.label='Term''d for Nonpay - #1 (RM)');
INSERT INTO `campaign_item` (`category_id`,`label`,`anchor_type`,`anchor_offset`,`not_on_friday`,`sort_order`)
SELECT c.id,'Term''d for Nonpay - #2 (RM)','BD_FROM_START',10,FALSE,60 FROM `campaign_category` c
WHERE c.name='Declined CC 1-15' AND NOT EXISTS (SELECT 1 FROM `campaign_item` i WHERE i.category_id=c.id AND i.label='Term''d for Nonpay - #2 (RM)');
INSERT INTO `campaign_item` (`category_id`,`label`,`anchor_type`,`anchor_offset`,`not_on_friday`,`sort_order`)
SELECT c.id,'Term''d for Nonpay - #3 (RM)','BD_FROM_START',15,FALSE,70 FROM `campaign_category` c
WHERE c.name='Declined CC 1-15' AND NOT EXISTS (SELECT 1 FROM `campaign_item` i WHERE i.category_id=c.id AND i.label='Term''d for Nonpay - #3 (RM)');
INSERT INTO `campaign_item` (`category_id`,`label`,`anchor_type`,`anchor_offset`,`not_on_friday`,`sort_order`)
SELECT c.id,'Term''d for Nonpay - #4 (RM)','BD_FROM_START',17,FALSE,80 FROM `campaign_category` c
WHERE c.name='Declined CC 1-15' AND NOT EXISTS (SELECT 1 FROM `campaign_item` i WHERE i.category_id=c.id AND i.label='Term''d for Nonpay - #4 (RM)');
INSERT INTO `campaign_item` (`category_id`,`label`,`anchor_type`,`anchor_offset`,`not_on_friday`,`sort_order`)
SELECT c.id,'Term''d for Nonpay - #5 (RM)','BD_FROM_START',20,FALSE,90 FROM `campaign_category` c
WHERE c.name='Declined CC 1-15' AND NOT EXISTS (SELECT 1 FROM `campaign_item` i WHERE i.category_id=c.id AND i.label='Term''d for Nonpay - #5 (RM)');

-- Declined CC 16-31 ----------------------------------------------------------
INSERT INTO `campaign_item` (`category_id`,`label`,`anchor_type`,`anchor_offset`,`not_on_friday`,`sort_order`)
SELECT c.id,'Term''d for Nonpay - #4 (RM)','BD_FROM_START',5,FALSE,10 FROM `campaign_category` c
WHERE c.name='Declined CC 16-31' AND NOT EXISTS (SELECT 1 FROM `campaign_item` i WHERE i.category_id=c.id AND i.label='Term''d for Nonpay - #4 (RM)');
INSERT INTO `campaign_item` (`category_id`,`label`,`anchor_type`,`anchor_offset`,`not_on_friday`,`sort_order`)
SELECT c.id,'Term''d for Nonpay - #5 (RM)','BD_FROM_START',10,FALSE,20 FROM `campaign_category` c
WHERE c.name='Declined CC 16-31' AND NOT EXISTS (SELECT 1 FROM `campaign_item` i WHERE i.category_id=c.id AND i.label='Term''d for Nonpay - #5 (RM)');
INSERT INTO `campaign_item` (`category_id`,`label`,`anchor_type`,`anchor_offset`,`not_on_friday`,`sort_order`)
SELECT c.id,'Declined CC #1','BD_FROM_START',11,FALSE,30 FROM `campaign_category` c
WHERE c.name='Declined CC 16-31' AND NOT EXISTS (SELECT 1 FROM `campaign_item` i WHERE i.category_id=c.id AND i.label='Declined CC #1');
INSERT INTO `campaign_item` (`category_id`,`label`,`anchor_type`,`anchor_offset`,`not_on_friday`,`sort_order`)
SELECT c.id,'Term''d for Nonpay - #1 (RM)','BD_FROM_START',15,FALSE,70 FROM `campaign_category` c
WHERE c.name='Declined CC 16-31' AND NOT EXISTS (SELECT 1 FROM `campaign_item` i WHERE i.category_id=c.id AND i.label='Term''d for Nonpay - #1 (RM)');
INSERT INTO `campaign_item` (`category_id`,`label`,`anchor_type`,`anchor_offset`,`not_on_friday`,`sort_order`)
SELECT c.id,'Term''d for Nonpay - #2 (RM)','BD_FROM_START',17,FALSE,80 FROM `campaign_category` c
WHERE c.name='Declined CC 16-31' AND NOT EXISTS (SELECT 1 FROM `campaign_item` i WHERE i.category_id=c.id AND i.label='Term''d for Nonpay - #2 (RM)');
INSERT INTO `campaign_item` (`category_id`,`label`,`anchor_type`,`anchor_offset`,`not_on_friday`,`sort_order`)
SELECT c.id,'Term''d for Nonpay - #3 (RM)','BD_FROM_START',20,FALSE,90 FROM `campaign_category` c
WHERE c.name='Declined CC 16-31' AND NOT EXISTS (SELECT 1 FROM `campaign_item` i WHERE i.category_id=c.id AND i.label='Term''d for Nonpay - #3 (RM)');

-- Declined ACH 1-15 ----------------------------------------------------------
INSERT INTO `campaign_item` (`category_id`,`label`,`anchor_type`,`anchor_offset`,`not_on_friday`,`sort_order`)
SELECT c.id,'Term''d for Nonpay - #5 (RM)','BD_FROM_START',5,FALSE,10 FROM `campaign_category` c
WHERE c.name='Declined ACH 1-15' AND NOT EXISTS (SELECT 1 FROM `campaign_item` i WHERE i.category_id=c.id AND i.label='Term''d for Nonpay - #5 (RM)');
INSERT INTO `campaign_item` (`category_id`,`label`,`anchor_type`,`anchor_offset`,`not_on_friday`,`sort_order`)
SELECT c.id,'Declined ACH #1 (RM)','BD_FROM_START',6,FALSE,20 FROM `campaign_category` c
WHERE c.name='Declined ACH 1-15' AND NOT EXISTS (SELECT 1 FROM `campaign_item` i WHERE i.category_id=c.id AND i.label='Declined ACH #1 (RM)');
INSERT INTO `campaign_item` (`category_id`,`label`,`anchor_type`,`anchor_offset`,`not_on_friday`,`sort_order`)
SELECT c.id,'Term''d for Nonpay - #1 (RM)','BD_FROM_START',10,FALSE,60 FROM `campaign_category` c
WHERE c.name='Declined ACH 1-15' AND NOT EXISTS (SELECT 1 FROM `campaign_item` i WHERE i.category_id=c.id AND i.label='Term''d for Nonpay - #1 (RM)');
INSERT INTO `campaign_item` (`category_id`,`label`,`anchor_type`,`anchor_offset`,`not_on_friday`,`sort_order`)
SELECT c.id,'Term''d for Nonpay - #2 (RM)','BD_FROM_START',15,FALSE,70 FROM `campaign_category` c
WHERE c.name='Declined ACH 1-15' AND NOT EXISTS (SELECT 1 FROM `campaign_item` i WHERE i.category_id=c.id AND i.label='Term''d for Nonpay - #2 (RM)');
INSERT INTO `campaign_item` (`category_id`,`label`,`anchor_type`,`anchor_offset`,`not_on_friday`,`sort_order`)
SELECT c.id,'Term''d for Nonpay - #3 (RM)','BD_FROM_START',17,FALSE,80 FROM `campaign_category` c
WHERE c.name='Declined ACH 1-15' AND NOT EXISTS (SELECT 1 FROM `campaign_item` i WHERE i.category_id=c.id AND i.label='Term''d for Nonpay - #3 (RM)');
INSERT INTO `campaign_item` (`category_id`,`label`,`anchor_type`,`anchor_offset`,`not_on_friday`,`sort_order`)
SELECT c.id,'Term''d for Nonpay - #4 (RM)','BD_FROM_START',20,FALSE,90 FROM `campaign_category` c
WHERE c.name='Declined ACH 1-15' AND NOT EXISTS (SELECT 1 FROM `campaign_item` i WHERE i.category_id=c.id AND i.label='Term''d for Nonpay - #4 (RM)');

-- Declined ACH 16-31 ---------------------------------------------------------
INSERT INTO `campaign_item` (`category_id`,`label`,`anchor_type`,`anchor_offset`,`not_on_friday`,`sort_order`)
SELECT c.id,'Term''d for Nonpay - #3 (RM)','BD_FROM_START',5,FALSE,10 FROM `campaign_category` c
WHERE c.name='Declined ACH 16-31' AND NOT EXISTS (SELECT 1 FROM `campaign_item` i WHERE i.category_id=c.id AND i.label='Term''d for Nonpay - #3 (RM)');
INSERT INTO `campaign_item` (`category_id`,`label`,`anchor_type`,`anchor_offset`,`not_on_friday`,`sort_order`)
SELECT c.id,'Term''d for Nonpay - #4 (RM)','BD_FROM_START',10,FALSE,20 FROM `campaign_category` c
WHERE c.name='Declined ACH 16-31' AND NOT EXISTS (SELECT 1 FROM `campaign_item` i WHERE i.category_id=c.id AND i.label='Term''d for Nonpay - #4 (RM)');
INSERT INTO `campaign_item` (`category_id`,`label`,`anchor_type`,`anchor_offset`,`not_on_friday`,`sort_order`)
SELECT c.id,'Term''d for Nonpay - #5 (RM)','BD_FROM_START',15,FALSE,30 FROM `campaign_category` c
WHERE c.name='Declined ACH 16-31' AND NOT EXISTS (SELECT 1 FROM `campaign_item` i WHERE i.category_id=c.id AND i.label='Term''d for Nonpay - #5 (RM)');
INSERT INTO `campaign_item` (`category_id`,`label`,`anchor_type`,`anchor_offset`,`not_on_friday`,`sort_order`)
SELECT c.id,'Declined ACH #1 (RM)','BD_FROM_START',16,FALSE,40 FROM `campaign_category` c
WHERE c.name='Declined ACH 16-31' AND NOT EXISTS (SELECT 1 FROM `campaign_item` i WHERE i.category_id=c.id AND i.label='Declined ACH #1 (RM)');
INSERT INTO `campaign_item` (`category_id`,`label`,`anchor_type`,`anchor_offset`,`not_on_friday`,`sort_order`)
SELECT c.id,'Term''d for Nonpay - #1 (RM)','BD_FROM_START',20,FALSE,80 FROM `campaign_category` c
WHERE c.name='Declined ACH 16-31' AND NOT EXISTS (SELECT 1 FROM `campaign_item` i WHERE i.category_id=c.id AND i.label='Term''d for Nonpay - #1 (RM)');

-- Check Termed ---------------------------------------------------------------
INSERT INTO `campaign_item` (`category_id`,`label`,`anchor_type`,`anchor_offset`,`not_on_friday`,`sort_order`)
SELECT c.id,'Term''d for Nonpay - #2 (RM)','BD_FROM_START',5,FALSE,10 FROM `campaign_category` c
WHERE c.name='Check Termed' AND NOT EXISTS (SELECT 1 FROM `campaign_item` i WHERE i.category_id=c.id AND i.label='Term''d for Nonpay - #2 (RM)');
INSERT INTO `campaign_item` (`category_id`,`label`,`anchor_type`,`anchor_offset`,`not_on_friday`,`sort_order`)
SELECT c.id,'Term''d for Nonpay - #3 (RM)','BD_FROM_START',10,FALSE,20 FROM `campaign_category` c
WHERE c.name='Check Termed' AND NOT EXISTS (SELECT 1 FROM `campaign_item` i WHERE i.category_id=c.id AND i.label='Term''d for Nonpay - #3 (RM)');
INSERT INTO `campaign_item` (`category_id`,`label`,`anchor_type`,`anchor_offset`,`not_on_friday`,`sort_order`)
SELECT c.id,'Term''d for Nonpay - #4 (RM)','BD_FROM_START',15,FALSE,30 FROM `campaign_category` c
WHERE c.name='Check Termed' AND NOT EXISTS (SELECT 1 FROM `campaign_item` i WHERE i.category_id=c.id AND i.label='Term''d for Nonpay - #4 (RM)');
INSERT INTO `campaign_item` (`category_id`,`label`,`anchor_type`,`anchor_offset`,`not_on_friday`,`sort_order`)
SELECT c.id,'Term''d for Nonpay - #5 (RM)','BD_FROM_START',17,FALSE,40 FROM `campaign_category` c
WHERE c.name='Check Termed' AND NOT EXISTS (SELECT 1 FROM `campaign_item` i WHERE i.category_id=c.id AND i.label='Term''d for Nonpay - #5 (RM)');

-- Check Customer -------------------------------------------------------------
INSERT INTO `campaign_item` (`category_id`,`label`,`anchor_type`,`anchor_offset`,`not_on_friday`,`sort_order`)
SELECT c.id,'Start Undelivered Email Tickets #1','BD_FROM_START',2,FALSE,10 FROM `campaign_category` c
WHERE c.name='Check Customer' AND NOT EXISTS (SELECT 1 FROM `campaign_item` i WHERE i.category_id=c.id AND i.label='Start Undelivered Email Tickets #1');
INSERT INTO `campaign_item` (`category_id`,`label`,`anchor_type`,`anchor_offset`,`not_on_friday`,`sort_order`)
SELECT c.id,'Invoice Generated #1','BD_FROM_START',6,FALSE,20 FROM `campaign_category` c
WHERE c.name='Check Customer' AND NOT EXISTS (SELECT 1 FROM `campaign_item` i WHERE i.category_id=c.id AND i.label='Invoice Generated #1');
INSERT INTO `campaign_item` (`category_id`,`label`,`anchor_type`,`anchor_offset`,`not_on_friday`,`sort_order`)
SELECT c.id,'Invoice Generated #2','BD_FROM_START',8,FALSE,30 FROM `campaign_category` c
WHERE c.name='Check Customer' AND NOT EXISTS (SELECT 1 FROM `campaign_item` i WHERE i.category_id=c.id AND i.label='Invoice Generated #2');
INSERT INTO `campaign_item` (`category_id`,`label`,`anchor_type`,`anchor_offset`,`not_on_friday`,`sort_order`)
SELECT c.id,'Invoice Generated #3 (RM)','BD_FROM_START',10,FALSE,40 FROM `campaign_category` c
WHERE c.name='Check Customer' AND NOT EXISTS (SELECT 1 FROM `campaign_item` i WHERE i.category_id=c.id AND i.label='Invoice Generated #3 (RM)');
INSERT INTO `campaign_item` (`category_id`,`label`,`anchor_type`,`anchor_offset`,`not_on_friday`,`sort_order`)
SELECT c.id,'Start Undelivered Email Tickets #2','BD_FROM_START',12,FALSE,50 FROM `campaign_category` c
WHERE c.name='Check Customer' AND NOT EXISTS (SELECT 1 FROM `campaign_item` i WHERE i.category_id=c.id AND i.label='Start Undelivered Email Tickets #2');
INSERT INTO `campaign_item` (`category_id`,`label`,`anchor_type`,`anchor_offset`,`not_on_friday`,`sort_order`)
SELECT c.id,'Invoice Generated #4 (RM)','BD_FROM_START',15,FALSE,60 FROM `campaign_category` c
WHERE c.name='Check Customer' AND NOT EXISTS (SELECT 1 FROM `campaign_item` i WHERE i.category_id=c.id AND i.label='Invoice Generated #4 (RM)');
INSERT INTO `campaign_item` (`category_id`,`label`,`anchor_type`,`anchor_offset`,`not_on_friday`,`sort_order`)
SELECT c.id,'Invoice Generated #5 (RM)','BD_FROM_START',16,FALSE,70 FROM `campaign_category` c
WHERE c.name='Check Customer' AND NOT EXISTS (SELECT 1 FROM `campaign_item` i WHERE i.category_id=c.id AND i.label='Invoice Generated #5 (RM)');
INSERT INTO `campaign_item` (`category_id`,`label`,`anchor_type`,`anchor_offset`,`not_on_friday`,`sort_order`)
SELECT c.id,'Invoice Generated #6 (RM)','BD_FROM_START',17,FALSE,80 FROM `campaign_category` c
WHERE c.name='Check Customer' AND NOT EXISTS (SELECT 1 FROM `campaign_item` i WHERE i.category_id=c.id AND i.label='Invoice Generated #6 (RM)');
INSERT INTO `campaign_item` (`category_id`,`label`,`anchor_type`,`anchor_offset`,`not_on_friday`,`sort_order`)
SELECT c.id,'Invoice Generated #7 (RM)','BD_FROM_START',18,FALSE,90 FROM `campaign_category` c
WHERE c.name='Check Customer' AND NOT EXISTS (SELECT 1 FROM `campaign_item` i WHERE i.category_id=c.id AND i.label='Invoice Generated #7 (RM)');
INSERT INTO `campaign_item` (`category_id`,`label`,`anchor_type`,`anchor_offset`,`not_on_friday`,`sort_order`)
SELECT c.id,'Invoice Generated #8 (RM)','BD_FROM_START',19,FALSE,100 FROM `campaign_category` c
WHERE c.name='Check Customer' AND NOT EXISTS (SELECT 1 FROM `campaign_item` i WHERE i.category_id=c.id AND i.label='Invoice Generated #8 (RM)');
INSERT INTO `campaign_item` (`category_id`,`label`,`anchor_type`,`anchor_offset`,`not_on_friday`,`sort_order`)
SELECT c.id,'Invoice Generated #9 (RM)','BD_FROM_START',20,FALSE,110 FROM `campaign_category` c
WHERE c.name='Check Customer' AND NOT EXISTS (SELECT 1 FROM `campaign_item` i WHERE i.category_id=c.id AND i.label='Invoice Generated #9 (RM)');
INSERT INTO `campaign_item` (`category_id`,`label`,`anchor_type`,`anchor_offset`,`not_on_friday`,`sort_order`)
SELECT c.id,'Shut Off 1st-of-Month Invoices for Nonpay (After Checks Processed)','BD_FROM_END',1,FALSE,120 FROM `campaign_category` c
WHERE c.name='Check Customer' AND NOT EXISTS (SELECT 1 FROM `campaign_item` i WHERE i.category_id=c.id AND i.label='Shut Off 1st-of-Month Invoices for Nonpay (After Checks Processed)');

-- Expiring CC - Current Month ------------------------------------------------
INSERT INTO `campaign_item` (`category_id`,`label`,`anchor_type`,`anchor_offset`,`not_on_friday`,`sort_order`)
SELECT c.id,'Expiring CC #1','BD_FROM_START',5,FALSE,10 FROM `campaign_category` c
WHERE c.name='Expiring CC - Current Month' AND NOT EXISTS (SELECT 1 FROM `campaign_item` i WHERE i.category_id=c.id AND i.label='Expiring CC #1');
INSERT INTO `campaign_item` (`category_id`,`label`,`anchor_type`,`anchor_offset`,`not_on_friday`,`sort_order`)
SELECT c.id,'Expiring CC #2','BD_FROM_START',9,FALSE,20 FROM `campaign_category` c
WHERE c.name='Expiring CC - Current Month' AND NOT EXISTS (SELECT 1 FROM `campaign_item` i WHERE i.category_id=c.id AND i.label='Expiring CC #2');
INSERT INTO `campaign_item` (`category_id`,`label`,`anchor_type`,`anchor_offset`,`not_on_friday`,`sort_order`)
SELECT c.id,'Expiring CC #3','BD_FROM_START',14,FALSE,30 FROM `campaign_category` c
WHERE c.name='Expiring CC - Current Month' AND NOT EXISTS (SELECT 1 FROM `campaign_item` i WHERE i.category_id=c.id AND i.label='Expiring CC #3');
INSERT INTO `campaign_item` (`category_id`,`label`,`anchor_type`,`anchor_offset`,`not_on_friday`,`sort_order`)
SELECT c.id,'Expiring CC #4','BD_FROM_START',18,FALSE,40 FROM `campaign_category` c
WHERE c.name='Expiring CC - Current Month' AND NOT EXISTS (SELECT 1 FROM `campaign_item` i WHERE i.category_id=c.id AND i.label='Expiring CC #4');
INSERT INTO `campaign_item` (`category_id`,`label`,`anchor_type`,`anchor_offset`,`not_on_friday`,`sort_order`)
SELECT c.id,'Expiring CC #5','BD_FROM_END',1,FALSE,50 FROM `campaign_category` c
WHERE c.name='Expiring CC - Current Month' AND NOT EXISTS (SELECT 1 FROM `campaign_item` i WHERE i.category_id=c.id AND i.label='Expiring CC #5');

-- ─────────────────────────────────────────────────────────────────────────────
-- PASS 2 — RELATIVE items. Each points at the campaign it follows, so the whole
-- dunning chain moves together if its head moves.
-- ─────────────────────────────────────────────────────────────────────────────

-- Declined CC 1-15: #1 → #2 → #3 → shut off, one business day apart.
INSERT INTO `campaign_item` (`category_id`,`label`,`anchor_type`,`anchor_offset`,`anchor_ref_item_id`,`not_on_friday`,`sort_order`)
SELECT c.id,'Declined CC #2','RELATIVE_TO_CAMPAIGN',1,r.id,FALSE,20 FROM `campaign_category` c
JOIN `campaign_item` r ON r.category_id=c.id AND r.label='Declined CC #1'
WHERE c.name='Declined CC 1-15' AND NOT EXISTS (SELECT 1 FROM `campaign_item` i WHERE i.category_id=c.id AND i.label='Declined CC #2');
INSERT INTO `campaign_item` (`category_id`,`label`,`anchor_type`,`anchor_offset`,`anchor_ref_item_id`,`not_on_friday`,`sort_order`)
SELECT c.id,'Declined CC #3 (RM)','RELATIVE_TO_CAMPAIGN',1,r.id,FALSE,30 FROM `campaign_category` c
JOIN `campaign_item` r ON r.category_id=c.id AND r.label='Declined CC #2'
WHERE c.name='Declined CC 1-15' AND NOT EXISTS (SELECT 1 FROM `campaign_item` i WHERE i.category_id=c.id AND i.label='Declined CC #3 (RM)');
INSERT INTO `campaign_item` (`category_id`,`label`,`anchor_type`,`anchor_offset`,`anchor_ref_item_id`,`not_on_friday`,`sort_order`)
SELECT c.id,'Shut Off Declined CC for Nonpay (RM)','RELATIVE_TO_CAMPAIGN',1,r.id,FALSE,40 FROM `campaign_category` c
JOIN `campaign_item` r ON r.category_id=c.id AND r.label='Declined CC #3 (RM)'
WHERE c.name='Declined CC 1-15' AND NOT EXISTS (SELECT 1 FROM `campaign_item` i WHERE i.category_id=c.id AND i.label='Shut Off Declined CC for Nonpay (RM)');

-- Declined CC 16-31
INSERT INTO `campaign_item` (`category_id`,`label`,`anchor_type`,`anchor_offset`,`anchor_ref_item_id`,`not_on_friday`,`sort_order`)
SELECT c.id,'Declined CC #2','RELATIVE_TO_CAMPAIGN',1,r.id,FALSE,40 FROM `campaign_category` c
JOIN `campaign_item` r ON r.category_id=c.id AND r.label='Declined CC #1'
WHERE c.name='Declined CC 16-31' AND NOT EXISTS (SELECT 1 FROM `campaign_item` i WHERE i.category_id=c.id AND i.label='Declined CC #2');
INSERT INTO `campaign_item` (`category_id`,`label`,`anchor_type`,`anchor_offset`,`anchor_ref_item_id`,`not_on_friday`,`sort_order`)
SELECT c.id,'Declined CC #3 (RM)','RELATIVE_TO_CAMPAIGN',1,r.id,FALSE,50 FROM `campaign_category` c
JOIN `campaign_item` r ON r.category_id=c.id AND r.label='Declined CC #2'
WHERE c.name='Declined CC 16-31' AND NOT EXISTS (SELECT 1 FROM `campaign_item` i WHERE i.category_id=c.id AND i.label='Declined CC #3 (RM)');
INSERT INTO `campaign_item` (`category_id`,`label`,`anchor_type`,`anchor_offset`,`anchor_ref_item_id`,`not_on_friday`,`sort_order`)
SELECT c.id,'Shut Off Declined CC for Nonpay (RM)','RELATIVE_TO_CAMPAIGN',1,r.id,FALSE,60 FROM `campaign_category` c
JOIN `campaign_item` r ON r.category_id=c.id AND r.label='Declined CC #3 (RM)'
WHERE c.name='Declined CC 16-31' AND NOT EXISTS (SELECT 1 FROM `campaign_item` i WHERE i.category_id=c.id AND i.label='Shut Off Declined CC for Nonpay (RM)');

-- Declined ACH 1-15
INSERT INTO `campaign_item` (`category_id`,`label`,`anchor_type`,`anchor_offset`,`anchor_ref_item_id`,`not_on_friday`,`sort_order`)
SELECT c.id,'Declined ACH #2 (RM)','RELATIVE_TO_CAMPAIGN',1,r.id,FALSE,30 FROM `campaign_category` c
JOIN `campaign_item` r ON r.category_id=c.id AND r.label='Declined ACH #1 (RM)'
WHERE c.name='Declined ACH 1-15' AND NOT EXISTS (SELECT 1 FROM `campaign_item` i WHERE i.category_id=c.id AND i.label='Declined ACH #2 (RM)');
INSERT INTO `campaign_item` (`category_id`,`label`,`anchor_type`,`anchor_offset`,`anchor_ref_item_id`,`not_on_friday`,`sort_order`)
SELECT c.id,'Declined ACH #3 (RM)','RELATIVE_TO_CAMPAIGN',1,r.id,FALSE,40 FROM `campaign_category` c
JOIN `campaign_item` r ON r.category_id=c.id AND r.label='Declined ACH #2 (RM)'
WHERE c.name='Declined ACH 1-15' AND NOT EXISTS (SELECT 1 FROM `campaign_item` i WHERE i.category_id=c.id AND i.label='Declined ACH #3 (RM)');
INSERT INTO `campaign_item` (`category_id`,`label`,`anchor_type`,`anchor_offset`,`anchor_ref_item_id`,`not_on_friday`,`sort_order`)
SELECT c.id,'Shut Off Declined ACH for Nonpay (RM)','RELATIVE_TO_CAMPAIGN',1,r.id,FALSE,50 FROM `campaign_category` c
JOIN `campaign_item` r ON r.category_id=c.id AND r.label='Declined ACH #3 (RM)'
WHERE c.name='Declined ACH 1-15' AND NOT EXISTS (SELECT 1 FROM `campaign_item` i WHERE i.category_id=c.id AND i.label='Shut Off Declined ACH for Nonpay (RM)');

-- Declined ACH 16-31
INSERT INTO `campaign_item` (`category_id`,`label`,`anchor_type`,`anchor_offset`,`anchor_ref_item_id`,`not_on_friday`,`sort_order`)
SELECT c.id,'Declined ACH #2 (RM)','RELATIVE_TO_CAMPAIGN',1,r.id,FALSE,50 FROM `campaign_category` c
JOIN `campaign_item` r ON r.category_id=c.id AND r.label='Declined ACH #1 (RM)'
WHERE c.name='Declined ACH 16-31' AND NOT EXISTS (SELECT 1 FROM `campaign_item` i WHERE i.category_id=c.id AND i.label='Declined ACH #2 (RM)');
INSERT INTO `campaign_item` (`category_id`,`label`,`anchor_type`,`anchor_offset`,`anchor_ref_item_id`,`not_on_friday`,`sort_order`)
SELECT c.id,'Declined ACH #3 (RM)','RELATIVE_TO_CAMPAIGN',1,r.id,FALSE,60 FROM `campaign_category` c
JOIN `campaign_item` r ON r.category_id=c.id AND r.label='Declined ACH #2 (RM)'
WHERE c.name='Declined ACH 16-31' AND NOT EXISTS (SELECT 1 FROM `campaign_item` i WHERE i.category_id=c.id AND i.label='Declined ACH #3 (RM)');
INSERT INTO `campaign_item` (`category_id`,`label`,`anchor_type`,`anchor_offset`,`anchor_ref_item_id`,`not_on_friday`,`sort_order`)
SELECT c.id,'Shut Off Declined ACH for Nonpay (RM)','RELATIVE_TO_CAMPAIGN',1,r.id,FALSE,70 FROM `campaign_category` c
JOIN `campaign_item` r ON r.category_id=c.id AND r.label='Declined ACH #3 (RM)'
WHERE c.name='Declined ACH 16-31' AND NOT EXISTS (SELECT 1 FROM `campaign_item` i WHERE i.category_id=c.id AND i.label='Shut Off Declined ACH for Nonpay (RM)');

-- Expiring CC - Prior Month: same day as its current-month counterpart (+0 BD).
INSERT INTO `campaign_item` (`category_id`,`label`,`anchor_type`,`anchor_offset`,`anchor_ref_item_id`,`not_on_friday`,`sort_order`)
SELECT c.id,'Expiring CC #6 (RM)','RELATIVE_TO_CAMPAIGN',0,r.id,FALSE,10 FROM `campaign_category` c
JOIN `campaign_item` r ON r.label='Expiring CC #1' AND r.category_id=(SELECT id FROM `campaign_category` WHERE name='Expiring CC - Current Month')
WHERE c.name='Expiring CC - Prior Month' AND NOT EXISTS (SELECT 1 FROM `campaign_item` i WHERE i.category_id=c.id AND i.label='Expiring CC #6 (RM)');
INSERT INTO `campaign_item` (`category_id`,`label`,`anchor_type`,`anchor_offset`,`anchor_ref_item_id`,`not_on_friday`,`sort_order`)
SELECT c.id,'Expiring CC #7 (RM)','RELATIVE_TO_CAMPAIGN',0,r.id,FALSE,20 FROM `campaign_category` c
JOIN `campaign_item` r ON r.label='Expiring CC #2' AND r.category_id=(SELECT id FROM `campaign_category` WHERE name='Expiring CC - Current Month')
WHERE c.name='Expiring CC - Prior Month' AND NOT EXISTS (SELECT 1 FROM `campaign_item` i WHERE i.category_id=c.id AND i.label='Expiring CC #7 (RM)');
INSERT INTO `campaign_item` (`category_id`,`label`,`anchor_type`,`anchor_offset`,`anchor_ref_item_id`,`not_on_friday`,`sort_order`)
SELECT c.id,'Expiring CC #8 (RM)','RELATIVE_TO_CAMPAIGN',0,r.id,FALSE,30 FROM `campaign_category` c
JOIN `campaign_item` r ON r.label='Expiring CC #3' AND r.category_id=(SELECT id FROM `campaign_category` WHERE name='Expiring CC - Current Month')
WHERE c.name='Expiring CC - Prior Month' AND NOT EXISTS (SELECT 1 FROM `campaign_item` i WHERE i.category_id=c.id AND i.label='Expiring CC #8 (RM)');
INSERT INTO `campaign_item` (`category_id`,`label`,`anchor_type`,`anchor_offset`,`anchor_ref_item_id`,`not_on_friday`,`sort_order`)
SELECT c.id,'Expiring CC #9 (RM)','RELATIVE_TO_CAMPAIGN',0,r.id,FALSE,40 FROM `campaign_category` c
JOIN `campaign_item` r ON r.label='Expiring CC #4' AND r.category_id=(SELECT id FROM `campaign_category` WHERE name='Expiring CC - Current Month')
WHERE c.name='Expiring CC - Prior Month' AND NOT EXISTS (SELECT 1 FROM `campaign_item` i WHERE i.category_id=c.id AND i.label='Expiring CC #9 (RM)');
INSERT INTO `campaign_item` (`category_id`,`label`,`anchor_type`,`anchor_offset`,`anchor_ref_item_id`,`not_on_friday`,`sort_order`)
SELECT c.id,'Expiring CC #10 (RM)','RELATIVE_TO_CAMPAIGN',0,r.id,FALSE,50 FROM `campaign_category` c
JOIN `campaign_item` r ON r.label='Expiring CC #5' AND r.category_id=(SELECT id FROM `campaign_category` WHERE name='Expiring CC - Current Month')
WHERE c.name='Expiring CC - Prior Month' AND NOT EXISTS (SELECT 1 FROM `campaign_item` i WHERE i.category_id=c.id AND i.label='Expiring CC #10 (RM)');

-- ─────────────────────────────────────────────────────────────────────────────
-- The schedule itself. Membership defaults to "all active campaigns enabled",
-- so no campaign_schedule_item rows are needed for the full AR calendar.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT IGNORE INTO `campaign_schedule` (`name`, `department_id`, `is_active`)
SELECT 'AR Calendar', d.id, TRUE FROM `departments` d WHERE d.department_name = 'Customer Service';
