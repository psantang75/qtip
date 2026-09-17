-- ─────────────────────────────────────────────────────────────────────────────
-- Missed Opportunities — the "rep offered, customer chose otherwise" carve-out.
-- Data only; no schema change.
--
-- Two high-severity rules were firing on calls the rep actually handled:
--
--   1. `buying_signal_not_closed` ended with "Flag when the rep responded with a
--      quote, a proposal, or a future follow-up instead of placing the order",
--      with no exception for the rep having ASKED for the order and the customer
--      choosing another path. A rep who offered to take the card on the line and
--      was told "just email me the link, I'm with a client" was graded identically
--      to a rep who never asked. `warranty_not_offered` and
--      `audio_system_not_offered` have carried an offered-and-declined exception
--      since the starter seed, and 20260909160000 added the equivalent to
--      `deal_lost_over_small_blocker`; these were the two high-severity rules
--      that never got one.
--
--   2. `group_expansion_not_captured` fired on any multi-site mention handled as
--      one site. But a customer who says "three stores, start with Hayward, we'll
--      expand once it proves out" is buying the way they want to buy — the only
--      real miss there is leaving the OTHER sites unrecorded, and whether a lead
--      was created for them is not always visible in the CRM window the prompt
--      renders. The rule now says so explicitly rather than letting the model
--      assert an omission it cannot see.
--
-- Both UPDATEs rewrite the whole `body_md` value, so re-running is a no-op, and
-- both rules stay editable in the report's Settings tab afterwards. `guidance_md`
-- is left alone — the coaching wording was never the problem.
-- ─────────────────────────────────────────────────────────────────────────────

UPDATE `ie_missed_opportunity_rule`
   SET `body_md` = 'The customer signalled readiness to buy and the rep did not attempt to take the order on the call. Signals include asking how to get started, asking whether to order online or through the rep, naming a go-live or opening date, or saying they are ready to move forward. Flag when the rep responded with a quote, a proposal, or a future follow-up instead of placing the order. Do NOT flag when the rep DID ask for the order and the customer chose another path — asking to be emailed a link or an order form, saying they are busy or with a customer, or wanting to think it over. The rep offering to take payment or place the order while on the line IS the close, so a customer-driven deferral after that offer is not this miss. Before reporting it, confirm from the transcript that the rep never made the offer.'
 WHERE `rule_key` = 'buying_signal_not_closed';

UPDATE `ie_missed_opportunity_rule`
   SET `body_md` = 'The customer revealed they operate, manage, or belong to more than one location, franchise group, dealership group, portfolio, or corporate parent, and the rep handled the call as a single site. Flag when the rep did not ask how many locations exist, did not ask which sites lack service, did not request the corporate or group contact, or accepted a passive hand-off such as the customer offering to pass along information. Do NOT flag on a phased rollout by itself: a customer who deliberately starts with one site and expands after it proves out is buying the way they want to buy. In that case this is a miss only when the OTHER sites were left unrecorded — no addresses taken, no group quote offered, and nothing showing a lead or record created for them. If the CRM sections shown to you do not reveal whether the other sites were recorded, say exactly that in what_happened instead of asserting they were not captured.'
 WHERE `rule_key` = 'group_expansion_not_captured';
