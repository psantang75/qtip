-- ─────────────────────────────────────────────────────────────────────────────
-- Missed Opportunities (Insights → Sales Agent Activity)
--
-- Productizes the manual "Sales Daily Review" pass: a nightly worker reads the
-- prior day's connected sales calls plus that agent's CRM notes and asks the
-- configured LLM to apply an editable rule set, storing one row per missed
-- opportunity with a call-specific recommended approach.
--
-- Three new tables, all additive — no existing table is altered:
--   ie_missed_opportunity_rule    — the editable rule sets (Settings tab)
--   ie_missed_opportunity_run     — per-day run log (idempotency, freshness, cost)
--   ie_missed_opportunity_finding — one row per detected miss
--
-- These are small operational tables (not ie_fact_* warehouse facts): they are
-- produced by an LLM worker rather than an extract/transform SQL pair, so they
-- are NOT registered in ie_source_report and are NOT partitioned. That also
-- means they can be modeled in Prisma, unlike the partitioned fact tables.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS `ie_missed_opportunity_rule` (
  `rule_id`      INT          NOT NULL AUTO_INCREMENT,
  `rule_key`     VARCHAR(64)  NOT NULL,
  `rule_name`    VARCHAR(160) NOT NULL,
  `category`     VARCHAR(64)  NOT NULL,
  `severity`     ENUM('low','medium','high') NOT NULL DEFAULT 'medium',
  -- What the model should look for in the transcript / notes.
  `body_md`      MEDIUMTEXT   NOT NULL,
  -- How to coach the fix; steers the recommended_approach wording.
  `guidance_md`  MEDIUMTEXT   NULL,
  `is_active`    BOOLEAN      NOT NULL DEFAULT TRUE,
  `sort_order`   SMALLINT     NOT NULL DEFAULT 100,
  `updated_by`   INT          NULL,
  `created_at`   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`rule_id`),
  UNIQUE KEY `uq_mo_rule_key` (`rule_key`),
  KEY `idx_mo_rule_active` (`is_active`, `sort_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `ie_missed_opportunity_run` (
  `run_id`            INT  NOT NULL AUTO_INCREMENT,
  -- Business day analyzed (not the day the worker executed).
  `run_date`          DATE NOT NULL,
  `status`            ENUM('RUNNING','SUCCESS','PARTIAL','FAILED') NOT NULL DEFAULT 'RUNNING',
  `calls_considered`  INT  NOT NULL DEFAULT 0,
  `calls_analyzed`    INT  NOT NULL DEFAULT 0,
  `calls_failed`      INT  NOT NULL DEFAULT 0,
  `calls_skipped`     INT  NOT NULL DEFAULT 0,
  `findings_count`    INT  NOT NULL DEFAULT 0,
  `tokens_in`         INT  NOT NULL DEFAULT 0,
  `tokens_out`        INT  NOT NULL DEFAULT 0,
  `usd_cost`          DECIMAL(10,4) NOT NULL DEFAULT 0,
  `model_used`        VARCHAR(80)   NULL,
  `error_text`        VARCHAR(500)  NULL,
  `started_at`        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `finished_at`       DATETIME NULL,
  PRIMARY KEY (`run_id`),
  -- One row per business day; a re-run updates in place.
  UNIQUE KEY `uq_mo_run_date` (`run_date`),
  KEY `idx_mo_run_finished` (`finished_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `ie_missed_opportunity_finding` (
  `finding_id`           BIGINT       NOT NULL AUTO_INCREMENT,
  -- YYYYMMDD of the call, so reads join ie_dim_date like the rest of Insights.
  `date_key`             INT          NOT NULL,
  `run_date`             DATE         NOT NULL,
  `employee_key`         INT          NULL,
  `agent_email`          VARCHAR(190) NULL,
  `agent_name`           VARCHAR(160) NULL,
  `conversation_id`      VARCHAR(64)  NULL,
  `call_started_at`      DATETIME     NULL,
  `talk_secs`            INT          NULL,
  `direction`            VARCHAR(16)  NULL,
  `customer_name`        VARCHAR(200) NULL,
  `customer_id`          INT          NULL,
  `rule_key`             VARCHAR(64)  NOT NULL,
  `severity`             ENUM('low','medium','high') NOT NULL DEFAULT 'medium',
  `title`                VARCHAR(240) NOT NULL,
  `what_happened`        TEXT         NOT NULL,
  `evidence_quote`       TEXT         NULL,
  `recommended_approach` TEXT         NOT NULL,
  `est_value_note`       VARCHAR(240) NULL,
  `created_at`           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`finding_id`),
  KEY `idx_mo_find_date` (`date_key`),
  KEY `idx_mo_find_emp`  (`employee_key`, `date_key`),
  KEY `idx_mo_find_rule` (`rule_key`, `date_key`),
  KEY `idx_mo_find_run`  (`run_date`),
  KEY `idx_mo_find_conv` (`conversation_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────────────────────
-- Starter rule set: the ten rules used to grade the 2026-09-04 review by hand.
-- Admins can edit, deactivate, or add to these from the report's Settings tab
-- without a code change.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT IGNORE INTO `ie_missed_opportunity_rule`
  (`rule_key`, `rule_name`, `category`, `severity`, `sort_order`, `body_md`, `guidance_md`) VALUES

('buying_signal_not_closed', 'Buying signal not closed', 'Closing', 'high', 10,
 'The customer signalled readiness to buy and the rep did not attempt to take the order on the call. Signals include asking how to get started, asking whether to order online or through the rep, naming a go-live or opening date, or saying they are ready to move forward. Flag when the rep responded with a quote, a proposal, or a future follow-up instead of placing the order.',
 'Coach the rep to close on the call when the customer asks how to buy. The recommended approach should give exact words that ask for the order and tie it to the customer''s own date or event.'),

('group_expansion_not_captured', 'Multi-location or group expansion not captured', 'Expansion', 'high', 20,
 'The customer revealed they operate, manage, or belong to more than one location, franchise group, dealership group, portfolio, or corporate parent, and the rep handled the call as a single site. Flag when the rep did not ask how many locations exist, did not ask which sites lack service, did not request the corporate or group contact, or accepted a passive hand-off such as the customer offering to pass along information.',
 'Coach the rep to size the group and ask for the decision-maker. The recommended approach should name the group and propose a concrete group-level next step rather than one rooftop.'),

('no_dated_next_step', 'No dated next step', 'Follow-through', 'medium', 30,
 'The call ended without a specific date or time for the next contact, or the rep left the next move entirely with the customer. Flag phrasing such as telling the customer to call back whenever they are ready, saying the rep will circle back later, or agreeing to a vague timeframe. Also flag when a follow-up date was set but falls after the customer''s own deadline, opening, or renovation date.',
 'Coach the rep to put a date on the calendar before hanging up and to write that date into the CRM note. The recommended approach should propose a specific day tied to the customer''s event.'),

('warranty_not_offered', 'Extended warranty not offered', 'Attach rate', 'medium', 40,
 'An order was placed, priced, or quoted for hardware such as a player, radio, amplifier, or speakers and the rep never offered the multi-year extended warranty. Flag only when hardware was actually in play. Do not flag when the rep offered it and the customer declined.',
 'Coach the rep to attach the warranty to every hardware order and to explain advance replacement on decline rather than dropping it.'),

('churn_not_routed_to_cs', 'Cancellation or churn threat not routed to Customer Service', 'Retention', 'high', 50,
 'The customer asked to cancel, threatened to leave, or raised a renewal or price objection that puts the account at risk, and the rep did not transfer them to Customer Service for the save. Correctly transferring a cancellation to Customer Service is the required process and is NOT a miss — only flag when the rep handled it themselves, was dismissive, or let the customer go without routing.',
 'Coach the rep to hand churn to Customer Service for retention options. The recommended approach should include the transfer language that keeps the customer warm.'),

('competitor_or_price_objection_unanswered', 'Competitor or price objection left unanswered', 'Objection handling', 'medium', 60,
 'The customer raised a competitor, a competing quote, a price comparison, or a technical blocker, and the rep could not answer it, guessed, or left it open. Flag when the rep admitted not knowing competitor pricing, speculated on an integration or compatibility question that is the actual blocker to the deal, or promised nothing concrete in response.',
 'Coach the rep to come back with a written answer on a committed date and to know competitor positioning before the conversation.'),

('weak_or_missing_voicemail', 'Weak or missing voicemail', 'Prospecting', 'low', 70,
 'The rep reached voicemail and either left no message at all, or left a message missing one or more of: their name, the company, one concrete reason to call back, and a direct phone number. Also flag give-up messaging such as saying this is the last follow-up attempt, which removes any reason to respond.',
 'Coach a four-part voicemail: name, company, one concrete value reason, direct number. The recommended approach should supply a rewritten message for this specific account.'),

('service_call_no_sales_probe', 'Service or admin call with no sales probe', 'Expansion', 'low', 80,
 'The call was billing, shipping, technical, or administrative and the rep resolved it correctly but never probed for growth while they had the customer engaged. Flag only when there was a natural opening, such as an account with hardware, an upcoming project, or a multi-site customer.',
 'Coach one relevant growth question per service contact. The recommended approach should give a question that fits what this customer actually said.'),

('deal_lost_over_small_blocker', 'Deal lost over a small fee or blocker without escalation', 'Closing', 'high', 90,
 'The rep let a deal stall or die over a small dollar amount or a solvable logistical blocker — a site survey fee, an activation fee, a shipping constraint, a payment method — without offering to waive it, credit it toward the purchase, or escalate it. Flag when the customer went elsewhere or the rep accepted the loss.',
 'Coach the rep to waive, credit, or escalate small blockers rather than lose the job. The recommended approach should name the specific concession to offer.'),

('professionalism_or_compliance', 'Professionalism or compliance lapse', 'Conduct', 'high', 100,
 'The rep said something on a recorded line that creates a professionalism, compliance, or margin-disclosure problem. Examples include discussing internal margin or cost with a customer, profanity, disparaging the company''s own systems or colleagues, or spending the majority of a long call on unrelated small talk instead of the customer''s business.',
 'Coach the specific line that should not have been said and what to say instead. Keep the recommended approach direct and non-punitive.');

-- ─────────────────────────────────────────────────────────────────────────────
-- Scalar settings live in the existing ie_config key/value store — no new table.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT IGNORE INTO `ie_config` (`config_key`, `config_value`, `description`) VALUES
  ('missed_opps_min_talk_secs', '100',
   'Missed Opportunities: minimum connected talk seconds for a call to be analyzed.'),
  ('missed_opps_excluded_agents', 'Drew Feely,Joshua Barber',
   'Missed Opportunities: comma-separated agent names excluded from analysis (BDRs).'),
  ('missed_opps_daily_usd_cap', '25.00',
   'Missed Opportunities: hard USD cap for a single day''s analysis run.'),
  ('missed_opps_model_tier', 'cheap',
   'Missed Opportunities: model tier for analysis — "cheap" or "reasoning".'),
  ('missed_opps_max_calls_per_run', '400',
   'Missed Opportunities: safety cap on calls analyzed in one run.');

-- ─────────────────────────────────────────────────────────────────────────────
-- Active monitoring (per .cursor/rules/insights-report-page.mdc: every report
-- page must be covered). Registry row only — no schema change.
--
-- check_kind is daily_fact against ie_missed_opportunity_run, NOT run_recency
-- against ie_ingestion_log. run_recency's volume signal is the last run's
-- rows_loaded, which here is the FINDINGS count — and a day where every rep
-- worked their calls well legitimately has zero findings, so run_recency would
-- WARN on good news. One run row per business day makes the volume check
-- structurally 1-vs-1 (always healthy) while freshness still goes RED the
-- moment a day's review is missing, which is the only thing worth alerting on.
--
-- producer_kind 'llm_worker' is new: the existing values (source_report /
-- rollup_capture / import_feed) all describe SQL producers. Only the equality
-- test against 'source_report' matters to the evaluator (it picks the alert
-- channel), so a new value is safe and honest about what produces this data.
-- arrears_days = 1 because the 05:20 run covers the PRIOR business day.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO `ie_dataset_monitor`
  (`dataset_code`, `display_name`, `producer_kind`, `producer_ref`, `check_kind`,
   `fact_table`, `date_column`, `date_kind`, `expected_by_hour`, `cadence_minutes`,
   `arrears_days`, `business_days_only`, `baseline_lookback_days`, `warn_pct`, `red_pct`,
   `min_expected_rows`, `zero_is_red`, `is_active`)
VALUES
  ('missed_opportunities', 'Missed Opportunities', 'llm_worker', 'MissedOpportunitiesWorker',
   'daily_fact', 'ie_missed_opportunity_run', 'run_date', 'date', 7, 1440, 1, 1, 56,
   50.00, 15.00, 0, 0, 1)
ON DUPLICATE KEY UPDATE
  `display_name`   = VALUES(`display_name`),
  `producer_kind`  = VALUES(`producer_kind`),
  `producer_ref`   = VALUES(`producer_ref`),
  `check_kind`     = VALUES(`check_kind`),
  `fact_table`     = VALUES(`fact_table`),
  `date_column`    = VALUES(`date_column`),
  `date_kind`      = VALUES(`date_kind`);

-- ─────────────────────────────────────────────────────────────────────────────
-- Insights page registry. Access is DB-driven via ie_page_role_access like every
-- other Insights page: Admin (1) + Manager (5) at ALL scope, matching the other
-- Sales Agent Activity pages (CSR grants were removed for Sales in
-- 20260818120000_insights_sales_remove_csr_role_grants).
-- ─────────────────────────────────────────────────────────────────────────────
INSERT IGNORE INTO `ie_page`
  (`page_key`, `page_name`, `description`, `category`, `route_path`, `icon`, `sort_order`, `is_active`, `requires_section`) VALUES
  ('aa_sales_missed_opportunities', 'Missed Opportunities',
   'Daily review of sales calls: each missed opportunity by agent with a recommended approach to fix it.',
   'Agent Activity - Sales', '/app/insights/aa-missed-opportunities', 'Lightbulb', 20, TRUE, 'insights');

INSERT IGNORE INTO `ie_page_role_access` (`page_id`, `role_id`, `can_access`, `data_scope`)
SELECT id, 1, TRUE, 'ALL' FROM `ie_page` WHERE `page_key` = 'aa_sales_missed_opportunities';

INSERT IGNORE INTO `ie_page_role_access` (`page_id`, `role_id`, `can_access`, `data_scope`)
SELECT id, 5, TRUE, 'ALL' FROM `ie_page` WHERE `page_key` = 'aa_sales_missed_opportunities';
