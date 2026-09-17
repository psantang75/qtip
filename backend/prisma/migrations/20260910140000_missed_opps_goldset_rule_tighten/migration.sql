-- ─────────────────────────────────────────────────────────────────────────────
-- Missed Opportunities — gold-set tighten from the 2026-09-09 review.
-- Data only; no schema change. Each UPDATE rewrites the whole body, so a
-- re-run is a no-op. Admins can still edit any of these from Settings.
--
-- The Sep 9 day was still ~70% false-positive on group_expansion, and the
-- other rules were repeating the same four mistakes: inferring a group from
-- a brand name or CRM research, treating a customer-chosen path (trial,
-- demo, quote-for-admin, "in 2 weeks") as a miss, firing warranty after the
-- offer was already made, and using voicemail/service-probe as a junk drawer.
-- ─────────────────────────────────────────────────────────────────────────────

UPDATE `ie_missed_opportunity_rule`
   SET `body_md` = 'The CUSTOMER on THIS call named live additional locations, a franchise/portfolio they operate, or a sister site, and the lead-task / Contact Manager notes do not already show those sites scoped. Flag when they named a live group (four properties, 25 locations, nine Goodwills plus more, seven more stores, a named sister clinic) and the rep never asked how many are uncovered or who decides, AND the notes do not already list those sites or a prior "wants one site only" decision. Do NOT flag: a franchise brand or industry with no customer sentence; CRM research the customer did not repeat; closed stores; zones in one building; an email domain; sites already sold or activating; a phased rollout ("start with this one, expand if it works"); or a probe the rep "should have" asked when nobody mentioned another site. If the notes already capture the footprint, this is not a miss on this call.'
 WHERE `rule_key` = 'group_expansion_not_captured';

UPDATE `ie_missed_opportunity_rule`
   SET `body_md` = 'The customer signalled readiness to buy and the rep did not attempt to take the order on the call. Signals include asking how to get started, asking whether to order online or through the rep, naming a go-live, or saying they are ready to move forward. Flag when the rep responded with a quote, a proposal, or a future follow-up INSTEAD of asking for the order. Do NOT flag when the customer chose another path after the offer — a free trial, a demo booking, a quote they need for an admin or board, "email me the link", or "I need to think it over." "Sounds good" to a demo or a trial is not a close signal. Before reporting it, confirm from the transcript that the rep never asked for the order AND the customer did not request the slower path.'
 WHERE `rule_key` = 'buying_signal_not_closed';

UPDATE `ie_missed_opportunity_rule`
   SET `body_md` = 'The call ended without any date or timeframe for the next contact, or the rep left the next move entirely with the customer ("call me when you are ready") with no callback promised. Do NOT flag when the customer named a timeframe the rep accepted ("in 2 weeks", "Monday", "early next week") — that is a dated step even if you would have preferred a tighter one. Do NOT flag when the lead-task or Contact Manager note already has a next-step date or cadence ("next is day 3", "check in next week", a due date). Only flag when hanging up left nobody owning a when.'
 WHERE `rule_key` = 'no_dated_next_step';

UPDATE `ie_missed_opportunity_rule`
   SET `body_md` = 'An order was placed, priced, or quoted for hardware (player, radio, amplifier, speakers) and the rep never offered the multi-year extended warranty. Asking "1-year or extended?" IS the offer. Do NOT flag when the rep offered it and the customer or their dealer declined. Do NOT flag when hardware was not actually in play.'
 WHERE `rule_key` = 'warranty_not_offered';

UPDATE `ie_missed_opportunity_rule`
   SET `body_md` = 'The customer described a space or problem that needs a commercial audio system (new build-out, failing speakers, better coverage, overhead paging) and the rep offered neither a system nor a site survey. Do NOT flag when the customer asked for a tech visit or survey and the rep scheduled or sent the survey order — that IS capturing the opportunity. Do NOT flag when the rep offered audio and the customer declined, or the space does not warrant it.'
 WHERE `rule_key` = 'audio_system_not_offered';

UPDATE `ie_missed_opportunity_rule`
   SET `body_md` = 'The call was billing, shipping, technical, or administrative, the rep resolved it, and there was a natural growth opening THE CUSTOMER SAID (an upcoming project, another site they named, aging hardware they asked about) that the rep never probed. Do NOT infer a group from a brand name, a dealership group, or an email domain. Do NOT flag a clean service call with no customer-stated opening.'
 WHERE `rule_key` = 'service_call_no_sales_probe';

UPDATE `ie_missed_opportunity_rule`
   SET `body_md` = 'The rep reached voicemail or a live gatekeeper taking a message, and the message was missing name, company, one concrete reason to call back, or a direct number — or used give-up language ("last follow-up"). Do NOT use this rule for a live conversation (failed to capture an email, weak discovery). Those are other rules or not a miss.'
 WHERE `rule_key` = 'weak_or_missing_voicemail';
