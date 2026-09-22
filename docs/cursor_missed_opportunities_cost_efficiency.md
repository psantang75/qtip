# Missed Opportunities: reduce cost while preserving review quality

Prepared September 18, 2026; updated the same day with measured dev figures after the CRM-correctness fix landed; updated September 22, 2026 with the measured caching result (§2) and the decision to decline tiered model routing (§5). Recommendation and Cursor implementation addendum only. **No production** application, model, database, scheduler, or settings were changed. The correctness fix and its accountability policy edits have since been applied **in dev**, which is where the updated initial-run measurements in §1 come from; production remains on the earlier baseline until separately authorized.

Read with [the salesperson/CRM correction brief](cursor_missed_opportunities_salesperson_crm_fix.md). Its accountability and correct-record requirements remain mandatory. Cost optimization must not restore CS-only sales credit, skip eligible calls, omit relevant lead/CM decisions, or conceal incomplete reviews.

## 1. What the production evidence shows

Production usage metadata was read without changing data. Costs below are estimates from logged token counts at the application's model rates, not a reconciliation to the provider invoice.

| Observation | Measured result |
|---|---:|
| Latest saved September 17 review | $8.0508; 68 considered, 67 analyzed, one failed |
| Latest main review requests | 68 Opus 4.7 requests; $7.92764 |
| Latest verification requests | 26 Haiku 4.5 requests; $0.123197 |
| Main-review input/output | 1,475,778 input / 21,950 output tokens |
| Average main-review prompt size | 64,723 characters; about 21,703 input tokens |
| Input share of the latest pass's total cost | About 93% |
| Earlier same-day window for the same 68 main reviews | About $8.038 including verification |
| Combined two review windows | About $16.089 |

The two sets of 68 main-review requests have identical `(case_id, model, pass, prompt_hash)` pairs. The first set was logged September 18 at 10:15:38–10:17:57 UTC; the second at 10:21:50–10:24:10 UTC. The repeated main requests alone cost $7.92764 on the second pass. Logs do not establish who initiated the rerun or whether it was deliberate; do not label this a scheduler defect without further evidence.

The saved daily row describes the latest review, while API logs include earlier attempts. It therefore does not describe all money spent reviewing that business date. The observed duplicate windows explain approximately $16 for this example; they do not establish that every normal day runs twice.

Other saved reviews were $4.1697 for September 15 and $9.9709 for September 16. Volume and prompt size differ, so do not compare these as equivalent workloads. Production currently has 11 active rules and **zero active sales plays**; reducing play injection would not save money in this production snapshot.

### Update — measured initial-run cost after the CRM-correctness fix (September 18, dev)

The salesperson/CRM correction has since landed on the working branch and its
editable policy edits were applied **in dev only**. A full dev regrade of the
September 17 business day was then measured from `ai_call_logs`. This is the
number that matters for the initial daily run going forward, because the
correctness fix changed what each prompt carries:

| Observation | Earlier 9/17 baseline (above) | Full 9/17 dev run, fix active |
|---|---:|---:|
| Main requests (Opus 4.7) | 68 | 66 |
| Average main prompt | 64,723 chars / ~21,703 input tok | **135,510 chars / ~47,055 input tok** |
| Main prompt floor / ceiling | not recorded | **122,826 / 157,978 chars (41,931 / 54,690 input tok)** |
| Total main input / output tok | 1,475,778 / 21,950 | **3,105,618 / 26,753** |
| Verification (Haiku 4.5) | 26 reqs; $0.1232 | 26 reqs; ~$0.128 |
| Estimated run cost | ~$8.05 | **~$16.33** (reconciles to the worker's logged $16.3251) |

Two facts drive the whole caching case and both are now measured, not assumed:

1. **The initial daily run roughly doubled** — from ~21.7k to ~47k input tokens
   per call — because each prompt now supplies the validated lead/CM note thread,
   a separate operational-ticket block, and coverage accounting that the old
   linkage never assembled. This is the *correct* cost of grading the right
   record; it is not waste to be cut, and §4/§6 still forbid trimming evidence to
   save money.
2. **A large, constant prefix now sits under every call.** The main prompt never
   drops below ~41,931 input tokens across all 66 calls, and the per-call
   variable part (transcript + that call's CRM evidence) averages only ~5k tokens
   on top of it. A ~42k-token block that is byte-identical on every request is
   precisely what provider prompt caching bills once and reads cheaply — so
   caching is now a **larger** dollar lever than the original ~$8 estimate
   implied, not a smaller one.

## 2. First priority: cache the shared prompt, retaining Opus

**Status (September 18): implemented on the working branch.** The wrapper now
sends the shared system prefix as a cache-eligible block and the cost plumbing
prices cache reads/writes separately. See "Implementation landed" below.

The worker builds a shared system prompt containing the persona, rules, and KB grounding, then sends it with each call. Fetching KB content once per run saves retrieval work but does **not** make repeated model input free. The Anthropic wrapper previously passed a plain system string and no `cache_control`.

Explicit provider prompt caching now marks the end of the stable shared system content. Per-call transcripts, salesperson identity, CRM notes, and changing timestamps stay after that boundary in the `user` message. The same instructions and evidence are preserved; no lossy summarization was needed for this saving.

### Implementation landed (September 18, dev branch)

- `callChatModel` takes `cacheSystem?: boolean`; when set (Anthropic), the whole
  `system` string is sent as one `cache_control: { type: 'ephemeral' }` text
  block. The missed-opportunities main pass (`analyzer.ts`) and verification
  pass (`verify.ts`) both set it. The AI Reviewer path is untouched (flag
  defaults off).
- `ChatModelResult` now surfaces `cacheWriteTokens` / `cacheReadTokens`, and
  `tokensIn` is the TOTAL input (uncached + write + read) so token reporting
  stays comparable to pre-cache runs.
- `aiCostEstimator.estimateUsdCost` accepts optional cache read/write counts and
  prices them at `0.1×` (read) and `1.25×` (5-min write) of the model's base
  input rate; omitting them reproduces the old uncached math exactly, so every
  non-caching call site is unchanged.
- `withCallLog` derives uncached input as `tokensIn − cacheRead − cacheWrite`
  and feeds the split to the estimator. `ai_call_logs.tokens_in` still records
  total input — **no schema change**.
- Per-call cache usage is logged (`prompt cache read=… write=…`) so real hits
  are confirmed from the provider usage fields, not the request flag.
- Measured and delivered (September 22, dev) — see "Measured saving" below. The
  earlier caveat that this remained an unvalidated projection no longer applies.

For Opus 4.7, published cache-hit input pricing is $0.50/million versus $5/million ordinary input; a five-minute cache write costs $6.25/million. This reduces the price of the **cached portion**, not the entire request. Output is still charged normally. [Provider pricing](https://platform.claude.com/docs/en/about-claude/pricing).

Implementation requirements:

- Keep the shared prefix deterministic and versioned. Exclude current time, call identity, random ordering, and unrelated per-call data from it.
- Start with a five-minute cache for the observed short run, measuring refreshes/hits. Avoid unnecessary one-hour write premiums unless gaps require them. Initial concurrent requests may all miss before the first cache entry exists; account for that rather than assuming a perfect hit rate.
- Verify model-specific cache eligibility/minimum length. Confirm real hits through usage fields, not just the presence of a request flag.
- Extend the provider response/cost plumbing to record uncached input, cache creation by TTL, cache reads, output, and applicable batch rates. The current wrapper/logger/estimator only account for `input_tokens` and `output_tokens`; after enabling caching that would undercount cost because cached input is reported separately.
- Preserve total context-token metrics separately from billable token categories. Test cold cache, warm cache, expiry, changed rules/KB, and unchanged per-call output contracts.
- These are provider mechanics. Keep operator-editable settings in the existing approved configuration mechanism; do not make this Markdown a runtime source.

Anthropic documents the prefix and usage-field behavior in its [prompt-caching guide](https://platform.claude.com/docs/en/build-with-claude/prompt-caching).

### Illustrative cost, not a measured saving

Recalculated against the **measured** post-fix initial run (§1 update): 66 main
Opus calls, $15.528 main input, $0.669 main output, ~$0.128 verification,
~$16.33 total. The measured prompt floor (~41,931 input tokens shared by every
call, versus a ~47,055-token average) implies a stable input share `s` of roughly
**0.85–0.89** — high, because the persona, the 11 rule bodies, and the KB
grounding block are identical on every request. That is the constant prefix
caching bills once and reads cheaply.

At `s = 0.85–0.89`, one five-minute cache write plus 65 hits gives approximately
**$4.1–$4.7 for one full initial run**, including unchanged output and
verification — a ~70% reduction off the ~$16.33 base. The absolute saving is now
*larger* than the original ~$8-base estimate suggested, even though the
percentage is similar. Use **about $4–$5 per comparable full run** as a
validation target, not a guaranteed budget: the true prefix share still has to be
confirmed by logging the system-block token count directly (the ~42k floor is an
upper bound on the cacheable prefix, since even the smallest call adds some
per-call evidence on top of it).

Calculation: `main_input_cost × [(1 − s) + s × (1.25 + 65 × 0.10) / 66] + main_output_cost + verification_cost`, where `s` is the stable input share (here inferred from the measured floor, not assumed). Different volumes, rule sets, KB size, complete CRM evidence, and cache misses change the result.

### Measured saving (September 22, dev regrade of the September 21 business day)

The projection above is now confirmed against a full dev run, read from
`ie_missed_opportunity_run` and `ai_call_logs`:

| | 9/17 dev run (pre-cache) | 9/21 dev run (cache active) |
|---|---:|---:|
| Calls analyzed | 63 | 79 |
| Input / output tokens | 3,171,701 / 31,875 | 3,774,540 / 33,297 |
| Run cost | $15.8976 | **$5.4173** |
| Cost per analyzed call | $0.2523 | **$0.0686** |
| Effective rate per million input tokens | $5.01 | **$1.44** |

The per-million-token rate is the load-bearing comparison, because it is
unaffected by the differing call counts: the pre-cache run paid Opus 4.7's full
$5/million input rate, and the cached run pays $1.44/million. That is a **73%
reduction in cost per call**, and the cached run cost less in absolute dollars
while grading 16 more calls. Normalized to the 66-call workload used in the
projection above, $5.4173 becomes about $4.53 — inside the $4–$5 target.

Caveats to respect when citing these figures:

- This is not a controlled A/B. The two runs cover different business days with
  different call mixes, and the verification pass gained rule-exclusion
  enforcement between them. Treat the per-call dollar figure as indicative and
  the per-million-token rate as the reliable measure.
- `ai_call_logs.tokens_in` remains TOTAL input, so the cache read/write split is
  not recoverable from the database alone; the hit rate itself was not measured
  directly from provider usage fields on this run. The run-level cost is
  consistent with a high hit rate but does not prove a specific one.
- Both figures are application estimates at the configured model rates, not a
  reconciliation to the provider invoice.

## 3. Second priority: reuse valid unchanged results on reruns

**Priority note (September 18):** by owner direction, a full day is normally
graded **once**; reruns are occasional (a rule recalibration or an incident), not
routine. So the savings here are real but bounded — they apply to the exception,
not the daily bill. Optimize the **initial run of the day** first (§2 caching),
which is paid every day, before building rerun-reuse machinery. The per-run cost
cap is enforced per run and resets to $0 each time (confirmed in the worker), so
each rerun is a full paid rebuild today; that is the cost this section would
avoid when a rerun does happen.

The worker currently initializes spend to zero, reselects/reviews calls, and replaces that day's findings. It has no reusable per-call review-result path. A budget check per run does not prevent repeated spend across reruns.

Implement safe incremental review rather than treating every rerun as a full paid rebuild:

- Key reusable evidence/results by conversation **and reviewed salesperson**, model/request settings, exact transcript/attribution, verified CRM evidence and cutoff, rule/persona/KB versions, and the relevant analyzer/parser/verifier contract versions.
- Reuse only completed valid results whose dependencies are unchanged. Retry failed, unparseable, incomplete, or changed calls. Include valid zero-finding reviews so those calls are not repeatedly paid for.
- Preserve the distinction between a provider-success log and a valid parsed/verified review. The September 17 run has one failed review even though a model may have responded; an API success flag alone is insufficient for reuse.
- If only parsing/validation code changes and a safely retained compatible raw response is available, revalidate without buying the same inference again. If policy/evidence/model semantics change, invalidate the affected analysis.
- Provide an explicit forced recompute for authorized calibration/model comparison; show its estimated incremental spend. Identical requests may have been deliberate during debugging, so do not disable legitimate recalibration.
- Combine reused and newly reviewed results into a complete day before publishing. Never replace the day with only the retry subset or erase prior successful findings when a retry fails.
- Capture attempt identity, business review date, reused/new/failed counts, attempt cost, and cumulative cost across attempts. Reuse suitable existing storage first; propose any required schema change under AGENTS.md before applying it.

The historical $7.93 repeated main-call cost is an opportunity estimate, not a claim that every repeated request was safely reusable: failed reviews and changes in analysis contracts must be handled correctly.

## 4. Reduce irrelevant context without reducing evidence coverage

After resolving the correct salesperson lead/CM, retain all relevant substantive notes, authors, dates, decisions, and exceptions. Avoid sending unrelated accounts or support discussions as if they were sales-credit evidence.

- Perform identity resolution, duplicate traversal, date normalization, note deduplication, and source labeling in code. These do not require a reasoning-model call.
- Deduplicate mirrored events and exact repeated text while retaining provenance. Remove IVR/hold boilerplate only when reliably identified; do not discard another participant's material that is needed to understand a transfer.
- Keep the active rubric and its exceptions available to every eligible review. Conditionally select product-specific KB detail without removing applicable requirements; uncertain applicability must broaden retrieval.
- Retrieve full relevant lead/CM history for coverage, then supply source-linked relevant excerpts or a validated topic index. Do not equate “retrieved from DB” with “all assessed by the model,” and do not blindly shorten the existing note limit to save money.
- If approved plays are later enabled, retrieve only applicable examples. They are optional coaching aids, not the rubric; currently there are none active in production.
- Avoid adding a separate classifier/summary/extractor call for every interaction unless measured end-to-end savings and quality justify it. A cheaper extra pass can cost more overall and hide exceptions.

Caching is the first recommendation because it preserves content and the existing model. Context restructuring must be calibrated against complete evidence before replacing the current input.

## 5. Optional later savings

**Batch the main analysis when the delivery deadline permits.** The provider's Message Batches API offers 50% off standard API token prices, but completion may take up to 24 hours and some requests can expire. At the observed workload, batching the main pass while keeping verification synchronous would be about **$4.09 without prompt-cache savings**. Implement submit/resume/result handling and per-request retries; keep manual urgent reviews synchronous. Batch/prompt-cache discounts can interact, but cache hits are not guaranteed across an asynchronously scheduled batch. Do not promise a fixed morning report deadline based on typical batch latency. [Batch documentation](https://platform.claude.com/docs/en/build-with-claude/batch-processing).

**Consider cheaper-model routing only after calibration.** The existing cheap tier selects Sonnet 4.6; its published $3/$15 input/output rates are 40% below Opus 4.7's $5/$25 for equal token counts. Tokenization and output behavior differ, so this is not a guaranteed 40% workload saving. The code comments describe prior over-flagging with the cheap tier; treat that as a reason to measure before switching, not as a validated permanent limitation. [Current rates](https://platform.claude.com/docs/en/about-claude/pricing).

Do not blindly run a cheap review then Opus on every positive. That pays twice on difficult cases and can miss false negatives from the first pass. If routing is introduced, validate independent routing signals, escalate ambiguity, and audit a sample of apparently clean calls. Keep Opus for cases whose correctness has not been demonstrated on the cheaper route. A model change is not necessary to achieve the first savings.

### Decision (September 22): tiered "waterfall" routing not pursued

A cheap-first / escalate-on-positive waterfall was considered as the next cost
lever and **declined** on the measured evidence, not on principle:

- The premise was that ~$16/day was mostly re-sent boilerplate. Caching removed
  that at no cost to evidence or accuracy, taking the run to $5.4173.
- Of what remains, roughly $0.83 is output tokens, which routing does not
  address. Most of the remaining input is already billed at the cache-read
  tenth-rate. The genuinely per-call portion is about 5k tokens of transcript
  and CRM evidence — the material §4 and §6 forbid trimming.
- So a waterfall would add a second call per case to pursue a small remainder
  while introducing false-negative risk. A cheap first pass that misses a real
  miss produces silence, which no downstream check can catch, unlike a false
  positive that a reviewer sees and disputes.

Revisit only if per-call volume grows substantially or a cheaper model is
independently calibrated against a manually reviewed set under §7. Request
batching (above) remains the honest next lever: a flat 50% reduction with no
accuracy risk, paid for in up to 24 hours of latency.

## 6. Preserve the checks that are already inexpensive

The observed Haiku verification cost is only about **1.5% of the latest run**. Removing it saves roughly twelve cents and weakens quality controls; improve its salesperson/lead/CM evidence instead. Similarly, lowering output limits has limited upside when input dominates, and truncated JSON can create paid failures.

Do not save money by raising the minimum talk-time threshold, omitting agents, sampling the daily review, limiting findings before verification, or treating unavailable CRM history as clean. A smaller daily cap merely stops work sooner; it does not make the same review more efficient.

## 7. Cost controls and acceptance criteria

Use atomic cost reservations that account for in-flight analysis/verification, reconciliation to actual usage, retries, and cumulative attempts. Current concurrency is four and the spend check occurs before a call using cost already completed; the observed $25 setting is therefore not a strict cumulative daily ceiling. Any budget stop must leave coverage explicit.

Before accepting an optimization:

1. Show per-run and cumulative spend, including cache categories, main/verification passes, failed calls, reruns, and any separately running play-mining job. Provider invoices and app estimates must be distinguishable.
2. Compare against a manually reviewed set with the corrected salesperson policy: Jason warranty, Lakeland attribution, wrong-account links, duplicates, dated next steps, and prior lead/CM exceptions. Include unflagged calls to measure false negatives, not just flagged findings.
3. Report accuracy, recall of known misses, wrong-customer links, attribution errors, incomplete reviews, eligible-call coverage, latency, and cost per completed review. Cost reduction is acceptable only with the same required coverage and no material quality regression.
4. Measure the actual stable-prefix share/cache hit rate and the incremental saving from rerun reuse. Do not add overlapping savings percentages or extrapolate a debugging rerun to every business day.
5. Keep existing source/CRM repair work intact. Prepare a targeted implementation and necessary database/configuration diffs; applying DB changes, deployment, and a paid production regrade require their separately authorized scope.

Suggested implementation order, weighted to the once-a-day initial run:
**accurate usage accounting (uncached/cache-write/cache-read/output categories) [done] → same-model prompt caching of the ~42k-token shared prefix on the initial daily run [done, measured September 22: $15.90 → $5.42] → validated context cleanup → optional batching [model routing declined, see §5] → safe rerun reuse (last, since reruns are occasional per §3)**. Keep the salesperson/CRM repair as a correctness prerequisite for interpreting quality results.

Main files to inspect: `backend/src/services/ai/ChatModelClient.ts`, `backend/src/services/aiCallLogger.ts`, `backend/src/services/aiCostEstimator.ts`, `backend/src/workers/MissedOpportunitiesWorker.ts`, and its `backend/src/services/insights/missedOpportunities/` prompt, evidence, settings, and persistence helpers. Extend existing modules rather than introducing a second review pipeline.
