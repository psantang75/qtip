-- Align FormMetadataInteractionType with FormInteractionType so metadata fields
-- can carry the same interaction type as their parent form. The form builder
-- stamps the form's interaction_type onto every metadata field, and TICKET /
-- UNIVERSAL forms previously failed to save because those members were missing
-- from this column's enum.
ALTER TABLE `form_metadata_fields` MODIFY COLUMN `interaction_type` ENUM('CALL', 'EMAIL', 'CHAT', 'OTHER', 'TICKET', 'UNIVERSAL') NOT NULL;
