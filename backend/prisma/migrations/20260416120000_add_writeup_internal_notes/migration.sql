-- Add internal_notes column to write_ups and create junction table for behavior flags / root causes / support needed.
-- Mirrors the coaching_session_behavior_flags pattern (a single junction table filtered by list_items.list_type).

ALTER TABLE `write_ups`
  ADD COLUMN `internal_notes` TEXT NULL AFTER `consequence`;

CREATE TABLE `write_up_list_items` (
  `write_up_id` INT NOT NULL,
  `list_item_id` INT NOT NULL,
  PRIMARY KEY (`write_up_id`, `list_item_id`),
  KEY `list_item_id` (`list_item_id`),
  CONSTRAINT `write_up_list_items_ibfk_1` FOREIGN KEY (`write_up_id`) REFERENCES `write_ups` (`id`) ON DELETE CASCADE,
  CONSTRAINT `write_up_list_items_ibfk_2` FOREIGN KEY (`list_item_id`) REFERENCES `list_items` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
