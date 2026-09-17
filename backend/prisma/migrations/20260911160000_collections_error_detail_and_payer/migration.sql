-- ─────────────────────────────────────────────────────────────────────────────
-- Collections: keep the gateway's own words, name the payer, and record WHICH
-- card the run tried.
--
-- Three gaps found while validating the 2026-09-01 run, all of them "the data
-- exists in CRM and we throw it away":
--
-- 1. result_message (billing). collections_billing.extract.sql computed the
--    processor's response text and then kept it only for DECLINED:
--      CASE WHEN l.first_result = 'DECLINED' THEN l.first_message END
--    So every one of the 15 ERROR rows and 7,688 OK rows on 09-01 carried a NULL
--    reason and "Submission error" was unexplainable — we could not separate a
--    Validation Error from an Invalid Amount, which is exactly the detail needed
--    to tell an over-sized request apart from a malformed one. decline_reason is
--    left untouched so the existing decline report and its index are unaffected;
--    this is the raw message for every result. Longest observed message in the
--    trailing quarter is 45 characters.
--
-- 2. processor_name (recovery). collections_recovery.extract.sql resolves
--    tblPaymentsCredits.CreatedBy only against AR staff (tblSalesPeople,
--    isDisplayInCRM = 1, DeptID IN (1,2,3)) and labels everything else NO_AGENT
--    with a NULL email — so a customer who paid through the portal reads as
--    "No agent" even though CreatedBy identifies them exactly. The id is already
--    stored as processor_crm_id; per the ID-space note in recoveryJoins.ts
--    anything above tblSalesPeople's max UserID of 201 is a tblContacts.ContactID.
--    This lands the resolved human name so the report can say who paid.
--
-- 3. card_billing_group_id (invoice). card_state was derived from the billing
--    group on the INVOICE HEADER, but CRM rewrites that header to whichever group
--    later paid — the behaviour collections_recovery.extract.sql already documents.
--    That produced a bogus "card replaced" state that was really just "we are
--    reading the wrong billing group": on 09-01, invoice 1939451's header points at
--    group 114062 (created 09-04) while the run actually charged group 79881, whose
--    card expired 6/2026. tblRecurringItems.BillingGroupID is the group the run was
--    configured to charge, keyed to the invoice by newOrderID. Storing the resolved
--    group makes every card_state auditable against CRM by hand.
--
-- Purely additive: one nullable column per table, no index, no existing column,
-- key or partition touched. Idempotent via the information_schema guard used by
-- 20260911140000_collections_invoice_card_state.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── billing: the gateway's own words, for every result ────────────────────────
SET @ddl := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'ie_stg_collections_billing' AND COLUMN_NAME = 'result_message') > 0,
  'DO 0',
  'ALTER TABLE `ie_stg_collections_billing` ADD COLUMN `result_message` VARCHAR(80) NULL AFTER `decline_reason`');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

SET @ddl := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'ie_fact_collections_billing' AND COLUMN_NAME = 'result_message') > 0,
  'DO 0',
  'ALTER TABLE `ie_fact_collections_billing` ADD COLUMN `result_message` VARCHAR(80) NULL AFTER `decline_reason`');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

-- ── recovery: who actually took the money ─────────────────────────────────────
SET @ddl := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'ie_stg_collections_recovery' AND COLUMN_NAME = 'processor_name') > 0,
  'DO 0',
  'ALTER TABLE `ie_stg_collections_recovery` ADD COLUMN `processor_name` VARCHAR(120) NULL AFTER `agent_email`');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

SET @ddl := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'ie_fact_collections_recovery' AND COLUMN_NAME = 'processor_name') > 0,
  'DO 0',
  'ALTER TABLE `ie_fact_collections_recovery` ADD COLUMN `processor_name` VARCHAR(120) NULL AFTER `agent_email`');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

-- ── invoice: which billing group the RUN charged ──────────────────────────────
SET @ddl := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'ie_stg_collections_invoice' AND COLUMN_NAME = 'card_billing_group_id') > 0,
  'DO 0',
  'ALTER TABLE `ie_stg_collections_invoice` ADD COLUMN `card_billing_group_id` INT NULL AFTER `pm_type`');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

SET @ddl := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'ie_fact_collections_invoice' AND COLUMN_NAME = 'card_billing_group_id') > 0,
  'DO 0',
  'ALTER TABLE `ie_fact_collections_invoice` ADD COLUMN `card_billing_group_id` INT NULL AFTER `pm_type`');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;
