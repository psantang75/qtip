-- ─────────────────────────────────────────────────────────────────────────────
-- Referential-integrity FKs (correctness).
--
-- Approved out of the read-only database review (docs/database_review.md,
-- §"Schema drift / correctness"). Purely additive FOREIGN KEY constraints; no
-- table is added, altered, or dropped and no data is touched. A read-only orphan
-- probe on every column below returned 0 rows before authoring (re-run on the
-- target before deploy — an ADD CONSTRAINT fails if orphans exist).
--
--   • ai_form_rule_pack_assignment.form_id → forms(id)
--       Had a unique + index but no FK, so deleting a form left orphan
--       assignment rows. ON DELETE CASCADE mirrors its sibling rule_pack FK
--       (fk_form_rule_pack_pack) — a form's rule-pack assignments die with it.
--       This one IS modeled in schema.prisma (Form is a real model), so the
--       constraint name matches Prisma's `<table>_<col>_fkey` convention and
--       the relation was added to the schema in the same change.
--
--   • coaching_sessions.{coaching_purpose, coaching_format, source_type}
--       → list_items(id)
--       Semi-polymorphic lookups (one column per list_type) that had no FK.
--       ON DELETE SET NULL (columns are nullable) preserves historical coaching
--       rows if a list item is ever removed — and list items are only ever
--       SOFT-deleted (list.controller.deleteListItem flips is_active=0; there is
--       no hard-delete path), so this action never fires in normal operation;
--       it is pure integrity insurance. These are DB-level FKs ONLY — list_items
--       is `@@ignore`d in schema.prisma (raw-SQL-managed), exactly like the four
--       FKs that already point into it (quiz_topics, resource_topics,
--       coaching_session_behavior_flags, write_up_list_items), so they cannot be
--       modeled as Prisma @relations.
--
-- Written as hand-authored SQL and applied via `prisma migrate deploy` because
-- this repo's schema.prisma is deliberately a partial model, so
-- `prisma migrate dev` cannot be used here (see docs/database_schema_updates.md).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE `ai_form_rule_pack_assignment`
  ADD CONSTRAINT `ai_form_rule_pack_assignment_form_id_fkey`
  FOREIGN KEY (`form_id`) REFERENCES `forms`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `coaching_sessions`
  ADD CONSTRAINT `coaching_sessions_coaching_purpose_fkey`
  FOREIGN KEY (`coaching_purpose`) REFERENCES `list_items`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE `coaching_sessions`
  ADD CONSTRAINT `coaching_sessions_coaching_format_fkey`
  FOREIGN KEY (`coaching_format`) REFERENCES `list_items`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE `coaching_sessions`
  ADD CONSTRAINT `coaching_sessions_source_type_fkey`
  FOREIGN KEY (`source_type`) REFERENCES `list_items`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;
