# Missed Opportunities — salesperson-accountability policy diff

Prepared September 18, 2026, alongside the CRM-linkage and attribution repair.
**Nothing here has been applied.** These are the exact before/after bodies for the
operator to review and enter through the admin rule/persona editor, which is where
this content lives (`ie_missed_opportunity_rule`, `ie_config`). No SQL was run
against any environment for this document, and no rule was activated, deactivated,
or created.

## Why the content has to change too

The code changes stop the pipeline from *mistaking* one person's evidence for
another's: a transcript turn is only the reviewed salesperson's when they were the
only employee on the conversation, a CRM note is only theirs when the note names
them as its author, and support tickets render in their own block so they cannot
pass as lead/CM documentation. Code can enforce *who* an item belongs to.

What it cannot decide is **whether a documented prior step excuses this call** —
that is business policy, and the current wording answers it too generously. Two
sentences in particular told the model that any prior progress anywhere clears the
step, which is what let Customer Service explaining warranty periods stand in for
Jason's sales attempt. They are the substance of this diff.

## 1. Persona — `ie_config.missed_opps_system_persona`

One paragraph changes. Everything else in the 3,655-character persona stays
byte-identical, including the materiality bar, the priority ordering, and the
no-free-product guardrail.

### Before (paragraph beginning "Judge like an expert closer")

> Judge like an expert closer, not a checklist. Do NOT flag a "miss" when the close
> is legitimately gated by a prerequisite the rep must resolve first (e.g., a radio
> already on an active PERSONAL SiriusXM subscription must be cancelled before a
> business activation; a radio ID, equipment, or site survey is still needed), NOR
> when the transcript or CRM history shows the rep already advanced that same
> opportunity (a quote/proposal sent, a dated next step set, a callback promised to
> complete the order). Gathering the information needed to sell, or promising a
> same-day proposal, is progress — not a missed order.

### After

> Judge like an expert closer, not a checklist. Do NOT flag a "miss" when the close
> is legitimately gated by a prerequisite the rep must resolve first (e.g., a radio
> already on an active PERSONAL SiriusXM subscription must be cancelled before a
> business activation; a radio ID, equipment, or site survey is still needed), NOR
> when THE REVIEWED SALESPERSON already advanced that same opportunity — their own
> quote or proposal sent, their own dated next step, their own promised callback —
> shown either in their attributable speech on this call or in a note on their
> validated lead or Contact Manager record for THIS transaction. Gathering the
> information needed to sell, or promising a same-day proposal, is progress — not a
> missed order.
>
> WHOSE WORK COUNTS. You are reviewing one named salesperson. Another employee
> doing the thing is not this salesperson doing it: Customer Service explaining
> warranty terms, resolving a return, or terminating an account, a support
> engineer's ticket note, and a colleague's sale on the same account are all
> context for that person's actions and never this salesperson's attempt. A support,
> billing, or return ticket — including one an AE wrote on — is operational truth,
> not the lead/CM documentation an exception requires. Unless the topic is
> documented sufficiently on this salesperson's own lead or CM task for this
> transaction, the salesperson still had to address it on this call. If the customer
> raises the question again, they must answer it again, however complete the history.

### What this changes in practice

| Case | Before | After |
| --- | --- | --- |
| Jason / Patrick's #112 | CS's five-year explanation read as "the opportunity was advanced" and the warranty omission was cleared. | CS's explanation is context. The omission stands, because lead 1120497 and CM 135455 document no warranty decision for this order. |
| Franklin #110–111 | The CS ticket's Comcast work read as the next step. | Only Jamie's own lead action 8562229 can satisfy it — which it does. |
| Citizens #118–119 | Prior CS termination read as retention performed. | Recovery context. Rule applicability and the lead/CM gate are reapplied. |
| Evergreen #129, #137 | Another rep's same-day replacement sale read as the reviewed person's offer. | Each actor keeps their own work. |
| Fair Oaks #109, Tim Hortons #139, Tailored #116–117 | Valid lead-based follow-through accepted. | Unchanged — these are exactly the "their own dated next step" case the new wording protects. |

## 2. `warranty_not_offered` (production, active, `is_omission = 1`)

### `body_md` before

> An order was placed, priced, or quoted for hardware (player, radio, amplifier,
> speakers) and the rep never offered the multi-year extended warranty. Asking
> "1-year or extended?" IS the offer. Do NOT flag when the rep offered it and the
> customer or their dealer declined. Do NOT flag when hardware was not actually in
> play.

### `body_md` after

> An order was placed, priced, or quoted for hardware (player, radio, amplifier,
> speakers) and THE REVIEWED SALESPERSON never offered the multi-year extended
> warranty. Asking "1-year or extended?" IS the offer. Do NOT flag when that
> salesperson offered it on this call and the customer or their dealer declined, or
> when a note on their validated lead or Contact Manager record shows the warranty
> was offered and answered FOR THIS ORDER. Do NOT flag when hardware was not
> actually in play.
>
> These do NOT clear it: anyone explaining what coverage exists, including Customer
> Service on a transferred segment or a support ticket note; the standard one-year
> term being described; the customer asking whether there is a warranty; a warranty
> decision recorded against a different order, a different site, or an older unit.
> A mention is not an offer — the requirement is an offer with a disposition.

### `guidance_md` before

> Coach the rep to attach the warranty to every hardware order and to explain
> advance replacement on decline rather than dropping it.

### `guidance_md` after

> Coach the rep to attach the warranty to every hardware order and to explain
> advance replacement on decline rather than dropping it. The coaching line is the
> actual offer they did not make — the term question ("one year or the five-year
> coverage?") — and it stands even when someone else has already resolved the order.
> Any recovery must respect real order timing and approved policy: do not assert
> shipping status, eligibility windows, pricing, or benefits that are not in the
> material.

## 3. `no_dated_next_step` (production, active, `is_omission = 1`)

Only the CRM-exception sentence changes; the customer-named-timeframe exception
(Tim Hortons #139, Tailored #116–117) is untouched.

### `body_md` before (sentence three)

> Do NOT flag when the lead-task or Contact Manager note already has a next-step
> date or cadence ("next is day 3", "check in next week", a due date).

### `body_md` after

> Do NOT flag when a note or due date on the salesperson's VALIDATED lead task or
> Contact Manager record for this opportunity already has a next-step date or
> cadence ("next is day 3", "check in next week", a due date) — a scheduled action
> with a due date and no note text still counts. A date on a support ticket, on an
> unrelated recurring Contact Manager cadence, or on another account's record does
> not.

## 4. `churn_not_routed_to_cs` (production, active, `is_omission = 1`)

### `body_md` before (sentence two)

> Correctly transferring a cancellation to Customer Service is the required process
> and is NOT a miss — only flag when the rep handled it themselves, was dismissive,
> or let the customer go without routing.

### `body_md` after

> Correctly transferring a cancellation to Customer Service is the required process
> and is NOT a miss — only flag when the reviewed salesperson handled it themselves,
> was dismissive, or let the customer go without routing. Customer Service having
> already terminated, credited, or saved the account is recovery history, not proof
> this salesperson routed it; judge the routing they did on this call.

## 5. `group_expansion_not_captured` and `audio_system_not_offered` and `service_call_no_sales_probe`

All three grant an exception on "the notes" or "the rep offered it". Each takes the
same two-word class of edit, so they are grouped here.

| Rule | Phrase before | Phrase after |
| --- | --- | --- |
| `group_expansion_not_captured` | "the lead-task / Contact Manager notes do not already show those sites scoped" (and the closing "If the notes already capture the footprint") | "the notes on the salesperson's validated lead task / Contact Manager record for this opportunity do not already show those sites scoped" |
| `audio_system_not_offered` | "Do NOT flag when the rep offered audio and the customer declined" | "Do NOT flag when the reviewed salesperson offered audio and the customer declined" |
| `service_call_no_sales_probe` | "that the rep never probed" | "that the reviewed salesperson never probed" |

Lakeland #113–114 depends on the first of these: the documented three-MRI-zone
scope and vendor registration live on lead 1119068, and reading them required
fixing the linkage (the run had attached the call to an unrelated La Mesa task).
The wording change is what keeps that scope a valid exception once the right record
is in hand.

## 6. Local-only rules — deliberately NOT part of this change

The September 17 production snapshot had **11 active rules**: the nine above plus
`buying_signal_not_closed`, `competitor_or_price_objection_unanswered`,
`deal_lost_over_small_blocker`, `professionalism_or_compliance`, and
`weak_or_missing_voicemail`. The fourteen `sales_qa_v8_*` rows exist **locally
only**.

Every one of those fourteen carries this sentence in `guidance_md`:

> Check prior completion, customer preference, legitimate prerequisites and same-day
> follow-through before alleging a miss.

That is the broad "any prior completion counts" instruction the repair narrows, and
it would need the same treatment — "prior completion documented on the
salesperson's own validated lead or CM record for this transaction" — **if and when
those rules are ever activated in production.** They are not in scope here:

- Deploying this branch does not create or activate them.
- They must not be copied to production as a side effect of this work.
- An operator edit already made to any of these rows must not be overwritten.

If the owner wants the v8 set reviewed for accountability wording, that is a
separate, explicitly authorized pass.

## 7. What code owns, and therefore is NOT in this diff

These are enforced in `backend/src/services/insights/missedOpportunities/` and must
not be restated as rule text — a rule that repeats them drifts:

- Which employee a transcript turn belongs to (`evidence.quoteResolvesAsInternalSpeaker`
  plus the conversation's internal-party count).
- Who authored a quoted CRM note (`evidence.quoteAuthors`, `isSamePerson`).
- That sales records and support tickets render as separate prompt blocks
  (`crmThread.renderSalesThread` / `renderTicketContext`).
- Which record the call resolved to, how well it is established, and what was
  rejected (`crmLink`, `crmSelect`, `crmDuplicate`).
- That only a `verified` resolution may overwrite the model's CRM citation
  (`MissedOpportunitiesWorker`).
- That a finding's quote must appear in the material it claims (`parse.parseFindings`).

## 8. Applying this

1. Owner reviews the before/after text above.
2. Edits are entered through the admin rule editor and the persona field in
   Insights settings — the same path an operator uses day to day. No migration, no
   seed, no deploy is required for content.
3. The code changes ship on their own schedule; they are safe ahead of the content
   edit (they remove wrong attribution, they do not depend on the new wording) and
   the content edit is safe ahead of the code (it is stricter, not looser).
4. Re-run a single day on stage and compare the affected cases before any
   production re-run. The September 17 production findings are not replaced by this
   work.
