# QTIP Sales Missed Opportunities — enhancement specification

Status: implementation-ready proposal, 2026-09-14. **Use one consistent review per eligible call, a compact packet of relevant evidence, and at most three actionable findings.** Keep Dynamic Media's SMB/midsize sales process: brief research, relevant discovery, correct product/offer, seek-first/ARP, appropriate close or agreed next step, accurate CRM follow-through.

This document specifies the enhancements; it does not claim they are all implemented. The revised local correction removes the file-based QA reference layer and uses the existing database-owned rules/persona. Fourteen QA rule additions were applied with user approval to `localhost:3306/qtip` on 2026-09-14; all eleven existing rules were preserved, giving twenty-five active local rules. Metrics, selective retrieval, revised plays, strict shared spending reservations and persistent call-review records remain proposed. No live KB, play, QA form, database schema, production run or deployment was changed.

Read with:

- [QA coverage and prioritized KB page list](sales_qa_kb_gap_analysis.md)
- [All active sales plays: dispositions and replacement set](sales_plays_audit.md)
- [QA database seed](../backend/scripts/seed_sales_qa_review_rules.sql) — 14 editable rule additions; applied to local qtip only

## 1. What the audit establishes

| Current evidence | Design consequence |
| --- | --- |
| 891 accessible KB page records; all 179 Account Executive pages plus 40 related pages fetched. Reviewer has six anchors and does not follow their branches. | Add a governed source map and conditional sections. Do not dump the whole book into every call. Most QA policy exists; some is contradictory or unfinished. |
| Eleven existing editable rubric rules preserved; fourteen QA additions now active in local qtip | Keep the rubric configurable, use database-owned QA definitions/rules, and prevent duplicate findings. Category keys route findings; they are not another scoring engine. |
| 72 active plays; up to 48 injected per call; 3,303 archived | Curate the library and retrieve zero to three applicable plays. Do not rank “best practice” by raw support count. |
| All active plays labeled WON; none retains a direct conversation link | Repair exact-opportunity outcome attribution and source membership before using plays as measured success evidence. |
| Current selection requires connected Sales talk time, configured minimum 100 seconds; maximum 400 candidates/run | This misses many no-contact attempts and short interactions. Publish coverage first; add a separate economical no-contact path rather than silently claiming every prior-day call was audited. |
| CRM history is bounded, with phone-based matching and day-wide fallback | Exact linkage and history coverage must be explicit. Missing records cannot become proof of missing work. |
| KB budget is 48,000 characters; transcript 24,000 characters; each CRM thread is bounded to 25 notes/6,000 characters | These are retrieval limits, not a global model token budget. Head/tail transcript clipping can remove relevant behavior. A larger context window does not solve evidence completeness. |
| Settings: $15 review cap, reasoning tier; $50 monthly play-mining cap | These are observed settings, not a verified hard combined cap. Current in-flight calls and reruns require better accounting. Model choice should be calibrated, not inferred from provider branding. |

## 2. Database-owned QA guidance and rules

The mandatory ownership rule is in [.cursor/rules/runtime-configuration.mdc](../.cursor/rules/runtime-configuration.mdc), linked from AGENTS.md and .cursorrules. Editable business content belongs in the database. Application code owns algorithms, validation, output contracts and fixed technical guardrails. Markdown planning documents and audit reports are not runtime configuration.

### Revised local correction

The Markdown loader, packaged reference, path environment setting, synthetic read-only rules and file-backed report-label fallbacks have been removed. Rules load from the existing ie_missed_opportunity_rule table; the persona and other settings continue using ie_config and the existing Admin → Insights Engine editor. Runtime does not read this specification, the KB work list or a local form snapshot.

The [SQL seed](../backend/scripts/seed_sales_qa_review_rules.sql) contains only the fourteen QA review categories introduced by this task. Each includes its actual supplied question/gate requirements, known defects, coaching interpretation and guidance, so no attached file is needed. Applying it inserts missing keys into the existing rule table. It leaves existing keys and operator edits untouched, adds no tables/columns, and changes no forms, persona, KB pages or plays. A QA rule gets a real database ID and is editable through the existing Rules editor. Legacy reporting keys remain stable.

**The seed was applied to the approved local target `localhost:3306/qtip` on 2026-09-14 at 09:12:42 EDT (13:12:42 UTC).** Fourteen active rules were inserted (IDs 22–35); all eleven existing rows were verified unchanged. Staging and production were not modified. Do not auto-seed on startup, during reads or as part of a build. Database text may use Markdown formatting in body_md/guidance_md; the restriction concerns runtime reference files, not rich-text storage.

### Form Builder remains the form authority

The QA form itself already lives in the database and is edited through Form Builder. The seed is a versioned coaching adaptation of the supplied snapshot, not a second scored form or an automatic live-form binding. A form change requires deliberate reconciliation of the database review rules until a generic binding is implemented. Missing or ambiguous policy cannot be replaced by a hidden file fallback.

A future form selection/binding belongs in database configuration, not an environment file or hardcoded form ID. An authorized backend adapter should load the selected form/version and its questions, conditions, applicability, N/A and visibility from existing form tables. Pin source versions for each run and reuse existing form utilities; do not special-case a particular version in TypeScript. Preserve known defective conditions rather than silently repairing them. Keep INTERNAL access and manager-only results separate from AE coaching; do not enable the form's separate AI reviewer.

If an approved compact requirement map is needed for cost, store it with its source version/hash and approval metadata in the database, using existing suitable storage first. Compile on source changes, not per call; validate that no gate or exception disappeared. Store adjustable selection rules and limits in database settings. The deployment process must explicitly report missing required database configuration in an environment; it must not manufacture replacement policy from files.

## 3. One bounded evidence packet per call

### Select and link

Use the existing business-calendar resolver for the prior business day in the report timezone. Treat `(conversation_id, reviewed_agent_id)` as the review unit; transferred calls must not attribute another AE's actions to the reviewed person. Deduplicate multiple queue/participant rows. List exclusions by reason: short call, no transcript, non-sales, excluded roster, unmatched identity, missing source, budget deferred or processing failure.

| Link level | Accepted evidence | Permitted use |
| --- | --- | --- |
| Exact | Verified CRM dial link with record kind and ID, linked conversation/participant, and matching account | Read the specific task/ticket and directly related lead history. A populated link still needs account/record validation. |
| Corroborated interim | Normalized far-end number plus independent business/contact detail, compatible task timing and a unique plausible record | Use as provisional context with visible confidence and evidence. Do not claim a system-exact link. |
| Ambiguous / unmatched | Shared number, multiple plausible leads, only a phone match or conflicting identity | Do not combine histories or guess a CRM reference. Call-only coaching is possible; documentation, research and lead-existence omissions remain unknown. |

Before CRM dial is available, filter out company/AE/internal numbers and use the direction-aware far-end participant. Compare candidate records; do not choose merely the newest open task. Search the actual account/lead and related Lead Manager or Contact Manager task, including completed tasks when needed. Day-wide AE notes can locate a candidate; unrelated customers' notes should not be injected into the final packet.

For CRM dial, agree the contract with that project: conversation ID, agent/participant, TASK or TICKET plus external ID, lead/account ID, created timestamp, link method and correcting actor. Preserve transfers and legitimate multiple related records. Adding links should improve the evidence packet without changing the coaching prompt. No CRM write is required to review an uncertain call.

### Keep three time views separate

1. **Before/during the call:** prior research, known need, prior offers/declines, agreed dates, open blockers and earlier lead existence. Only this view establishes what the AE could have known or completed already.
2. **Follow-through cutoff:** same-day quote, lead/task creation, notes, status, next contact and routing. Use the selected business day's end unless an approved note-entry grace policy specifies otherwise. A later note is evidence of documentation, not proof that words were said on the call.
3. **Recovery now:** a fresh status/ownership/preference check before outreach or a recovery suggestion is actioned. A later order can eliminate the need to recover while leaving an earlier coaching lesson intact. Never rewrite the original as-of review with future knowledge.

### Required packet sections and coverage

| Section | Include | Exclude / uncertainty handling |
| --- | --- | --- |
| Call facts | Time, direction, purpose/stage, product when known, reviewed speaker, full transcript or explicitly declared coverage | IVR/hold is not buyer speech; transcript start offsets alone cannot produce talk duration. |
| Matched record | Task/ticket identity, current-as-of-call status, due date, key account fields and relationship evidence | No account borrowing, full card details, unrelated AR history or nonessential personal data. |
| Prior commitments and discovery | First/relevant discovery, research evidence, accepted/declined offers, last customer commitment, unresolved objections, quoted scope | Older relevant work must survive a newest-notes limit. Maintain source note IDs, timestamps, author and changed/superseded status. |
| Same-day follow-through | Relevant task/ticket notes, lead creation across owners when appropriate, proposal/quote evidence and required routing record | “Created no lead today by this AE” does not prove no suitable lead exists. Daily Tracker or email-dependent requirements are unknown if those systems are unavailable. |
| Governing guidance | Applicable form requirements, rubric, linked KB sections including exceptions, zero to three approved relevant plays | Missing KB details cannot be invented. A title/link without content is not evidence of a script or rule. |
| Source manifest | Source IDs/versions, fetched/as-of times, match basis, counts, truncated/failed fields and exact included spans | Do not encode unavailable as empty. No negative inference from an omitted region. |

Use selective database queries and an approved KB index before the LLM call. Initial retrieval defaults: inspect up to 100 note metadata rows per matched thread within a two-year lookback, carry pinned research/commitments from older history where available, and select at most 12 relevant note excerpts across linked threads. These are proposed configurable caps, not proof of complete history. Show omitted counts/time range and set affected checks to unknown when prior completion cannot be established. Avoid another summarizing LLM for every call; cache versioned account summaries only when their underlying notes and as-of cutoff are unchanged.

## 4. Review, evidence validation and AE output

One analysis request should identify purpose, resolve applicability, record observable behaviors/metrics, and return a compact call summary with zero to three distinct findings. Evaluate required steps and genuine commercial openings; the minimum is not a dollar-loss claim. Company policy and documented exceptions govern; the rubric identifies the finding type. Plays and external benchmarks guide coaching. Conflicts go to a manager queue, not an automatic AE failure.

Apply disconfirmation before publishing a miss: Was it done earlier? Offered and declined? Still blocked by an actual prerequisite? Completed in another valid record? Outside this flow? Prevented by customer preference? Missing because the transcript/CRM/KB is incomplete? Resolve or withhold the finding accordingly. A quote showing an opportunity is not proof that no offer was made elsewhere in the call.

Required output contract:

| Field | Content |
| --- | --- |
| Review identity / status | Conversation and AE, linked record/confidence, reference versions, reviewed/partial/unassessable/failed/deferred. Include calls with no findings so management has a denominator. |
| Interaction summary | Two or three sentences: customer need, relevant history, AE response, outcome and existing commitment. No need to generate a long transcript recap. |
| Specific miss | Requirement/opening, why applicable, observed action or omission, supporting timestamped source span, question/rubric/KB citation, confidence and consequence. |
| Next time | One reusable behavior and natural wording that fits the call. Avoid generic “ask more questions.” |
| Recovery | Whether appropriate; owner, first feasible action, timing consistent with permission/policy, what to say/ask, intended commitment and CRM update. If none, state a short reason. |
| Metrics / limitations | Defined counts and coverage, including unknown/N/A. No fabricated QA score, lost revenue or success probability. |

Example (illustrative, not an actual employee finding): The buyer requested a player for a second store and said other sites use a different service. The AE handled the immediate order but did not explore the other sites; the matched history does not already cover them. **Next time:** “Which other locations do you oversee, and how is the current music setup working there?” **Recovery:** After checking current CRM status and routing rules, the AE reconnects at a permitted time, refers to the buyer's comment, confirms the unsold scope and proposes a suitable next step. If that opportunity is already open under another owner, coordinate instead of creating a duplicate.

Validate JSON schema, allowed keys, citation membership, speaker attribution and quote spans in code. Metrics must agree with cited utterances. For an omission or disputed inference, permit at most one targeted verification call with the proposed requirement, applicable policy, relevant full evidence and prior/same-day context. The existing verifier sees the transcript alone and can confuse an attempted step with a fully satisfied requirement; update it before relying on it for QA completeness. If verification fails or cannot inspect sufficient evidence, mark the finding unverified and keep it out of published failure counts.

No automatic customer/AE messaging, CRM task creation or recovery execution is included. Existing report access rules apply. Keep manager-only detail and uncertain matches out of AE-facing factual assertions. Maintain correction history so a manager or AE can dispute a bad match or inaccurate finding.

## 5. Management metrics: small first release

**Track counts and ratios; set expectations by interaction.** Use the same definitions for every AE. Do not confuse a mandatory script question with an external benchmark. Full benchmark context and primary-source links are in the [KB analysis](sales_qa_kb_gap_analysis.md#4-external-benchmark-basis-and-limits).

| Measure | Definition / source | Management use |
| --- | --- | --- |
| Questions asked | Count distinct AE requests for information/confirmation in complete reviewed speech; separately count substantive discovery and responsive follow-ups. Exclude rhetorical questions, repeated transcript fragments and simple backchannels. | Raw count and distribution by purpose/duration; identify either thin discovery or an interrogation. Count quality matters more than hitting a total. |
| Required-topic completion | For the selected flow: satisfied on this call, satisfied in valid prior history, missed with evidence, N/A, unknown. Completed / assessable applicable topics; always display unknown count. | Track actual company-required coverage without requiring the AE to re-ask known facts. CM's three growth topics remain specific to its applicable branch. |
| Buyer participation | Seller seconds / (seller seconds + buyer seconds), plus eligible-call count. Use verified speaker intervals, not words or total connected time. | Compare similar call types; show median and spread. A demo, voicemail and short order have different speaking needs. |
| Responsive discovery | Number of AE questions that develop a buyer's immediately preceding substantive answer, with source spans | Identify whether the AE follows the customer's issue instead of reciting a script. Show examples alongside count. |
| Clear next commitment | Applicable open opportunities with customer-understood next action/owner/timing / assessable applicable opportunities | Show agreed on call separately from internal NDC entered and later promise fulfilled. |
| Relevant offers / expansion capture | Appropriate offers attempted / applicable assessable openings; verified new/updated opportunity records / identified actionable openings | Separate warranty, relevant upsell and net-new sites. Declined offers count as attempts; no applicable opportunity is N/A. |
| Recovery follow-through | Due recoveries completed on time / recoveries due; also unresolved and deferred, with reasons | Track subsequent confirmed advancement/orders separately. An AI recommendation is not completed recovery or recovered revenue. |
| Review reliability and coverage | Reviewed / eligible; incomplete, failed, deferred, unmatched; accepted/corrected findings; cost/review | Management can see what the system did not assess. Zero findings is not the same as full compliance. |

Counting contract: “How many locations, and what are you using for music?” is one speaking turn containing two information requests and covers two topics. Store utterance IDs and semantic units so duplicate audio or rephrased fragments are not double-counted. A necessary clarification can be another information request; repeating the same requirement does not increase topic completion. Numeric extraction returns unknown if the transcript is materially incomplete. The LLM classifies question purpose in the same review response; code totals the cited units. A punctuation-only counter may be used for diagnostics, never as the authoritative question count.

For timing, merge overlapping intervals within each speaker/channel, remove IVR/hold/silence, and measure non-overlapping seller/buyer speech; record cross-talk separately. Multi-AE calls need participant attribution or a team-level metric, never a guessed individual ratio. If phrase-end/duration data is absent, show unavailable. The current transcript renderer exposes phrase start times but does not establish complete interval durations; confirm raw phone payload support before implementing this measure. Do not label word share as talk time. Avoid inferring interruptions from start offsets alone.

Start with fixed **topic checklists**, not invented universal totals: the existing inbound opening obtains locations and current source; the applicable CM flow asks about projects, audio systems and unsupported locations/brands. Add purpose/impact, approval and timing where the actual flow requires them. Track actual question totals on all assessable contact-made calls. For a first two-week baseline, do not turn Gong's numerical ranges into QA thresholds; managers can then approve per-flow coaching bands with examples and exceptions in B2. No automatic failure or compensation decision should be driven by a raw count/ratio alone.

Default cohorts: inbound discovery, outbound inquiry/prospecting, CM/expansion, proposal/close, fulfillment/service and no-contact. Within contact-made, separate under 5, 5–10 and over 10 minutes; compare like opportunity scope and lead source when sample size permits. Use rolling 30-day trends, sample counts and uncertainty. Suppress comparative AE ranking below 20 eligible calls in a cohort as a proposed starting rule; do not make many tiny combinations or claim a top-decile benchmark without representative outcome data.

Keep the first manager view to coverage/cost, discovery coverage, next commitments, relevant offers and recovery completion; expose question counts, talk share and examples on drill-down. One weekly coaching theme per AE is more usable than a new composite “hunter score.” Add longest monologue/interactivity only after reliable speaker timing exists and a manager identifies a decision it improves.

## 6. Cost and context limits

These are **proposed engineering limits for the next release**, not claims about today's effective prompt size or guaranteed provider pricing. Measure with the selected model's tokenizer and actual billing data. Fetching a shared block once saves retrieval work; it does not by itself avoid repeated input charges.

| Packet allocation | Initial ceiling (input tokens) |
| --- | ---: |
| Contract + applicable database form/rubric + relevant KB + selected plays | 5,000, including at most 750 for zero to three plays |
| Transcript | 8,000 |
| Prior/same-day CRM evidence + source manifest | 3,000 |
| **Ordinary review total** | **16,000** |

Allow unused allocation to move between sections while enforcing the total. Reserve up to 2,000 output tokens for the ordinary review. A long/complex call may use one explicitly admitted 24,000-input / 3,000-output request when the daily reservation permits; do not silently discard the middle and conclude an omission. If full decisive evidence does not fit, review observable events only and mark coverage partial, or defer for manager review. At most one targeted verification request (up to 4,000 input / 1,000 output) and one schema repair (up to 2,000 input / 1,000 output) are allowed, reserved in advance. No recursive rereview, background agent fan-out, per-call web search or provider switching loop.

- Build/cache the approved reference and KB sections by content hash/version once per change. Select by explicit flow/product/rule metadata, not a free-ranging retrieval agent. Fetch only configured domains/pages and approved direct dependencies; cap at one dependency level and 12 page fetches per refresh bundle. Larger catalogs can be refreshed in bounded batches, never by crawling the KB during every call.
- Cache call evidence by conversation/agent, transcript version, CRM as-of/hash and policy/rubric/play versions. Reuse identical results on reruns; changed notes or policy invalidate only affected work. Never reuse another day's recovery status as current.
- Use one calibrated primary model. Start with the existing configured tier, compare a cheaper tier on the same labeled sample, and switch only if accuracy meets the same gates. Keep numerical durations and aggregation deterministic.
- Before dispatch, atomically reserve worst-case input/output plus permitted verification, repair and provider retries. Aggregate across concurrent workers and manual reruns under a defined local spend day; also track review date separately so a historical rerun cannot get a fresh allowance. Release unused reservations after actual usage. If rates are unavailable or budget cannot be reserved, defer rather than assume zero cost.
- Record input/output/cache usage, model, attempts, latency and cost per review. Use `estimated_cost = input_tokens × input_rate + output_tokens × output_rate` with consistent rate units and all ancillary calls included. Provider-reported usage reconciles reservations; maintain a small configurable buffer rather than claiming exact billing equality.
- Retain $15/day as the initial review envelope unless management changes it. At 100 calls, the planning allowance is $0.15 per call; at 400 it is $0.0375, **not an estimate that the current model can achieve either**. Stop at budget and publish deferred counts. Do not silently use the cheaper model to exhaust coverage.
- The separate $50/month learning budget must include mining, canonicalization, validation and retries. Verify the current librarian path is accounted for; it is not enough to check the miner's cap. Do not automatically raise either budget to process a backlog.

## 7. Implementation sequence and acceptance

| Phase | Concrete work | Exit condition |
| --- | --- | --- |
| A — reference correction (local code and database) | Remove runtime Markdown layer; restore database-only editable rules/persona; insert 14 approved QA rules and add mandatory ownership guardrail | Code checks pass. Local qtip has 25 active rules; all 11 original rows were preserved. No staging/production seed, deployment or review rerun performed. |
| B — evidence and source control | Resolve priority KB conflicts; create source map; improve exact/interim linking, time views, completeness, compiled reference and selective KB/play packet; repair play provenance/outcomes and selective archiving | Reviewable replay shows the exact evidence/policy used; ambiguous account or incomplete omission evidence never produces a definitive failure. |
| C — one call-review record and metrics | Persist zero-finding reviews, coverage, versions, metrics and manager dispositions; implement token/cost reservation and structured output; add focused manager/AE display | Denominators reconcile with selected/excluded calls; money and review attempts reconcile; no-contact coverage accurately labeled. |
| D — calibrated rollout | Shadow review, adjudication, limited AE cohort, weekly behavior/recovery review | Meets agreed accuracy gates and useful coaching outcomes within budget; managers can correct findings and trace them. |

**Storage proposal, not a migration authorization:** existing run aggregates and finding rows cannot by themselves represent an assessed call with zero findings, individual metric unknowns, source versions and review corrections. First inspect reusable review/audit storage. If unsuitable, propose one `call_review` record per conversation/AE/as-of review version with typed summary fields and bounded versioned metrics/provenance JSON; let findings reference that review, preserving historical results. Store references and minimal redacted evidence, not another copy of full recordings or CRM history. Recovery/approval history and atomic spend reservations also need durable homes; reuse existing approved audit/config facilities if they meet query and concurrency needs. Bring exact fields, indexes, retention, access rules, additive/idempotent migration and rollback for explicit approval **before** altering the database. Do not use fake findings or arbitrary config rows to avoid this design decision.

For no-contact: identify genuine attempt using phone events/disposition and available voicemail content. Empty/missing audio cannot prove a failed attempt. Run deterministic attempt/cadence checks where evidence permits; use a compact AI review only for actual voicemail content and wording. Do not lower the existing 100-second setting and assume all unanswered dials will suddenly be selected.

Proposed shadow sample: at least 60 manager-labeled interactions covering inbound, CM/expansion, short calls, no-contact, prior discovery, declined warranty, valid CS transfer, wrong/shared phone match, missing history, multiple AEs and legitimate close blockers. Include clean calls as well as known misses. Hold out cases for final evaluation and repeat a subset three times to measure judgment consistency; repeated outputs are not a substitute for human labels.

Proposed release gates: at least 90% precision and 85% recall for material misses on the held-out labeled set; at least 95% agreement on applicability and mandatory-topic states; zero confirmed cross-account attribution errors or unsupported price/licensing claims in that set; 100% valid citations/schemas for published findings; at least 90% repeat agreement on finding identity/applicability. Validate question counts against labeled information requests (at least 95% exact agreement), and talk share within ±5 percentage points on manually timed eligible samples before showing it as measured. These are proposed product acceptance thresholds, not industry benchmarks; report sample size and uncertainty and extend testing when critical cases are sparse.

Monitor live correction rate and coverage by call type after release. A regression in source matching, policy integrity or budget enforcement pauses affected automatic findings and routes them to review. A clean result means no supported material miss within the stated coverage; it never certifies all QA questions as passed.

## 8. Boundaries that keep this manageable

Use one source per company rule, database-owned QA guidance, one call review, one primary model request, up to three findings and up to three relevant plays. Keep full source data available for drill-down, but send only the applicable evidence with explicit limits. Start with the five compact KB additions/indexes and existing-page repairs listed in the KB analysis. Finish accurate coverage, source matching and coaching before expanding dashboards, play mining or scoring.

The business test is concrete: can the AE understand the missed behavior, act appropriately on the account, and show better discovery, commitment and follow-through on comparable future calls? Track those outcomes alongside the metrics; do not mistake a higher question count or a larger play library for better selling.
