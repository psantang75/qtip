-- Phase C (C2): per-form cap on the number of secondary sources the
-- multi-source case loader will auto-attach to a primary source.
-- Default 3 keeps prompt cost bounded for combined ticket+call
-- reviews; QA admins can dial down to 0/1 on a noisy form or up to
-- 10 for forms that want maximum cross-source corroboration.
ALTER TABLE `forms`
  ADD COLUMN `ai_max_attached_sources` TINYINT UNSIGNED NOT NULL DEFAULT 3
    AFTER `ai_disagreement_route_threshold`;
