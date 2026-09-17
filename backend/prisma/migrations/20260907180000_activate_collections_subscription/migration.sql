-- Activate the collections_subscription source report.
-- Its extract/transform SQL (collections_subscription.{extract,transform}.sql) are
-- validated and the 13-month backfill is loaded, so the nightly dispatcher can now
-- keep the subscription-outcome fact fresh. Additive + idempotent.
UPDATE `ie_source_report`
   SET `is_active` = 1
 WHERE `report_code` = 'collections_subscription';
