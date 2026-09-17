-- ─────────────────────────────────────────────────────────────────────────────
-- Missed Opportunities: new rule — commercial audio system opportunity missed.
--
-- The starter set (20260908170000) covers subscription growth, expansion, and
-- follow-through but has no rule for the hardware/install side of the business:
-- speakers, amplifiers, overhead paging, zoned/background audio, and the
-- professional install that goes with them. Reps routinely take a music order
-- while a real audio-system opportunity (a new build-out, failing speakers, a
-- request for better coverage) goes uncaptured.
--
-- Additive and idempotent via INSERT IGNORE on the unique rule_key, exactly like
-- the starter seed. Admins can edit or deactivate it from the Settings area.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT IGNORE INTO `ie_missed_opportunity_rule`
  (`rule_key`, `rule_name`, `category`, `severity`, `sort_order`, `body_md`, `guidance_md`) VALUES
('audio_system_not_offered', 'Commercial audio system opportunity not captured', 'Expansion', 'medium', 85,
 'The customer described a space, project, or problem where a commercial audio system fits — a new location or build-out, failing or aging speakers, a request for better sound coverage or overhead paging, or hardware already in play — and the rep did not offer an audio system or capture the opportunity (no quote, no site survey offered, no follow-up to spec it). Flag only when there was a real opening. Do NOT flag when the rep offered audio and the customer declined, or when the space clearly does not warrant it.',
 'Coach the rep to offer a commercial audio system or a site survey whenever the space warrants it. The recommended approach should name the space or need the customer described and propose a concrete next step — for example a site survey credited toward the install, or asking for photos to spec speakers.');
