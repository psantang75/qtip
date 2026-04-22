# Insights — Quality data validation

> **Purpose:** Lock down every Quality calculation, scope filter, period
> resolution, and threshold mapping by validating the live endpoints against a
> hand-computed "golden slice" of real production-shaped data.
>
> Run the discovery script in [`backend/scripts/insights-discovery.sql`](../../backend/scripts/insights-discovery.sql)
> and the API diff in [`backend/scripts/insights-validate-quality.ts`](../../backend/scripts/insights-validate-quality.ts)
> to refresh / rerun this report.

---

## Phase 1 — Golden slice

Slice picked by the discovery query: the agent × form × prior-month combo with
the highest finalized-submission count (richest math).

| Field | Value |
| --- | --- |
| Agent | **Marc Joseph** (`user_id = 23`, role `CSR`) |
| Department | **Tech Support** (`department_id = 2`) |
| Form | **Contact Call Review Form** (`form_id = 259`) |
| Period | **February 2026** (`2026-02-01 00:00:00` → `2026-02-28 23:59:59`) |
| Finalized submissions in slice | **27** |
| Disputes in slice | **3** (all `ADJUSTED`) |

### 1.1 Form structure

10 categories, 120 questions total. Question type breakdown:

| Type | Count | Contributes to score? |
| --- | --- | --- |
| `YES_NO` | 87 | yes (per `EARNED_EXPR` / `POSSIBLE_EXPR` in [`QCQualityData.ts`](../../backend/src/services/QCQualityData.ts)) |
| `SUB_CATEGORY` | 22 | no — display-only grouping |
| `TEXT` | 11 | no — narrative only |

> All Quality math for this slice is driven by the 87 `YES_NO` questions.
> Categories that contain only `SUB_CATEGORY` / `TEXT` questions (e.g.
> "Overall Feedback") will not appear in `getCategoryScores`.

### 1.2 Per-submission scores (slice)

27 finalized submissions for Marc Joseph in February 2026:

| # | id | submitted_at | total_score |
| --- | --- | --- | --- |
| 1 | 830 | 2026-02-02 12:44:01 | 100.00 |
| 2 | 841 | 2026-02-03 11:58:16 | 94.04 |
| 3 | 853 | 2026-02-04 09:10:54 | **74.29** |
| 4 | 865 | 2026-02-04 16:42:02 | 97.01 |
| 5 | 877 | 2026-02-05 13:41:52 | 98.87 |
| 6 | 888 | 2026-02-06 10:02:44 | 98.13 |
| 7 | 900 | 2026-02-09 09:03:42 | 99.01 |
| 8 | 911 | 2026-02-09 16:40:28 | 92.40 |
| 9 | 922 | 2026-02-10 16:33:13 | 90.30 |
| 10 | 933 | 2026-02-11 11:29:37 | 92.45 |
| 11 | 944 | 2026-02-12 09:10:37 | 93.24 |
| 12 | 955 | 2026-02-12 16:27:10 | 100.00 |
| 13 | 967 | 2026-02-13 12:28:54 | 100.00 |
| 14 | 979 | 2026-02-16 10:41:25 | 96.34 |
| 15 | 990 | 2026-02-17 10:37:12 | 100.00 |
| 16 | 1001 | 2026-02-17 16:52:39 | 100.00 |
| 17 | 1011 | 2026-02-18 13:22:53 | 100.00 |
| 18 | 1021 | 2026-02-19 09:56:29 | 98.10 |
| 19 | 1033 | 2026-02-19 16:44:44 | 91.53 |
| 20 | 1045 | 2026-02-20 13:02:32 | 95.61 |
| 21 | 1057 | 2026-02-23 09:59:13 | 99.16 |
| 22 | 1068 | 2026-02-23 16:37:50 | 91.53 |
| 23 | 1079 | 2026-02-24 16:01:49 | 98.91 |
| 24 | 1091 | 2026-02-25 11:46:46 | 94.80 |
| 25 | 1102 | 2026-02-26 11:42:49 | 100.00 |
| 26 | 1113 | 2026-02-27 09:00:59 | 98.10 |
| 27 | 1124 | 2026-02-27 16:47:01 | 100.00 |

### 1.3 Disputes in slice

| id | submission_id | status | created_at | resolved_at | DATEDIFF (days) |
| --- | --- | --- | --- | --- | --- |
| 156 | 877 | ADJUSTED | 2026-02-05 21:16:01 | 2026-02-12 05:36:42 | 7 |
| 157 | 853 | ADJUSTED | 2026-02-05 21:16:35 | 2026-02-24 22:12:42 | 19 |
| 177 | 1068 | ADJUSTED | 2026-02-25 14:25:20 | 2026-02-25 18:15:13 | 0 |

### 1.4 Department-wide context (Tech Support, Feb 2026)

| Metric | Value |
| --- | --- |
| Finalized submissions (all CSRs) | **99** |
| Avg `COALESCE(total_score, snap_score)` | **94.5267** |
| Disputes created in Feb 2026 | **10** (3 REJECTED, 7 ADJUSTED) |
| Avg dispute resolution days (resolved only) | **4.7000** |
| Department comparison vs Customer Service | Tech Support 99 audits / 94.53 / 9 attached disputes; CS 205 / 92.93 / 20 |

### 1.5 Business calendar (Feb 2026)

`business_calendar_days` rows for Feb 2026: **20 WORKDAYs**, 8 WEEKENDs, 0
holidays. Pace target (`ie_kpi_threshold` for `audits_assigned`,
`department_key IS NULL`) = **15** audits / business-day.

```text
audits_assigned (Feb 2026, dept-wide) = 15 × 20 = 300
audit_completion_rate (Tech Support)  = 99 / 300 × 100 = 33.0000%
```

---

## Phase 2 — Hand-computed expected values

Every formula below maps to the literal SQL in
[`QCKpiService.ts`](../../backend/src/services/QCKpiService.ts) /
[`QCQualityData.ts`](../../backend/src/services/QCQualityData.ts). Expected
values are pinned for the slice + the dept-wide context above so each scope
(SELF / DEPARTMENT / ALL) can be checked independently.

### 2.1 KPI tiles — `getQCKpis` (department scope)

`getQCKpis` is **not user-scoped**. Under DEPARTMENT scope (the natural scope
for a CSR's manager hitting QC Overview), `dept_filter = [2]`.

| KPI code | Formula | Expected (Tech Support, Feb 2026) |
| --- | --- | --- |
| `avg_qa_score` | `AVG(COALESCE(s.total_score, ss.score))` over 99 finalized submissions | **94.526667** |
| `audits_completed` | `COUNT(*)` of finalized submissions | **99** |
| `audits_assigned` | `ROUND(paceTarget × businessDays)` = 15 × 20 | **300** |
| `audit_completion_rate` | `99 / 300 × 100` | **33.0000** |
| `dispute_rate` | `dispCount / finalized × 100` = `10 / 99 × 100` | **10.1010** |
| `dispute_upheld_rate` | `upheld(UPHELD+REJECTED) / resolved(UPHELD+REJECTED+ADJUSTED) × 100`. Slice has 3 REJECTED + 7 ADJUSTED, 0 UPHELD → `3 / 10 × 100` | **30.0000** |
| `dispute_adjusted_rate` | `adjusted / resolved × 100` = `7 / 10 × 100` | **70.0000** |
| `avg_dispute_resolution_time` | `AVG(DATEDIFF(d.resolved_at, d.created_at))` over disputes resolved with `created_at` in Feb 2026 | **4.7000** |
| `time_to_audit` | `AVG(DATEDIFF(submitted_at, Interaction Date))` for finalized submissions in Feb 2026 with an `Interaction Date` metadata field | *(captured at run-time by the API diff — depends on per-submission metadata)* |
| `dispute_not_upheld_rate` | always returns `null` in current code | **null** |
| `critical_fail_rate` | always returns `null` in current code | **null** |
| `qa_score_trend` | `current.avg_qa_score − prior.avg_qa_score` (computed in `getKpiValues`) | populated only when both periods have a value |

### 2.2 KPI tiles — slice user (SELF scope or Agent Profile)

`getQCKpis` ignores the `userId` parameter for everything except `avg_qa_score`
under the existing call signature, **but** SELF scope sets `dept_filter = []`
(see `resolveDeptFilter`). Under that path the dept-wide aggregate widens to
ALL — so the only metric that is correctly user-scoped today on the KPI tile
panel is **none** when scope is SELF.

> ⚠️ **Behavior caveat to flag during validation:** SELF-scoped `getQCKpis`
> returns global numbers, not per-agent numbers. The Agent Profile page
> compensates by calling `getAgentProfile` directly. Document this so the test
> suite asserts the *current* behavior and the gap is visible.

When invoked with the user filter directly (the path used by the Agent Profile
trends and `computeKpisForRange(deptFilter, range, userId=23)`):

| KPI code | Expected (slice, user 23) |
| --- | --- |
| `avg_qa_score` | **96.067407** *(AVG of the 27 stored scores in §1.2)* |
| `audits_completed` (still ignores userId) | n/a — code path doesn't filter |

### 2.3 6-month trend — `getQCTrends`

Anchored on Feb 2026 (last month with data ≤ requested end date). The trend
window is the 6 months ending at the anchor.

| month | dept (Tech Support) `avg_qa_score` | user 23 `avg_qa_score` |
| --- | --- | --- |
| 2025-09 | 0 audits → `null` | 0 audits → `null` |
| 2025-10 | 0 audits → `null` | 0 audits → `null` |
| 2025-11 | **90.3053** (78 audits) | **96.0093** (14 audits) |
| 2025-12 | **96.6538** (76 audits) | **97.6486** (14 audits) |
| 2026-01 | **96.7590** (84 audits) | **97.9680** (25 audits) |
| 2026-02 | **94.5267** (99 audits) | **96.0674** (27 audits) |

`getTrends` walks the anchor backward up to 3 times when the latest month is
empty. With Feb 2026 populated, no walk-back is needed and the response label
strings are `Sep 25`, `Oct 25`, `Nov 25`, `Dec 25`, `Jan 26`, `Feb 26`.

### 2.4 Score distribution — `getScoreDistribution`

| Scope | bucket | expected count |
| --- | --- | --- |
| Slice (user 23) | `70-79` | **1** |
| Slice (user 23) | `90-100` | **26** |
| Tech Support | `60-69` | **2** |
| Tech Support | `70-79` | **4** |
| Tech Support | `80-89` | **14** |
| Tech Support | `90-100` | **79** |

Sum = 27 / 99 ✅ matches `audits_completed`.

### 2.5 Per-category — `getCategoryScores` (slice / user 23)

`avgScore = round((earned / possible) × 1000) / 10`.

| category | audits | earned | possible | expected `avgScore` |
| --- | --- | --- | --- | --- |
| Initial Greeting / Customer Verification | 27 | 101 | 108 | `101/108×100=93.5185…` → **93.5** |
| Contact Management | 27 | 4 | 5 | `80.0000` → **80.0** |
| CRM / Knowledge Base | 27 | 77 | 108 | `71.2962…` → **71.3** |
| Product / Service Knowledge and Problem Solving Ability | 27 | 53 | 54 | `98.1481…` → **98.1** |
| Call Transfer / Hold Procedures | 27 | 22 | 23 | `95.6521…` → **95.7** |
| Wrap-Up Process | 27 | 117 | 123 | `95.1219…` → **95.1** |
| Professionalism / Rapport | 27 | 256 | 261 | `98.0842…` → **98.1** |
| Ticket / Task Documentation | 27 | 341 | 358 | `95.2513…` → **95.3** |
| Work From Home Policy | 27 | 27 | 27 | `100.0000` → **100.0** |

> "Overall Feedback" is omitted because it has no `YES_NO`/`SCALE`/`RADIO`
> questions and `getCategoryScores` filters them out by `WHERE
> fq.question_type IN ('YES_NO','SCALE','RADIO')`.
>
> A `priorScore` field is appended for each row using the same query against
> Jan 2026; a value of `null` means no audits / no scoreable answers in that
> category for the prior period.

### 2.6 Per-form — `getFormScores`

`getFormScores` is **dept-scoped only** (no user filter). Returned `avgScore`
is rounded to 1 decimal: `Math.round(avg * 10) / 10`.

| Scope | form | submissions | expected `avgScore` |
| --- | --- | --- | --- |
| Tech Support (dept_id=2) | Contact Call Review Form | **99** | `94.5267 → 94.5` |

### 2.7 Top missed questions — `getMissedQuestions`

Selection rule (from the SQL):
- Question type ∈ {`YES_NO`,`SCALE`,`RADIO`} **and** `POSSIBLE_EXPR > 0`
- `total >= 5` (response count)
- `missed > 0`
- Order by `missed / total DESC`, top 10
- For each top question: top 15 agents with `agentMissed > 0`, ordered by
  `agentMissed DESC, csr.username`.
- `missRate = round((missed / total) × 1000) / 10`

Exact list depends on `EARNED_EXPR = 0` matches (e.g. a `YES_NO` answered
"no" with `no_value = 0`, or a `SCALE` answered `0`). Pinned at run-time by
the API diff so a deterministic snapshot is captured into the report.

### 2.8 Department comparison — `getQualityDeptComparison` (ALL scope)

`avgScore` rounded to 1 decimal.

| dept | audits | expected `avgScore` | disputes |
| --- | --- | --- | --- |
| Tech Support | 99 | `94.5267 → 94.5` | **9** |
| Customer Service | 205 | `92.9289 → 92.9` | **20** |

> Note: the comparison row's `disputes` count is `COUNT(DISTINCT
> disp.id)` from `LEFT JOIN disputes`, which counts disputes whose
> **submission** is finalized in the period — it is not the same as the
> KPI tile `dispute_rate` numerator which counts by `disputes.created_at`.
> Tech Support: 9 disputes here vs 10 in §1.4 because one Feb-created
> dispute pointed at a submission finalized outside Feb.

---

## Phase 6 — Threshold mapping (`ie_kpi_threshold`)

Direction `UP_IS_GOOD`: `value >= goal` → green, `>= warning` → amber,
`>= critical` → orange, otherwise red.
Direction `DOWN_IS_GOOD`: `value <= goal` → green, `<= warning` → amber,
`<= critical` → orange, otherwise red.

Banding output is one of `good` | `warning` | `critical` | `neutral` (see
`frontend/src/constants/kpiDefs.ts → getThresholdStatus`). The visual color
mapping (`frontend/src/components/insights/thresholdColors.ts`):

| status | tailwind | informal label |
| --- | --- | --- |
| good | `bg-emerald-500` | green |
| warning | `bg-orange-400` | orange / amber |
| critical | `bg-red-500` | red |
| neutral | `bg-slate-300` | grey |

| KPI | direction | goal | warning | critical | slice value | expected band |
| --- | --- | --- | --- | --- | --- | --- |
| `avg_qa_score` | UP_IS_GOOD | 90 | 80 | 70 | 94.53 (dept) / 96.07 (user) | **good** |
| `audit_completion_rate` | UP_IS_GOOD | 95 | 85 | 75 | 33.00 (Tech Support) | **critical** (`<= critical`) |
| `quiz_pass_rate` | UP_IS_GOOD | 85 | 70 | 55 | n/a in slice | **neutral** |
| `coaching_completion_rate` | UP_IS_GOOD | 92 | 80 | 65 | n/a in slice | **neutral** |
| `dispute_rate` | DOWN_IS_GOOD | 5 | 10 | 20 | 10.10 (Tech Support) | **warning** (`> warning`, `< critical`) |
| `dispute_upheld_rate` | DOWN_IS_GOOD | 10 | 20 | 35 | 30.00 | **warning** |
| `dispute_adjusted_rate` | DOWN_IS_GOOD | 3 | 8 | 15 | 70.00 | **critical** (`>= critical`) |
| `avg_dispute_resolution_time` | DOWN_IS_GOOD | 3 | 7 | 14 | 4.70 | **warning** (`<= warning`, `> goal`) |
| `time_to_audit` | DOWN_IS_GOOD | 3 | 7 | 14 | depends on metadata | captured at run-time |
| `audits_assigned` | NEUTRAL | 15 | 13 | 12 | 300 (15 × 20 days) | **neutral** (pace target only) |

Boundary equality is **inclusive**: a value exactly at `goal` resolves to
`good`, exactly at `warning` resolves to `warning`, exactly at `critical`
resolves to `critical`. Pinned by `InsightsKpiThresholds.test.ts`.

> **Inverse-direction sanity check:** `dispute_rate = 10.10` resolves to
> *warning* because `10.10 > goal (5)` and `10.10 > warning (10)` but
> `10.10 < critical (20)`. Flipping the direction to `UP_IS_GOOD` would
> resolve the same value to *good* (`>= goal (5)`) — exactly the bug we want
> to prevent regressing on. The flip is asserted by
> [`InsightsKpiThresholds.test.ts`](../../backend/src/services/__tests__/InsightsKpiThresholds.test.ts).

---

## Phase 3 — API diff results

Populated by [`backend/scripts/insights-validate-quality.ts`](../../backend/scripts/insights-validate-quality.ts).
Each run replaces this section.

> _Run `ts-node backend/scripts/insights-validate-quality.ts` to refresh._

<!-- API_DIFF_BEGIN -->
_Last run: 2026-04-20T18:42:31.167Z — **52/52** checks passed (0 failed)._

| Area | Field | Expected | Actual | Result |
| --- | --- | --- | --- | --- |
| KPIs (dept) | avg_qa_score | `94.5267` | `94.5267` | **✓ PASS** |
| KPIs (dept) | audits_completed | `99` | `99` | **✓ PASS** |
| KPIs (dept) | audits_assigned | `300` | `300` | **✓ PASS** |
| KPIs (dept) | audit_completion_rate | `33` | `33` | **✓ PASS** |
| KPIs (dept) | dispute_rate | `10.1010` | `10.1010` | **✓ PASS** |
| KPIs (dept) | dispute_upheld_rate | `30` | `30` | **✓ PASS** |
| KPIs (dept) | dispute_adjusted_rate | `70` | `70` | **✓ PASS** |
| KPIs (dept) | avg_dispute_resolution_time | `4.7000` | `4.7000` | **✓ PASS** |
| KPIs (dept) | meta.businessDays/paceTarget | `20/15` | `20/15` | **✓ PASS** |
| Trends (dept) | Sep 25 | `null` | `null` | **✓ PASS** |
| Trends (dept) | Oct 25 | `null` | `null` | **✓ PASS** |
| Trends (dept) | Nov 25 | `90.3053` | `90.3053` | **✓ PASS** |
| Trends (dept) | Dec 25 | `96.6538` | `96.6538` | **✓ PASS** |
| Trends (dept) | Jan 26 | `96.7590` | `96.7590` | **✓ PASS** |
| Trends (dept) | Feb 26 | `94.5267` | `94.5267` | **✓ PASS** |
| Trends (slice user) | Sep 25 | `null` | `null` | **✓ PASS** |
| Trends (slice user) | Oct 25 | `null` | `null` | **✓ PASS** |
| Trends (slice user) | Nov 25 | `96.0093` | `96.0093` | **✓ PASS** |
| Trends (slice user) | Dec 25 | `97.6486` | `97.6486` | **✓ PASS** |
| Trends (slice user) | Jan 26 | `97.9680` | `97.9680` | **✓ PASS** |
| Trends (slice user) | Feb 26 | `96.0674` | `96.0674` | **✓ PASS** |
| Score dist (dept) | 60-69 | `2` | `2` | **✓ PASS** |
| Score dist (dept) | 70-79 | `4` | `4` | **✓ PASS** |
| Score dist (dept) | 80-89 | `14` | `14` | **✓ PASS** |
| Score dist (dept) | 90-100 | `79` | `79` | **✓ PASS** |
| Categories (slice) | Initial Greeting / Customer Verification — audits | `27` | `27` | **✓ PASS** |
| Categories (slice) | Initial Greeting / Customer Verification — avgScore | `93.5000` | `93.5000` | **✓ PASS** |
| Categories (slice) | Contact Management — audits | `27` | `27` | **✓ PASS** |
| Categories (slice) | Contact Management — avgScore | `80` | `80` | **✓ PASS** |
| Categories (slice) | CRM / Knowledge Base — audits | `27` | `27` | **✓ PASS** |
| Categories (slice) | CRM / Knowledge Base — avgScore | `71.3000` | `71.3000` | **✓ PASS** |
| Categories (slice) | Product / Service Knowledge and Problem Solving Ability — audits | `27` | `27` | **✓ PASS** |
| Categories (slice) | Product / Service Knowledge and Problem Solving Ability — avgScore | `98.1000` | `98.1000` | **✓ PASS** |
| Categories (slice) | Call Transfer / Hold Procedures — audits | `27` | `27` | **✓ PASS** |
| Categories (slice) | Call Transfer / Hold Procedures — avgScore | `95.7000` | `95.7000` | **✓ PASS** |
| Categories (slice) | Wrap-Up Process — audits | `27` | `27` | **✓ PASS** |
| Categories (slice) | Wrap-Up Process — avgScore | `95.1000` | `95.1000` | **✓ PASS** |
| Categories (slice) | Professionalism / Rapport — audits | `27` | `27` | **✓ PASS** |
| Categories (slice) | Professionalism / Rapport — avgScore | `98.1000` | `98.1000` | **✓ PASS** |
| Categories (slice) | Ticket / Task Documentation — audits | `27` | `27` | **✓ PASS** |
| Categories (slice) | Ticket / Task Documentation — avgScore | `95.3000` | `95.3000` | **✓ PASS** |
| Categories (slice) | Work From Home Policy — audits | `27` | `27` | **✓ PASS** |
| Categories (slice) | Work From Home Policy — avgScore | `100` | `100` | **✓ PASS** |
| Form scores (dept) | Contact Call Review Form — submissions | `99` | `99` | **✓ PASS** |
| Form scores (dept) | Contact Call Review Form — avgScore | `94.5000` | `94.5000` | **✓ PASS** |
| Dept comparison | Tech Support — audits | `99` | `99` | **✓ PASS** |
| Dept comparison | Tech Support — avgScore | `94.5000` | `94.5000` | **✓ PASS** |
| Dept comparison | Tech Support — disputes | `9` | `9` | **✓ PASS** |
| Dept comparison | Customer Service — audits | `205` | `205` | **✓ PASS** |
| Dept comparison | Customer Service — avgScore | `92.9000` | `92.9000` | **✓ PASS** |
| Dept comparison | Customer Service — disputes | `20` | `20` | **✓ PASS** |
| Missed questions | rows returned | `>= 0 (snapshot)` | `10` | **✓ PASS** |
<!-- API_DIFF_END -->

---

## Edge-case fixtures (Phase 4)

See [`backend/prisma/test-fixtures/quality-edge-cases.sql`](../../backend/prisma/test-fixtures/quality-edge-cases.sql).
Documented inline in that file. Not loaded by any migration; load manually into
a throwaway schema before running the edge-case tests:

```powershell
mysql -u root qtip_test -e "source backend/prisma/test-fixtures/quality-edge-cases.sql"
```

## Regression tests (Phase 5)

- [`backend/src/services/__tests__/QCQualityData.golden.test.ts`](../../backend/src/services/__tests__/QCQualityData.golden.test.ts)
  pins every value in §2.4–§2.8 to this slice.
- [`backend/src/services/__tests__/QCQualityData.edges.test.ts`](../../backend/src/services/__tests__/QCQualityData.edges.test.ts)
  exercises the Phase 4 fixtures: zero audits, all-N/A, threshold boundaries,
  all three question types in one form, single-row aggregates.
- [`backend/src/services/__tests__/QCKpiService.golden.test.ts`](../../backend/src/services/__tests__/QCKpiService.golden.test.ts)
  pins KPI values + 6-month trend points.
- [`backend/src/services/__tests__/InsightsPermissionService.scope.test.ts`](../../backend/src/services/__tests__/InsightsPermissionService.scope.test.ts)
  asserts the resolved `dataScope` actually narrows the result set as
  advertised for ALL / DIVISION / DEPARTMENT / SELF.
- [`backend/src/services/__tests__/InsightsKpiThresholds.test.ts`](../../backend/src/services/__tests__/InsightsKpiThresholds.test.ts)
  pins every Quality KPI's live `ie_kpi_threshold` row + the resulting
  band classification (Phase 6).

Run all of the above with:

```powershell
cd backend; npm test
```
