# Sales play audit and replacement plan

Read-only audit, 2026-09-14. **The current library should be curated before it is used as an effectiveness benchmark.** All 72 active plays received individual recommendations below. All 3,303 archived plays were inventoried and screened for provenance, duplicates and claim patterns; they were not individually validated against original call recordings. No play was activated, archived or rewritten in the live database.

## Findings and recommended decisions

| Finding | Evidence / implication |
| --- | --- |
| 3,375 plays: 72 active, 3,303 archived, zero proposed | Six active categories each contain 12 plays. Recommended active dispositions: **6 retain with gates, 23 revise, 20 merge, 22 hold, 1 retire**. None is certified effective by this audit. |
| All 72 active plays labeled WON | All 72 lack a direct source-conversation ID; 42 lack a quote. Canonicalization does not retain a membership trail. A quote or support count cannot by itself establish a successful tactic. |
| Outcome matching is too broad | `salesPlays/outcome.ts` checks orders across leads found through matching phone contacts. It does not require the reviewed call's exact opportunity, a post-call order or a defined attribution window. An older unrelated order can label a call WON. |
| Every call can receive 48 plays | `renderPlaysForPrompt` takes up to eight per category, ordered by support. There is no call-purpose/product selector or global play token budget. Twenty-four active plays are excluded by ranking, while unrelated ones may be included. Fetch-once does not mean pay-once for model input. |
| Canonicalization can lose evidence and inflate support | `parseCanonical` accepts duplicate member indexes within/across groups and does not ensure every selected source is accounted for. A group without valid members can still receive support 1. Quote validation checks mined snippets, not original dialogue. |
| Canonicalization can archive unseen input | It reads at most 150 proposed source plays per category, then archives all proposed source plays in that category. Rows outside the input cap or omitted by the model can disappear from the pending queue. |
| Approval is insufficiently evidenced | `activate` can publish regenerated canonical plays in the same operation. The prompt describes manager signoff, but the canonical rows alone do not establish a specific human review of the final wording. Preserve an approval record for the actual version. |
| Savings, licensing, shipping and payment advice need controls | Examples include blanket licensing protection, next-day shipment, unsupported competitor terms, numeric discounts, payment splitting and invented urgency. Current approved KB and customer circumstances must govern. |

Paths above are relative to `backend/src/services/insights/missedOpportunities/`. These are observed implementation limitations, not proof that every stored result is wrong.

## Immediate priorities

1. **Retire 3361's manufactured internal cancellation pressure.** A customer's real deadline can support a factual escalation; inventing a threat cannot.
2. **Hold the 22 claim-dependent plays** until policy/source review, especially 3330 payment splitting, 3328/3331/3357 licensing, 3310 shipping, 3349 audio sizing and 3338 competitor terms. These are recommendations only; live settings remain unchanged.
3. **Consolidate the 20 overlaps** and revise the 23 overbroad plays. Keep company-required CM questions in their correct flow; remove “every call” advice where not supported.
4. **Gate all retained plays** by purpose, stage, product, prerequisites and customer preference. Support counts are frequency, not win-rate evidence.
5. **Repair provenance/outcome logic and input-archive behavior before further automatic promotion.** Keep mined proposals in review status until the exact wording and claims are approved.

## Disposition of every active play

**Hold** means exclude from recommendations until the claim/process is corrected and approved. **Merge** means preserve useful intent in the named replacement, then archive the duplicate. **Retain with gates** still requires source/policy validation before it can be labeled effective. P01–P16 refer to the replacement set below.

| ID | Category | Current title | Recommendation | Specific correction |
| --- | --- | --- | --- | --- |
| 3304 | closing | Send Order Link Live and Co-Pilot Checkout to Close | Revise | Keep guided online sign only when the buyer is ready; use approved secure payment and drop the guaranteed conversion language. P10. |
| 3305 | closing | Lock a Specific Dated Next Step Before Every Call Ends | Merge | Use one customer-agreed next-step play, gated to unfinished qualified opportunities; do not require a callback after every call. P11. |
| 3306 | closing | Pair Every Voicemail with a Same-Day Email and Clear CTA | Revise | Use the relevant voicemail/call-first cadence; remove the unsupported claim that it doubles callbacks. P12. |
| 3307 | closing | Commit to a Same-Day Proposal and Assign the Customer One Task | Merge | Proposal only when discovery and prerequisites are sufficient; remove every-call same-day rule. P10. |
| 3308 | closing | Present Annual Prepay as the Default Billing Choice | Merge | Present approved monthly/annual choices and full cost based on customer fit; remove default-prepay and churn claims. P08. |
| 3309 | closing | Take Payment Live on the Call — Card or Portal | Hold | Replace blanket card collection and 30-second promise with approved payment flow; honor orders-over-$2500 policy and authorization. P10. |
| 3310 | closing | Create Legitimate Urgency with Ship-Cutoff and Activation Timing | Hold | Replace next-day shipping promise with in-stock, paid/released, cutoff and approved delivery estimates. P13. |
| 3311 | closing | Warm-Transfer or Book a Live Backup Instead of Voicemail Hand-offs | Merge | Warm handoff for a ready buyer with explicit owner and context; consolidate with 3359. P10. |
| 3312 | closing | Lock a Firm Follow-Up When an Internal Approver Is Involved | Revise | Help the contact involve the approver and agree a next step; remove never-accept-pressure wording. P11. |
| 3313 | closing | Use Warranty and Add-On Rules as Legitimate Now-or-Never Closes | Hold | Verify warranty purchase window before claiming it cannot be added after shipment; no invented scarcity. P09. |
| 3314 | closing | Offer a Paid Site Survey or Photo Assessment to Unblock Stalled Hardware Deals | Revise | Use approved survey/photo intake paths; do not assume both are paid or quote an unverified fee. P05. |
| 3315 | closing | Confirm Activation, Go-Live Expectations, and Service Continuity Before Hanging Up | Hold | Activation duration and uninterrupted service are product-dependent; use verified prerequisites and operational estimates. P13. |
| 3316 | discovery | Run the 3-Question Growth Check on Every Check-In | Revise | Keep the three growth topics for the relevant CM flow, including permission and prior context; no universal all-call or under-two-minute claim. P03. |
| 3317 | discovery | Qualify Audio Infrastructure Before Quoting Any Hardware | Revise | Detailed ceiling/70V qualification belongs to applicable audio projects, not every music-player sale. P05. |
| 3318 | discovery | Open With a Positive Frame, Then Probe for Pain | Merge | Use truthful service context and a neutral satisfaction question; do not fabricate recent positive feedback. P03. |
| 3319 | discovery | Qualify and Engage Gatekeepers to Reach the Real Decision-Maker | Revise | Keep a short, truthful gatekeeper introduction and relevant contact request; avoid a four-question interrogation. P12. |
| 3320 | discovery | Confirm Personal vs. Business Subscription and Playback Device Before Activating | Revise | Keep existing-consumer-subscription and device/RID checks only for affected activation paths. P05. |
| 3321 | discovery | Surface Licensing Risk to Accelerate the Switch | Merge | Qualify the actual music use, then use approved product/application licensing language. P06. |
| 3322 | discovery | Map the Full Multi-Site Footprint Before Finalizing Any Order | Revise | Confirm ownership and supported vs remaining sites; remove routinely-doubles-deal-size claim and every-order repetition. P04. |
| 3323 | discovery | Diagnose Root Cause Before Accepting the Customer's Hardware Verdict | Retain with gates | Clarify the symptom and route technical diagnosis appropriately before proposing equipment. No unsupported repair diagnosis. P05. |
| 3324 | discovery | Turn Cancellations and Closures Into Redeployment or Relocation Revenue | Hold | Do not treat a closure/cancellation as almost always an unmet sales need. Follow retention/CS process; discuss relocation only when relevant. P14. |
| 3325 | discovery | Lock a Dated Next Step Before Ending Every Call | Merge | Duplicate next-step behavior; fold into 3305 after correcting customer-agreement requirement. P11. |
| 3326 | discovery | Probe Adjacent and Sister-Location Needs Before Closing Any Upsell | Merge | Discover an actual multi-site need; avoid vertical-based budget assumptions and route the scope correctly. P04. |
| 3327 | discovery | Capture Durable Contact and Billing Info in a Single Pass | Revise | Verify the authorized contact and relevant account fields; remove universal role-email preference and unnecessary personal-data capture. P01. |
| 3328 | objection | Lead with Licensing Risk to Neutralize Consumer-App Objections | Hold | Remove fine amounts, blanket coverage and cheapest-legal-path claims pending the approved licensing matrix. Do not use fear as urgency. P06. |
| 3329 | objection | Anchor Equipment Pitch with Factory-Direct Savings Up Front | Hold | Savings, rebates, prices and seller/fulfillment claims need current approved evidence; lead with the need, not an unqualified price anchor. P08. |
| 3330 | objection | Solve Payment Friction In-Call with a Backup Method | Hold | Do not split charges to evade payment limits. Use check/ACH or the documented manager-exception process. P10. |
| 3331 | objection | Reframe Price Objections by Breaking Down Value Per Zone or Per Day | Hold | Check product/application PRO coverage; show total price/terms before per-day framing. No blanket licensing promise. P06/P08. |
| 3332 | objection | Use a Paid Site Survey to De-Risk Complex or Stalled Installs | Hold | Survey credit, fee, duration and device eligibility require current scope-specific policy. P05. |
| 3333 | objection | Neutralize Contract and Commitment Fear with Month-to-Month Clarity | Hold | Month-to-month, cancellation and rate-lock claims must match the actual offer and agreement. P08. |
| 3334 | objection | Convert Satellite Reception Complaints into a Streaming Upgrade | Hold | Channel counts, price parity and rebates must come from current product policy; do not embed changing numbers. P08. |
| 3335 | objection | Reframe Content or Channel Objections with a Live Catalog Search | Retain with gates | Use the approved catalog to address a stated selection concern, then check fit; follow retention routing when relevant. P07. |
| 3336 | objection | Offer Extended Warranty by Framing It as Downtime Protection | Revise | Use the approved warranty framework and customer concern; no automatic replacements or discount authority beyond policy. P09. |
| 3337 | objection | Isolate the Real Objection Before Conceding Anything | Revise | Seek the real objection with an open question, then ARP and check resolution; avoid a leading price-or-other binary. P07. |
| 3338 | objection | Warn Competitor-Switchers About Auto-Renewal Trap Before They Cancel | Hold | Remove unsupported competitor auto-renewal and number-one-deal-killer assertions; ask the buyer to check their actual agreement. P08. |
| 3339 | objection | Reframe Cancellation or Downgrade Requests as a Retention Conversation | Hold | Use the correct retention/CS route and approved offer; do not invent a term/rate lock to save a cancellation. P14. |
| 3340 | upsell | Run a Three-Part Upsell Sweep on Every Check-In | Merge | Duplicate CM growth check. Quote resembles a recommendation rather than dialogue; re-verify against source transcript. P03. |
| 3341 | upsell | Lead Every Hardware Pitch with Factory-Direct Savings Anchor | Hold | 30–50%/8,000-technician claims need reconciliation with KB and current evidence; quoted text does not establish all numeric claims. P08. |
| 3342 | upsell | Attach Extended Warranty on Every Hardware Sale | Revise | Keep relevant warranty offer; verify SKU price/eligibility and advanced replacement terms; no unapproved discount. P09. |
| 3343 | upsell | Ask About Additional Locations and Sister Brands on Every Call | Merge | Footprint question belongs to applicable discovery/expansion; remove every-call and zero-cost claims. Re-verify imperative-style quote. P04. |
| 3344 | upsell | Pitch Overhead/On-Hold Messaging as a Paid Add-On Every Call | Hold | Separate overhead messaging from on-hold service and verify product/price; remove every-call pitch. Re-verify the quote. P08. |
| 3345 | upsell | Pivot Hardware Failures and Complaints into an Internet-Player Upgrade | Merge | Clarify hardware problem, then evaluate an eligible internet alternative using verified capabilities; re-verify instructional quote. P05/P08. |
| 3346 | upsell | Offer Soundtrack to SiriusXM Customers Wanting Variety or Multi-Zone Control | Hold | Playlist counts, price parity and delivery dates need current product sources. P08/P13. |
| 3347 | upsell | Consolidate All Locations onto One Account and Lock in Annual Billing | Merge | Verify common payer/ownership and approved billing options; no blanket master-account annual consolidation or churn promise. P08. |
| 3348 | upsell | Turn Every Inbound or Admin Call into a Discovery and Upsell Moment | Merge | Use the correct CM/service flow and resolve or route the original request; no universal upsell during all billing/admin contacts. P03/P14. |
| 3349 | upsell | Quote Full Hardware Stack (Player + Amp + Speakers + Install) in One Proposal | Hold | Do not recommend two speakers per 1,000 square feet as a universal design rule. Use qualified audio intake/design; warranty quote does not support that rule. P05. |
| 3350 | upsell | Position Yourself as Single Point of Contact for All Future Adds | Revise | Provide the AE commercial contact while preserving portal, Billing and Support paths; do not steer everything to the AE to retain credit. P14. |
| 3351 | upsell | Probe Licensing Risk When Customer Mentions Consumer Music Services | Merge | Qualified licensing education only; remove implication that only this paid solution can address every use. P06. |
| 3352 | urgency | Give Voicemails a Concrete Deadline or Benefit Hook | Hold | Voicemail needs a truthful account-specific reason, not invented expiry, fines or outage. Existing quote does not substantiate the urgency. P12. |
| 3353 | urgency | Lock a Specific Callback Date — Let the Customer Name It | Merge | Duplicate next-step scheduling; use one gated play. P11. |
| 3354 | urgency | Anchor Every Urgency Lever to the Customer's Own Deadline | Retain with gates | Use the customer's actual project deadline and verify prerequisites/lead times. Do not create a deadline for them. P13. |
| 3355 | urgency | Use Payment Method to Accelerate Ship Date and Activation | Hold | Verify ACH clearance and warehouse cutoff; do not manufacture urgency with unverified timelines. P13. |
| 3356 | urgency | Commit to a Same-Day Proposal or Callback to Hold Momentum | Merge | Same-day/60-minute proposal only if scope and capacity support it; consolidate with quote readiness. P10. |
| 3357 | urgency | Convert PRO / Licensing Exposure Into a Same-Day Paid Signup | Hold | Do not promise ten-minute activation resolves a PRO notice or past licensing issue. Use approved notice handling. P06. |
| 3358 | urgency | Anchor Trial and Demo Follow-Ups to the Expiration Date | Revise | Keep trial-success/expiry review tied to the real trial; remove unrelated fines/licensing pressure. P15. |
| 3359 | urgency | Take the Order Yourself When a Ready Buyer Is on the Line | Merge | Duplicate ready-buyer handoff; retain one controlled close/handoff play. P10. |
| 3360 | urgency | Use Ownership Transfer or Competitor Renewal as a Same-Week Close Trigger | Revise | Verify ownership, authorized contacts and actual service implications; remove blanket 24–48-hour re-papering or presumed lapse. P16. |
| 3361 | urgency | Frame Internal Urgency to Drive Customer Escalation | Retire | Do not tell internal teams a buyer will cancel unless the buyer actually said so. Replace manufactured pressure with factual urgency/escalation. P13. |
| 3362 | urgency | Offer Annual Prepay or Multi-Year Bundle to Lock Revenue Upfront | Merge | Annual/multiyear is a customer-fit choice under approved terms, not a universal default or proven churn tactic. P08. |
| 3363 | urgency | Decouple Planning from Occupancy to Keep Multi-Site Deals Moving | Revise | Align construction readiness, billing start, shipment and activation with the customer's agreed milestones; no blanket collect-and-ship-now. P13. |
| 3364 | research | Mine Pre-Call Research to Surface Multi-Location Expansion | Revise | Use verified research and clearly labeled hypotheses. Do not intentionally guess site count to provoke a correction. Preserve corporate research exception. P01. |
| 3365 | research | Pull the Full Account Before Every Call to Build Instant Credibility | Retain with gates | Use the correct account's relevant CRM context and outstanding commitments, with source dates. P01. |
| 3366 | research | Own the Handoff: Lead Rep-Transition Calls with Specifics | Revise | Explain a real AE handoff truthfully and keep continuity; avoid causal claims and preserve service department boundaries. P16. |
| 3367 | research | Open Retention Calls with a Positive Feedback Frame | Merge | Duplicate satisfaction opening; do not invent positive feedback or imply an issue is solved. P03. |
| 3368 | research | Name-Drop the Existing Service to Bypass Gatekeepers Fast | Revise | Use existing-vendor language only for an actual customer; use truthful inquiry/cold context otherwise. Remove unsupported engagement uplift. P12. |
| 3369 | research | Convert Ownership and Cancellation Events into New Activations | Revise | Use ownership-transfer authorization and CS process; request a suitable new contact without implying permission to transfer service. P16. |
| 3370 | research | Multi-Thread When a Single Contact Goes Dark | Revise | Alternative contact only under the governing cadence and preferences; no automatic stakeholder escalation after two voicemails. P12. |
| 3371 | research | Call Abandoned-Cart and Inbound Leads Before They Go Cold | Retain with gates | Follow up a real authorized abandoned inquiry/cart with verified identity, preference and source cadence. Do not assume purchase intent. P12. |
| 3372 | research | Leverage Franchise and Corporate Programs as Social Proof | Hold | Do not copy a sister franchisee's prices/billing terms or contacts. Verify program eligibility, payer and authority. P01/P08. |
| 3373 | research | Audit AR, Billing Details, and Contact Info Before Every Revenue Call | Revise | Limit research to relevant billing context; do not pull all AR/card information for every sale or inject payment secrets into AI. P01. |
| 3374 | research | Lock Dated Follow-Ups to Expansion and Project Timelines | Merge | Customer-timed future callback belongs in next-step/milestone play; record owner and useful timing without invented precision. P11. |
| 3375 | research | Be the Technical Expert: Know Hardware, Licensing, and Competing Gear Cold | Retain with gates | Use verified product facts and supervisor support when needed; never pretend expertise or give unsupported licensing/technical answers. P08. |

## A smaller replacement set

These are **16 proposed play families**, not 16 scripts to recite on a call. Retrieve zero to three relevant plays. Each should be a short card with trigger, exclusions, desired behavior, natural example wording, CRM action, approved source IDs, claim validity, owner and version. Existing KB stays authoritative; rates and terms remain linked facts.

| Family | Trigger and exclusions | Behavior and short example | Evidence of a useful result |
| --- | --- | --- | --- |
| P01 Relevant pre-call context | A task requires research; skip/reuse as allowed by corporate exception. Never borrow another franchisee's terms. | Read the matched account, prior discovery and open commitments. “I saw the planned opening noted for October—is that still current?” | Verified context used without repeating answered questions or inventing research. |
| P02 Brief SMB discovery | New/changed commercial need; do not restart discovery on routine fulfillment. | Confirm setup, reason, impact and desired result. “When music stops, what does your team have to do to get it going again?” | Customer need and practical consequence recorded; solution tied to that answer. |
| P03 Contact Manager growth check | Applicable CM check-in with permission; follow dissatisfaction/support branch first. | Use the three existing topics: upcoming projects, audio satisfaction, unsupported locations/brands. “Could I ask three quick questions about what you're planning?” | Relevant opportunity or clear no-current-need disposition, without forcing a sale. |
| P04 Footprint and expansion routing | Multi-location/franchise context; confirm operator scope rather than brand size alone. | “Which locations do you oversee, and which are already covered with us?” Follow current net-new routing and lead rules. | Verified scope, owner and next action; existing/unsold opportunities recorded correctly. |
| P05 Equipment and audio qualification | A real equipment/install/activation need; product-specific questions only. | “What equipment is there now, and what needs to change?” Use audio intake/site survey or technical support when needed. | Appropriate specification or clear technical prerequisite; no guessed system design. |
| P06 Accurate licensing conversation | Music-use/licensing question or consumer-service issue. | Clarify application and approved coverage; route PRO notices correctly. “How is the music being used at the location?” | Accurate scope and suitable next action, without fines, legal guarantees or retroactive-cure promises. |
| P07 Seek first, then ARP | An actual unresolved objection; a firm refusal is not permission for endless rebuttal. | “What is the main concern about making the change?” Acknowledge, respond to that concern, pivot/check resolution. | Concern clarified and resolved, narrowed or honestly dispositioned. |
| P08 Relevant value and offer options | Customer has an identified need and eligible options. | Compare approved service/equipment/term alternatives against that need. “Given your need for central control, here's the option that fits and the total cost.” | Buyer understands fit, cost and terms; no unsupported comparative claim or automatic discount. |
| P09 Applicable warranty | Eligible equipment purchase; an earlier accepted/declined offer is recognized. | Use the KB three-problems/three-solutions framework and actual price/terms. “How long would you like to cover this equipment?” | Appropriate offer and customer decision documented; no invented purchase deadline. |
| P10 Proposal and ready-buyer close | Qualified and ready, with prerequisites satisfied; preserve audio and payment exceptions. | Review the proposal, seek the order and guide approved online sign. “Does this cover what you need, and are you ready to place it?” | Appropriate close attempt/commitment, or legitimate blocker and owner; approved payment/handoff only. |
| P11 Customer-agreed next step | Qualified opportunity still open; respect no-fit/no-contact and requested future timing. | “What will you and your partner need to review, and when should we reconnect?” Confirm purpose, owner, date/time as applicable. | Customer-understood commitment, not merely an internal due date. |
| P12 Relevant outbound / no contact | Truthful existing relationship, submitted inquiry, permitted cart follow-up or prospecting reason. | Brief personalized reason, contact identity and callback ask using the right cadence/script. “I'm following up on your music inquiry for the new location.” | Genuine attempt, correct voicemail/email/notes and governing next-contact step. |
| P13 Real timing and logistics | Customer deadline or verified stock/activation/construction dependency. | Work backward from the real milestone and confirm operational estimates. “When must music be working, and will the network be ready by then?” | Feasible owner/date for each blocker; no invented urgency or guaranteed delivery. |
| P14 Service and retention handoff | Support, billing, cancellation or dissatisfaction; apply actual department responsibilities. | Resolve or route the initial need, then pursue commercial change only where appropriate. “Let's get the service issue to the right team; I'll document the equipment need separately.” | Accepted handoff or tracked recovery; customer does not have to restart their story. |
| P15 Trial / demo value check | Approved, real trial/demo with agreed use case. | “Have you tried the setup we discussed, and does it solve the issue at the front desk?” Confirm next decision. | Usage/value evidence and appropriate conversion step, rather than an expiry-only pitch. |
| P16 Ownership and AE continuity | Verified business ownership/contact/AE transition. | Confirm who is authorized, preserve known context, explain actual process and next owner. | Correct contact/ownership update and continuity; no assumed service transfer or threatened lapse. |

## Archive review and evidence ledger

All **3,303 archived rows** retain a source-conversation ID; 50 lack a quote. The complete [review ledger](C:/Users/psantangelo/.codex/visualizations/2026/09/14/01a09f57-015e-76d3-b1f7-c9398e0db15d/sales-play-review-ledger.json) records each ID, status, title, source reference, duplicate-body IDs, screening flags and disposition. It contains no full transcript or customer call-note text.

Deterministic archive screens found 582 rows with universal-scope wording, 313 with numeric claims, 109 with performance/guarantee wording, 90 with licensing terms, and 291 with payment/offer terms. Categories overlap. These flags are **review cues, not counts of proven bad plays**; a legitimate warranty can trigger a number/terms screen. Exact normalized-body duplicates are listed per row; absence of an exact duplicate is not semantic uniqueness.

Archive disposition is keep archived pending source-level review. Review a candidate's full dialogue, actual opportunity timeline and current policy before reactivation. The archive was fully accounted for; its original recordings were not exhaustively listened to. No effectiveness score or “best seller” ranking is supported by this audit.

Snapshot SHA-256: `93fff33b7894e90ffed16f46d9e899208b48b84e971821ce4b18ea3b618aa034`. The ledger includes the retrieval timestamp and screening methodology. Source extraction used the configured QTIP read-only integrations; live policy changes after this date require revalidation.

## How to prove a play earns its place

- Preserve the exact play version, original conversation/agent turn IDs, merged source membership and independently verified policy citations. Reject repeated/invalid membership indexes and archive only represented inputs in the transaction.
- Treat outcome as **unknown** until the exact opportunity and a dated order/lost disposition are linked. Keep prior orders, open opportunities and mixed outcomes separate. Never relabel unknown as lost after a failed lookup.
- Pilot a small number of revised plays in comparable call types. Track eligible opportunities, play usage, appropriate next-step/offer behavior, customer outcomes and manager corrections. Report sample sizes and uncertainty; do not claim causation from raw support or a before/after comparison with changing lead mix.
- A proposed activation gate is: approved policy/claims, source trace, a manager-reviewed sample of eligible uses including unsuccessful calls, and acceptable customer experience. A sparse sample can justify keeping a useful coaching example; it cannot justify “proven to increase close rate.”
- Review one behavior per AE at a time. Retire duplication, expired claims and plays with repeated context errors. Keep a maximum of 16 families initially; a proposed new family needs a real uncovered scenario or replaces an existing family. The cap is a proposed maintenance constraint, not a sales benchmark.

See the [KB gap list](sales_qa_kb_gap_analysis.md) for policy links and the [enhancement plan](sales_missed_opportunities_enhancement_plan.md) for call-level retrieval, cost controls and calibration.
