-- ─────────────────────────────────────────────────────────────────────────────
-- Move the Unlock Register into the Quality section as a first-class,
-- server-driven page (it previously lived only under Admin, hardcoded in
-- AdminLayout). Registering it in `app_page` means the Quality sidebar,
-- the route guard, and the admin "Page Access" screen all pick it up from
-- one source, exactly like every other Quality page.
--
-- Access: Admin only. The register is a read-only, org-wide audit of reopened
-- reviews, so the single admin grant is ALL (everyone's records, read-only).
-- Absent rows = NONE for every other role → hidden in nav + route redirects +
-- API 403 (the /api/unlocks endpoints stay admin-gated at the router too).
--
-- Additive + idempotent (INSERT IGNORE), safe to re-run across dev/test/prod.
-- ─────────────────────────────────────────────────────────────────────────────

INSERT IGNORE INTO `app_page` (`page_key`, `page_name`, `section`, `route_path`, `icon`, `sort_order`) VALUES
  ('quality_unlock_register', 'Unlock Register', 'quality', '/app/quality/unlocks', 'Unlock', 70);

-- Unlock Register — Admin only, read-only org-wide (ALL).
INSERT IGNORE INTO `app_page_role_access` (`page_id`, `role_id`, `access_level`, `can_access`, `can_write`)
SELECT id, 1, 'ALL', TRUE, FALSE FROM `app_page` WHERE `page_key` = 'quality_unlock_register';
