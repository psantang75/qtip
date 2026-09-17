# Sales Interaction QA — Form Definition (v8, current)

Snapshot of the live form definition as stored in **production** (`qtip-db` on
`10.90.15.5`) on 2026-09-14. This is a read-only reference document; the form
itself is edited through the Quality → Form Builder UI.

## Form identity

| Field | Value |
| --- | --- |
| Form name | Sales Interaction QA |
| Form id | 319 |
| Version | 8 (current / `is_active = 1`) |
| Form group id | 312 (versions 1–8 = ids 312–319) |
| Parent form id | 318 (v7) |
| Interaction type | UNIVERSAL |
| Access mode | `INTERNAL` |
| Access roles | `["user:40"]` (plus `admin` implicitly) |
| Critical cap | 79.00 % |
| AI reviewer | Disabled (`ai_enabled = 0`, no review guidance, no base prompt) |
| Created | 2026-09-10 19:00:35 by user 6 |

Because `access_mode = INTERNAL`, this form is hidden from every agent/CSR and
from the standard Quality surfaces. It is only auditable by the listed audience
and its results only appear in the Insights → Internal Research section.

Only version 8 exists on production. Dev and stage do not have this form family
at all — versions 1–4 were normal forms, and INTERNAL mode was switched on at v5.

## Metadata fields (all UNIVERSAL, all required)

| Order | Field | Type |
| --- | --- | --- |
| 0 | Reviewer Name | AUTO |
| 1 | Review Date | AUTO |
| 2 | CSR | DROPDOWN |
| 3 | Interaction Date | DATE |
| 4 | Customer ID | TEXT |
| 5 | Customer Name | TEXT |

## Category weights

The weighted categories sum to exactly 1.00. `Interaction Type` and
`QA Summary` carry 0.00 weight — they exist for routing and for coaching
hand-off, and contribute nothing to the score.

| Order | Category | Weight |
| --- | --- | --- |
| 0 | Interaction Type | 0.00 |
| 1 | Calling Standards & Approach | 0.06 |
| 2 | Contact Attempt – No-Contact | 0.12 |
| 3 | Script & Call Flow Adherence – Contact-Made | 0.07 |
| 4 | Discovery & Needs Assessment – Contact-Made | 0.12 |
| 5 | Account Research & Lead Generation | 0.10 |
| 6 | Expansion Opportunity Identification & Routing | 0.08 |
| 7 | Product & Service Knowledge – Contact-Made | 0.08 |
| 8 | Objection Handling – Contact-Made | 0.06 |
| 9 | Warranty & Upsell – Contact-Made | 0.06 |
| 10 | Sales Process & Proposal – Contact-Made | 0.06 |
| 11 | Follow-Up Cadence | 0.06 |
| 12 | Lead Management & Entry | 0.07 |
| 13 | CRM Documentation & Note Policy | 0.05 |
| 14 | Work-from-Home Compliance | 0.01 |
| 15 | QA Summary | 0.00 |

## How this form scores

Per `backend/src/utils/scoringUtil.ts`:

- Every scored question is a YES_NO worth `yes_value = 1` / `no_value = 0`.
- Question-level `weight` is `0.00` on all 71 questions and is not read by the
  scoring engine — all weighting happens at the category level.
- `TEXT` questions are non-scoring, so each category's Feedback box never
  affects points.
- **Gate questions carry `yes_value = 0`**, so they contribute no points either.
  They exist purely to open or close the questions beneath them.
- N/A answers are dropped from both earned and possible points, but only where
  `is_na_allowed` is set.
- Hidden questions (gate closed) are excluded from possible points entirely.
- Category raw score = earned ÷ possible. Total = Σ(earned × weight) ÷
  Σ(possible × weight), so a category with no visible scored questions drops out
  of the denominator rather than scoring zero.
- Any critical question answered **No** caps the total at 79 %.

### Critical questions (7)

| Id | Category | Question |
| --- | --- | --- |
| 10812 | Calling Standards & Approach | Did the AE avoid steering the customer toward email-only contact? |
| 10814 | Contact Attempt – No-Contact | Did the AE make a genuine attempt to reach the contact? |
| 10829 | Account Research & Lead Generation | Was account research completed before engaging (or correctly skipped under the Corporate Non-Franchise exception)? |
| 10853 | Warranty & Upsell – Contact-Made | Did the AE offer or discuss the warranty when applicable? |
| 10855 | Warranty & Upsell – Contact-Made | Did the AE pursue relevant upsells (zones, messaging, equipment, installs, locations, players)? |
| 10867 | Lead Management & Entry | Did the AE create a lead when warranted (even if lost on the same interaction)? |
| 10872 | CRM Documentation & Note Policy | Did the AE document the interaction in the CRM? |

## Branching overview

The first question splits the whole audit:

- **Interaction Type = Contact Made** (`option_value = 1`) opens Script & Call
  Flow, Discovery, Product & Service Knowledge, Objection Handling, Warranty &
  Upsell, and Sales Process & Proposal.
- **Interaction Type = No Contact / Voicemail** (`option_value = 2`) opens
  Contact Attempt.

These categories are never gated on Interaction Type and always render: Calling
Standards & Approach, Account Research & Lead Generation, Expansion Opportunity
Identification & Routing, Follow-Up Cadence, Lead Management & Entry, CRM
Documentation & Note Policy, Work-from-Home Compliance, QA Summary.

Several of the always-on categories lead with their own applicability gate
(Account Research 10828, Expansion 10833, Follow-Up 10861, Lead Management
10866), so they collapse to a single question when not applicable.

## Questions

Legend: **Crit** = critical question, **N/A** = N/A answer permitted,
**Shown when** = the gate condition that must be satisfied for the question to
render and score. All questions are visible to the CSR except the two QA Summary
questions.

### 0. Interaction Type (weight 0.00)

| Id | Question | Type | Crit | N/A | Shown when |
| --- | --- | --- | --- | --- | --- |
| 10809 | Interaction Type | RADIO | – | – | Always |

Options (both score 0, so this question is routing only):

| Order | Option | Stored value |
| --- | --- | --- |
| 0 | Contact Made | `1` |
| 1 | No Contact / Voicemail | `2` |

### 1. Calling Standards & Approach (weight 0.06)

| Id | Question | Type | Crit | N/A | Shown when |
| --- | --- | --- | --- | --- | --- |
| 10810 | Was the call placed within the customer's local calling hours (9 a.m.–5 p.m. local)? | YES_NO | – | Yes | Always |
| 10811 | Did the AE call before emailing (call-first)? | YES_NO | – | Yes | Always |
| 10812 | Did the AE avoid steering the customer toward email-only contact? | YES_NO | **Yes** | Yes | Always |
| 10813 | Calling Standards & Approach Feedback | TEXT | – | – | Always |

### 2. Contact Attempt – No-Contact (weight 0.12)

| Id | Question | Type | Crit | N/A | Shown when |
| --- | --- | --- | --- | --- | --- |
| 10814 | Did the AE make a genuine attempt to reach the contact? | YES_NO | **Yes** | No | Interaction Type = No Contact / Voicemail |
| 10815 | Did the AE leave a voicemail when the option was available? | YES_NO | – | Yes | Interaction Type = No Contact / Voicemail |
| 10816 | Did the voicemail follow the approved script? | YES_NO | – | Yes | Interaction Type = No Contact / Voicemail |
| 10817 | Contact Attempted Feedback | TEXT | – | – | Interaction Type = No Contact / Voicemail |

### 3. Script & Call Flow Adherence – Contact-Made (weight 0.07)

| Id | Question | Type | Crit | N/A | Shown when |
| --- | --- | --- | --- | --- | --- |
| 10818 | Did the AE follow the correct call flow for this interaction? | YES_NO | – | Yes | Interaction Type = Contact Made |
| 10819 | Did the AE maintain control and direction of the call? | YES_NO | – | Yes | Interaction Type = Contact Made |
| 10820 | Script & Call Flow Adherence Feedback | TEXT | – | – | Interaction Type = Contact Made |

### 4. Discovery & Needs Assessment – Contact-Made (weight 0.12)

| Id | Question | Type | Crit | N/A | Shown when |
| --- | --- | --- | --- | --- | --- |
| 10821 | Was discovery required for this interaction? *(gate)* | YES_NO | – | No | Interaction Type = Contact Made |
| 10822 | Did the AE ask the required opening question (number of locations and current music source)? | YES_NO | – | Yes | 10821 = Yes |
| 10823 | Did the AE identify why the customer wants a new music solution? | YES_NO | – | Yes | 10821 = Yes |
| 10824 | Did the AE clarify whether the contact is a franchisee or corporate? | YES_NO | – | Yes | 10821 = Yes |
| 10825 | Did the AE present the sound-system upsell talk track? | YES_NO | – | Yes | 10821 = Yes |
| 10826 | Did the AE ask for the customer's feedback after addressing their needs? | YES_NO | – | Yes | 10821 = Yes |
| 10827 | Discovery & Needs Assessment Feedback | TEXT | – | – | 10821 = Yes |

### 5. Account Research & Lead Generation (weight 0.10)

| Id | Question | Type | Crit | N/A | Shown when |
| --- | --- | --- | --- | --- | --- |
| 10828 | Was account research required for this interaction (e.g., first engagement)? *(gate)* | YES_NO | – | No | Always |
| 10829 | Was account research completed before engaging (or correctly skipped under the Corporate Non-Franchise exception)? | YES_NO | **Yes** | No | 10828 = Yes |
| 10830 | Did the AE log the complete ChatGPT research prompt findings and enter them in the task notes? | YES_NO | – | Yes | 10828 = Yes |
| 10831 | For franchise accounts, was research focused on the franchisee (current and other brands)? | YES_NO | – | Yes | 10829 = Yes |
| 10832 | Account Research & Lead Generation Feedback | TEXT | – | – | 10828 = Yes |

### 6. Expansion Opportunity Identification & Routing (weight 0.08)

| Id | Question | Type | Crit | N/A | Shown when |
| --- | --- | --- | --- | --- | --- |
| 10833 | Was an expansion review applicable (multi-location or franchise brand)? *(gate)* | YES_NO | – | No | Always |
| 10834 | Did the AE identify the brand's total locations vs. those already in CRM (net-new)? | YES_NO | – | Yes | **10833 = *(blank)* — see anomaly 1** |
| 10835 | Were the identified net-new locations documented? | YES_NO | – | Yes | 10833 = Yes |
| 10836 | Did the AE identify and document the expansion contact? | YES_NO | – | Yes | 10833 = Yes |
| 10837 | Was the net-new opportunity routed correctly by size (20+ to management review; under 20 pursued by the AE)? | YES_NO | – | Yes | 10833 = Yes |
| 10838 | Was a lead created with the correct status for the new opportunity? | YES_NO | – | Yes | 10833 = Yes |
| 10839 | Were all identified net-new sites included in the original sale? | YES_NO | – | Yes | 10833 = Yes |
| 10840 | Was a new lead created for any unsold net-new sites? | YES_NO | – | Yes | 10833 = Yes |
| 10841 | Expansion Opportunity Identification & Routing Feedback | TEXT | – | – | 10833 = Yes |

### 7. Product & Service Knowledge – Contact-Made (weight 0.08)

| Id | Question | Type | Crit | N/A | Shown when |
| --- | --- | --- | --- | --- | --- |
| 10842 | Were products or services required for this interaction? *(gate)* | YES_NO | – | No | Interaction Type = Contact Made |
| 10843 | Did the AE describe product and service features and compatibility accurately? | YES_NO | – | Yes | 10842 = Yes |
| 10844 | Did the AE explain licensing requirements accurately? | YES_NO | – | Yes | 10842 = Yes |
| 10845 | Did the AE recommend the appropriate equipment and service? | YES_NO | – | Yes | 10842 = Yes |
| 10846 | Did the AE use research or supervisor support when needed? | YES_NO | – | Yes | 10842 = Yes |
| 10847 | Product & Service Knowledge Feedback | TEXT | – | – | 10842 = Yes |

### 8. Objection Handling – Contact-Made (weight 0.06)

| Id | Question | Type | Crit | N/A | Shown when |
| --- | --- | --- | --- | --- | --- |
| 10848 | Were any objections or hesitations raised? *(gate)* | YES_NO | – | No | Interaction Type = Contact Made |
| 10849 | Did the AE acknowledge and address ALL the customer's objections? | YES_NO | – | Yes | 10848 = Yes |
| 10850 | Did the AE attempt to overcome ALL objections rather than concede or defer? | YES_NO | – | Yes | 10848 = Yes |
| 10851 | Objection Handling Feedback | TEXT | – | – | 10848 = Yes |

### 9. Warranty & Upsell – Contact-Made (weight 0.06)

| Id | Question | Type | Crit | N/A | Shown when |
| --- | --- | --- | --- | --- | --- |
| 10852 | Was warranty or upsell applicable on this interaction? *(gate)* | YES_NO | – | No | Interaction Type = Contact Made |
| 10853 | Did the AE offer or discuss the warranty when applicable? | YES_NO | **Yes** | Yes | 10852 = Yes |
| 10854 | Did the AE present the warranty using the three-problems / three-solutions framework? | YES_NO | – | Yes | 10852 = Yes |
| 10855 | Did the AE pursue relevant upsells (zones, messaging, equipment, installs, locations, players)? | YES_NO | **Yes** | Yes | 10852 = Yes |
| 10856 | Warranty & Upsell Feedback | TEXT | – | – | 10852 = Yes |

### 10. Sales Process & Proposal – Contact-Made (weight 0.06)

| Id | Question | Type | Crit | N/A | Shown when |
| --- | --- | --- | --- | --- | --- |
| 10857 | Was a quote or proposal in scope for this interaction? *(gate)* | YES_NO | – | No | Interaction Type = Contact Made |
| 10858 | Did the AE generate and send a quote/proposal when required? | YES_NO | – | Yes | **10857 = *(blank)* — see anomaly 1** |
| 10859 | For non-audio quotes, did the AE attempt to send the proposal and close on the call? | YES_NO | – | Yes | 10857 = Yes |
| 10860 | Sales Process & Proposal Feedback | TEXT | – | – | 10857 = Yes |

### 11. Follow-Up Cadence (weight 0.06)

| Id | Question | Type | Crit | N/A | Shown when |
| --- | --- | --- | --- | --- | --- |
| 10861 | Was follow-up cadence applicable (an existing lead / opportunity in progress)? *(gate)* | YES_NO | – | No | Always |
| 10862 | Did the AE follow the required follow-up cadence? | YES_NO | – | Yes | 10861 = Yes |
| 10863 | Did follow-up emails reference the call attempt (call-first)? | YES_NO | – | Yes | 10861 = Yes |
| 10864 | Did the AE set a clear expectation for the next contact with the customer? | YES_NO | – | Yes | 10861 = Yes |
| 10865 | Follow-Up Cadence Feedback | TEXT | – | – | 10861 = Yes |

### 12. Lead Management & Entry (weight 0.07)

| Id | Question | Type | Crit | N/A | Shown when |
| --- | --- | --- | --- | --- | --- |
| 10866 | Was lead entry or management applicable to this interaction? *(gate)* | YES_NO | – | No | Always |
| 10867 | Did the AE create a lead when warranted (even if lost on the same interaction)? | YES_NO | **Yes** | Yes | 10866 = Yes |
| 10868 | Was the site-count tier handled correctly (1–9 standard, 10–49 tiered, 50+ referred to management)? | YES_NO | – | Yes | 10866 = Yes |
| 10869 | Was the lead status set accurately per the Knowledge Base? | YES_NO | – | Yes | 10866 = Yes |
| 10870 | Was the lead contacted within one business day, or escalated to the Sales Manager? | YES_NO | – | Yes | 10866 = Yes |
| 10871 | Lead Management & Entry Feedback | TEXT | – | – | 10866 = Yes |

### 13. CRM Documentation & Note Policy (weight 0.05)

| Id | Question | Type | Crit | N/A | Shown when |
| --- | --- | --- | --- | --- | --- |
| 10872 | Did the AE document the interaction in the CRM? | YES_NO | **Yes** | Yes | Always |
| 10873 | Was it documented in the correct area (ticket vs. task)? | YES_NO | – | Yes | Always |
| 10874 | Do the notes meet the Knowledge Base requirements (attempt, outcome, next steps, NDC)? | YES_NO | – | Yes | Always |
| 10875 | CRM Documentation & Note Policy Feedback | TEXT | – | – | Always |

### 14. Work-from-Home Compliance (weight 0.01)

| Id | Question | Type | Crit | N/A | Shown when |
| --- | --- | --- | --- | --- | --- |
| 10876 | Was the Work-from-Home policy followed? | YES_NO | – | Yes | Always |
| 10877 | Work-from-Home Compliance Feedback | TEXT | – | – | Always |

### 15. QA Summary (weight 0.00) — not visible to CSR

| Id | Question | Type | Crit | N/A | Shown when |
| --- | --- | --- | --- | --- | --- |
| 10878 | Refer salesperson for coaching? | YES_NO | – | No | Always |
| 10879 | Coaching notes/feedback for manager. | TEXT | – | – | Always |

## Known data anomalies in v8

These are defects in the stored definition, not in the platform. Fixing them
means editing the form in the Form Builder and saving a v9.

1. **Two questions can never render.** The conditions on question 10834 ("Did
   the AE identify the brand's total locations vs. those already in CRM
   (net-new)?", condition 4685) and question 10858 ("Did the AE generate and send
   a quote/proposal when required?", condition 4709) have an empty
   `target_value` instead of `YES`. `buildVisibilityMap` compares the gate's
   answer against the empty string with `EQUALS`, which can never be true, so
   both questions are permanently hidden and are excluded from possible points.
   Every sibling question in those two categories uses `target_value = 'YES'`,
   so this is almost certainly unintentional.

2. **Orphaned radio options on a YES_NO question.** Question 10829 is stored as
   `question_type = YES_NO` but still carries three `radio_options` rows (Yes =
   `1`, Correctly Skipped = `2`, No = `3`, all scoring 0) left over from when it
   was a RADIO. The renderer and the scoring engine both switch on
   `question_type`, so the options are dead rows and the "Correctly Skipped"
   answer is not reachable — the exception is only expressible by answering Yes.
   Note that question 10831 gates on `10829 = Yes`, which is consistent with the
   YES_NO behaviour.
