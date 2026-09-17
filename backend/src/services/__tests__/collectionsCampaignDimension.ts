/**
 * The `ie_dim_collections_campaign` rows the Collections service tests measure against.
 *
 * Shared rather than restated per file: the campaign vocabulary is read from the
 * database now, so each mocked pool has to answer for it, and three private copies of
 * these rows would reintroduce exactly the drift that moving them into the dimension
 * removed. Kept in step with the seed in
 * `20260907170000_create_collections_facts` / `20260915140000_collections_ach_cycle_split`.
 *
 * The two exclusions are the point of the fixture. `CHECK` recovers dollars but bills on
 * no cycle, and `EXP_CC` bills on no cycle and is not measured in dollars at all, so
 * `success_kind = 'RECOVERY_DOLLARS' AND cycle <> 'NA'` must return the four recurring
 * runs and nothing else. A test asserting the declined population is really asserting
 * that predicate against these rows.
 */
export const CAMPAIGN_DIM_ROWS = [
  { campaign_key: 'CC_1_15', label: 'Declined CC (1st)', success_kind: 'RECOVERY_DOLLARS', cycle: '1_15' },
  { campaign_key: 'CC_16_31', label: 'Declined CC (16th)', success_kind: 'RECOVERY_DOLLARS', cycle: '16_31' },
  { campaign_key: 'ACH_1_15', label: 'Declined ACH (1st)', success_kind: 'RECOVERY_DOLLARS', cycle: '1_15' },
  { campaign_key: 'ACH_16_31', label: 'Declined ACH (16th)', success_kind: 'RECOVERY_DOLLARS', cycle: '16_31' },
  { campaign_key: 'CHECK', label: 'Check', success_kind: 'RECOVERY_DOLLARS', cycle: 'NA' },
  { campaign_key: 'EXP_CC', label: 'Expiring Credit Card', success_kind: 'CARD_UPDATE', cycle: 'NA' },
  { campaign_key: 'SALES_AR', label: 'Sales AR', success_kind: 'RECOVERY_DOLLARS', cycle: 'NA' },
  { campaign_key: 'ACH', label: 'Declined ACH (pre-split)', success_kind: 'RECOVERY_DOLLARS', cycle: 'NA' },
];

/** True for the vocabulary read, so a mocked pool can route it like any other query. */
export const isCampaignDimension = (sql: string): boolean =>
  sql.includes('FROM ie_dim_collections_campaign');
