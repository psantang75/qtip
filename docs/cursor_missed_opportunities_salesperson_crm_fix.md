# Cursor implementation brief: salesperson accountability and correct CRM evidence

Prepared September 18, 2026, from the September 17 production assessment and the owner's subsequent clarification.

## 1. Objective and scope

Fix Missed Opportunities so it assesses **the named salesperson's performance on the reviewed interaction**, using the **correct Lead Manager and Contact Manager records**. Correct customer/task resolution before expanding the amount of evidence supplied to the model.

The owner's clarification governs this work: unless the relevant topic is documented sufficiently in the salesperson's lead or CM task, the salesperson still needs to address it. A Customer Service discussion does not substitute for the salesperson attempting the applicable sale. Jason's replacement-player warranty call is the concrete example.

This brief supersedes the earlier assessment's broad cross-employee credit interpretation. **Do not use the earlier “withdraw 24 / retain 4 / qualify 4” totals as expected outputs.** Reassess affected cases with this policy after fixing linkage. The verified wrong-record examples remain valid.

When this brief is assigned for implementation, implement the local code/tests and prepare the necessary editable-rule/persona changes. Deliver a reviewable diff. This document is not authorization to deploy, change production CRM/QTIP data, apply database updates, rerun/replace production findings, or contact customers. Do not implement unrelated dashboard/QA expansions.

Read `AGENTS.md`, `backend/src/AGENTS.md`, and the applicable backend/date/runtime-configuration rules. Business policy belongs in existing database rules/persona settings; this Markdown file is an implementation brief, **never a runtime policy source**. Follow the existing schema/database approval process if a database change is needed; complete all independent code and review preparation first.

## 2. Salesperson-specific evidence policy

The review unit is `(conversation_id, reviewed_salesperson_id)`, with the person's actual participation/segments. “Agent” in a raw transcript can refer to another employee or IVR; it is not sufficient attribution.

| Evidence | How the reviewer may use it |
|---|---|
| Reviewed salesperson's attributable words on this call | Establish that person's offer, question, response, close, or routing attempt. |
| Relevant notes on the salesperson's verified Lead Manager/CM task | Establish documented scope, prior completion/decline, customer prerequisites, and follow-through, with source/time/author. A documented exception must actually address the requirement. |
| Another person's words, including CS on a transferred segment | Context only for that person's actions. Do not credit the reviewed salesperson with making their offer. |
| Support/billing/return tickets, including notes written by an AE on a ticket | Operational context and recovery planning. They are not substitutes for the required lead/CM documentation exception. |
| A different account's records or unrelated opportunity on the same account | Exclude from the grading packet. A shared phone, brand, owner, or date is insufficient. |
| Unavailable, ambiguous, or truncated evidence | Unknown; do not represent it as an empty history, confirmed compliance, or proven omission. |

Apply these rules:

1. **The salesperson owns the sales attempt.** An applicable hardware sale requires the salesperson's extended-warranty attempt unless valid lead/CM documentation establishes that the step was already satisfied or declined for this transaction. CS explaining standard/extended warranty does not satisfy that sales obligation.
2. **A mention is not automatically an offer.** “Warranty discussed,” product descriptions, standard one-year coverage, a customer's warranty question, or an unresolved CS handoff do not demonstrate a sales offer and disposition. Check the actual rule requirements and documented content.
3. **The exception is topic- and transaction-specific.** An actual prior warranty offer/decline for the same order documented in the relevant lead/CM can count. An old unit's warranty, a different site's purchase, or generic account research cannot. If the customer reopens the question, the salesperson must address the new question even when history exists.
4. **Do not require repeated discovery already established in the lead/CM.** Verified site counts, decision makers, explicit phased rollout, an appropriate prior decline, and documented follow-up can remain valid exceptions under the applicable rule. This clarification does not eliminate the rubric's other exceptions.
5. **Retain authorship.** A substantive note legitimately recorded in the salesperson's relevant lead/CM may establish documented history even when entered by another employee; it does not prove the reviewed salesperson personally said those words. Assignment alone does not make every historical note relevant.
6. **Prior calls cannot silently bypass the documentation gate.** A prior salesperson call may corroborate a documented exception. Do not suppress a current-call obligation solely from a separate prior transcript when the required lead/CM record does not document the exception. Distinguish a separate callback from multiple segments of the same interaction.
7. **Separate time and claim.** Prior notes establish known history. The salesperson's same-day post-call notes can establish follow-through, but a later note cannot change what the transcript shows was said on the call. Conflicting claims require explicit review, not automatic suppression.
8. **Separate coaching from current recovery.** A CS action may mean there is nothing left to recover, while the salesperson's on-call omission remains valid. Conversely, an unresolved account is not by itself proof the salesperson failed.

### Required Jason warranty result

September 17, finding **112**, conversation `24a2a340-c796-492a-9e59-204a164870b3`, Jason Spangler / Patrick's:

- Sales record: **Lead task 1120497**; account context: **CM 135455**; support context: **Ticket 289807**.
- Jason offers/orders replacement hardware but does not attempt to sell extended warranty in his sales call.
- The earlier CS call explains an additional five-year option. That explanation is **not** Jason's sales attempt.
- The retrieved lead and CM notes do not document a warranty offer/decision for this sale; recent entries are chiefly workflow/status changes.
- With this evidence, **retain the salesperson warranty omission**. Do not discard or downgrade it solely because CS explained warranty periods. Do not invent a warranty question on Jason's segment: the question appears in the earlier support conversation.
- Suggested coaching is an actual applicable warranty offer/selection question. Any post-sale recovery remains subject to real order timing and approved policy; do not invent shipping status, eligibility, pricing, or benefits.

## 3. Confirmed lookup defects to correct

The assessment inspected production checkout `2e63fc3be7d006ac1685ec7bcff5b42f7caa5b34`. Recheck the implementation at the working branch before editing.

| Defect | Observed implementation / consequence |
|---|---|
| Open leads are detected incorrectly | `crmLink.ts` uses `CustomerLeadID != null && CompletedOn == null`. CRM `CompletedOn` is non-nullable and open tasks use `0001-01-01…`; `CustomerLeadID = 0` is also not a real lead. |
| Phone candidates include unrelated/internal numbers | `getFarEndNumbers` combines ANI, DNIS, and Remote across all sessions without identifying the customer participant. Phone identity is not independently corroborated. |
| Account tasks are missed | Task candidates use matched ContactID/CustomerLeadID, without expanding by verified CustomerID. Real tasks can have null ContactID and a CM commonly has CustomerLeadID 0. |
| CM/lead association is too narrow and unsafe at zero | `loadSalesThreads` joins equal lead IDs. It misses the account CM and can treat zero as a shared lead relationship. |
| A duplicate is treated as a final record | There is no explicit validated successor traversal, including references to another CustomerID. |
| Weak evidence becomes a strong saved link | A single candidate is labeled strong; the worker can overwrite the model's CRM reference with that result. Candidate count does not prove identity. |
| Latest activity can distort historical matching | Candidate ranking uses latest activity/current state without bounding it to the reviewed day, although note loading is date-bounded. |
| Correct notes are dropped | The loader limits rows before removing boilerplate, then drops the entire note if its opening matches an automatic-status prefix. Substantive text following that prefix disappears. |
| Necessary metadata is absent | Record-history loading omits action ID, author, due date, task owner/status, and the relationship making the note relevant. |
| Generic verification can credit the wrong person | The verifier reads a generic current transcript without structured actor/source eligibility or the lead/CM exception evidence. |

Confirmed wrong links: **Lakeland and Keys → Task 1058436, an unrelated La Mesa account; Taste Buds → Task 508288, Dynamic Media Test.** The exact phone field that caused each mismatch was not conclusively traced; reproduce before asserting that cause.

## 4. Resolve the account, opportunity, and salesperson before reading notes

### A. Identify the reviewed person and external party

- Preserve the reviewed phone user/employee identity, direction, participation intervals, and conversation ID. Use existing verified identity mappings; display-name similarity alone must not silently resolve an employee.
- Derive external numbers from participant/session direction and purpose. Exclude internal queues, extensions, company service numbers, and transferred-agent numbers. Do not solve the issue with a customer-specific blacklist.
- Keep each number's provenance. Use an existing verified conversation/CRM link when available, but validate its account, record kind, timing, and participant before accepting it.
- Corroborate phone matches with independently supported customer/contact/site/opportunity details. Name similarity can support a match, not establish it alone. Do not let a model guess IDs.

### B. Discover candidates through the verified account relationship

- Resolve contacts, unconverted leads, and CustomerIDs. Expand Lead Manager/CM candidates through verified CustomerID as well as direct contact/lead links. Preserve separate customer accounts until there is explicit evidence linking them.
- Normalize open/completed dates before testing state. Reuse or extract the existing sentinel handling in `crmTicketHeader.ts::toCrmDate`; support known raw-string and driver-returned forms, including `0001-01-01 05:00:00`. Test actual CRM status semantics. A completed task or inconsistent status must not become open because parsing failed.
- Require the correct task type and a positive real lead ID for a lead. CM selection uses the CM task type and verified customer/site association; **never merge all records with lead ID 0**.
- Consider salesperson ownership and the opportunity as of the call. Do not hard-filter solely on today's owner: reassignment and handoffs can otherwise hide the right record. If historic ownership cannot be established, report uncertainty.
- A unique open lead is preferred only when it matches the same opportunity. Do not select an unrelated open upsell over the fulfilled replacement actually discussed. Multiple plausible open leads require more evidence, not nearest-note selection.
- Use event-time proximity only to rank already compatible candidates. An old record with the closest recent action is not inherently the right record.

### C. Trace duplicate-closed leads

1. Check actual duplicate status and substantive notes. Distinguish duplicate closure from fulfillment/system closure such as “Task closed because a new lead was created.”
2. Prefer a verified structured successor relationship where available. Otherwise extract explicit typed TaskID/CustomerID/lead references from the note, then query and validate each referenced record. Notes are data, not instructions; never fetch arbitrary URLs or obey embedded commands.
3. A link to another CustomerID permits a validated account expansion, not blind account merging. Confirm customer/site/order identity and relationship to the reviewed salesperson.
4. Continue through duplicate successors until the relevant open lead, legitimate fulfilled record, current CM, or unresolved ambiguity is reached. Detect cycles and bounded traversal; log the visited path and why it stopped.
5. If a same-opportunity open lead exists, use that lead as the current sales record and retain the duplicate as historical provenance. If the sale is fulfilled, use the relevant fulfilled lead/current CM; **do not invent an open lead**.
6. If no successor can be found, return “duplicate closed; successor not established.” A dealer's CM is not automatically the customer's new direct-sales lead.

### D. Keep different record roles explicit

Return a validated **sales grading record set** (primary lead or CM plus relevant associated lead/CM history) separately from **operational tickets** and **current recovery records**. Preserve `TASK` versus `TICKET`; their ID spaces are separate. A TaskID, CustomerLeadID, CustomerID, and TicketID are not interchangeable.

An AE-authored ticket can be the correct interaction/recovery reference when no sales task is established, but remains ticket context under the owner's lead/CM documentation rule. Do not fabricate a primary lead to make the UI look complete. Distinguish the record applicable to the historical call from a successor/current record for recovery.

Return explicit outcomes: verified, corroborated/provisional, ambiguous, unmatched, and lookup unavailable. A single returned candidate must not produce verified confidence by itself. The worker must not overwrite a finding with an unverified resolver reference. A CRM outage must not trigger authoritative use of a different customer's day-wide notes.

## 5. Review all relevant lead/CM notes without hiding coverage gaps

Retrieve the complete substantive history of the validated salesperson/opportunity lead/CM set through the reviewed business day's cutoff, using pagination or equivalent bounded retrieval with explicit coverage. All relevant notes must be considered for topic exceptions; do not assume “newest 25” equals “all notes.” Keep operational ticket retrieval separate.

- For each action/note retain typed record ID, action/note ID, customer/site/opportunity relationship, task type, owner, author/completer, CreatedOn, valid CompletedOn, DueOn, status/result, and substantive text.
- Normalize sentinel dates before calculating event time; `COALESCE(CompletedOn, CreatedOn)` does not handle a non-null sentinel. Do not use a scheduled action's CreatedOn to claim its later completed work occurred earlier. Preserve scheduled versus completed state.
- Read due dates even when note text is empty. A real scheduled follow-up on the correct relevant record can satisfy the timeframe rule; an unrelated recurring CM due date cannot satisfy every sales call.
- Remove only known boilerplate fragments. Preserve the meaningful remainder of “Task Status Changed… [customer scope/offer/next step]” and “Created Lead… [customer request].” Preserve raw source references for verification; do not erase mixed-content rows.
- Consider older relevant topic decisions as well as current notes. Resolve contradictions chronologically and by transaction, not by whichever note is closest or shortest.
- Split `before_call`, `same_day_follow_through`, and `later_recovery`. Exclude later-day evidence from historical compliance judgments. Account for current task fields changing after the call; where no history exists, mark as-of status unknown.
- If the complete relevant history does not fit the model budget, inspect it in explicit chunks or use source-linked topic extraction that preserves requirements, declines, decisions, and contradictions. Keep raw decisive excerpts available to verification. Do not silently replace full coverage with an unconstrained summary.
- Record retrieved/considered/omitted counts, cutoff, truncation, lookup errors, and which note IDs support each proposed exception. If any relevant portion was not assessed, say so; hold history-dependent negative conclusions for review.
- Restrict same-day lead-creation evidence to verified related opportunities. A day-wide list, today's assignment, or one AE's creation activity is not proof that no prior/other-owner lead exists. Avoid feeding unrelated accounts to the model.
- Deduplicate mirrored ticket/task events without losing source and author. Redact credentials/payment data from model inputs and diagnostic exports using existing patterns.

## 6. Give analysis and verification the same attributable evidence

Use one structured internal evidence contract, adapted to existing types rather than a parallel review engine:

| Field group | Required meaning |
|---|---|
| Reviewed interaction | Conversation + reviewed employee/phone user + attributable segment/utterance IDs + call time. |
| Resolution | Customer/opportunity identities, primary sales task, related lead/CM records, support tickets, duplicate path, confidence, rejected candidates/reasons. |
| Source provenance | Record kind/type/ID, action/note ID, author, time, relation to the salesperson/opportunity, pre/post-call status. |
| Rule evidence | Applicable trigger; reviewed salesperson's attempt or omission; current-call customer decision; eligible lead/CM exception with citation; contextual evidence that cannot grant credit. |
| Coverage | Sources queried/read, unavailable/omitted material, whether attribution and necessary history are complete enough for the particular claim. |

Update the analyzer/prompt/omission verifier so each proposed failure answers:

1. Is the rule actually applicable to this salesperson's interaction and product/opportunity?
2. Did **this salesperson** attempt or complete it in their attributed speech? A different employee/IVR cannot supply the answer.
3. Does the **validated lead/CM** document a sufficiently specific prior exception for this requirement and transaction? Cite the exact note; explain why it qualifies. Merely finding the topic in a ticket is insufficient.
4. Did the customer decline, defer, or choose a permitted path on this call? Preserve the applicable rule's exceptions; do not invent mandatory pressure or appointments.
5. Is there sufficient coverage for an omission claim? If not, mark unresolved/unverified rather than quietly counting the call clean or publishing a definitive failure.
6. Does the proposed guidance address the actual salesperson miss without inventing authority, product capabilities, pricing, legal claims, or commitments? Can the coaching stand even when recovery is already complete?

Validate quote spans, source membership, actor, record relationship, and permitted evidence use in code. The generic existence of a quote or model `rep_attempted: true` is insufficient. A CS quote must not remove Jason's sales finding. Verification failure must be visible; preserve the diagnostic draft without presenting it as verified or silently converting it to zero findings.

Keep editable salesperson-accountability and exception policy in the existing `ie_missed_opportunity_rule` / `ie_config` admin-managed content. Prepare exact before/after changes to the persona and affected rule bodies/guidance, including warranty and the treatment of prior completion. Remove contradictory broad “any prior completion counts” instructions. Code owns source attribution, relationship validation, output contracts, and evidence completeness. No new hardcoded parallel rubric or runtime Markdown loader.

Inspect actual environment rules before preparing updates: the September 17 production snapshot had **11 active rules**; local documentation describes additional QA categories applied locally only. Do not assume deployment applies missing rules, copy all local categories to production, or overwrite operator edits. Applying database changes remains a separate authorized step; idempotent changes must be narrowly targeted and preserve unrelated values.

## 7. September 17 regression and calibration cases

Use sanitized fixtures for deterministic resolver/evidence tests. IDs below identify the audited examples, not runtime allowlists. Live CRM state can change; preserve the audit date in fixtures. Model outcomes must be calibrated against the corrected policy, not the earlier aggregate verdicts.

| Case / finding(s) | Required lookup and behavior |
|---|---|
| Patrick's / Jason #112 | Lead **1120497**, CM **135455**, support ticket **289807**. No lead/CM warranty disposition. CS-only warranty explanation must **not** clear the salesperson omission. Add paired fixture where the relevant lead/CM explicitly documents a qualifying prior offer/decline. |
| Lakeland #113–114 | Reject unrelated **1058436**. Resolve lead **1119068**, customer **148975**, due **September 18**. Preserve documented three-MRI-zone scope/vendor registration. Do not attribute Adrian's later handoff to Jason. |
| Keys #131–133 | Reject **1058436**. Resolve duplicate lead **1120480**, customer **149023**. Its note points to existing dealer Low Voltage Integrators, customer **79882**, CM **204703**. No Keys-specific open successor was identified; do not relabel dealer CM as a direct-sales lead. |
| Taste Buds #130 | Reject test-account task **508288**. Resolve account CM **816551**, AE ticket **290020**, support tickets **288598/286234** as distinct roles. The salesperson's own transcript contains a test/next-day plan; support context is not required to invent that compliance. |
| Fair Oaks #109 | Replace old completed **1074398** with relevant open **1120485**, CustomerLeadID **193194**, plus CM **363666**. Action **8561828** documents Jamie's callback/retry and tomorrow follow-up. Preserve this valid lead-based follow-through. |
| Tailored #116–117 | Enrollment **1120159** is historical; open client lead **1120251** owns continued work, due **September 21**. Distinguish dealer enrollment from end-client order; accepted timeframe/current lead notes remain valid. |
| Citizens #118–119 | Follow duplicate **1109240** / customer **62421** via note **8495653** to customer **148597**. Sale **1110112** fulfilled; CM **1111425**; return ticket **289955**, task **1120260**. No open sales lead found. Prior CS termination is factual recovery context, **not proof the salesperson performed retention**; reapply rule applicability and the lead/CM exception gate. |
| Holmes Tuttle #125–126 | Duplicate **856216** explicitly references fulfilled **856321**; current CM **856311**. No open successor expected in the fixture. The salesperson actually probes projects/offers audio and the customer reports existing coverage. |
| Toyota of Gladstone #128 | Distinguish interaction **1120470** / customer **149020** from web fulfillment **1120469** / customer **149019**. Validate that cross-account relationship; do not blindly merge both customers. |
| Batteries Plus #121–122 | Same lead **1120130**, CM **968160**. Mitchell offers warranty on the earlier call. Retrieved lead/CM notes record the hardware order, not a warranty decline. **Do not automatically suppress the separate callback finding from the earlier transcript alone**; apply the documented-exception gate and assess current-call applicability. Add a paired fixture with an explicit lead/CM decline. |
| Franklin #110–111 | Lead **1120533** / CM **345902**. Jamie's lead action **8562229** records Monday follow-up; CS ticket **289875** separately records the Comcast plan. Distinguish Jamie's actual commitment from CS's technical work; no credit transfer for a missing salesperson action. |
| Tim Hortons / Parth #139 | Open **1119200**; action **8557155** says next week, due **September 24**. Accept that relevant salesperson lead follow-up; do not require an exact appointment beyond the rubric. |
| Apple Lumber #138 | Old fulfilled **845381** is not the current courtesy-contact record; use CM **847008**. Old research does not create a customer-stated current expansion. |
| Evergreen / Vince and Steven #129, #137 | CM **108108**, same-day replacement **1120216**. Preserve individual actor identity and handoff; another rep's sale is not the reviewed person's offer. Do not invent additional uncovered sites from three existing accounts. |
| McTims #134–136 | Lead **1120224**. Preserve actual portfolio/price objection evidence, corporate prerequisite, and declined callback. Do not recommend a callback the customer refused or unsupported licensing economics. |

Also test: no matching account; CRM outage; ambiguous shared phone; a single wrong candidate; internal transfer numbers; multiple same-account leads; reassignment; null and sentinel dates; closed-status/date conflicts; CM lead ID zero; duplicate loops/missing targets; mixed boilerplate + substantive notes; more than 25 notes; oversized older decisive notes; due date with empty text; future activity; DST/day boundaries; unknown speaker; and a `TASK`/`TICKET` with the same numeric ID.

## 8. Implementation map and delivery order

| Area | Existing entry points to inspect/extend |
|---|---|
| CRM identity and linkage | `backend/src/services/insights/missedOpportunities/crmLink.ts`; existing `backend/src/services/CallTicketLinkerService.ts` / CRM adapters. |
| Thread retrieval and coverage | `crmLinkThread.ts`, `crmActivity.ts`, `crmCreated.ts`; reuse `backend/src/services/CRMService.ts` and `backend/src/services/crmTicketHeader.ts` where appropriate. |
| Actor/segment material | `candidates.ts`, `backend/src/services/transcriptRender.ts`, available phone session/participant data. |
| Evidence, prompt, verification | `types.ts`, `prompt.ts`, `analyzer.ts`, `verify.ts`, `evidence.ts`, `parse.ts`. |
| Persistence/link override/run health | `backend/src/workers/MissedOpportunitiesWorker.ts`, `workerSupport.ts`, existing report services. |
| Displayed references | Existing Missed Opportunities UI and `frontend/src/utils/crmLinks.ts`; preserve the shared URL helper. |
| Editable policy | `rules.service.ts`, `settings.ts`, existing admin rule/persona editor and database content. |

Paths without a prefix in this table are under `backend/src/services/insights/missedOpportunities/`. Search for existing helpers before adding any. Respect Prisma/data-access conventions; do not introduce a new `mysql2` pool. Keep modules within repository size constraints and remove obsolete lookup logic when replacing it.

1. Add focused failing regression fixtures for wrong identities, real open-date semantics, duplicate traversal, and Jason's CS-only warranty credit. Confirm each reproduces the actual defect rather than simply encoding the old implementation.
2. Correct account/opportunity resolution and typed reference selection, including the worker's strong-link override. Validate candidate rejection and uncertain outcomes before changing prompts.
3. Correct full relevant lead/CM note retrieval, actor/time metadata, due dates, and coverage. Keep ticket context separate and preserve substantive status-prefixed content.
4. Apply the structured evidence contract through analysis and verification. Prepare the precise editable policy diff and remove contradictory broad-credit behavior. Make draft/unverified status explicit using suitable existing storage/API structures where possible; propose any genuinely needed schema addition before applying it.
5. Show reviewers the selected lead/CM, relevant support references, resolution reason, duplicate path, and important coverage limitations through the existing report flow. An internal diagnostic can hold verbose candidate details; AE-facing findings should remain concise and factual.
6. Run targeted resolver/thread/attribution/verifier/worker tests, then repository lint and both builds; run the broader relevant suite for changed behavior. Tests must not require live production/customer data. A live model calibration is separate from deterministic unit tests and must not rewrite production findings.
7. Deliver changed files, test/build results, exact policy diff, unresolved evidence/schema needs, and a before/after table for these cases. Include run/call identities for any failure so “no findings” cannot hide a failed review.

## 9. Definition of done

- No fixture attaches Lakeland/Keys to La Mesa or Taste Buds to Dynamic Media Test; no ambiguous match is presented as verified.
- Relevant open leads are recognized with actual CRM sentinel semantics; CM association and duplicate successor handling work without shared-zero-ID or cross-account contamination.
- Every granted prior-completion exception cites relevant salesperson lead/CM evidence. CS/support-only discussion cannot clear Jason's warranty omission or another salesperson-required action.
- Other employees' speech never counts as the reviewed salesperson's attempt; real customer declines, documented scope, and valid lead/CM follow-up remain protected.
- All relevant lead/CM notes are assessed or the limitation is explicit. Mixed system/user notes, due dates, authors, and historical cutoffs survive retrieval correctly.
- Tickets remain available for operational truth and recovery planning, without silently becoming sales credit or an invented lead.
- Failed or insufficient reviews remain visible and distinguishable from clean calls. Existing active rule keys and unrelated operator edits are preserved.
- The final handoff states what is implemented locally, what database content is prepared/applied under separate authorization, and what remains un-deployed. No production rerun, CRM mutation, or customer outreach is bundled into this repair.
