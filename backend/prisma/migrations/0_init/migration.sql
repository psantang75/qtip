SET FOREIGN_KEY_CHECKS=0;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `agent_activity` (
  `id` int NOT NULL AUTO_INCREMENT,
  `csr_id` int NOT NULL,
  `department_id` int DEFAULT NULL,
  `activity_date` date NOT NULL,
  `status_switches` int NOT NULL DEFAULT '0',
  `start_time` datetime NOT NULL,
  `end_time` datetime NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `agent_activity_activity_date_idx` (`activity_date`),
  KEY `agent_activity_csr_id_fkey` (`csr_id`),
  KEY `agent_activity_department_id_fkey` (`department_id`),
  CONSTRAINT `agent_activity_csr_id_fkey` FOREIGN KEY (`csr_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `agent_activity_department_id_fkey` FOREIGN KEY (`department_id`) REFERENCES `departments` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `alert_notification_queue` (
  `id` int NOT NULL AUTO_INCREMENT,
  `rule_id` int NOT NULL,
  `user_id` int NOT NULL,
  `message` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `priority` enum('CRITICAL','HIGH','NORMAL') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'NORMAL',
  `is_sent` tinyint(1) NOT NULL DEFAULT '0',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `sent_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `alert_notification_queue_is_sent_created_at_idx` (`is_sent`,`created_at`),
  KEY `alert_notification_queue_rule_id_fkey` (`rule_id`),
  KEY `alert_notification_queue_user_id_fkey` (`user_id`),
  CONSTRAINT `alert_notification_queue_rule_id_fkey` FOREIGN KEY (`rule_id`) REFERENCES `alert_rules` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `alert_notification_queue_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `alert_rules` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(150) COLLATE utf8mb4_unicode_ci NOT NULL,
  `metric_id` int NOT NULL,
  `condition_operator` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `threshold_value` decimal(10,2) NOT NULL,
  `scope` enum('USER','TEAM','DEPARTMENT','ORG') COLLATE utf8mb4_unicode_ci NOT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_by` int NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `alert_rules_metric_id_fkey` (`metric_id`),
  KEY `alert_rules_created_by_fkey` (`created_by`),
  CONSTRAINT `alert_rules_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `alert_rules_metric_id_fkey` FOREIGN KEY (`metric_id`) REFERENCES `metric_definitions` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `audit_assignments` (
  `id` int NOT NULL AUTO_INCREMENT,
  `form_id` int NOT NULL,
  `target_id` int DEFAULT NULL,
  `target_type` enum('USER','DEPARTMENT') COLLATE utf8mb4_unicode_ci NOT NULL,
  `schedule` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_by` int NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `qa_id` int DEFAULT NULL,
  `start_date` datetime NOT NULL,
  `end_date` datetime DEFAULT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  PRIMARY KEY (`id`),
  KEY `audit_assignments_form_id_fkey` (`form_id`),
  KEY `audit_assignments_created_by_fkey` (`created_by`),
  KEY `audit_assignments_qa_id_fkey` (`qa_id`),
  CONSTRAINT `audit_assignments_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `audit_assignments_form_id_fkey` FOREIGN KEY (`form_id`) REFERENCES `forms` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `audit_assignments_qa_id_fkey` FOREIGN KEY (`qa_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `audit_logs` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `action` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `target_id` int DEFAULT NULL,
  `target_type` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `details` text COLLATE utf8mb4_unicode_ci,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `audit_logs_user_id_fkey` (`user_id`),
  CONSTRAINT `audit_logs_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=389 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `auth_logs` (
  `id` int NOT NULL AUTO_INCREMENT,
  `email` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `success` tinyint(1) NOT NULL,
  `ip_address` varchar(45) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `attempted_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=1076 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `business_calendar_days` (
  `id` int NOT NULL AUTO_INCREMENT,
  `calendar_date` date NOT NULL,
  `day_type` enum('WORKDAY','WEEKEND','HOLIDAY','CLOSURE','ADJUSTMENT') COLLATE utf8mb4_unicode_ci NOT NULL,
  `note` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `business_calendar_days_calendar_date_key` (`calendar_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `call_activity_raw` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `report_date` date NOT NULL,
  `calls_offered` int NOT NULL DEFAULT '0',
  `calls_handled` int NOT NULL DEFAULT '0',
  `hold_minutes` decimal(10,2) NOT NULL DEFAULT '0.00',
  `line_minutes` decimal(10,2) NOT NULL DEFAULT '0.00',
  `wrap_minutes` decimal(10,2) NOT NULL DEFAULT '0.00',
  `import_id` int DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `call_activity_raw_user_id_report_date_idx` (`user_id`,`report_date`),
  KEY `call_activity_raw_import_id_fkey` (`import_id`),
  CONSTRAINT `call_activity_raw_import_id_fkey` FOREIGN KEY (`import_id`) REFERENCES `import_logs` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `call_activity_raw_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `calls` (
  `id` int NOT NULL AUTO_INCREMENT,
  `call_id` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `csr_id` int NOT NULL,
  `department_id` int DEFAULT NULL,
  `customer_id` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `call_date` datetime NOT NULL,
  `duration` int NOT NULL,
  `recording_url` text COLLATE utf8mb4_unicode_ci,
  `transcript` longtext COLLATE utf8mb4_unicode_ci,
  `metadata` text COLLATE utf8mb4_unicode_ci,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `calls_call_id_key` (`call_id`),
  KEY `calls_call_date_idx` (`call_date`),
  KEY `calls_csr_id_fkey` (`csr_id`),
  KEY `calls_department_id_fkey` (`department_id`),
  CONSTRAINT `calls_csr_id_fkey` FOREIGN KEY (`csr_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `calls_department_id_fkey` FOREIGN KEY (`department_id`) REFERENCES `departments` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=27 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `certificates` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `course_id` int NOT NULL,
  `issue_date` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `expiry_date` datetime DEFAULT NULL,
  `enrollment_id` int DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `certificates_enrollment_id_idx` (`enrollment_id`),
  KEY `certificates_user_id_fkey` (`user_id`),
  KEY `certificates_course_id_fkey` (`course_id`),
  CONSTRAINT `certificates_course_id_fkey` FOREIGN KEY (`course_id`) REFERENCES `courses` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `certificates_enrollment_id_fkey` FOREIGN KEY (`enrollment_id`) REFERENCES `enrollments` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `certificates_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=13 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `coaching_session_behavior_flags` (
  `coaching_session_id` int NOT NULL,
  `list_item_id` int NOT NULL,
  PRIMARY KEY (`coaching_session_id`,`list_item_id`),
  KEY `list_item_id` (`list_item_id`),
  CONSTRAINT `coaching_session_behavior_flags_ibfk_1` FOREIGN KEY (`coaching_session_id`) REFERENCES `coaching_sessions` (`id`) ON DELETE CASCADE,
  CONSTRAINT `coaching_session_behavior_flags_ibfk_2` FOREIGN KEY (`list_item_id`) REFERENCES `list_items` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `coaching_session_quizzes` (
  `coaching_session_id` int NOT NULL,
  `quiz_id` int NOT NULL,
  PRIMARY KEY (`coaching_session_id`,`quiz_id`),
  KEY `quiz_id` (`quiz_id`),
  KEY `idx_csq_session` (`coaching_session_id`),
  CONSTRAINT `coaching_session_quizzes_ibfk_1` FOREIGN KEY (`coaching_session_id`) REFERENCES `coaching_sessions` (`id`) ON DELETE CASCADE,
  CONSTRAINT `coaching_session_quizzes_ibfk_2` FOREIGN KEY (`quiz_id`) REFERENCES `quizzes` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `coaching_session_resources` (
  `coaching_session_id` int NOT NULL,
  `resource_id` int NOT NULL,
  PRIMARY KEY (`coaching_session_id`,`resource_id`),
  KEY `resource_id` (`resource_id`),
  KEY `idx_csr_session` (`coaching_session_id`),
  CONSTRAINT `coaching_session_resources_ibfk_1` FOREIGN KEY (`coaching_session_id`) REFERENCES `coaching_sessions` (`id`) ON DELETE CASCADE,
  CONSTRAINT `coaching_session_resources_ibfk_2` FOREIGN KEY (`resource_id`) REFERENCES `training_resources` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `coaching_session_topics` (
  `id` int NOT NULL AUTO_INCREMENT,
  `coaching_session_id` int NOT NULL,
  `topic_id` int NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `coaching_session_topics_coaching_session_id_topic_id_key` (`coaching_session_id`,`topic_id`),
  KEY `coaching_session_topics_coaching_session_id_idx` (`coaching_session_id`),
  KEY `coaching_session_topics_topic_id_idx` (`topic_id`),
  CONSTRAINT `coaching_session_topics_coaching_session_id_fkey` FOREIGN KEY (`coaching_session_id`) REFERENCES `coaching_sessions` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `coaching_session_topics_topic_id_fkey` FOREIGN KEY (`topic_id`) REFERENCES `topics` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=137 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `coaching_sessions` (
  `id` int NOT NULL AUTO_INCREMENT,
  `batch_id` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `csr_id` int NOT NULL,
  `session_date` datetime NOT NULL,
  `notes` text COLLATE utf8mb4_unicode_ci,
  `attachment_filename` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `attachment_path` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `attachment_size` int DEFAULT NULL,
  `attachment_mime_type` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` enum('SCHEDULED','IN_PROCESS','AWAITING_CSR_ACTION','QUIZ_PENDING','COMPLETED','FOLLOW_UP_REQUIRED','CLOSED') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'SCHEDULED',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `created_by` int DEFAULT NULL,
  `completed_at` datetime DEFAULT NULL,
  `csr_acknowledged_at` datetime DEFAULT NULL,
  `csr_action_plan` text COLLATE utf8mb4_unicode_ci,
  `csr_root_cause` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `csr_support_needed` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `delivered_at` datetime DEFAULT NULL,
  `follow_up_date` datetime DEFAULT NULL,
  `follow_up_notes` text COLLATE utf8mb4_unicode_ci,
  `internal_notes` text COLLATE utf8mb4_unicode_ci,
  `behavior_flags` varchar(1000) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `follow_up_required` tinyint(1) NOT NULL DEFAULT '0',
  `kb_resource_id` int DEFAULT NULL,
  `kb_url` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `qa_audit_id` int DEFAULT NULL,
  `quiz_id` int DEFAULT NULL,
  `quiz_required` tinyint(1) NOT NULL DEFAULT '0',
  `require_acknowledgment` tinyint(1) NOT NULL DEFAULT '1',
  `require_action_plan` tinyint(1) NOT NULL DEFAULT '1',
  `required_action` text COLLATE utf8mb4_unicode_ci,
  `source_type` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'OTHER',
  `coaching_purpose` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'WEEKLY',
  `coaching_format` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'ONE_ON_ONE',
  `due_date` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `coaching_sessions_created_by_idx` (`created_by`),
  KEY `coaching_sessions_csr_id_created_by_idx` (`csr_id`,`created_by`),
  KEY `coaching_sessions_kb_resource_id_fkey` (`kb_resource_id`),
  KEY `coaching_sessions_quiz_id_fkey` (`quiz_id`),
  KEY `coaching_sessions_csr_id_coaching_purpose_idx` (`csr_id`,`coaching_purpose`),
  KEY `coaching_sessions_session_date_coaching_purpose_idx` (`session_date`,`coaching_purpose`),
  KEY `coaching_sessions_coaching_purpose_idx` (`coaching_purpose`),
  KEY `coaching_sessions_coaching_format_idx` (`coaching_format`),
  KEY `idx_cs_batch_id` (`batch_id`),
  CONSTRAINT `coaching_sessions_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `coaching_sessions_csr_id_fkey` FOREIGN KEY (`csr_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `coaching_sessions_kb_resource_id_fkey` FOREIGN KEY (`kb_resource_id`) REFERENCES `training_resources` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `coaching_sessions_quiz_id_fkey` FOREIGN KEY (`quiz_id`) REFERENCES `quizzes` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=46 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `course_pages` (
  `id` int NOT NULL AUTO_INCREMENT,
  `course_id` int NOT NULL,
  `page_title` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `content_type` enum('TEXT','VIDEO','PDF') COLLATE utf8mb4_unicode_ci NOT NULL,
  `content_url` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `content_text` text COLLATE utf8mb4_unicode_ci,
  `page_order` int NOT NULL,
  PRIMARY KEY (`id`),
  KEY `course_pages_course_id_fkey` (`course_id`),
  CONSTRAINT `course_pages_course_id_fkey` FOREIGN KEY (`course_id`) REFERENCES `courses` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=22 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `courses` (
  `id` int NOT NULL AUTO_INCREMENT,
  `course_name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `created_by` int NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `is_draft` tinyint(1) NOT NULL DEFAULT '1',
  PRIMARY KEY (`id`),
  KEY `courses_created_by_fkey` (`created_by`),
  CONSTRAINT `courses_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=6 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `department_managers` (
  `id` int NOT NULL AUTO_INCREMENT,
  `department_id` int NOT NULL,
  `manager_id` int NOT NULL,
  `assigned_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `assigned_by` int NOT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  PRIMARY KEY (`id`),
  UNIQUE KEY `department_managers_department_id_manager_id_key` (`department_id`,`manager_id`),
  KEY `department_managers_department_id_idx` (`department_id`),
  KEY `department_managers_manager_id_idx` (`manager_id`),
  KEY `department_managers_assigned_by_fkey` (`assigned_by`),
  CONSTRAINT `department_managers_assigned_by_fkey` FOREIGN KEY (`assigned_by`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `department_managers_department_id_fkey` FOREIGN KEY (`department_id`) REFERENCES `departments` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `department_managers_manager_id_fkey` FOREIGN KEY (`manager_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=26 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `departments` (
  `id` int NOT NULL AUTO_INCREMENT,
  `department_name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  PRIMARY KEY (`id`),
  UNIQUE KEY `departments_department_name_key` (`department_name`)
) ENGINE=InnoDB AUTO_INCREMENT=8 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `dispute_score_history` (
  `id` int NOT NULL AUTO_INCREMENT,
  `dispute_id` int NOT NULL,
  `submission_id` int NOT NULL,
  `score_type` enum('PREVIOUS','ADJUSTED') COLLATE utf8mb4_unicode_ci NOT NULL,
  `score` decimal(5,2) NOT NULL,
  `recorded_by` int DEFAULT NULL,
  `notes` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `dispute_score_history_dispute_id_created_at_idx` (`dispute_id`,`created_at`),
  KEY `dispute_score_history_recorded_by_idx` (`recorded_by`),
  KEY `dispute_score_history_submission_id_idx` (`submission_id`),
  CONSTRAINT `dispute_score_history_dispute_id_fkey` FOREIGN KEY (`dispute_id`) REFERENCES `disputes` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `dispute_score_history_recorded_by_fkey` FOREIGN KEY (`recorded_by`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `dispute_score_history_submission_id_fkey` FOREIGN KEY (`submission_id`) REFERENCES `submissions` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=29 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `disputes` (
  `id` int NOT NULL AUTO_INCREMENT,
  `submission_id` int NOT NULL,
  `disputed_by` int NOT NULL,
  `resolved_by` int DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `resolved_at` datetime DEFAULT NULL,
  `status` enum('OPEN','UPHELD','REJECTED','ADJUSTED') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'OPEN',
  `reason` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `resolution_notes` text COLLATE utf8mb4_unicode_ci,
  `attachment_url` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `disputes_submission_id_fkey` (`submission_id`),
  KEY `disputes_disputed_by_fkey` (`disputed_by`),
  KEY `disputes_resolved_by_fkey` (`resolved_by`),
  CONSTRAINT `disputes_disputed_by_fkey` FOREIGN KEY (`disputed_by`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `disputes_resolved_by_fkey` FOREIGN KEY (`resolved_by`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `disputes_submission_id_fkey` FOREIGN KEY (`submission_id`) REFERENCES `submissions` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=31 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `email_stats_raw` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `report_date` date NOT NULL,
  `emails_sent` int NOT NULL DEFAULT '0',
  `emails_received` int NOT NULL DEFAULT '0',
  `crm_contacts_updated` int NOT NULL DEFAULT '0',
  `bounces` int NOT NULL DEFAULT '0',
  `import_id` int DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `email_stats_raw_user_id_report_date_idx` (`user_id`,`report_date`),
  KEY `email_stats_raw_import_id_fkey` (`import_id`),
  CONSTRAINT `email_stats_raw_import_id_fkey` FOREIGN KEY (`import_id`) REFERENCES `import_logs` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `email_stats_raw_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `enrollments` (
  `id` int NOT NULL AUTO_INCREMENT,
  `course_id` int DEFAULT NULL,
  `user_id` int DEFAULT NULL,
  `status` enum('IN_PROGRESS','COMPLETED') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'IN_PROGRESS',
  `progress` decimal(5,2) NOT NULL DEFAULT '0.00',
  `due_date` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `path_id` int DEFAULT NULL,
  `department_id` int DEFAULT NULL,
  `assignment_type` enum('COURSE','TRAINING_PATH') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'COURSE',
  `target_type` enum('USER','DEPARTMENT') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'USER',
  PRIMARY KEY (`id`),
  KEY `enrollments_course_id_fkey` (`course_id`),
  KEY `enrollments_user_id_fkey` (`user_id`),
  KEY `enrollments_path_id_fkey` (`path_id`),
  KEY `enrollments_department_id_fkey` (`department_id`),
  CONSTRAINT `enrollments_course_id_fkey` FOREIGN KEY (`course_id`) REFERENCES `courses` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `enrollments_department_id_fkey` FOREIGN KEY (`department_id`) REFERENCES `departments` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `enrollments_path_id_fkey` FOREIGN KEY (`path_id`) REFERENCES `training_paths` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `enrollments_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=12 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `entity_raw` (
  `id` int NOT NULL AUTO_INCREMENT,
  `table_config_id` int NOT NULL,
  `report_date` date NOT NULL,
  `dimension_value` varchar(150) COLLATE utf8mb4_unicode_ci NOT NULL,
  `data` json NOT NULL,
  `import_id` int DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `entity_raw_table_config_id_report_date_idx` (`table_config_id`,`report_date`),
  CONSTRAINT `entity_raw_table_config_id_fkey` FOREIGN KEY (`table_config_id`) REFERENCES `raw_table_config` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `form_categories` (
  `id` int NOT NULL AUTO_INCREMENT,
  `form_id` int NOT NULL,
  `category_name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `weight` decimal(5,2) NOT NULL,
  `sort_order` int NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  KEY `form_categories_form_id_sort_order_idx` (`form_id`,`sort_order`),
  CONSTRAINT `form_categories_form_id_fkey` FOREIGN KEY (`form_id`) REFERENCES `forms` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=558 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `form_metadata_fields` (
  `id` int NOT NULL AUTO_INCREMENT,
  `form_id` int NOT NULL,
  `interaction_type` enum('CALL','EMAIL','CHAT','OTHER') COLLATE utf8mb4_unicode_ci NOT NULL,
  `field_name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `field_type` enum('TEXT','DROPDOWN','DATE','AUTO','SPACER') COLLATE utf8mb4_unicode_ci NOT NULL,
  `is_required` tinyint(1) NOT NULL DEFAULT '1',
  `dropdown_source` varchar(1000) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `sort_order` int NOT NULL DEFAULT '0',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `form_metadata_fields_form_id_interaction_type_field_name_key` (`form_id`,`interaction_type`,`field_name`),
  CONSTRAINT `form_metadata_fields_form_id_fkey` FOREIGN KEY (`form_id`) REFERENCES `forms` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=1595 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `form_question_conditions` (
  `id` int NOT NULL AUTO_INCREMENT,
  `question_id` int NOT NULL,
  `target_question_id` int NOT NULL,
  `condition_type` enum('EQUALS','NOT_EQUALS','EXISTS','NOT_EXISTS') COLLATE utf8mb4_unicode_ci NOT NULL,
  `target_value` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `logical_operator` enum('AND','OR') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'AND',
  `group_id` int NOT NULL DEFAULT '0',
  `sort_order` int NOT NULL DEFAULT '0',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `form_question_conditions_question_id_fkey` (`question_id`),
  KEY `form_question_conditions_target_question_id_fkey` (`target_question_id`),
  CONSTRAINT `form_question_conditions_question_id_fkey` FOREIGN KEY (`question_id`) REFERENCES `form_questions` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `form_question_conditions_target_question_id_fkey` FOREIGN KEY (`target_question_id`) REFERENCES `form_questions` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=2313 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `form_questions` (
  `id` int NOT NULL AUTO_INCREMENT,
  `category_id` int NOT NULL,
  `question_text` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `question_type` enum('YES_NO','SCALE','N_A','TEXT','INFO_BLOCK','RADIO','SUB_CATEGORY','MULTI_SELECT') COLLATE utf8mb4_unicode_ci NOT NULL,
  `weight` decimal(5,2) NOT NULL,
  `sort_order` int NOT NULL DEFAULT '0',
  `scale_min` int DEFAULT NULL,
  `scale_max` int DEFAULT NULL,
  `is_na_allowed` tinyint(1) NOT NULL DEFAULT '0',
  `yes_value` int NOT NULL DEFAULT '1',
  `no_value` int NOT NULL DEFAULT '0',
  `na_value` int NOT NULL DEFAULT '0',
  `visible_to_csr` tinyint(1) NOT NULL DEFAULT '1',
  PRIMARY KEY (`id`),
  KEY `form_questions_category_id_sort_order_idx` (`category_id`,`sort_order`),
  CONSTRAINT `form_questions_category_id_fkey` FOREIGN KEY (`category_id`) REFERENCES `form_categories` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=4326 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `forms` (
  `id` int NOT NULL AUTO_INCREMENT,
  `form_name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `interaction_type` enum('CALL','TICKET','EMAIL','CHAT','UNIVERSAL') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'UNIVERSAL',
  `version` int NOT NULL DEFAULT '1',
  `created_by` int NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `parent_form_id` int DEFAULT NULL,
  `user_version` int DEFAULT NULL,
  `user_version_date` date DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `forms_interaction_type_idx` (`interaction_type`),
  KEY `forms_created_by_fkey` (`created_by`),
  KEY `forms_parent_form_id_fkey` (`parent_form_id`),
  CONSTRAINT `forms_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `forms_parent_form_id_fkey` FOREIGN KEY (`parent_form_id`) REFERENCES `forms` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=251 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `free_text_answers` (
  `id` int NOT NULL AUTO_INCREMENT,
  `answer_id` int NOT NULL,
  `option_id` int NOT NULL,
  `text_value` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `free_text_answers_answer_id_fkey` (`answer_id`),
  KEY `free_text_answers_option_id_fkey` (`option_id`),
  CONSTRAINT `free_text_answers_answer_id_fkey` FOREIGN KEY (`answer_id`) REFERENCES `submission_answers` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `free_text_answers_option_id_fkey` FOREIGN KEY (`option_id`) REFERENCES `radio_options` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `import_logs` (
  `id` int NOT NULL AUTO_INCREMENT,
  `data_type` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `file_name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `imported_by` int NOT NULL,
  `rows_imported` int NOT NULL DEFAULT '0',
  `rows_skipped` int NOT NULL DEFAULT '0',
  `rows_errored` int NOT NULL DEFAULT '0',
  `status` enum('PENDING','PROCESSING','COMPLETE','FAILED') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'PENDING',
  `error_details` json DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `import_logs_imported_by_fkey` (`imported_by`),
  CONSTRAINT `import_logs_imported_by_fkey` FOREIGN KEY (`imported_by`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `lead_sales_margin_raw` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `report_date` date NOT NULL,
  `leads_assigned` int NOT NULL DEFAULT '0',
  `leads_contacted` int NOT NULL DEFAULT '0',
  `orders` int NOT NULL DEFAULT '0',
  `lead_revenue` decimal(12,2) NOT NULL DEFAULT '0.00',
  `lead_margin` decimal(12,2) NOT NULL DEFAULT '0.00',
  `import_id` int DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `lead_sales_margin_raw_user_id_report_date_idx` (`user_id`,`report_date`),
  KEY `lead_sales_margin_raw_import_id_fkey` (`import_id`),
  CONSTRAINT `lead_sales_margin_raw_import_id_fkey` FOREIGN KEY (`import_id`) REFERENCES `import_logs` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `lead_sales_margin_raw_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `lead_source_raw` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `report_date` date NOT NULL,
  `source_name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `leads_received` int NOT NULL DEFAULT '0',
  `converted` int NOT NULL DEFAULT '0',
  `conversion_rate` decimal(6,4) NOT NULL DEFAULT '0.0000',
  `import_id` int DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `lead_source_raw_user_id_report_date_idx` (`user_id`,`report_date`),
  KEY `lead_source_raw_import_id_fkey` (`import_id`),
  CONSTRAINT `lead_source_raw_import_id_fkey` FOREIGN KEY (`import_id`) REFERENCES `import_logs` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `lead_source_raw_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `list_items` (
  `id` int NOT NULL AUTO_INCREMENT,
  `list_type` varchar(50) NOT NULL,
  `category` varchar(100) DEFAULT NULL,
  `item_key` varchar(100) DEFAULT NULL,
  `label` varchar(255) NOT NULL,
  `sort_order` int NOT NULL DEFAULT '0',
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_li_type` (`list_type`),
  KEY `idx_li_type_active` (`list_type`,`is_active`)
) ENGINE=InnoDB AUTO_INCREMENT=51 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `metric_definitions` (
  `id` int NOT NULL AUTO_INCREMENT,
  `code` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(150) COLLATE utf8mb4_unicode_ci NOT NULL,
  `aggregation` enum('COUNT','SUM','AVG','MAX','MIN') COLLATE utf8mb4_unicode_ci NOT NULL,
  `direction` enum('HIGH_IS_GOOD','LOW_IS_GOOD') COLLATE utf8mb4_unicode_ci NOT NULL,
  `is_cumulative` tinyint(1) NOT NULL DEFAULT '0',
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `metric_definitions_code_key` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `metric_departments` (
  `id` int NOT NULL AUTO_INCREMENT,
  `metric_id` int NOT NULL,
  `department_id` int NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `metric_departments_metric_id_department_id_key` (`metric_id`,`department_id`),
  KEY `metric_departments_department_id_fkey` (`department_id`),
  CONSTRAINT `metric_departments_department_id_fkey` FOREIGN KEY (`department_id`) REFERENCES `departments` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `metric_departments_metric_id_fkey` FOREIGN KEY (`metric_id`) REFERENCES `metric_definitions` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `metric_thresholds` (
  `id` int NOT NULL AUTO_INCREMENT,
  `metric_id` int NOT NULL,
  `department_id` int DEFAULT NULL,
  `red_below` decimal(10,2) NOT NULL,
  `yellow_below` decimal(10,2) NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `metric_thresholds_metric_id_fkey` (`metric_id`),
  KEY `metric_thresholds_department_id_fkey` (`department_id`),
  CONSTRAINT `metric_thresholds_department_id_fkey` FOREIGN KEY (`department_id`) REFERENCES `departments` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `metric_thresholds_metric_id_fkey` FOREIGN KEY (`metric_id`) REFERENCES `metric_definitions` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `performance_goal_departments` (
  `id` int NOT NULL AUTO_INCREMENT,
  `goal_id` int NOT NULL,
  `department_id` int NOT NULL,
  `assigned_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `assigned_by` int NOT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  PRIMARY KEY (`id`),
  UNIQUE KEY `performance_goal_departments_goal_id_department_id_key` (`goal_id`,`department_id`),
  KEY `performance_goal_departments_goal_id_idx` (`goal_id`),
  KEY `performance_goal_departments_department_id_idx` (`department_id`),
  KEY `performance_goal_departments_assigned_by_idx` (`assigned_by`),
  CONSTRAINT `performance_goal_departments_assigned_by_fkey` FOREIGN KEY (`assigned_by`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `performance_goal_departments_department_id_fkey` FOREIGN KEY (`department_id`) REFERENCES `departments` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `performance_goal_departments_goal_id_fkey` FOREIGN KEY (`goal_id`) REFERENCES `performance_goals` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=9 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `performance_goal_users` (
  `id` int NOT NULL AUTO_INCREMENT,
  `goal_id` int NOT NULL,
  `user_id` int NOT NULL,
  `assigned_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `assigned_by` int NOT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  PRIMARY KEY (`id`),
  UNIQUE KEY `performance_goal_users_goal_id_user_id_key` (`goal_id`,`user_id`),
  KEY `performance_goal_users_goal_id_idx` (`goal_id`),
  KEY `performance_goal_users_user_id_idx` (`user_id`),
  KEY `performance_goal_users_assigned_by_idx` (`assigned_by`),
  CONSTRAINT `performance_goal_users_assigned_by_fkey` FOREIGN KEY (`assigned_by`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `performance_goal_users_goal_id_fkey` FOREIGN KEY (`goal_id`) REFERENCES `performance_goals` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `performance_goal_users_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=6 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `performance_goals` (
  `id` int NOT NULL AUTO_INCREMENT,
  `goal_type` enum('QA_SCORE','AUDIT_RATE','DISPUTE_RATE') COLLATE utf8mb4_unicode_ci NOT NULL,
  `target_value` decimal(5,2) NOT NULL,
  `scope` enum('GLOBAL','DEPARTMENT','USER','MULTI_USER','MULTI_DEPARTMENT') COLLATE utf8mb4_unicode_ci NOT NULL,
  `department_id` int DEFAULT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_by` int DEFAULT NULL,
  `updated_by` int DEFAULT NULL,
  `updated_at` datetime DEFAULT NULL,
  `start_date` date NOT NULL DEFAULT (curdate()),
  `end_date` date DEFAULT NULL,
  `target_form_id` int DEFAULT NULL,
  `target_category_id` int DEFAULT NULL,
  `target_question_id` int DEFAULT NULL,
  `target_scope` enum('ALL_QA','FORM','CATEGORY','QUESTION') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'ALL_QA',
  PRIMARY KEY (`id`),
  KEY `performance_goals_is_active_start_date_end_date_idx` (`is_active`,`start_date`,`end_date`),
  KEY `performance_goals_start_date_end_date_idx` (`start_date`,`end_date`),
  KEY `performance_goals_target_scope_target_form_id_target_categor_idx` (`target_scope`,`target_form_id`,`target_category_id`,`target_question_id`),
  KEY `performance_goals_department_id_fkey` (`department_id`),
  KEY `performance_goals_created_by_fkey` (`created_by`),
  KEY `performance_goals_updated_by_fkey` (`updated_by`),
  KEY `performance_goals_target_form_id_fkey` (`target_form_id`),
  KEY `performance_goals_target_category_id_fkey` (`target_category_id`),
  KEY `performance_goals_target_question_id_fkey` (`target_question_id`),
  CONSTRAINT `performance_goals_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `performance_goals_department_id_fkey` FOREIGN KEY (`department_id`) REFERENCES `departments` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `performance_goals_target_category_id_fkey` FOREIGN KEY (`target_category_id`) REFERENCES `form_categories` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `performance_goals_target_form_id_fkey` FOREIGN KEY (`target_form_id`) REFERENCES `forms` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `performance_goals_target_question_id_fkey` FOREIGN KEY (`target_question_id`) REFERENCES `form_questions` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `performance_goals_updated_by_fkey` FOREIGN KEY (`updated_by`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=9 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `quiz_attempts` (
  `id` int NOT NULL AUTO_INCREMENT,
  `quiz_id` int NOT NULL,
  `user_id` int NOT NULL,
  `coaching_session_id` int DEFAULT NULL,
  `answers_json` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `score` decimal(5,2) NOT NULL,
  `passed` tinyint(1) NOT NULL,
  `attempt_number` int NOT NULL DEFAULT '1',
  `submitted_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `quiz_attempts_quiz_id_user_id_idx` (`quiz_id`,`user_id`),
  KEY `quiz_attempts_coaching_session_id_idx` (`coaching_session_id`),
  KEY `quiz_attempts_user_id_fkey` (`user_id`),
  CONSTRAINT `quiz_attempts_coaching_session_id_fkey` FOREIGN KEY (`coaching_session_id`) REFERENCES `coaching_sessions` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `quiz_attempts_quiz_id_fkey` FOREIGN KEY (`quiz_id`) REFERENCES `quizzes` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `quiz_attempts_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=8 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `quiz_questions` (
  `id` int NOT NULL AUTO_INCREMENT,
  `quiz_id` int NOT NULL,
  `question_text` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `options` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `correct_option` int NOT NULL,
  PRIMARY KEY (`id`),
  KEY `quiz_questions_quiz_id_fkey` (`quiz_id`),
  CONSTRAINT `quiz_questions_quiz_id_fkey` FOREIGN KEY (`quiz_id`) REFERENCES `quizzes` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=15 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `quiz_topics` (
  `quiz_id` int NOT NULL,
  `topic_id` int NOT NULL,
  PRIMARY KEY (`quiz_id`,`topic_id`),
  KEY `quiz_topics_topic_id_idx` (`topic_id`),
  CONSTRAINT `quiz_topics_quiz_id_fkey` FOREIGN KEY (`quiz_id`) REFERENCES `quizzes` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `quiz_topics_topic_id_fkey` FOREIGN KEY (`topic_id`) REFERENCES `topics` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `quizzes` (
  `id` int NOT NULL AUTO_INCREMENT,
  `course_id` int NOT NULL,
  `quiz_title` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `pass_score` decimal(5,2) NOT NULL,
  `topic_id` int DEFAULT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  PRIMARY KEY (`id`),
  KEY `quizzes_course_id_fkey` (`course_id`),
  KEY `quizzes_topic_id_fkey` (`topic_id`),
  KEY `quizzes_is_active_idx` (`is_active`),
  CONSTRAINT `quizzes_course_id_fkey` FOREIGN KEY (`course_id`) REFERENCES `courses` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `quizzes_topic_id_fkey` FOREIGN KEY (`topic_id`) REFERENCES `topics` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `radio_options` (
  `id` int NOT NULL AUTO_INCREMENT,
  `question_id` int NOT NULL,
  `option_text` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `option_value` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `score` int NOT NULL DEFAULT '0',
  `has_free_text` tinyint(1) NOT NULL DEFAULT '0',
  `sort_order` int NOT NULL DEFAULT '0',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `radio_options_question_id_fkey` (`question_id`),
  CONSTRAINT `radio_options_question_id_fkey` FOREIGN KEY (`question_id`) REFERENCES `form_questions` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=269 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `raw_table_config` (
  `id` int NOT NULL AUTO_INCREMENT,
  `table_name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `display_name` varchar(150) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `is_user_centric` tinyint(1) NOT NULL DEFAULT '1',
  `primary_dimension` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `raw_table_config_table_name_key` (`table_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `report_definition_departments` (
  `id` int NOT NULL AUTO_INCREMENT,
  `report_id` int NOT NULL,
  `department_id` int NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `report_definition_departments_report_id_department_id_key` (`report_id`,`department_id`),
  KEY `report_definition_departments_department_id_fkey` (`department_id`),
  CONSTRAINT `report_definition_departments_department_id_fkey` FOREIGN KEY (`department_id`) REFERENCES `departments` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `report_definition_departments_report_id_fkey` FOREIGN KEY (`report_id`) REFERENCES `report_definitions` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `report_definitions` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(150) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `layout_config` json NOT NULL,
  `audience_scope` enum('USER','TEAM','DEPARTMENT','ORG') COLLATE utf8mb4_unicode_ci NOT NULL,
  `show_in_nav` tinyint(1) NOT NULL DEFAULT '0',
  `nav_order` int NOT NULL DEFAULT '0',
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_by` int NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `report_definitions_created_by_fkey` (`created_by`),
  CONSTRAINT `report_definitions_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `roles` (
  `id` int NOT NULL AUTO_INCREMENT,
  `role_name` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `roles_role_name_key` (`role_name`)
) ENGINE=InnoDB AUTO_INCREMENT=6 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `sales_margin_raw` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `report_date` date NOT NULL,
  `order_count` int NOT NULL DEFAULT '0',
  `revenue` decimal(12,2) NOT NULL DEFAULT '0.00',
  `cogs` decimal(12,2) NOT NULL DEFAULT '0.00',
  `gross_margin` decimal(12,2) NOT NULL DEFAULT '0.00',
  `product_category` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `import_id` int DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `sales_margin_raw_user_id_report_date_idx` (`user_id`,`report_date`),
  KEY `sales_margin_raw_import_id_fkey` (`import_id`),
  CONSTRAINT `sales_margin_raw_import_id_fkey` FOREIGN KEY (`import_id`) REFERENCES `import_logs` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `sales_margin_raw_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `score_snapshots` (
  `id` int NOT NULL AUTO_INCREMENT,
  `csr_id` int NOT NULL,
  `score` decimal(5,2) NOT NULL,
  `snapshot_date` date NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `submission_id` int DEFAULT NULL,
  `snapshot_data` text COLLATE utf8mb4_unicode_ci,
  PRIMARY KEY (`id`),
  KEY `score_snapshots_csr_id_fkey` (`csr_id`),
  KEY `score_snapshots_submission_id_fkey` (`submission_id`),
  CONSTRAINT `score_snapshots_csr_id_fkey` FOREIGN KEY (`csr_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `score_snapshots_submission_id_fkey` FOREIGN KEY (`submission_id`) REFERENCES `submissions` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=125 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `submission_answers` (
  `id` int NOT NULL AUTO_INCREMENT,
  `submission_id` int NOT NULL,
  `question_id` int NOT NULL,
  `answer` text COLLATE utf8mb4_unicode_ci,
  `notes` text COLLATE utf8mb4_unicode_ci,
  PRIMARY KEY (`id`),
  KEY `submission_answers_submission_id_fkey` (`submission_id`),
  KEY `submission_answers_question_id_fkey` (`question_id`),
  CONSTRAINT `submission_answers_question_id_fkey` FOREIGN KEY (`question_id`) REFERENCES `form_questions` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `submission_answers_submission_id_fkey` FOREIGN KEY (`submission_id`) REFERENCES `submissions` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=1114 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `submission_calls` (
  `id` int NOT NULL AUTO_INCREMENT,
  `submission_id` int NOT NULL,
  `call_id` int NOT NULL,
  `sort_order` int NOT NULL DEFAULT '0',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `submission_calls_submission_id_call_id_key` (`submission_id`,`call_id`),
  KEY `submission_calls_call_id_fkey` (`call_id`),
  CONSTRAINT `submission_calls_call_id_fkey` FOREIGN KEY (`call_id`) REFERENCES `calls` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `submission_calls_submission_id_fkey` FOREIGN KEY (`submission_id`) REFERENCES `submissions` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=22 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `submission_metadata` (
  `id` int NOT NULL AUTO_INCREMENT,
  `submission_id` int NOT NULL,
  `field_id` int NOT NULL,
  `value` text COLLATE utf8mb4_unicode_ci,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `date_value` date DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `submission_metadata_date_value_idx` (`date_value`),
  KEY `submission_metadata_submission_id_fkey` (`submission_id`),
  KEY `submission_metadata_field_id_fkey` (`field_id`),
  CONSTRAINT `submission_metadata_field_id_fkey` FOREIGN KEY (`field_id`) REFERENCES `form_metadata_fields` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `submission_metadata_submission_id_fkey` FOREIGN KEY (`submission_id`) REFERENCES `submissions` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=890 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `submissions` (
  `id` int NOT NULL AUTO_INCREMENT,
  `form_id` int NOT NULL,
  `call_id` int DEFAULT NULL,
  `submitted_by` int NOT NULL,
  `submitted_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `total_score` decimal(5,2) DEFAULT NULL,
  `status` enum('DRAFT','SUBMITTED','DISPUTED','FINALIZED') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'DRAFT',
  PRIMARY KEY (`id`),
  KEY `submissions_form_id_fkey` (`form_id`),
  KEY `submissions_call_id_fkey` (`call_id`),
  KEY `submissions_submitted_by_fkey` (`submitted_by`),
  CONSTRAINT `submissions_call_id_fkey` FOREIGN KEY (`call_id`) REFERENCES `calls` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `submissions_form_id_fkey` FOREIGN KEY (`form_id`) REFERENCES `forms` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `submissions_submitted_by_fkey` FOREIGN KEY (`submitted_by`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=148 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `ticket_task_raw` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `report_date` date NOT NULL,
  `ticket_id` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `priority` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `category` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `resolution_time_minutes` int DEFAULT NULL,
  `import_id` int DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `ticket_task_raw_user_id_report_date_idx` (`user_id`,`report_date`),
  KEY `ticket_task_raw_import_id_fkey` (`import_id`),
  CONSTRAINT `ticket_task_raw_import_id_fkey` FOREIGN KEY (`import_id`) REFERENCES `import_logs` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `ticket_task_raw_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `topics` (
  `id` int NOT NULL AUTO_INCREMENT,
  `topic_name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `sort_order` int NOT NULL DEFAULT '0',
  `category` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `topics_topic_name_key` (`topic_name`),
  KEY `topics_is_active_idx` (`is_active`),
  KEY `topics_sort_order_idx` (`sort_order`)
) ENGINE=InnoDB AUTO_INCREMENT=31 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `training_logs` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `course_id` int DEFAULT NULL,
  `action` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `details` text COLLATE utf8mb4_unicode_ci,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `training_logs_user_id_fkey` (`user_id`),
  KEY `training_logs_course_id_fkey` (`course_id`),
  CONSTRAINT `training_logs_course_id_fkey` FOREIGN KEY (`course_id`) REFERENCES `courses` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `training_logs_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=27 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `training_path_courses` (
  `id` int NOT NULL AUTO_INCREMENT,
  `path_id` int NOT NULL,
  `course_id` int NOT NULL,
  `course_order` int NOT NULL,
  PRIMARY KEY (`id`),
  KEY `training_path_courses_path_id_fkey` (`path_id`),
  KEY `training_path_courses_course_id_fkey` (`course_id`),
  CONSTRAINT `training_path_courses_course_id_fkey` FOREIGN KEY (`course_id`) REFERENCES `courses` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `training_path_courses_path_id_fkey` FOREIGN KEY (`path_id`) REFERENCES `training_paths` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `training_paths` (
  `id` int NOT NULL AUTO_INCREMENT,
  `path_name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_by` int NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `training_paths_created_by_fkey` (`created_by`),
  CONSTRAINT `training_paths_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `training_resource_topics` (
  `resource_id` int NOT NULL,
  `topic_id` int NOT NULL,
  PRIMARY KEY (`resource_id`,`topic_id`),
  KEY `training_resource_topics_topic_id_idx` (`topic_id`),
  CONSTRAINT `training_resource_topics_resource_id_fkey` FOREIGN KEY (`resource_id`) REFERENCES `training_resources` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `training_resource_topics_topic_id_fkey` FOREIGN KEY (`topic_id`) REFERENCES `topics` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `training_resources` (
  `id` int NOT NULL AUTO_INCREMENT,
  `title` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `url` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_by` int NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `file_mime_type` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `file_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `file_path` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `file_size` int DEFAULT NULL,
  `resource_type` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'URL',
  PRIMARY KEY (`id`),
  KEY `training_resources_is_active_idx` (`is_active`),
  KEY `training_resources_created_by_fkey` (`created_by`),
  CONSTRAINT `training_resources_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `user_alert_preferences` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `frequency` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `batch_alerts` tinyint(1) NOT NULL DEFAULT '1',
  `timezone` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `user_alert_preferences_user_id_key` (`user_id`),
  CONSTRAINT `user_alert_preferences_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `users` (
  `id` int NOT NULL AUTO_INCREMENT,
  `username` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `email` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `password_hash` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `role_id` int NOT NULL,
  `department_id` int DEFAULT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `last_login` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `manager_id` int DEFAULT NULL,
  `title` varchar(150) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `users_username_key` (`username`),
  UNIQUE KEY `users_email_key` (`email`),
  KEY `users_last_login_idx` (`last_login`),
  KEY `users_role_id_fkey` (`role_id`),
  KEY `users_department_id_fkey` (`department_id`),
  KEY `users_manager_id_fkey` (`manager_id`),
  CONSTRAINT `users_department_id_fkey` FOREIGN KEY (`department_id`) REFERENCES `departments` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `users_manager_id_fkey` FOREIGN KEY (`manager_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `users_role_id_fkey` FOREIGN KEY (`role_id`) REFERENCES `roles` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=20 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `write_up_attachments` (
  `id` int NOT NULL AUTO_INCREMENT,
  `write_up_id` int NOT NULL,
  `attachment_type` varchar(20) NOT NULL,
  `reference_type` varchar(50) DEFAULT NULL,
  `reference_id` int DEFAULT NULL,
  `filename` varchar(255) NOT NULL,
  `file_path` varchar(500) DEFAULT NULL,
  `file_size` int DEFAULT NULL,
  `mime_type` varchar(100) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_write_up_attachments_write_up_id` (`write_up_id`),
  CONSTRAINT `fk_write_up_attachments_write_up` FOREIGN KEY (`write_up_id`) REFERENCES `write_ups` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `write_up_examples` (
  `id` int NOT NULL AUTO_INCREMENT,
  `violation_id` int NOT NULL,
  `example_date` date DEFAULT NULL,
  `description` text NOT NULL,
  `source` enum('MANUAL','QA_IMPORT','COACHING_IMPORT') NOT NULL DEFAULT 'MANUAL',
  `qa_submission_id` int DEFAULT NULL,
  `qa_question_id` int DEFAULT NULL,
  `sort_order` int NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  KEY `idx_write_up_examples_violation_id` (`violation_id`),
  CONSTRAINT `fk_write_up_examples_violation` FOREIGN KEY (`violation_id`) REFERENCES `write_up_violations` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `write_up_incidents` (
  `id` int NOT NULL AUTO_INCREMENT,
  `write_up_id` int NOT NULL,
  `incident_date` date NOT NULL,
  `description` text NOT NULL,
  `sort_order` int NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  KEY `idx_write_up_incidents_write_up_id` (`write_up_id`),
  CONSTRAINT `fk_write_up_incidents_write_up` FOREIGN KEY (`write_up_id`) REFERENCES `write_ups` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `write_up_prior_discipline` (
  `id` int NOT NULL AUTO_INCREMENT,
  `write_up_id` int NOT NULL,
  `reference_type` varchar(50) NOT NULL,
  `reference_id` int NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_prior_discipline` (`write_up_id`,`reference_type`,`reference_id`),
  KEY `idx_write_up_prior_discipline_write_up_id` (`write_up_id`),
  CONSTRAINT `fk_write_up_prior_write_up` FOREIGN KEY (`write_up_id`) REFERENCES `write_ups` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `write_up_violations` (
  `id` int NOT NULL AUTO_INCREMENT,
  `incident_id` int NOT NULL,
  `policy_violated` varchar(255) NOT NULL,
  `reference_material` varchar(500) DEFAULT NULL,
  `sort_order` int NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  KEY `idx_write_up_violations_incident_id` (`incident_id`),
  CONSTRAINT `fk_write_up_violations_incident` FOREIGN KEY (`incident_id`) REFERENCES `write_up_incidents` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `write_ups` (
  `id` int NOT NULL AUTO_INCREMENT,
  `csr_id` int NOT NULL,
  `document_type` enum('VERBAL_WARNING','WRITTEN_WARNING','FINAL_WARNING') NOT NULL,
  `status` enum('DRAFT','SCHEDULED','DELIVERED','AWAITING_SIGNATURE','SIGNED','FOLLOW_UP_PENDING','CLOSED') NOT NULL DEFAULT 'DRAFT',
  `meeting_date` datetime DEFAULT NULL,
  `meeting_notes` text,
  `corrective_action` text,
  `correction_timeline` varchar(255) DEFAULT NULL,
  `checkin_date` date DEFAULT NULL,
  `consequence` text,
  `linked_coaching_id` int DEFAULT NULL,
  `follow_up_required` tinyint NOT NULL DEFAULT '0',
  `follow_up_date` date DEFAULT NULL,
  `follow_up_assigned_to` int DEFAULT NULL,
  `follow_up_checklist` text,
  `follow_up_notes` text,
  `follow_up_completed_at` datetime DEFAULT NULL,
  `signed_at` datetime DEFAULT NULL,
  `signature_data` text,
  `acknowledged_at` datetime DEFAULT NULL,
  `created_by` int NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `delivered_at` datetime DEFAULT NULL,
  `closed_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_write_ups_csr_id` (`csr_id`),
  KEY `idx_write_ups_status` (`status`),
  KEY `idx_write_ups_created_by` (`created_by`),
  KEY `idx_write_ups_created_at` (`created_at`),
  KEY `fk_write_ups_follow_up` (`follow_up_assigned_to`),
  KEY `fk_write_ups_coaching` (`linked_coaching_id`),
  CONSTRAINT `fk_write_ups_coaching` FOREIGN KEY (`linked_coaching_id`) REFERENCES `coaching_sessions` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_write_ups_creator` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_write_ups_csr` FOREIGN KEY (`csr_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_write_ups_follow_up` FOREIGN KEY (`follow_up_assigned_to`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

SET FOREIGN_KEY_CHECKS=1;