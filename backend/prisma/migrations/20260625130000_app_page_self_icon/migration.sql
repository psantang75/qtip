-- Self ("Own") experience icon, so OWN-level nav links keep the distinct icon
-- they had in the old static navConfig (e.g. "My Training" → BookOpen) instead
-- of inheriting the editor page's icon.
ALTER TABLE `app_page`
  ADD COLUMN `self_icon` VARCHAR(50) NULL;

UPDATE `app_page` SET `self_icon` = 'BookOpen' WHERE `page_key` = 'training_coaching';
UPDATE `app_page` SET `self_icon` = 'FileText' WHERE `page_key` = 'pw_list';
UPDATE `app_page` SET `self_icon` = 'FileCheck' WHERE `page_key` = 'quality_submissions';
UPDATE `app_page` SET `self_icon` = 'History' WHERE `page_key` = 'quality_disputes';
