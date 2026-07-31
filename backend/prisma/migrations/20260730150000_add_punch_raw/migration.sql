-- CreateTable
CREATE TABLE `punch_raw` (
  `id` int NOT NULL AUTO_INCREMENT,
  `post_id` varchar(50) NOT NULL,
  `user_id` int NOT NULL,
  `punch_in_at` datetime NULL,
  `punch_out_at` datetime NULL,
  `punch_type_in` varchar(50) NULL,
  `punch_type_out` varchar(50) NULL,
  `regular_duration` decimal(10,2) NOT NULL DEFAULT '0.00',
  `import_id` int NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `punch_raw_post_id_key` (`post_id`),
  KEY `punch_raw_user_id_punch_in_at_idx` (`user_id`,`punch_in_at`),
  KEY `punch_raw_import_id_fkey` (`import_id`),
  CONSTRAINT `punch_raw_import_id_fkey` FOREIGN KEY (`import_id`) REFERENCES `import_logs` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `punch_raw_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
