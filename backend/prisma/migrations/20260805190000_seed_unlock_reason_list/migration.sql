-- ─────────────────────────────────────────────────────────────────────────────
-- Move the unlock/reopen reasons out of hardcoded arrays and into the
-- admin-managed `list_items` catalogue (Admin → List Management → Quality),
-- mirroring how `qa_form_type` is managed. `item_key` holds the stable code
-- that `record_unlock.reason_code` stores; `label` is the admin-editable
-- display text. Renaming a label never orphans historical rows because the
-- code is what is stored.
--
-- Additive + idempotent (seed only when the row is absent), safe across
-- dev/test/prod. Codes match UNLOCK_REASON_CODES in the app so existing rows
-- resolve unchanged.
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO `list_items` (`list_type`, `item_key`, `category`, `label`, `sort_order`, `is_active`)
SELECT 'unlock_reason', 'SCORING_ERROR', NULL, 'Scoring error', 1, 1
WHERE NOT EXISTS (SELECT 1 FROM `list_items` WHERE `list_type` = 'unlock_reason' AND `item_key` = 'SCORING_ERROR');

INSERT INTO `list_items` (`list_type`, `item_key`, `category`, `label`, `sort_order`, `is_active`)
SELECT 'unlock_reason', 'WRONG_INTERACTION', NULL, 'Wrong interaction attached', 2, 1
WHERE NOT EXISTS (SELECT 1 FROM `list_items` WHERE `list_type` = 'unlock_reason' AND `item_key` = 'WRONG_INTERACTION');

INSERT INTO `list_items` (`list_type`, `item_key`, `category`, `label`, `sort_order`, `is_active`)
SELECT 'unlock_reason', 'CALIBRATION_CORRECTION', NULL, 'Calibration correction', 3, 1
WHERE NOT EXISTS (SELECT 1 FROM `list_items` WHERE `list_type` = 'unlock_reason' AND `item_key` = 'CALIBRATION_CORRECTION');

INSERT INTO `list_items` (`list_type`, `item_key`, `category`, `label`, `sort_order`, `is_active`)
SELECT 'unlock_reason', 'POLICY_CHANGE', NULL, 'Policy change', 4, 1
WHERE NOT EXISTS (SELECT 1 FROM `list_items` WHERE `list_type` = 'unlock_reason' AND `item_key` = 'POLICY_CHANGE');

INSERT INTO `list_items` (`list_type`, `item_key`, `category`, `label`, `sort_order`, `is_active`)
SELECT 'unlock_reason', 'TECHNICAL_ISSUE', NULL, 'Technical issue', 5, 1
WHERE NOT EXISTS (SELECT 1 FROM `list_items` WHERE `list_type` = 'unlock_reason' AND `item_key` = 'TECHNICAL_ISSUE');

INSERT INTO `list_items` (`list_type`, `item_key`, `category`, `label`, `sort_order`, `is_active`)
SELECT 'unlock_reason', 'AGENT_APPEAL', NULL, 'Agent appeal', 6, 1
WHERE NOT EXISTS (SELECT 1 FROM `list_items` WHERE `list_type` = 'unlock_reason' AND `item_key` = 'AGENT_APPEAL');

INSERT INTO `list_items` (`list_type`, `item_key`, `category`, `label`, `sort_order`, `is_active`)
SELECT 'unlock_reason', 'OTHER', NULL, 'Other', 7, 1
WHERE NOT EXISTS (SELECT 1 FROM `list_items` WHERE `list_type` = 'unlock_reason' AND `item_key` = 'OTHER');
