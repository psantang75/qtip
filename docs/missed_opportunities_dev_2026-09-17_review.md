# September 17 dev Missed Opportunities — acceptance review

Reviewed September 18, 2026. **Assessment only: not ready to accept as meeting the correction brief.** No application code, rules, findings, CRM records, or production data were changed by this review. No model regrade was initiated.

The salesperson accountability policy has improved, including the required Jason/Patrick's warranty result. However, the saved results still contain clear false positives, unresolved CRM links, incorrect primary tasks, and incomplete evidence handling. A live read-only reproduction also found a concrete open-lead status bug in the updated code.

## Scope and baseline

Compared against `cursor_missed_opportunities_salesperson_crm_fix.md`, the owner's clarification, and the active dev rule bodies. The earlier production audit's aggregate verdicts are superseded by the salesperson-specific policy and are not the expected answer.

| Saved dev run | Observed |
|---|---|
| Business date / run | September 17, 2026 / run 10 |
| Finished | September 18, 14:17:12 UTC / 10:17:12 a.m. Eastern |
| Status | PARTIAL: 66 considered, 65 analyzed, 1 failed |
| Findings | 46, IDs 1767–1812, across 32 conversations |
| Rules | 25 active; 44 findings under legacy rules and 2 under the added QA rules |
| Missing saved CRM reference | 15 findings across 10 conversations |
| Logged run cost | $16.3251, approximately $16.33 |
| Tokens | 3,204,754 input; 32,568 output |

Reviewed the 46 saved findings against their 32 full available transcripts, relevant lead/CM/action history, and the active rubric. Reconstructed the current resolver for those 32 calls without running the model. Retrieved source histories for 62 related tasks and 571 action rows, supplemented by the previously verified September 17 audit records. These retrieval totals are not a claim that every record is relevant or that the production prompt contained all those rows.

Limits: this was transcript review, not audio listening. The 33 analyzed conversations without findings and the one failed call were not independently regraded for false negatives. Historical model prompts are not retained in the inspected logs, so current resolver reconstruction is distinguished below from saved run output. Reconstruction used the full available transcript and current source/CRM state; it is not an exact replay of the original model input. Later actions were separated from evidence available on the reviewed day.

Dev has more active rules and a different eligible-call count than the earlier production snapshot. Comparing 46 dev findings with 32 production findings does not establish improved or worsened accuracy by itself.

## Acceptance result

| Requirement | Result |
|---|---|
| Salesperson must make the applicable attempt; CS discussion cannot supply credit | Improved. Jason/Patrick's #1776 is correctly retained. Live dev warranty/persona text reflects the clarification. |
| Reject the known unrelated La Mesa/test-account references | Improved in the saved results: those references are absent. Replacement with a null link is only partial progress. |
| Recognize open leads using actual CRM data types | **Fail.** Binary status flags are interpreted incorrectly; confirmed against live rows. |
| Select the relevant lead or CM and trace legitimate successors | **Fail.** Tailored still points to fulfillment task 1120255 instead of open work 1120251; Apple still points to old lead 845381 instead of CM 847008. |
| Preserve current-call offers, declines, prerequisites, and accepted timing | **Fail.** Multiple saved findings contradict these exceptions. |
| Review relevant notes completely, or qualify missing evidence | **Fail.** There are unresolved calls and truncated packets, yet findings are still presented definitively. |
| Attribute speech to the reviewed salesperson through transfers | Partial. The code recognizes multiple employees but skips verification instead of resolving their segments or holding uncertain judgments. |
| Keep rule applicability distinct from desirable extra coaching | **Fail.** Warranty sold, research-only expansion, and customer-selected slower paths are still reported under omission rules. |
| Demonstrate a complete, efficient run | Not demonstrated: PARTIAL, one failed call, and approximately $16.33 for the saved run. |

## Confirmed implementation defects

### 1. Open leads still become closed because the CRM status flag is binary

This is a regression from an existing, validated pattern. The proven daily extract `workers/sql/task_open.extract.sql:75` reads the same flag as `AND (ts.Closed = 0 OR ts.Title = 'Contact Past Due')` — the comparison happens **inside SQL**, where the flag's storage type compares numerically and safely, and the raw value never enters JavaScript. `collections_task.extract.sql` uses the same `cts.Closed = 0` / `= 1` SQL-side convention. The new resolver diverged: `crmDiscover.ts:169` projects the raw flag as `ts.Closed AS statusClosed`, bringing it into JS, and `crmSelect.ts:112` then compares it with `Number(row.statusClosed) === 0`. The CRM/MySQL driver returns this flag as a Buffer containing byte 0 or 1; `Number(Buffer.from([0]))` is `NaN`, not numeric zero, so `=== 0` is false and an open status falls through to closed. The symptom is systemic: with every open lead misread, `selectSalesRecords` finds an empty `openLeads` set and lands in the `crmSelect.ts:290` branch ("no open lead; most recently worked closed lead used as the historical record") for calls whose lead is in fact open — which then feeds the wrong primary record into grading.

This was reproduced using the application's `mysql2` dependency and prepared `execute`, not inferred from mocked numeric fixtures:

| Task | CRM completion / status | Actual updated function | Same row with numeric status projection |
|---|---|---|---|
| 1120251 — Tailored | Sentinel; Lead Received; Closed byte 0 | closed | open |
| 1119200 — Tim Hortons | Sentinel; Verbal Contact; Closed byte 0 | closed | open |
| 1120533 — Franklin | Sentinel; Verbal Contact; Closed byte 0 | closed | open |
| 1120472 — Fever River Fitness | Sentinel; Proposal Issued; Closed byte 0 | closed | open |
| 1120255 — Tailored fulfillment | Actual completion; Closed byte 1 | closed | closed |

**Required correction:** stop comparing the raw flag in JavaScript. Mirror the proven pipeline and resolve open state in SQL — either compare directly (`ts.Closed = 0`) or project a normalized value (e.g. `CAST(ts.Closed AS UNSIGNED)`), matching `task_open.extract.sql` — and validate the result. If any normalization must remain in JS, coerce the driver's Buffer explicitly rather than relying on `Number()`. Add regressions using real driver-shaped Buffer values as well as numeric/string forms and unknown values. Preserve the existing sentinel, terminal-status, and Contact Past Due distinctions. No database schema change is required for a SELECT projection.

### 2. Transfer legs can erase a positively identified customer number

`crmPhone.ts:160` adds every leg's inferred near-end number to one exclusion set; line 181 rejects any customer candidate in that set. On Fair Oaks and Irish Isle, the real customer participant is outbound, while transferred agent/queue legs are inbound with the same ANI/DNIS pair. Consequently both numbers become excluded and the resolver returns no customer number.

**Required correction:** interpret participant and transfer relationships together. A contradictory direction on a transferred leg must not automatically override a positively identified external participant. Preserve provenance and return explicit uncertainty when the source cannot be reconciled. Use these two actual, sanitized session patterns as regression fixtures; do not add a customer-number allowlist.

### 3. Account identity is being mistaken for opportunity verification

`crmSelect.ts:265` includes all discovered lead/CM records on the chosen account. Lines 290–310 prefer the most recently worked closed lead whenever any lead exists, and can promote it to verified based on account-name corroboration. There is no salesperson/opportunity compatibility requirement in the selection arguments. A matching account name does not establish the correct sales transaction or current CM.

| Case | Saved dev link | Expected review context / remaining problem |
|---|---|---|
| Fair Oaks #1769–1770 | None | Open lead 1120485 and CM 363666; action 8561828 records Jamie's retry/callback and tomorrow follow-up. Customer-number loss prevents discovery. |
| Tailored first call #1779–1780 | None | Enrollment 1120159 and relevant continued client work 1120251 must be distinguished. |
| Tailored second call #1782 | 1120255 | This is a system-closed fulfillment record. Open client lead 1120251, due September 21, contains action 8560397 requesting Monday follow-up. Enrollment 1120159 documents the wider portfolio. |
| Apple Lumber #1809 | 845381 | Old fulfilled lead; the current courtesy-contact context is CM 847008. The resolver reads the CM but still selects the old lead as primary. |
| Community First #1792–1793 | 1120419 | Separate messaging lead, closed Lost; hardware order is 1120343. Both may be relevant to different portions of the conversation; select by finding/opportunity, not latest action. |
| Lakeland #1775 | None | Prior correction case expects lead 1119068 / customer 148975. Current reconstruction instead selects historical task 587245 and labels it verified. That does not pass the required opportunity-resolution case. |
| Keys #1798–1800 | None | Duplicate interaction 1120480 / customer 149023 points to the existing dealer relationship; dealer CM 204703 is context, not an invented Keys direct-sales lead. Reconstruction stops as ambiguous. |
| Taste Buds #1801 | None | CM 816551 plus AE ticket 290020 and support tickets 288598/286234 in their distinct roles. Reconstruction stops as ambiguous. |
| Citizens #1781 | None | Follow duplicate 1109240 via action 8495653 to customer 148597; fulfilled sale 1110112, CM 1111425, return ticket 289955 / task 1120260. Reconstruction stops before resolving this chain. |
| Toyota #1791 | None | Interaction 1120470 and fulfillment 1120469 require validation of their explicit cross-account relationship. Reconstruction finds no contact. |

The correct successor is not always an open lead. Citizens and Keys must retain the actual fulfilled/return/dealer outcome rather than create an artificial open sales opportunity.

**Required correction:** establish account, site/order, relevant salesperson relationship, historical call record, and current recovery record separately. Traverse a validated duplicate relationship before treating its two accounts as an unsolvable shared-phone collision. Do not widen grading eligibility to every lead on the account. Retain operational tickets even when the sales task remains unresolved.

### 4. Publishing and verification do not enforce the actual decision

- **#1772 Anita:** saved `warranty_not_offered` narrative explicitly says the salesperson offered the five-year warranty, the customer declined, and there is no miss to report.
- **#1797 Evergreen/Steven:** saved warranty finding is titled “Warranty offered and declined—no miss.” It is still included in the finding count.
- **#1811 Hamilton Dental:** warranty was selected and included in the order, but the result is saved under `warranty_not_offered` because of missing value framing. A possible QA presentation issue is a different criterion and must be evaluated under that criterion's applicability and KB requirements.

Quote grounding proves a sentence exists; it does not prove the alleged failure. The parser lacks a sufficient contract for applicable rule, actual failure, valid exception, and final disposition. The omission verifier receives findings and transcript but not the same validated lead/CM evidence and full rule conditions. It skips multi-employee conversations (`verify.ts:159`) and leaves their findings unchanged.

**Required correction:** use a structured disposition and criterion-level evidence, validate internal consistency, and give verification the same attributable call and eligible CRM evidence. Preserve unresolved drafts separately from confirmed failures. A skipped or failed verifier must not silently certify a draft. Do not solve this with only keyword filtering for “no miss.”

### 5. More notes are retrieved, but complete review is still not established

Current reconstruction reports these coverage gaps in the sales-history packet:

| Conversation | Retrieved / rendered rows | Omitted |
|---|---:|---:|
| Beardman Digital | 24 / 22 | 2 |
| Batteries Plus, each of its two calls | 52 / 36 | 16 |
| Loden Vision | 57 / 31 | 26 |
| East Pass | 137 / 43 | 94 |

`crmThread.ts` still has a 14,000-character packet ceiling. Exposing omitted-row counts is an improvement, but truncation is not proof that all relevant exceptions were assessed. These are reconstructed coverage figures, not recovered original prompt snapshots.

**Required correction:** first narrow to the correct opportunity, then evaluate all substantive relevant notes in bounded chunks or retain topic evidence with original citations. Mark each criterion unknown where omitted material could change its decision. Keep full provenance and due dates. Do not increase every prompt indiscriminately.

## Finding-by-finding assessment

My assessment of the saved 46 findings is **8 with a supportable core, 30 to remove as written, and 8 needing qualification, a different criterion, or unresolved evidence**. These are manual review recommendations, not changes to QTIP or an estimate of recall across the full day.

“Keep core” does not approve every coaching sentence or confirm the automated lookup passed. In particular, unresolved linkage must be repaired before presenting CRM-dependent claims as verified. “Review” does not mean the salesperson failed or passed.

| ID | Salesperson / customer | Assessment | Basis |
|---|---|---|---|
| 1767 | Jamie — Dental Center Greenville | Review | AI receptionist/no-contact branch. Verify the actual approved script and whether a message option was available; do not invent mandatory urgency, email capture, or extra script requirements. |
| 1768 | Jamie — Dental Care Center Zebulon | Remove | Message gives identity, company, sister-office context, possible savings, direct number and Monday retry. Rule does not require a numeric savings claim or deadline; the finding adds those requirements. |
| 1769 | Jamie — Fair Oaks | Remove | On-call investigation/callback plus own lead's documented retry and tomorrow follow-up contradict abandonment. “Expired card,” ACH/manual payment authority and immediate activation are not established. |
| 1770 | Jamie — Fair Oaks | Remove | Jamie discusses messaging and the app limitation. Outdoor/Bluetooth context alone does not establish the asserted unaddressed audio need; the finding demands extra offers without the necessary trigger. |
| 1771 | Jamie — Franklin | Keep core | Customer expresses cancellation risk and Jamie does not route the save on that call. Rewrite the guidance: the later CS Comcast/Monday note cannot be treated as information Jamie already knew before hangup. |
| 1772 | Jason — Anita | Remove | Current call contains five-year offer and decline. The finding itself says there is no miss. |
| 1773 | Jason — Pacific Club | Remove | Customer needs GM/multiple approvals and requests a quote/paperwork. This is an explicit exception to buying-signal-not-closed. |
| 1774 | Jason — Pacific Club | Remove | Jason offers audio equipment; customer says upgrades are already done and discusses a future project. An unaccepted offer is not an omitted offer. |
| 1775 | Jason — Lakeland | Review | Initial credential advice and ownership language may warrant narrow coaching. The finding wrongly makes routing to the appropriate support team itself the failure; attribution and trial lead linkage remain unresolved. |
| 1776 | Jason — Patrick's | Keep core | Required regression passes: hardware purchase, no Jason warranty attempt, no qualifying warranty disposition on lead 1120497 / CM 135455. Earlier CS explanation does not clear it. |
| 1777 | Jason — Beardman Digital | Remove | CFO quote, shipping details and compatibility are real prerequisites; customer requests the quote and accepts tomorrow's follow-up. Do not require an immediate order instead. |
| 1778 | Jason — Club Pilates | Remove | Jason probes the objection and offers a short demo, which is declined. His own lead documents the earlier demo and Spotify differentiator (8544717/8544741). This is not an unanswered competitor question requiring an invented nurture commitment. |
| 1779 | Mitchell — Tailored, first call | Keep core | Direct Sonos Pro comparison is left unanswered without a concrete research commitment. Correct the missing enrollment/client linkage; do not invent competitor facts in coaching. |
| 1780 | Mitchell — Tailored, first call | Remove | Customer chooses information and a later callback; dealer enrollment is not consent to order the entire property portfolio now. |
| 1781 | Mitchell — Citizens | Review | Transcript explicitly says CS referred the equipment-return request to Mitchell. Validate the return workflow and duplicate chain before declaring a routing failure. Earlier CS termination is recovery context, not credit for Mitchell's retention effort. |
| 1782 | Mitchell — Tailored, second call | Remove | Portfolio/phased rollout is already documented; continued client work is on open 1120251, not closed 1120255. Do not demand repeated footprint discovery. |
| 1783 | Mitchell — Elite Tech Pros | Remove | Customer explains future sites and says “when I get to that point.” This does not support a ready-to-order-now failure. |
| 1784 | Mitchell — Elite Tech Pros | Review | No timeframe is agreed for the new expansion; potentially valid follow-up coaching. Establish the expansion lead/CM and due dates before asserting that no validated record schedules the next touch. |
| 1785 | Mitchell — Irish Isle | Remove | Customer asks for technical access help to decide whether to keep service; Mitchell makes that transfer. The active routing rule does not require the AE to perform a separate retention negotiation before appropriate routing. |
| 1786 | Mitchell — Batteries Plus, first call | Remove | Brand/account research does not establish a customer-stated live uncovered portfolio on this call. |
| 1787 | Mitchell — Batteries Plus, callback | Keep core | Hardware completion callback contains no offer. Earlier separate call's offer/decline is not documented in the relevant lead/CM reviewed; it cannot silently bypass the owner's documentation gate. Make the current-call scope clear. |
| 1788 | Mitchell — Batteries Plus, callback | Remove | Same research/brand-only expansion problem; no new customer-stated site trigger. |
| 1789 | Mitchell — Riverside | Keep core | Live gatekeeper takes a message; rep identifies the existing music-provider relationship but gives no concrete business reason for callback. This rule explicitly covers gatekeeper messages. Do not call it an actual voicemail in recovery text. |
| 1790 | Mitchell — Loden Vision | Remove | Transcript shows automated routing/transfer, not an available voicemail/message opportunity that the rep refused. Unknown is not a missed voicemail. |
| 1791 | Mitchell — Toyota Gladstone | Remove | Customer describes existing covered stores and declines help while completing the web purchase; no established uncovered expansion. |
| 1792 | Mitchell — Community First | Remove | Four-branch count comes from research. Customer asks about the main branch; that alone does not meet the revised live-additional-site trigger. |
| 1793 | Mitchell — Community First | Review | The cited uncertainty about human/AI voices may merit product-knowledge coaching. It does not itself prove the saved professionalism criterion; most of the call addresses business and mutual rapport is not automatically misconduct. |
| 1794 | Mitchell — Public House | Remove | Present zones are purchased; an additional zone is explicitly later/phased. No immediate-close omission is established. |
| 1795 | Mitchell — Public House | Remove | Email domain and corporate virtual card are explicitly insufficient expansion triggers under the revised rule. |
| 1796 | Mitchell — Public House | Remove | Player and offline benefit are presented; customer chooses the app “for now.” Active QA guidance says an appropriate declined offer is not an omission. |
| 1797 | Steven — Evergreen | Remove | Warranty offered and declined on the reviewed call; even the finding's title says no miss. |
| 1798 | Mitchell — Keys Cafe | Remove | Customer elects to check the existing dealer first. That slower path must not become an immediate-close failure. |
| 1799 | Mitchell — Keys Cafe | Remove | Other-site discussion concerns existing coverage, not an established live uncovered opportunity. |
| 1800 | Mitchell — Keys Cafe | Review | No callback timeframe is captured in the call; a possible follow-up gap remains. Resolve duplicate lead/dealer context and the customer's chosen path before publishing an authoritative recovery instruction. |
| 1801 | Steven — Taste Buds | Remove | Own transcript accepts a next-day testing/roster plan. The rule accepts a timeframe without a precise appointment. Proposed “Thursday afternoon after tomorrow's test” also conflicts with a Thursday call. |
| 1802 | Mitchell — McTims | Keep core | Customer actually identifies additional restaurants; footprint/decision authority remains unscoped. Correct the recovery advice to respect the declined callback. |
| 1803 | Mitchell — McTims | Remove | Corporate approval is a prerequisite and customer explicitly refuses the proposed callback. Do not treat this as consent to close now. |
| 1804 | Mitchell — McTims | Keep core | Price objection receives an insufficient value response. Keep advice grounded in approved product/licensing guidance; remove unsupported fine amounts and guaranteed economics. |
| 1805 | Vince — Evergreen | Review | Customer's broader group reference is real, but three sites are already on service and Vince routes to assigned AE Steven. Determine remaining scope in CM 108108; do not infer additional uncovered sites or credit Steven's later sale to Vince. |
| 1806 | Steven — Fever River Fitness | Keep core | Hardware is priced/proposed and no extended-warranty offer appears on this call or qualifying prior sales note. September 18 proposal action 8562308 later offers coverage: that updates recovery status, not September 17 speech. |
| 1807 | Vince — East Pass | Remove | Finding relies on prior research and the salesperson's prompt rather than establishing the customer's current live uncovered sites as required by the revised expansion rule. |
| 1808 | Vince — East Pass | Remove | Vince offers audio equipment/install services; customer requests hardware pricing. This is not audio-not-offered. |
| 1809 | Vince — Apple Lumber | Remove | Old account research supplies the expansion premise; no qualifying new-site statement. Primary record remains the wrong historical lead instead of CM 847008. |
| 1810 | Vince — Tim Hortons / Parth | Remove | Corporate prerequisite and next-week timing are explicit. Lead 1119200/action 8557155 has the relevant September 24 follow-up. |
| 1811 | Vince — Hamilton Dental | Review | Remove from warranty-not-offered: customer selects coverage at 02:41, rep prices it at 03:24, and order includes it. Assess any three-problems presentation coaching separately under QA question 10854 with applicable guidance. |
| 1812 | Vince — Hamilton Dental | Remove | Rep recalls other locations; customer explicitly chooses one player for this site. The revised expansion rule excludes a rep-only prompt and a one-site/phased decision. |

## Coaching and recovery need their own accuracy check

Do not approve the current wording simply because a core omission is valid:

- Franklin: support note 1745410 was entered at 16:56 Eastern, after the approximately 16:35–16:44 call. A later Comcast plan cannot become a fact the AE should have repeated earlier.
- Fever River Fitness: extended coverage is offered in the next-day proposal. Preserve any September 17 omission, but do not recommend recovery as though that proposal was never sent.
- Warranty examples: “keeps the office from ever going silent” overstates a replacement warranty. Confirm actual product, coverage, price and replacement terms; do not imply a warranty prevents all downtime or that every hardware package costs the same.
- Fair Oaks: an expired card and authority to bypass checkout with manual payment/ACH are not established by the quoted portal error.
- McTims: respect refusal of a callback. Do not manufacture fine amounts or licensing savings to overcome the objection.
- Customer prerequisites and choices are factual constraints, not evidence that a salesperson must keep pressing until they obtain a different answer.

## Recommended Cursor follow-up and acceptance gate

1. Fix and test the actual CRM binary-status projection and the transferred-customer-number exclusion. These are deterministic defects and do not require another paid daily model run to reproduce.
2. Resolve the known task/CM/duplicate cases above. Distinguish account confidence from opportunity confidence and record ownership; explicitly separate historical grading from current recovery.
3. Enforce finding disposition and rule applicability. Block internally contradictory “no miss” records; separate QA presentation from omitted offers. Verify customer declines, quote/approval prerequisites, and accepted timeframes against the actual active rule.
4. Carry verified source/actor/time/coverage evidence through both analysis and verification. Incomplete evidence needs a visible pending/qualified disposition, not automatic failure or automatic clean status.
5. Calibrate a small fixed set: Jason/Patrick's retained; Anita and Evergreen warranty declines removed; Hamilton excluded from warranty-not-offered; Pacific/Beardman approved quote paths removed; Public House declined player offer removed; Tailored correct open lead; Apple correct CM; Fair Oaks/Irish Isle transfer lookup resolved; valid McTims and Fever River omissions retained with accurate guidance.
6. Review the failed call separately and sample the calls without findings to test missed detections. Passing only the flagged-call examples cannot establish recall.
7. Only after these gates pass, compare equivalent rule/call sets and measure a controlled dev run. Retain the same salesperson-accountability standard when reducing cost. Use evidence reuse and bounded relevant histories rather than omitting eligible calls or accepting unverifiable drafts.

The saved run already costs approximately $16.33; the efficiency objective is not demonstrated here. This is the application's logged estimate, not a provider invoice reconciliation or total spend across all reruns. Fix the deterministic defects and calibrate the identified cases before paying for repeated full-day regrades.

**Decision:** the implementation is moving in the intended direction, but the updated September 17 dev output does not yet satisfy the requested accuracy, CRM linkage, complete-evidence, or publication requirements. Keep this assessment separate from runtime guidance; business policy remains in the existing editable rule/persona records.
