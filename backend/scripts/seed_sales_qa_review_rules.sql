-- Database seed: ONLY the 14 QA review rules introduced in this task.
-- Applied with user approval to LOCAL localhost:3306/qtip on 2026-09-14 at 13:12:42 UTC.
-- Verified: 14 inserted (IDs 22-35), all 11 existing rows unchanged, 25 active rules total.
-- Other environments require separate authorization; this script is not automatically run.
-- Existing table only; no schema/form/persona/KB/play changes. Existing keys are preserved.
-- These become editable in Admin > Insights Engine > Missed Opportunities > Rules.
-- The original QA form remains managed in Form Builder; this does not enable its AI reviewer.
SET NAMES utf8mb4;
START TRANSACTION;

-- QA step: Calling standards
INSERT INTO ie_missed_opportunity_rule
  (rule_key, rule_name, category, severity, body_md, guidance_md, is_active, is_omission, sort_order, updated_by)
VALUES (_utf8mb4'sales_qa_v8_calling',
  _utf8mb4'QA step: Calling standards',
  _utf8mb4'Required sales step',
  _utf8mb4'medium',
  _utf8mb4'Approved Sales Interaction QA snapshot: version 8, form 319, supplied 2026-09-14. Report a material unmet requirement below even without a known dollar loss. Contact-Made categories apply only after actual contact; No-Contact applies to no contact/voicemail. Gates and N/A determine applicability. This database rule is an editable versioned coaching adaptation, not a live form binding.

### 1. Calling Standards & Approach (weight 0.06)

| Id | Question | Type | Crit | N/A | Shown when |
| --- | --- | --- | --- | --- | --- |
| 10810 | Was the call placed within the customer''s local calling hours (9 a.m.–5 p.m. local)? | YES_NO | – | Yes | Always |
| 10811 | Did the AE call before emailing (call-first)? | YES_NO | – | Yes | Always |
| 10812 | Did the AE avoid steering the customer toward email-only contact? | YES_NO | **Yes** | Yes | Always |
| 10813 | Calling Standards & Approach Feedback | TEXT | – | – | Always |

Interpretation: Honor the customer-requested email-only exception and documented outside-hours requests in the KB. A prior email-only request does not require another initial call attempt.',
  _utf8mb4'Apply this category only when its contact branch and applicability gates are satisfied. This is coaching, not a scored Quality audit; do not calculate a QA percentage or expose manager-summary answers. Unknown is not No. Check prior completion, customer preference, legitimate prerequisites and same-day follow-through before alleging a miss. An appropriate offer declined by the customer is not an omission. Require actual KB content for script, cadence, product and warranty details; conflicting or incomplete evidence cannot support a definitive policy failure. Use the active rubric key for an overlapping miss and report one finding. Give a concise interaction summary, the specific miss with question/source evidence, natural next-time wording, and an appropriate recovery owner/action/timing after checking current status. Do not invent lost revenue, urgency, licensing scope, discounts or a recovery opportunity. Counts and talk ratios alone are not failures.', 1, 0, 8000, NULL)
ON DUPLICATE KEY UPDATE rule_key = VALUES(rule_key);
-- QA step: No-contact attempt
INSERT INTO ie_missed_opportunity_rule
  (rule_key, rule_name, category, severity, body_md, guidance_md, is_active, is_omission, sort_order, updated_by)
VALUES (_utf8mb4'sales_qa_v8_no_contact',
  _utf8mb4'QA step: No-contact attempt',
  _utf8mb4'Required sales step',
  _utf8mb4'medium',
  _utf8mb4'Approved Sales Interaction QA snapshot: version 8, form 319, supplied 2026-09-14. Report a material unmet requirement below even without a known dollar loss. Contact-Made categories apply only after actual contact; No-Contact applies to no contact/voicemail. Gates and N/A determine applicability. This database rule is an editable versioned coaching adaptation, not a live form binding.

### 2. Contact Attempt – No-Contact (weight 0.12)

| Id | Question | Type | Crit | N/A | Shown when |
| --- | --- | --- | --- | --- | --- |
| 10814 | Did the AE make a genuine attempt to reach the contact? | YES_NO | **Yes** | No | Interaction Type = No Contact / Voicemail |
| 10815 | Did the AE leave a voicemail when the option was available? | YES_NO | – | Yes | Interaction Type = No Contact / Voicemail |
| 10816 | Did the voicemail follow the approved script? | YES_NO | – | Yes | Interaction Type = No Contact / Voicemail |
| 10817 | Contact Attempted Feedback | TEXT | – | – | Interaction Type = No Contact / Voicemail |',
  _utf8mb4'Apply this category only when its contact branch and applicability gates are satisfied. This is coaching, not a scored Quality audit; do not calculate a QA percentage or expose manager-summary answers. Unknown is not No. Check prior completion, customer preference, legitimate prerequisites and same-day follow-through before alleging a miss. An appropriate offer declined by the customer is not an omission. Require actual KB content for script, cadence, product and warranty details; conflicting or incomplete evidence cannot support a definitive policy failure. Use the active rubric key for an overlapping miss and report one finding. Give a concise interaction summary, the specific miss with question/source evidence, natural next-time wording, and an appropriate recovery owner/action/timing after checking current status. Do not invent lost revenue, urgency, licensing scope, discounts or a recovery opportunity. Counts and talk ratios alone are not failures.', 1, 0, 8001, NULL)
ON DUPLICATE KEY UPDATE rule_key = VALUES(rule_key);
-- QA step: Call flow
INSERT INTO ie_missed_opportunity_rule
  (rule_key, rule_name, category, severity, body_md, guidance_md, is_active, is_omission, sort_order, updated_by)
VALUES (_utf8mb4'sales_qa_v8_call_flow',
  _utf8mb4'QA step: Call flow',
  _utf8mb4'Required sales step',
  _utf8mb4'medium',
  _utf8mb4'Approved Sales Interaction QA snapshot: version 8, form 319, supplied 2026-09-14. Report a material unmet requirement below even without a known dollar loss. Contact-Made categories apply only after actual contact; No-Contact applies to no contact/voicemail. Gates and N/A determine applicability. This database rule is an editable versioned coaching adaptation, not a live form binding.

### 3. Script & Call Flow Adherence – Contact-Made (weight 0.07)

| Id | Question | Type | Crit | N/A | Shown when |
| --- | --- | --- | --- | --- | --- |
| 10818 | Did the AE follow the correct call flow for this interaction? | YES_NO | – | Yes | Interaction Type = Contact Made |
| 10819 | Did the AE maintain control and direction of the call? | YES_NO | – | Yes | Interaction Type = Contact Made |
| 10820 | Script & Call Flow Adherence Feedback | TEXT | – | – | Interaction Type = Contact Made |',
  _utf8mb4'Apply this category only when its contact branch and applicability gates are satisfied. This is coaching, not a scored Quality audit; do not calculate a QA percentage or expose manager-summary answers. Unknown is not No. Check prior completion, customer preference, legitimate prerequisites and same-day follow-through before alleging a miss. An appropriate offer declined by the customer is not an omission. Require actual KB content for script, cadence, product and warranty details; conflicting or incomplete evidence cannot support a definitive policy failure. Use the active rubric key for an overlapping miss and report one finding. Give a concise interaction summary, the specific miss with question/source evidence, natural next-time wording, and an appropriate recovery owner/action/timing after checking current status. Do not invent lost revenue, urgency, licensing scope, discounts or a recovery opportunity. Counts and talk ratios alone are not failures.', 1, 0, 8002, NULL)
ON DUPLICATE KEY UPDATE rule_key = VALUES(rule_key);
-- QA step: Discovery and needs
INSERT INTO ie_missed_opportunity_rule
  (rule_key, rule_name, category, severity, body_md, guidance_md, is_active, is_omission, sort_order, updated_by)
VALUES (_utf8mb4'sales_qa_v8_discovery',
  _utf8mb4'QA step: Discovery and needs',
  _utf8mb4'Required sales step',
  _utf8mb4'medium',
  _utf8mb4'Approved Sales Interaction QA snapshot: version 8, form 319, supplied 2026-09-14. Report a material unmet requirement below even without a known dollar loss. Contact-Made categories apply only after actual contact; No-Contact applies to no contact/voicemail. Gates and N/A determine applicability. This database rule is an editable versioned coaching adaptation, not a live form binding.

### 4. Discovery & Needs Assessment – Contact-Made (weight 0.12)

| Id | Question | Type | Crit | N/A | Shown when |
| --- | --- | --- | --- | --- | --- |
| 10821 | Was discovery required for this interaction? *(gate)* | YES_NO | – | No | Interaction Type = Contact Made |
| 10822 | Did the AE ask the required opening question (number of locations and current music source)? | YES_NO | – | Yes | 10821 = Yes |
| 10823 | Did the AE identify why the customer wants a new music solution? | YES_NO | – | Yes | 10821 = Yes |
| 10824 | Did the AE clarify whether the contact is a franchisee or corporate? | YES_NO | – | Yes | 10821 = Yes |
| 10825 | Did the AE present the sound-system upsell talk track? | YES_NO | – | Yes | 10821 = Yes |
| 10826 | Did the AE ask for the customer''s feedback after addressing their needs? | YES_NO | – | Yes | 10821 = Yes |
| 10827 | Discovery & Needs Assessment Feedback | TEXT | – | – | 10821 = Yes |',
  _utf8mb4'Apply this category only when its contact branch and applicability gates are satisfied. This is coaching, not a scored Quality audit; do not calculate a QA percentage or expose manager-summary answers. Unknown is not No. Check prior completion, customer preference, legitimate prerequisites and same-day follow-through before alleging a miss. An appropriate offer declined by the customer is not an omission. Require actual KB content for script, cadence, product and warranty details; conflicting or incomplete evidence cannot support a definitive policy failure. Use the active rubric key for an overlapping miss and report one finding. Give a concise interaction summary, the specific miss with question/source evidence, natural next-time wording, and an appropriate recovery owner/action/timing after checking current status. Do not invent lost revenue, urgency, licensing scope, discounts or a recovery opportunity. Counts and talk ratios alone are not failures.', 1, 1, 8003, NULL)
ON DUPLICATE KEY UPDATE rule_key = VALUES(rule_key);
-- QA step: Account research
INSERT INTO ie_missed_opportunity_rule
  (rule_key, rule_name, category, severity, body_md, guidance_md, is_active, is_omission, sort_order, updated_by)
VALUES (_utf8mb4'sales_qa_v8_research',
  _utf8mb4'QA step: Account research',
  _utf8mb4'Required sales step',
  _utf8mb4'medium',
  _utf8mb4'Approved Sales Interaction QA snapshot: version 8, form 319, supplied 2026-09-14. Report a material unmet requirement below even without a known dollar loss. Contact-Made categories apply only after actual contact; No-Contact applies to no contact/voicemail. Gates and N/A determine applicability. This database rule is an editable versioned coaching adaptation, not a live form binding.

### 5. Account Research & Lead Generation (weight 0.10)

| Id | Question | Type | Crit | N/A | Shown when |
| --- | --- | --- | --- | --- | --- |
| 10828 | Was account research required for this interaction (e.g., first engagement)? *(gate)* | YES_NO | – | No | Always |
| 10829 | Was account research completed before engaging (or correctly skipped under the Corporate Non-Franchise exception)? | YES_NO | **Yes** | No | 10828 = Yes |
| 10830 | Did the AE log the complete ChatGPT research prompt findings and enter them in the task notes? | YES_NO | – | Yes | 10828 = Yes |
| 10831 | For franchise accounts, was research focused on the franchisee (current and other brands)? | YES_NO | – | Yes | 10829 = Yes |
| 10832 | Account Research & Lead Generation Feedback | TEXT | – | – | 10828 = Yes |

Interpretation: Recognize the Corporate Non-Franchise exception and franchisee focus. Q10829 is YES_NO; its orphaned RADIO choices are not usable. Verify research timing and prior work before alleging omission.',
  _utf8mb4'Apply this category only when its contact branch and applicability gates are satisfied. This is coaching, not a scored Quality audit; do not calculate a QA percentage or expose manager-summary answers. Unknown is not No. Check prior completion, customer preference, legitimate prerequisites and same-day follow-through before alleging a miss. An appropriate offer declined by the customer is not an omission. Require actual KB content for script, cadence, product and warranty details; conflicting or incomplete evidence cannot support a definitive policy failure. Use the active rubric key for an overlapping miss and report one finding. Give a concise interaction summary, the specific miss with question/source evidence, natural next-time wording, and an appropriate recovery owner/action/timing after checking current status. Do not invent lost revenue, urgency, licensing scope, discounts or a recovery opportunity. Counts and talk ratios alone are not failures.', 1, 0, 8004, NULL)
ON DUPLICATE KEY UPDATE rule_key = VALUES(rule_key);
-- QA step: Expansion and routing
INSERT INTO ie_missed_opportunity_rule
  (rule_key, rule_name, category, severity, body_md, guidance_md, is_active, is_omission, sort_order, updated_by)
VALUES (_utf8mb4'sales_qa_v8_expansion',
  _utf8mb4'QA step: Expansion and routing',
  _utf8mb4'Required sales step',
  _utf8mb4'medium',
  _utf8mb4'Approved Sales Interaction QA snapshot: version 8, form 319, supplied 2026-09-14. Report a material unmet requirement below even without a known dollar loss. Contact-Made categories apply only after actual contact; No-Contact applies to no contact/voicemail. Gates and N/A determine applicability. This database rule is an editable versioned coaching adaptation, not a live form binding.

### 6. Expansion Opportunity Identification & Routing (weight 0.08)

| Id | Question | Type | Crit | N/A | Shown when |
| --- | --- | --- | --- | --- | --- |
| 10833 | Was an expansion review applicable (multi-location or franchise brand)? *(gate)* | YES_NO | – | No | Always |
| 10834 | Did the AE identify the brand''s total locations vs. those already in CRM (net-new)? | YES_NO | – | Yes | **10833 = *(blank)* — see anomaly 1** |
| 10835 | Were the identified net-new locations documented? | YES_NO | – | Yes | 10833 = Yes |
| 10836 | Did the AE identify and document the expansion contact? | YES_NO | – | Yes | 10833 = Yes |
| 10837 | Was the net-new opportunity routed correctly by size (20+ to management review; under 20 pursued by the AE)? | YES_NO | – | Yes | 10833 = Yes |
| 10838 | Was a lead created with the correct status for the new opportunity? | YES_NO | – | Yes | 10833 = Yes |
| 10839 | Were all identified net-new sites included in the original sale? | YES_NO | – | Yes | 10833 = Yes |
| 10840 | Was a new lead created for any unsold net-new sites? | YES_NO | – | Yes | 10833 = Yes |
| 10841 | Expansion Opportunity Identification & Routing Feedback | TEXT | – | – | 10833 = Yes |

Interpretation: Q10834 has a blank target_value and is permanently hidden in v8; it can support coaching only, not a failed scored question. The 20+ net-new routing threshold differs from total-site pricing tiers. Check Daily Tracker evidence when required; unavailable Tracker data is unknown.',
  _utf8mb4'Apply this category only when its contact branch and applicability gates are satisfied. This is coaching, not a scored Quality audit; do not calculate a QA percentage or expose manager-summary answers. Unknown is not No. Check prior completion, customer preference, legitimate prerequisites and same-day follow-through before alleging a miss. An appropriate offer declined by the customer is not an omission. Require actual KB content for script, cadence, product and warranty details; conflicting or incomplete evidence cannot support a definitive policy failure. Use the active rubric key for an overlapping miss and report one finding. Give a concise interaction summary, the specific miss with question/source evidence, natural next-time wording, and an appropriate recovery owner/action/timing after checking current status. Do not invent lost revenue, urgency, licensing scope, discounts or a recovery opportunity. Counts and talk ratios alone are not failures.', 1, 0, 8005, NULL)
ON DUPLICATE KEY UPDATE rule_key = VALUES(rule_key);
-- QA step: Product and service accuracy
INSERT INTO ie_missed_opportunity_rule
  (rule_key, rule_name, category, severity, body_md, guidance_md, is_active, is_omission, sort_order, updated_by)
VALUES (_utf8mb4'sales_qa_v8_product',
  _utf8mb4'QA step: Product and service accuracy',
  _utf8mb4'Required sales step',
  _utf8mb4'medium',
  _utf8mb4'Approved Sales Interaction QA snapshot: version 8, form 319, supplied 2026-09-14. Report a material unmet requirement below even without a known dollar loss. Contact-Made categories apply only after actual contact; No-Contact applies to no contact/voicemail. Gates and N/A determine applicability. This database rule is an editable versioned coaching adaptation, not a live form binding.

### 7. Product & Service Knowledge – Contact-Made (weight 0.08)

| Id | Question | Type | Crit | N/A | Shown when |
| --- | --- | --- | --- | --- | --- |
| 10842 | Were products or services required for this interaction? *(gate)* | YES_NO | – | No | Interaction Type = Contact Made |
| 10843 | Did the AE describe product and service features and compatibility accurately? | YES_NO | – | Yes | 10842 = Yes |
| 10844 | Did the AE explain licensing requirements accurately? | YES_NO | – | Yes | 10842 = Yes |
| 10845 | Did the AE recommend the appropriate equipment and service? | YES_NO | – | Yes | 10842 = Yes |
| 10846 | Did the AE use research or supervisor support when needed? | YES_NO | – | Yes | 10842 = Yes |
| 10847 | Product & Service Knowledge Feedback | TEXT | – | – | 10842 = Yes |',
  _utf8mb4'Apply this category only when its contact branch and applicability gates are satisfied. This is coaching, not a scored Quality audit; do not calculate a QA percentage or expose manager-summary answers. Unknown is not No. Check prior completion, customer preference, legitimate prerequisites and same-day follow-through before alleging a miss. An appropriate offer declined by the customer is not an omission. Require actual KB content for script, cadence, product and warranty details; conflicting or incomplete evidence cannot support a definitive policy failure. Use the active rubric key for an overlapping miss and report one finding. Give a concise interaction summary, the specific miss with question/source evidence, natural next-time wording, and an appropriate recovery owner/action/timing after checking current status. Do not invent lost revenue, urgency, licensing scope, discounts or a recovery opportunity. Counts and talk ratios alone are not failures.', 1, 0, 8006, NULL)
ON DUPLICATE KEY UPDATE rule_key = VALUES(rule_key);
-- QA step: Objection handling
INSERT INTO ie_missed_opportunity_rule
  (rule_key, rule_name, category, severity, body_md, guidance_md, is_active, is_omission, sort_order, updated_by)
VALUES (_utf8mb4'sales_qa_v8_objections',
  _utf8mb4'QA step: Objection handling',
  _utf8mb4'Required sales step',
  _utf8mb4'medium',
  _utf8mb4'Approved Sales Interaction QA snapshot: version 8, form 319, supplied 2026-09-14. Report a material unmet requirement below even without a known dollar loss. Contact-Made categories apply only after actual contact; No-Contact applies to no contact/voicemail. Gates and N/A determine applicability. This database rule is an editable versioned coaching adaptation, not a live form binding.

### 8. Objection Handling – Contact-Made (weight 0.06)

| Id | Question | Type | Crit | N/A | Shown when |
| --- | --- | --- | --- | --- | --- |
| 10848 | Were any objections or hesitations raised? *(gate)* | YES_NO | – | No | Interaction Type = Contact Made |
| 10849 | Did the AE acknowledge and address ALL the customer''s objections? | YES_NO | – | Yes | 10848 = Yes |
| 10850 | Did the AE attempt to overcome ALL objections rather than concede or defer? | YES_NO | – | Yes | 10848 = Yes |
| 10851 | Objection Handling Feedback | TEXT | – | – | 10848 = Yes |',
  _utf8mb4'Apply this category only when its contact branch and applicability gates are satisfied. This is coaching, not a scored Quality audit; do not calculate a QA percentage or expose manager-summary answers. Unknown is not No. Check prior completion, customer preference, legitimate prerequisites and same-day follow-through before alleging a miss. An appropriate offer declined by the customer is not an omission. Require actual KB content for script, cadence, product and warranty details; conflicting or incomplete evidence cannot support a definitive policy failure. Use the active rubric key for an overlapping miss and report one finding. Give a concise interaction summary, the specific miss with question/source evidence, natural next-time wording, and an appropriate recovery owner/action/timing after checking current status. Do not invent lost revenue, urgency, licensing scope, discounts or a recovery opportunity. Counts and talk ratios alone are not failures.', 1, 1, 8007, NULL)
ON DUPLICATE KEY UPDATE rule_key = VALUES(rule_key);
-- QA step: Warranty and relevant upsell
INSERT INTO ie_missed_opportunity_rule
  (rule_key, rule_name, category, severity, body_md, guidance_md, is_active, is_omission, sort_order, updated_by)
VALUES (_utf8mb4'sales_qa_v8_warranty',
  _utf8mb4'QA step: Warranty and relevant upsell',
  _utf8mb4'Required sales step',
  _utf8mb4'medium',
  _utf8mb4'Approved Sales Interaction QA snapshot: version 8, form 319, supplied 2026-09-14. Report a material unmet requirement below even without a known dollar loss. Contact-Made categories apply only after actual contact; No-Contact applies to no contact/voicemail. Gates and N/A determine applicability. This database rule is an editable versioned coaching adaptation, not a live form binding.

### 9. Warranty & Upsell – Contact-Made (weight 0.06)

| Id | Question | Type | Crit | N/A | Shown when |
| --- | --- | --- | --- | --- | --- |
| 10852 | Was warranty or upsell applicable on this interaction? *(gate)* | YES_NO | – | No | Interaction Type = Contact Made |
| 10853 | Did the AE offer or discuss the warranty when applicable? | YES_NO | **Yes** | Yes | 10852 = Yes |
| 10854 | Did the AE present the warranty using the three-problems / three-solutions framework? | YES_NO | – | Yes | 10852 = Yes |
| 10855 | Did the AE pursue relevant upsells (zones, messaging, equipment, installs, locations, players)? | YES_NO | **Yes** | Yes | 10852 = Yes |
| 10856 | Warranty & Upsell Feedback | TEXT | – | – | 10852 = Yes |

Interpretation: Evaluate warranty and other upsell applicability separately; one does not make every offer mandatory.',
  _utf8mb4'Apply this category only when its contact branch and applicability gates are satisfied. This is coaching, not a scored Quality audit; do not calculate a QA percentage or expose manager-summary answers. Unknown is not No. Check prior completion, customer preference, legitimate prerequisites and same-day follow-through before alleging a miss. An appropriate offer declined by the customer is not an omission. Require actual KB content for script, cadence, product and warranty details; conflicting or incomplete evidence cannot support a definitive policy failure. Use the active rubric key for an overlapping miss and report one finding. Give a concise interaction summary, the specific miss with question/source evidence, natural next-time wording, and an appropriate recovery owner/action/timing after checking current status. Do not invent lost revenue, urgency, licensing scope, discounts or a recovery opportunity. Counts and talk ratios alone are not failures.', 1, 0, 8008, NULL)
ON DUPLICATE KEY UPDATE rule_key = VALUES(rule_key);
-- QA step: Proposal and close
INSERT INTO ie_missed_opportunity_rule
  (rule_key, rule_name, category, severity, body_md, guidance_md, is_active, is_omission, sort_order, updated_by)
VALUES (_utf8mb4'sales_qa_v8_proposal',
  _utf8mb4'QA step: Proposal and close',
  _utf8mb4'Required sales step',
  _utf8mb4'medium',
  _utf8mb4'Approved Sales Interaction QA snapshot: version 8, form 319, supplied 2026-09-14. Report a material unmet requirement below even without a known dollar loss. Contact-Made categories apply only after actual contact; No-Contact applies to no contact/voicemail. Gates and N/A determine applicability. This database rule is an editable versioned coaching adaptation, not a live form binding.

### 10. Sales Process & Proposal – Contact-Made (weight 0.06)

| Id | Question | Type | Crit | N/A | Shown when |
| --- | --- | --- | --- | --- | --- |
| 10857 | Was a quote or proposal in scope for this interaction? *(gate)* | YES_NO | – | No | Interaction Type = Contact Made |
| 10858 | Did the AE generate and send a quote/proposal when required? | YES_NO | – | Yes | **10857 = *(blank)* — see anomaly 1** |
| 10859 | For non-audio quotes, did the AE attempt to send the proposal and close on the call? | YES_NO | – | Yes | 10857 = Yes |
| 10860 | Sales Process & Proposal Feedback | TEXT | – | – | 10857 = Yes |

Interpretation: Q10858 has a blank target_value and is permanently hidden in v8; it can support coaching only, not a failed scored question. Respect audio and prerequisite exceptions.',
  _utf8mb4'Apply this category only when its contact branch and applicability gates are satisfied. This is coaching, not a scored Quality audit; do not calculate a QA percentage or expose manager-summary answers. Unknown is not No. Check prior completion, customer preference, legitimate prerequisites and same-day follow-through before alleging a miss. An appropriate offer declined by the customer is not an omission. Require actual KB content for script, cadence, product and warranty details; conflicting or incomplete evidence cannot support a definitive policy failure. Use the active rubric key for an overlapping miss and report one finding. Give a concise interaction summary, the specific miss with question/source evidence, natural next-time wording, and an appropriate recovery owner/action/timing after checking current status. Do not invent lost revenue, urgency, licensing scope, discounts or a recovery opportunity. Counts and talk ratios alone are not failures.', 1, 1, 8009, NULL)
ON DUPLICATE KEY UPDATE rule_key = VALUES(rule_key);
-- QA step: Follow-up and next contact
INSERT INTO ie_missed_opportunity_rule
  (rule_key, rule_name, category, severity, body_md, guidance_md, is_active, is_omission, sort_order, updated_by)
VALUES (_utf8mb4'sales_qa_v8_follow_up',
  _utf8mb4'QA step: Follow-up and next contact',
  _utf8mb4'Required sales step',
  _utf8mb4'medium',
  _utf8mb4'Approved Sales Interaction QA snapshot: version 8, form 319, supplied 2026-09-14. Report a material unmet requirement below even without a known dollar loss. Contact-Made categories apply only after actual contact; No-Contact applies to no contact/voicemail. Gates and N/A determine applicability. This database rule is an editable versioned coaching adaptation, not a live form binding.

### 11. Follow-Up Cadence (weight 0.06)

| Id | Question | Type | Crit | N/A | Shown when |
| --- | --- | --- | --- | --- | --- |
| 10861 | Was follow-up cadence applicable (an existing lead / opportunity in progress)? *(gate)* | YES_NO | – | No | Always |
| 10862 | Did the AE follow the required follow-up cadence? | YES_NO | – | Yes | 10861 = Yes |
| 10863 | Did follow-up emails reference the call attempt (call-first)? | YES_NO | – | Yes | 10861 = Yes |
| 10864 | Did the AE set a clear expectation for the next contact with the customer? | YES_NO | – | Yes | 10861 = Yes |
| 10865 | Follow-Up Cadence Feedback | TEXT | – | – | 10861 = Yes |',
  _utf8mb4'Apply this category only when its contact branch and applicability gates are satisfied. This is coaching, not a scored Quality audit; do not calculate a QA percentage or expose manager-summary answers. Unknown is not No. Check prior completion, customer preference, legitimate prerequisites and same-day follow-through before alleging a miss. An appropriate offer declined by the customer is not an omission. Require actual KB content for script, cadence, product and warranty details; conflicting or incomplete evidence cannot support a definitive policy failure. Use the active rubric key for an overlapping miss and report one finding. Give a concise interaction summary, the specific miss with question/source evidence, natural next-time wording, and an appropriate recovery owner/action/timing after checking current status. Do not invent lost revenue, urgency, licensing scope, discounts or a recovery opportunity. Counts and talk ratios alone are not failures.', 1, 0, 8010, NULL)
ON DUPLICATE KEY UPDATE rule_key = VALUES(rule_key);
-- QA step: Lead entry and management
INSERT INTO ie_missed_opportunity_rule
  (rule_key, rule_name, category, severity, body_md, guidance_md, is_active, is_omission, sort_order, updated_by)
VALUES (_utf8mb4'sales_qa_v8_lead_management',
  _utf8mb4'QA step: Lead entry and management',
  _utf8mb4'Required sales step',
  _utf8mb4'medium',
  _utf8mb4'Approved Sales Interaction QA snapshot: version 8, form 319, supplied 2026-09-14. Report a material unmet requirement below even without a known dollar loss. Contact-Made categories apply only after actual contact; No-Contact applies to no contact/voicemail. Gates and N/A determine applicability. This database rule is an editable versioned coaching adaptation, not a live form binding.

### 12. Lead Management & Entry (weight 0.07)

| Id | Question | Type | Crit | N/A | Shown when |
| --- | --- | --- | --- | --- | --- |
| 10866 | Was lead entry or management applicable to this interaction? *(gate)* | YES_NO | – | No | Always |
| 10867 | Did the AE create a lead when warranted (even if lost on the same interaction)? | YES_NO | **Yes** | Yes | 10866 = Yes |
| 10868 | Was the site-count tier handled correctly (1–9 standard, 10–49 tiered, 50+ referred to management)? | YES_NO | – | Yes | 10866 = Yes |
| 10869 | Was the lead status set accurately per the Knowledge Base? | YES_NO | – | Yes | 10866 = Yes |
| 10870 | Was the lead contacted within one business day, or escalated to the Sales Manager? | YES_NO | – | Yes | 10866 = Yes |
| 10871 | Lead Management & Entry Feedback | TEXT | – | – | 10866 = Yes |',
  _utf8mb4'Apply this category only when its contact branch and applicability gates are satisfied. This is coaching, not a scored Quality audit; do not calculate a QA percentage or expose manager-summary answers. Unknown is not No. Check prior completion, customer preference, legitimate prerequisites and same-day follow-through before alleging a miss. An appropriate offer declined by the customer is not an omission. Require actual KB content for script, cadence, product and warranty details; conflicting or incomplete evidence cannot support a definitive policy failure. Use the active rubric key for an overlapping miss and report one finding. Give a concise interaction summary, the specific miss with question/source evidence, natural next-time wording, and an appropriate recovery owner/action/timing after checking current status. Do not invent lost revenue, urgency, licensing scope, discounts or a recovery opportunity. Counts and talk ratios alone are not failures.', 1, 0, 8011, NULL)
ON DUPLICATE KEY UPDATE rule_key = VALUES(rule_key);
-- QA step: CRM documentation
INSERT INTO ie_missed_opportunity_rule
  (rule_key, rule_name, category, severity, body_md, guidance_md, is_active, is_omission, sort_order, updated_by)
VALUES (_utf8mb4'sales_qa_v8_notes',
  _utf8mb4'QA step: CRM documentation',
  _utf8mb4'Required sales step',
  _utf8mb4'medium',
  _utf8mb4'Approved Sales Interaction QA snapshot: version 8, form 319, supplied 2026-09-14. Report a material unmet requirement below even without a known dollar loss. Contact-Made categories apply only after actual contact; No-Contact applies to no contact/voicemail. Gates and N/A determine applicability. This database rule is an editable versioned coaching adaptation, not a live form binding.

### 13. CRM Documentation & Note Policy (weight 0.05)

| Id | Question | Type | Crit | N/A | Shown when |
| --- | --- | --- | --- | --- | --- |
| 10872 | Did the AE document the interaction in the CRM? | YES_NO | **Yes** | Yes | Always |
| 10873 | Was it documented in the correct area (ticket vs. task)? | YES_NO | – | Yes | Always |
| 10874 | Do the notes meet the Knowledge Base requirements (attempt, outcome, next steps, NDC)? | YES_NO | – | Yes | Always |
| 10875 | CRM Documentation & Note Policy Feedback | TEXT | – | – | Always |',
  _utf8mb4'Apply this category only when its contact branch and applicability gates are satisfied. This is coaching, not a scored Quality audit; do not calculate a QA percentage or expose manager-summary answers. Unknown is not No. Check prior completion, customer preference, legitimate prerequisites and same-day follow-through before alleging a miss. An appropriate offer declined by the customer is not an omission. Require actual KB content for script, cadence, product and warranty details; conflicting or incomplete evidence cannot support a definitive policy failure. Use the active rubric key for an overlapping miss and report one finding. Give a concise interaction summary, the specific miss with question/source evidence, natural next-time wording, and an appropriate recovery owner/action/timing after checking current status. Do not invent lost revenue, urgency, licensing scope, discounts or a recovery opportunity. Counts and talk ratios alone are not failures.', 1, 0, 8012, NULL)
ON DUPLICATE KEY UPDATE rule_key = VALUES(rule_key);
-- QA step: Work-from-home policy
INSERT INTO ie_missed_opportunity_rule
  (rule_key, rule_name, category, severity, body_md, guidance_md, is_active, is_omission, sort_order, updated_by)
VALUES (_utf8mb4'sales_qa_v8_work_from_home',
  _utf8mb4'QA step: Work-from-home policy',
  _utf8mb4'Required sales step',
  _utf8mb4'medium',
  _utf8mb4'Approved Sales Interaction QA snapshot: version 8, form 319, supplied 2026-09-14. Report a material unmet requirement below even without a known dollar loss. Contact-Made categories apply only after actual contact; No-Contact applies to no contact/voicemail. Gates and N/A determine applicability. This database rule is an editable versioned coaching adaptation, not a live form binding.

### 14. Work-from-Home Compliance (weight 0.01)

| Id | Question | Type | Crit | N/A | Shown when |
| --- | --- | --- | --- | --- | --- |
| 10876 | Was the Work-from-Home policy followed? | YES_NO | – | Yes | Always |
| 10877 | Work-from-Home Compliance Feedback | TEXT | – | – | Always |

Interpretation: Require confirmed AE policy applicability and direct relevant evidence; do not infer home location or a policy breach from background noise.',
  _utf8mb4'Apply this category only when its contact branch and applicability gates are satisfied. This is coaching, not a scored Quality audit; do not calculate a QA percentage or expose manager-summary answers. Unknown is not No. Check prior completion, customer preference, legitimate prerequisites and same-day follow-through before alleging a miss. An appropriate offer declined by the customer is not an omission. Require actual KB content for script, cadence, product and warranty details; conflicting or incomplete evidence cannot support a definitive policy failure. Use the active rubric key for an overlapping miss and report one finding. Give a concise interaction summary, the specific miss with question/source evidence, natural next-time wording, and an appropriate recovery owner/action/timing after checking current status. Do not invent lost revenue, urgency, licensing scope, discounts or a recovery opportunity. Counts and talk ratios alone are not failures.', 1, 0, 8013, NULL)
ON DUPLICATE KEY UPDATE rule_key = VALUES(rule_key);
COMMIT;
