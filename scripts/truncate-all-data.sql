-- Wipe all data from the QTIP database in preparation for production migration.
-- Does NOT drop or alter any table structure.
-- All AUTO_INCREMENT counters are reset to 1.
-- Run with: mysql -u root -p"PASSWORD" qtip -e "source scripts/truncate-all-data.sql"

SET FOREIGN_KEY_CHECKS = 0;
SET UNIQUE_CHECKS = 0;

-- -----------------------------------------------------------------------
-- Leaf / deeply-nested tables first (children before parents)
-- -----------------------------------------------------------------------

-- Write-up children
TRUNCATE TABLE `write_up_attachments`;
TRUNCATE TABLE `write_up_incidents`;
TRUNCATE TABLE `write_up_violations`;
TRUNCATE TABLE `write_up_examples`;
TRUNCATE TABLE `write_up_prior_discipline`;
TRUNCATE TABLE `write_ups`;

-- Quiz / training children
TRUNCATE TABLE `quiz_attempts`;
TRUNCATE TABLE `quiz_topics`;
TRUNCATE TABLE `quiz_questions`;
TRUNCATE TABLE `quizzes`;
TRUNCATE TABLE `training_resource_topics`;
TRUNCATE TABLE `training_resources`;

-- Submission children
TRUNCATE TABLE `free_text_answers`;
TRUNCATE TABLE `submission_answers`;
TRUNCATE TABLE `submission_calls`;
TRUNCATE TABLE `submission_metadata`;
TRUNCATE TABLE `dispute_score_history`;
TRUNCATE TABLE `disputes`;
TRUNCATE TABLE `score_snapshots`;
TRUNCATE TABLE `submissions`;

-- Coaching children
TRUNCATE TABLE `coaching_session_topics`;
TRUNCATE TABLE `coaching_sessions`;

-- Calls
TRUNCATE TABLE `calls`;

-- Audit / activity
TRUNCATE TABLE `audit_logs`;
TRUNCATE TABLE `agent_activity`;
TRUNCATE TABLE `audit_assignments`;
TRUNCATE TABLE `auth_logs`;

-- Form children
TRUNCATE TABLE `form_question_conditions`;
TRUNCATE TABLE `radio_options`;
TRUNCATE TABLE `form_questions`;
TRUNCATE TABLE `form_categories`;
TRUNCATE TABLE `form_metadata_fields`;
TRUNCATE TABLE `forms`;

-- Performance goals
TRUNCATE TABLE `performance_goal_users`;
TRUNCATE TABLE `performance_goal_departments`;
TRUNCATE TABLE `performance_goals`;

-- Department managers / topics
TRUNCATE TABLE `department_managers`;
TRUNCATE TABLE `topics`;

-- Courses
TRUNCATE TABLE `courses`;

-- Alerts
TRUNCATE TABLE `alert_notification_queue`;
TRUNCATE TABLE `alert_rules`;
TRUNCATE TABLE `user_alert_preferences`;

-- Raw data tables
TRUNCATE TABLE `call_activity_raw`;
TRUNCATE TABLE `sales_margin_raw`;
TRUNCATE TABLE `lead_sales_margin_raw`;
TRUNCATE TABLE `lead_source_raw`;
TRUNCATE TABLE `ticket_task_raw`;
TRUNCATE TABLE `email_stats_raw`;
TRUNCATE TABLE `entity_raw`;
TRUNCATE TABLE `import_logs`;
TRUNCATE TABLE `raw_table_config`;

-- Insights tables
TRUNCATE TABLE `ie_page_user_override`;
TRUNCATE TABLE `ie_page_role_access`;
TRUNCATE TABLE `ie_page`;
TRUNCATE TABLE `ie_kpi_threshold`;
TRUNCATE TABLE `ie_kpi`;
TRUNCATE TABLE `ie_ingestion_log`;
TRUNCATE TABLE `ie_ingestion_lock`;
TRUNCATE TABLE `ie_dim_employee`;
TRUNCATE TABLE `ie_dim_department`;
TRUNCATE TABLE `ie_dim_date`;
TRUNCATE TABLE `ie_config`;

-- Metric / report definitions
TRUNCATE TABLE `metric_thresholds`;
TRUNCATE TABLE `metric_departments`;
TRUNCATE TABLE `metric_definitions`;
TRUNCATE TABLE `report_definition_departments`;
TRUNCATE TABLE `report_definitions`;

-- Calendar
TRUNCATE TABLE `business_calendar_days`;

-- -----------------------------------------------------------------------
-- Core / parent tables last
-- -----------------------------------------------------------------------

TRUNCATE TABLE `users`;
TRUNCATE TABLE `departments`;
TRUNCATE TABLE `roles`;

-- list_items is @@ignore in Prisma — skip it

-- -----------------------------------------------------------------------
-- Reset AUTO_INCREMENT on all tables that use it
-- -----------------------------------------------------------------------

ALTER TABLE `roles`                       AUTO_INCREMENT = 1;
ALTER TABLE `departments`                 AUTO_INCREMENT = 1;
ALTER TABLE `users`                       AUTO_INCREMENT = 1;
ALTER TABLE `forms`                       AUTO_INCREMENT = 1;
ALTER TABLE `form_metadata_fields`        AUTO_INCREMENT = 1;
ALTER TABLE `form_categories`             AUTO_INCREMENT = 1;
ALTER TABLE `form_questions`              AUTO_INCREMENT = 1;
ALTER TABLE `radio_options`               AUTO_INCREMENT = 1;
ALTER TABLE `form_question_conditions`    AUTO_INCREMENT = 1;
ALTER TABLE `performance_goals`           AUTO_INCREMENT = 1;
ALTER TABLE `performance_goal_users`      AUTO_INCREMENT = 1;
ALTER TABLE `performance_goal_departments` AUTO_INCREMENT = 1;
ALTER TABLE `audit_assignments`           AUTO_INCREMENT = 1;
ALTER TABLE `department_managers`         AUTO_INCREMENT = 1;
ALTER TABLE `courses`                     AUTO_INCREMENT = 1;
ALTER TABLE `quizzes`                     AUTO_INCREMENT = 1;
ALTER TABLE `quiz_topics`                 AUTO_INCREMENT = 1;
ALTER TABLE `quiz_questions`              AUTO_INCREMENT = 1;
ALTER TABLE `quiz_attempts`               AUTO_INCREMENT = 1;
ALTER TABLE `training_resources`          AUTO_INCREMENT = 1;
ALTER TABLE `training_resource_topics`    AUTO_INCREMENT = 1;
ALTER TABLE `coaching_sessions`           AUTO_INCREMENT = 1;
ALTER TABLE `coaching_session_topics`     AUTO_INCREMENT = 1;
ALTER TABLE `write_ups`                   AUTO_INCREMENT = 1;
ALTER TABLE `write_up_incidents`          AUTO_INCREMENT = 1;
ALTER TABLE `write_up_violations`         AUTO_INCREMENT = 1;
ALTER TABLE `write_up_examples`           AUTO_INCREMENT = 1;
ALTER TABLE `write_up_prior_discipline`   AUTO_INCREMENT = 1;
ALTER TABLE `write_up_attachments`        AUTO_INCREMENT = 1;
ALTER TABLE `calls`                       AUTO_INCREMENT = 1;
ALTER TABLE `submissions`                 AUTO_INCREMENT = 1;
ALTER TABLE `submission_metadata`         AUTO_INCREMENT = 1;
ALTER TABLE `submission_calls`            AUTO_INCREMENT = 1;
ALTER TABLE `submission_answers`          AUTO_INCREMENT = 1;
ALTER TABLE `score_snapshots`             AUTO_INCREMENT = 1;
ALTER TABLE `disputes`                    AUTO_INCREMENT = 1;
ALTER TABLE `dispute_score_history`       AUTO_INCREMENT = 1;
ALTER TABLE `audit_logs`                  AUTO_INCREMENT = 1;
ALTER TABLE `agent_activity`              AUTO_INCREMENT = 1;
ALTER TABLE `topics`                      AUTO_INCREMENT = 1;
ALTER TABLE `auth_logs`                   AUTO_INCREMENT = 1;
ALTER TABLE `alert_rules`                 AUTO_INCREMENT = 1;
ALTER TABLE `user_alert_preferences`      AUTO_INCREMENT = 1;
ALTER TABLE `metric_definitions`          AUTO_INCREMENT = 1;
ALTER TABLE `metric_departments`          AUTO_INCREMENT = 1;
ALTER TABLE `metric_thresholds`           AUTO_INCREMENT = 1;
ALTER TABLE `report_definitions`          AUTO_INCREMENT = 1;
ALTER TABLE `report_definition_departments` AUTO_INCREMENT = 1;
ALTER TABLE `import_logs`                 AUTO_INCREMENT = 1;
ALTER TABLE `raw_table_config`            AUTO_INCREMENT = 1;
ALTER TABLE `ie_kpi`                      AUTO_INCREMENT = 1;
ALTER TABLE `ie_kpi_threshold`            AUTO_INCREMENT = 1;
ALTER TABLE `ie_page`                     AUTO_INCREMENT = 1;
ALTER TABLE `ie_page_role_access`         AUTO_INCREMENT = 1;
ALTER TABLE `ie_page_user_override`       AUTO_INCREMENT = 1;
ALTER TABLE `ie_ingestion_log`            AUTO_INCREMENT = 1;

SET FOREIGN_KEY_CHECKS = 1;
SET UNIQUE_CHECKS = 1;

SELECT 'All tables truncated and AUTO_INCREMENT reset.' AS status;
