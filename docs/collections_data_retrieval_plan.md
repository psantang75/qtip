# Collections (AR Campaign) â Data Retrieval & Structure Plan

**Status:** Approved to build (2026-09-07) â warehouse tables green-lit,
invoice-level attribution locked, 13-month backfill, email-based agent match.
See Â§6 for locked decisions + the 3 remaining confirms. No CRM writes, ever
(read-only `crm` pool); all QTIP-side tables are additive, idempotent migrations.

This document backs the Collections Insights UI (already built with sample data:
Overview, Campaign Ã Touch, Agent Performance, Contact Frequency, Channel
Effectiveness). Phase 1 = UI + typed contracts + sample data. **Phase 2 (this
doc) = replace sample data with a real CRM-sourced pipeline.**

Overview, Contact Frequency and Channel Effectiveness were **retired on
2026-09-17** (see 4b-14); Cycle Performance, Cycle Invoices and Failed Charge
Invoices were added after this line was written. Sections below that describe the
retired reports are kept as a record of why they were built, not as current
behaviour.

Everything below was verified with live read-only queries against
`dmcms_prod` (MySQL 5.7) on 2026-09-07.

---

## 1. What the CRM actually contains (verified)

### 1.1 The model in one paragraph
Every collections activity is a **task** (`tblTask`) of an AR **task type**
(`tblTaskType`). The recurring biller creates the tasks on a schedule (the 1st
and the 16th). A CSR works a task by moving it through a **status ladder**
(`tblTaskStatus`), and every move is logged as an **action** (`tblAction`) â an
action is one **touch**. Money lands in `tblPaymentsCredits`, tied back to the
task by **`BillingGroupID`** and a time window. Dunning/reminder emails are in
`tblEmail`.

### 1.2 AR task types (the campaigns)

| TaskTypeID | Title | DeptID | Volume (120d) |
|---:|---|---:|---:|
| 1 | Ops Accounts Receivable - CC | 2 (Ops/CS) | 2,551 |
| 33 | Ops Accounts Receivable - Check | 2 | 1,649 |
| 4 | Expiring Credit Card | 2 | 843 |
| 9 | Sales Accounts Receivable | 1 (Sales) | 553 |
| 34 | Ops Accounts Receivable - ACH | 2 | 112 |
| 32 | Ops Accounts Receivable - Special | 2 | (low) |

`tblTaskType.DeptID`: **1 = Sales, 2 = Ops/Customer Service**. Core collections
= dept 2 types (1, 34, 33, 4, 32); type 9 is the Sales-side AR.

### 1.3 "1st vs 16th" is a created-date rule for CARD only (corrected 2026-09-15)
CC and ACH are **single** task types; the "1â15 vs 16â31" campaigns are not two
types â they're distinguished by **`DAY(tblTask.CreatedOn)`**. Histogram for
TaskTypeID 1 over 120 days:

- **Day 1 â 1,300 tasks**, **Day 16 â 1,005 tasks**, every other day â¤ ~36.

So: `DAY(CreatedOn) <= 15` â "â¦1-15", else "â¦16-31". Stragglers on other days
are manual adds and fold into the nearest cycle. That holds for **card** because a
declined card raises its task within seconds of the run, so the created date IS the
run date.

**It does NOT hold for ACH (TaskTypeID 34).** An ACH return posts against its cycle but
the task appears an average of 11.8 days later, reaching 26, so the two passes' task
windows overlap and a created-date test misfiles them. The ACH split is resolved from
the run behind the task instead - see 4b-13.

### 1.4 Status ladder = the touch sequence (encoded in the title)
Each task type has its **own** ladder (`tblTaskStatus.TaskTypeID`). The touch
number is literally in the status `Title`. For CC (TaskTypeID 1), the dunning â
term chain is:

```
Declined CC #1 (139) â #1 - 2nd Call (69) â #2 (70) â #2 - 2nd Call (181)
â #3 (71) â #3 - 2nd Call (8) â #4 (2) â #4 - 2nd Call (3) â #5 (144)
â Termd Non-Pay #1 (115) â #1 - 2nd Call (123) â #2 (104) â â¦ â #5 (1)
â Termd Non-Pay - Final Call (113)
```

Terminal / outcome statuses (with `Closed` bit): **Paid (6, Closed)**,
Promised To Pay (5), Termd - Promised to Pay (183), **Non-Payment (179,
Closed)**, Cancelled - No Contact / Customer Request (7 / 103, Closed),
Reactivated (193), Credit Memo - Contacted/No Contact (164/180), plus system
milestones Invoice Generated #1âFinal, Invoice Viewed, Invoice Confirmed,
Contact Attempted. ACH (34) and Check (33) have parallel ladders (`Declined ACH
#1..#5`, `Termd Non-Pay #1..#5`, `Invoice Generated #1..#10`, etc.).

### 1.5 A "touch" vs a system event (critical filter)
`tblAction.ActionTypeID` separates human work from automation:

- **`ActionTypeID = 1`** = a **human agent touch** (`CreatedBy` = a real
  salesperson). 3,581 over 45d for AR.
- **`ActionTypeID = 0`** = **system event** (invoice generated, invoice viewed,
  payment auto-posted, status auto-flip). 7,994 over 45d; authored by
  `CreatedBy = 0` or `12 (System)`.

Touch counting **must** filter `ActionTypeID = 1` or call/talk metrics get
inflated ~3Ã by system rows. `tblActionResult`/`tblActionStatus` are empty, so
the outcome of a touch is read from the **status it moved the task into**
(`tblAction.TaskStatusID`).

### 1.6 Money: `tblPaymentsCredits`
Columns that matter: `PaymentCreditID`, **`BillingGroupID`** (join key),
`PaymentAmount`, `ProcessedDate` (indexed), **`PaymentsCreditsStatusID`**,
**`PaymentsCreditsTypeID`**, **`CreatedBy`** (the processor), `CheckNumber`.

- **Collected** = `PaymentsCreditsStatusID = 3` (**Approved**) AND
  `PaymentsCreditsTypeID = 1` (**Payment**). (Status: 1 Processing, 2 Declined,
  3 Approved, 4 Pending. Type: 1 Payment, 2 Credit, 3 Return, 9 Credit Memo,
  6 CC Refund, 10 ACH Refund, â¦ â only type 1 is a real inbound collection.)
- Instrument (CC vs ACH vs Check) is **not** a column here â infer it from the
  **campaign/task type** (or `tblPaymentResponseLog.CardType` / `CheckNumber`
  if we ever need per-payment instrument).

### 1.7 Agent vs No-Agent attribution (the key finding)
`CreatedBy` is populated on essentially **all** payments (there is no NULL
bucket), so agent-vs-no-agent is **not** null-vs-not. Resolve `CreatedBy`
against `tblSalesPeople`:

- **`CreatedBy = 0`** dominates: **7,710 payments / $760K in 15 days** â portal
  self-service / system-initiated with no login = **No-Agent**.
- **Large numeric `CreatedBy`** (e.g. 64982, 119049â¦) resolve to no salesperson
  = **customer/contact portal logins** = **No-Agent**.
- **`CreatedBy = 12` = "System"** (DeptID 0) = **No-Agent** (consolidated).
- **Real CS agents** (DeptID 2): Florentine (132), Fuller (97), Cowans (185),
  Gaston (180), Bettis (166), E. Santangelo (194), Kelley (193), McGarity (152),
  Ady (199)â¦ = **Agent-processed**, credited to that person.

30-day split (status=3): **not-a-salesperson â $1.17M** vs **salesperson â
$0.97M**. This maps cleanly onto the UI's **Portal â No Agent** vs
**Portal â Agent** buckets. (Matches the confirmed reality: no auto-retry;
no-agent = customer got an email and self-served on the portal.)

### 1.8 Task â payment join is valid
Sampling 492 recent CC tasks, **310 (63%)** had an Approved payment on the same
`BillingGroupID` within 30 days of task creation â `BillingGroupID` is the sound
join key. **Final recovery is measured at the invoice level (Â§1.10), not by a
time window.**

### 1.9 Dunning emails exist (`tblEmail`)
`tblEmail(EmailID, SendTo, Subject, CreatedOn, SentOn, CustomerID, OrderID,
EmailTypeID)`. Reminder types include **"Reminder - Recurring Invoice"**,
**"Expiring CC"**, **"Recurring Invoice"** â the "email â portal self-service"
lever, countable per customer/day. (Exact `EmailTypeID` lookup table to confirm
in 2b.)

### 1.10 Invoices, balances & recovery (the corrected attribution layer)
Recovery is an **invoice**-level fact, not a task-level time window. Verified:

- **Invoice = `tblOrders`.** Recurring service invoices are `OrderTypeID = 3`
  (Recurring); other AR-relevant types: 6 Reactivation, 7 Termination, 8 Service
  Cycle. One order per billing cycle (has `OrderDate`, `DueDate`,
  `BillingGroupID`, `CustomerID`, `OrderStatusID`, `RecurringID`).
- **AR task â invoice link is `BillingGroupID`, NOT `tblOrders.TaskID`.**
  `tblOrders.TaskID` is `0` on recurring invoices (it belongs to the order-flow,
  not AR collection). A task collects the open invoice(s) on its billing group
  for that cycle.
- **Invoice amount = Î£ `tblOrderParts`** (`NormalPrice`/`UnitCost` + `PartTax`).
  Example: $28.95 + $2.03 = **$30.98**.
- **Collected (invoice-level) = Î£ approved applied payments** via the ready-made
  view **`vwPaymentsCreditsOrdersApproved(OrderID, Amount, PaymentCreditID,
  Type, Debit, AppliedOn, PaymentsCreditsOrderID)`**. This is the authoritative
  source â it's already scoped to *approved payments applied to specific
  orders*. (Applied `Amount` is stored negative; use magnitude.) Join back to
  `tblPaymentsCredits` on `PaymentCreditID` for the processor (`CreatedBy` â
  agent / no-agent) and `ProcessedDate`.
- **Open balance = invoice amount â collected.** `is_paid = balance <= 0`.
- **`OrderStatusID` is NOT reliable for paid/unpaid** â fully-paid recurring
  invoices still read `2 = Awaiting Payment`. Paid/open **must** be computed from
  balance. (This is exactly why a task stays open when one invoice is paid but
  another on the same billing group still owes â confirmed with live data.)
- **`tblActionOrder(OrderID, ActionID)`** ties a specific touch to the specific
  invoice it addressed â enables per-invoice touch history when needed.

### 1.11 Subscriptions & termination (collected-vs-terminated)
- **Subscription = `tblService`** (one per radio/site). Key fields: `ServiceID`,
  `CustomerID`, `SiteID`, `OrderPartID`, `ServiceStatus`
  (Active/Inactive/NotUsed/â¦), `ServiceStartDate`, `ServiceEndDate`,
  `ReactivatedID` / `ReactivatedDate`.
- **Service â campaign link is via the order, NOT `tblTaskService`.**
  `tblTaskService` returned **0 rows** for AR task types (it's for activation
  tasks). The valid path is `tblService.OrderPartID â tblOrderParts.OrderID â
  tblOrders.BillingGroupID = tblTask.BillingGroupID`. So the subs under a
  campaign task are the services on that billing group's overdue invoice(s).
- **Termination event = `tblServiceTermination(ServiceID, TerminationReasonID,
  TerminationOn, CreatedBy, CreatedOn, TerminationNotes)`.** `CreatedOn` = when
  the term was *decided/recorded* (use for campaign attribution); `TerminationOn`
  = effective churn date (**often future-dated** to the end of the paid period â
  live rows showed CreatedOn 2026-09-04 â TerminationOn 2027-01-03). `CreatedBy`
  = the user who termed (agent attributable).
- **AR-specific termination reasons** (`tblServiceTermReason`) let us attribute
  churn to the collection campaign: **21 "Canceled - Expired CC", 32 "Canceled -
  AR Contacted", 33 "Canceled - AR Not Contacted", 36 "Canceled - AR Payment
  Delay"** (and legacy 1 "Nonpayment"). Non-AR reasons (e.g. 28 "Encore
  Termination", 35 "Switching to Competitor") are churn but **not** campaign-
  caused â tag separately.
- **Outcome per sub:** `RETAINED` (still Active / invoice cash-paid after the
  campaign), `TERMINATED` (has an AR-reason termination during/after the
  campaign), `REACTIVATED` (`ReactivatedDate` set / status flips back). Capture
  the **task status at outcome** so we can answer "terminated *at what status*"
  (e.g. termed at "Termd Non-Pay #3").

### 1.12 Order (invoice) types on AR billing groups â what's actually collected
Distribution of order types on billing groups that had an AR task (last 2mo of
tasks, orders in last 5mo), with real cash applied (Payment/Credit/Overpayment):

| Order type | ID | Orders | Invoice $ | Cash collected | In scope? |
| --- | --- | --- | --- | --- | --- |
| **Recurring** | 3 | 6,124 | $1,523,944 | $945,403 | â core |
| **Order** (one-time / Sales AR) | 1 | 614 | $445,256 | $322,137 | â (esp. Sales AR) |
| **Reactivation** | 6 | 72 | $16,108 | $11,109 | â **termâcollect = reactivation win** |
| Date Adjustment | 11 | 53 | $3,280 | $1,076 | â balance modifier |
| Labor Adjustment | 10 | 9 | $3,920 | $2,274 | â balance modifier |
| Termination | 7 | 36 | $2,700 | $1,605 | â ï¸ churn marker, not a campaign invoice |
| Warranty / Box Swap / Discount | 5/2/9 | 69 | $0 | â | â no balance |
| **Service Cycle** | 8 | **0** | â | â | â **not present on AR BGs** |

**Answers your question directly:**
- **Service Cycle (8) is NOT part of this activity** â zero such orders on AR
  billing groups. Drop it from scope.
- **Reactivation (6) IS** â exactly the "term, then collect â reactivation"
  you described. Small count but real balances that get paid; count as a
  **reactivation success** (mirrors task status `Reactivated` +
  `tblService.ReactivatedDate`).
- **Termination (7)** orders are the churn *event* (DueDate is a `2001` placeholder,
  balance usually $0). Handle churn via the subscription fact (Â§1.11), **not** as a
  recovery invoice. The rare final-balance collection (~$1.6K/2mo) is immaterial.

---

## 2. Attribution & classification rules (the business logic)

1. **Campaign key** (derived per task):
   - Type 1 (CC): `DAY(CreatedOn) <= 15` â `CC_1_15` else `CC_16_31`
   - Type 34 (ACH): same split, but resolved from the RUN, never `CreatedOn` (see 4b-13) â `ACH_1_15` / `ACH_16_31`
   - Type 33 (Check): `CHECK` *(split into Termed vs Customer â see Q1)*
   - Type 4 (Expiring CC): `EXP_CC` *(current vs prior month â see Q1)*
   - Type 32 (Special): `AR_SPECIAL`
   - Type 9 (Sales AR): `SALES_AR` *(include? â see Q2)*
2. **Touch = an agent status-change action** (validated 2026-09-07):
   - â ï¸ **`ActionTypeID` is NOT the human/system flag** â `tblActionType` only
     has `1='type 1'`, `2='CM Group'`; human and system events both span 0/1.
     Do **not** filter on it.
   - A **human touch** = `tblAction` whose **`CreatedBy` resolves to a real
     agent** (`tblSalesPeople`, `isDisplayInCRM=1`, `DeptID IN (1,2,3)`) **and**
     whose status is a real disposition (exclude `Title LIKE 'Not Started%'`).
     System/batch task-generation rows are `CreatedBy=0` or `CreatedBy=12`
     ("System"/"Recurring Service", **DeptID 0**) â excluded by the dept filter.
   - â ï¸ **Dedup the agent join** â `UserID=12` has **two** `tblSalesPeople` rows;
     a naive `sp.UserID = a.CreatedBy` fans out and double-counts. Resolve agents
     via a deduped derived table: `SELECT UserID, MIN(EMail) email,
     MIN(SalesPersonName) name FROM tblSalesPeople WHERE isDisplayInCRM=1 AND
     DeptID IN (1,2,3) GROUP BY UserID`.
   - `touch_seq` (1..10), `phase` (OUTREACH / TERM / FINAL), `is_2nd_call`
     parse from the status `Title` in SQL (validated across every ladder â
     Declined CC/ACH #N, Termd Non-Pay #N, Termdâ¦Final Call=6, Invoice
     Generated #N, Expiring CC #N AM/PM, Contact Attempt N/#N). Non-ladder agent
     dispositions (Paid, Promised, Reactivated) keep `touch_seq = NULL`,
     `phase = OUTREACH` â still counted as agent activity.
3. **Collected $ = REAL MONEY ONLY (critical).** Recovery counts money the
   customer actually paid â **`Payment` (type 1)**, **`Credit` (type 2)**, and
   **`Overpayment` (type 4)** â at `PaymentCreditStatusID = 3` ("Approved").
   `Credit` and `Overpayment` are real prior funds the customer paid (now sitting
   as unapplied account credit/overpayment) being applied to the invoice, so they
   **do** count. Everything else â **credit memos, forgiven, uncollectibles,
   warranty, discount orders** â is a non-cash adjustment/write-off and is
   **excluded**. This matters: the applied view
   `vwPaymentsCreditsOrdersApproved` is **NOT cash-only** â over 13mo it contains
   **$12.8M of Credit Memos (52,510 rows)** plus write-offs. So:
   - Sum applied amounts from the view **filtered to `Type IN ('Payment',
     'Credit','Overpayment')`** (or join `tblPaymentsCredits` and gate on
     `TypeID IN (1,2,4) AND StatusID = 3`), per `OrderID`. Use magnitude (stored
     negative).
   - **Type reference â count â / exclude â:** 1 Payment â | 2 Credit â |
     3 Return â | 4 Overpayment â | 5 Void â | 6 CC Refund â | 7 Check
     Refund â | 8 Blanket Refund â | 9 Credit Memo â | 10 ACH Refund â |
     11 Forgiven â | 12 Warranty â | 13 Uncollectibles â | 14 Discount
     Order â | 99 Return/Credit Memo-Old â | 100 Credit Bal. Adj. â.
   - **Chargebacks / disputes:** a Payment later flipped to `Dispute - Lost`
     (status 6) or reversed by a `CC/ACH/Check Refund` (types 6/7/10) was clawed
     back â net it out (track `reversed_amount` separately so gross vs net cash
     is visible). `Dispute - Won` (7) stays counted.
   - Track `credit_memo_amount`, `writeoff_amount` (Forgiven/Uncollectibles) as
     **their own non-cash measures** for AR visibility â never inside recovery $.
4. **Processor kind** (from the applying payment's `tblPaymentsCredits.CreatedBy`;
   validated 2026-09-07 â mirrors the touch resolver, same dedup guard):
   - `AGENT` â `CreatedBy` resolves via the **deduped** agent table
     (`isDisplayInCRM=1`, `DeptID IN (1,2,3)`, `GROUP BY UserID`). Credit = agent
     (e.g. Florentine $1.27M, Fuller $608K over 90d).
   - `NO_AGENT` â `CreatedBy = 0` (auto-recurring / portal-system; ~$3.4M/90d),
     `= 12` ("System"/"Recurring Service", DeptID 0), or a large-numeric
     non-salesperson (customer portal login). One "No-Agent Recovery" bucket.
   - â ï¸ Never join `tblSalesPeople` on `UserID` without the dept filter/dedupe â
     `UserID=12` has two rows and would double-count.
5. **Invoice â campaign/task attribution**: an invoice's open balance is
   attributed to the **AR task on the same `BillingGroupID`** covering that cycle
   (task `CreatedOn` â the collection cycle for the overdue invoice). Recovery =
   approved payments **applied to that invoice** after the task opened; the
   `touch_seq` at `AppliedOn` gives "marginal recovery by touch" and the
   **post-term spike** (payments applied after a `Termd` status). A task is
   **resolved** only when **all** its linked invoices reach `balance <= 0`.
6. **Channels (4)**: `Portal â No Agent` (no-agent payments) and `Portal â
   Agent` (agent-processed) come straight from Â§1.7. **Inbound / Outbound
   call** split needs the phone data + an employee map (Phase 2b, Q4). Touch
   *counts* ("calls placed") come from `tblAction` today; talk-time (seconds)
   needs the phone system.
7. **Subscription outcome** (per Â§1.11): for each service on the campaign's
   billing group, classify `RETAINED` / `TERMINATED` / `REACTIVATED`.
   - **Terminated *by the campaign*** = a `tblServiceTermination` row with an
     **AR reason** (21/32/33/36, legacy 1) whose `CreatedOn` â¥ task open. Churn
     with non-AR reasons is reported but not credited to the campaign.
   - Record `status_at_outcome` = the task's `TaskStatusID` (touch label) at the
     termination/collection moment â "**collected vs terminated, and at what
     status**", i.e. the sub-level twin of marginal recovery by touch.
   - **Subs collected** = services that stayed `RETAINED` (their cycle invoice
     reached cash-paid). Report count + retained MRR alongside terminated count +
     lost MRR per campaign / per touch.

---

## 3. Warehouse structure (conforms to `.cursor/rules/insights-data-warehouse.mdc`)

**Guardrail-locked architecture (verified against the live `ie_*` system):**
- **Registry-driven ingestion â NO new worker code.** Each fact = one
  `ie_source_report` row + a `<code>.extract.sql` + a `<code>.transform.sql`.
  The existing `ie-source-dispatch` PM2 process runs due reports; the generic
  `SourceReportSyncWorker` does extract â TRUNCATE staging â bulk-insert
  (by column-name) â transform (delete-window + insert). We add **zero** TS
  workers.
- **Idempotency = delete-window + insert** (NOT upsert-by-PK). The transform
  deletes the `date_key` window then re-inserts, so re-runs never double-count.
- **Partitioning is MANDATORY** (partition-manager requires it):
  - staging `ie_stg_*`: `PARTITION BY RANGE (YEAR(<date_col>)*100 + MONTH(<date_col>))`
  - fact `ie_fact_*`: `date_key` = `YYYYMMDD INT`,
    `PARTITION BY RANGE (date_key DIV 100)`, single `p_future` catch-all,
    `date_key` in the PK: `PRIMARY KEY (<code>_key, date_key)`.
- **Identity conform = shared dims, by email.** Agents conform to
  **`ie_dim_employee`** via `LOWER(TRIM(email))` (CRM `tblSalesPeople.EMail`
  emitted by the extract), dates to **`ie_dim_date`** (`full_date`), exactly
  like `call_activity`. No custom agent/date dim.
- **Additive only, idempotent DDL** (`CREATE TABLE IF NOT EXISTS`,
  `INSERT ... ON DUPLICATE KEY UPDATE`); one migration, no existing object
  altered.

### 3.1 Reference lookups (small, seeded â plain tables, not partitioned)
Not SCD dims; static campaign/touch decode seeded in the migration.
- **`ie_dim_collections_campaign`** â `campaign_key` (PK), `label`, `instrument`
  (CC/ACH/CHECK/EXP_CC/SALES), `cycle` (1_15 / 16_31 / NA), `success_kind`
  (RECOVERY_DOLLARS / CARD_UPDATE), `color` (reuse `campaign_category` palette),
  `dept_id`.
- **`ie_dim_collections_touch`** â `status_id` (CRM, PK) â `task_type_id`,
  `touch_seq`, `touch_label` (e.g. "Declined CC #2"), `phase`
  (OUTREACH/TERM/FINAL), `is_2nd_call`, `is_terminal`, `is_success`. Seeded by a
  deterministic parse of the Â§7 status ladders.

### 3.2 Facts (each partitioned by `date_key`; PK includes `date_key`)
Every fact carries `date_key INT` (YYYYMMDD, conformed to `ie_dim_date`),
`load_batch_id`, `loaded_at`, and `PRIMARY KEY (<code>_key, date_key)` with
`PARTITION BY RANGE (date_key DIV 100)`. Each has a matching `ie_stg_*` staging
table partitioned on its source date column.

- **`ie_fact_collections_task`** (`report_code` `collections_task`, FULL_RELOAD_WINDOW,
  nightly off-peak) â grain: one AR task. **`date_key` = task `CreatedOn`.**
  `task_id`, `task_type_id`, `campaign_key`, `billing_group_id`, `customer_id`,
  `agent_email`, `employee_key` (conformed), `final_status_id`, `outcome`
  (PAID / REACTIVATED / TERMED_NON_PAY / CANCELLED / OPEN / â¦), `is_success`,
  `terminated_flag`, `first_touch_on`, `last_touch_on`, `agent_touch_count`,
  `amount_at_risk`, `amount_recovered`.
- **`ie_fact_collections_invoice`** (`collections_invoice`, FULL_RELOAD_WINDOW,
  nightly) â grain: one collectible AR invoice (`tblOrders`,
  `OrderTypeID IN (3,1,6)`; adj 10/11 fold into balance; 7/8 excluded).
  **`date_key` = `OrderDate`.** `order_id`, `billing_group_id`, `customer_id`,
  `task_id` (attributed), `campaign_key`, `order_type_id`, `is_reactivation`,
  `due_date`, `invoice_amount` (Î£ parts+tax), `cash_collected` (Payment+Credit+
  Overpayment, approved), `credit_memo_amount`, `writeoff_amount`,
  `refund_amount`, `open_balance`, `outcome` (CASH_PAID / MEMO_WRITEOFF /
  PARTIAL / REFUNDED / OPEN), `is_cash_paid`, `paid_on`, `last_processor_kind`.
- **`ie_fact_collections_touch`** (`collections_touch`, INCREMENTAL_WINDOW,
  hourly, trailing ~45d) â grain: one human touch (`ActionTypeID=1`).
  **`date_key` = action `CreatedOn`.** `action_id`, `task_id`, `campaign_key`,
  `status_id_after`, `touch_seq`, `touch_label`, `phase`, `agent_email`,
  `employee_key`.
- **`ie_fact_collections_recovery`** (`collections_recovery`, INCREMENTAL_WINDOW,
  hourly, trailing ~45d) â grain: one real-money application (Payment/Credit/
  Overpayment) from `vwPaymentsCreditsOrdersApproved`. **`date_key` = `AppliedOn`.**
  `payments_credits_order_id`, `payment_credit_id`, `order_id`, `billing_group_id`,
  `task_id` (attributed), `campaign_key`, `payment_type`, `processor_crm_id`,
  `processor_kind` (AGENT/NO_AGENT), `agent_email`, `employee_key`, `amount`
  (magnitude), `attributed_touch_seq`, `is_reversed`. Non-cash lines never enter.
- **`ie_fact_collections_subscription`** (`collections_subscription`,
  FULL_RELOAD_WINDOW, nightly) â grain: one service under an AR campaign.
  **`date_key` = campaign task `CreatedOn`** (cohort). `service_id`,
  `billing_group_id`, `customer_id`, `task_id`, `campaign_key`, `order_part_id`,
  `service_status`, `outcome` (RETAINED / TERMINATED / REACTIVATED),
  `term_reason_id`, `term_reason_text`, `is_ar_reason`, `term_recorded_on`,
  `term_effective_on`, `terminated_by_crm_id`, `status_at_outcome`,
  `reactivated_on`, `mrr_amount`.

> Rollups the UI needs (by campaign, touch, agent, day, channel) are `GROUP BY`
> queries over these facts â no per-metric tables. Each fact's `ie_source_report`
> row + an `ie_dataset_monitor` row (freshness) mirror `service_counts`.

### 3.3 Agent identity (conform, by email)
The extract emits the CRM agent email (`tblSalesPeople.EMail`, `isDisplayInCRM=1`);
the transform `LEFT JOIN ie_dim_employee e ON e.is_current=1 AND
LOWER(TRIM(e.email))=LOWER(TRIM(s.agent_email))` to set `employee_key` â exactly
`call_activity`'s conform. Unmatched emails are surfaced by the worker's
`logUnmatchedEmails` check (staging keeps an `email`/`agent_email` column).
Collections agents span **DeptID 2** and a couple in **DeptID 3**; `AGENT` vs
`NO_AGENT` on payments is decided in the extract by resolving `CreatedBy` to a
`tblSalesPeople` row in those depts. Phase 2b talk-time reuses the same email
join â no schema change.

---

## 4. Retrieval mechanics (registry-driven; mirrors `service_counts`/`call_activity`)

- **Adding each fact = the documented checklist:** one migration row in
  `ie_source_report` (+ `ie_dataset_monitor`) and two SQL files
  `<code>.extract.sql` / `<code>.transform.sql` in `backend/src/workers/sql/`.
  **No new PM2 process, no new TS worker** â `ie-source-dispatch` picks it up.
- **Extract** runs on the **`crm`** pool, **window-bound by `:pFromDate`/`:pToDate`**
  on the grain's date column (so both the nightly rolling window and the chunked
  backfill runner work). Aliases MUST equal staging column names. Emit
  `agent_email` for the identity conform + `logUnmatchedEmails` check.
- **Transform** runs on `primary`: `DELETE` the `date_key` window, then `INSERT`
  conformed rows (`JOIN ie_dim_date`, `LEFT JOIN ie_dim_employee`). Block
  comments only (the splitter drops line-comment-led statements).
- **Load modes:** task/invoice/subscription = `FULL_RELOAD_WINDOW`
  (`window_months` â 15, `run_only_hours` off-peak) so late payments/status
  changes on open tasks are recaptured; touch/recovery = `INCREMENTAL_WINDOW`
  (`incremental_days` â 45, hourly).
- **MySQL 5.7 CRM realities:** filter `TaskTypeID` (indexed) before date; join
  `tblAction`/`tblOrders`/`tblPaymentsCredits` on indexed keys; add
  `/*+ MAX_EXECUTION_TIME(120000) */` to heavy extracts (the splitter preserves
  `/*+ hints */`); never `LIMIT` inside `IN (...)`.
- **Backfill:** 13 months via `run-source-backfill.ts <code> <from> <to>
  [chunkDays]` â the existing chunked runner (idempotent per chunk).
- **Attribution runs in the transform (primary), not the CRM extract.** Load
  tasks/invoices/payments to staging separately, then join set-based in the
  warehouse â the correlated `DISTINCT`-subquery form took ~11s for 400 tasks.

---

## 4a. Execution status (2026-09-07)

**Built + backfilled 13 months (2025-08-07 â 2026-09-07) into the `qtip`
warehouse** via the standard registry pipeline + `run-source-backfill`:

| Fact | Rows | Extract perf |
| --- | --- | --- |
| `ie_fact_collections_task` | 18,384 | ~0.5s / 30-day chunk |
| `ie_fact_collections_invoice` | 19,847 | ~1.5s / 10-day chunk (was 35.5s before window-scoping the parts/applied aggregates) |
| `ie_fact_collections_recovery` | 21,611 | ~2s / 10-day chunk |
| `ie_fact_collections_touch` | 74,046 | ~4s / 15-day chunk |
| `ie_fact_collections_subscription` | 148,337 | ~1s / 10-day chunk (grain = task Ã service on the billing group) |

**Validated real numbers (13-mo):** cash rate by campaign â EXP_CC 99.7% (card
updates), SALES_AR 89.0%, CHECK 71.4%, CC 1st 60.6%, CC 16th 53.9%, ACH 73.9%.
Recovery AGENT $5.38M / NO_AGENT $1.88M. Touch funnel (CC 1st, distinct tasks):
seq1 1058 â seq2 2038 â seq3 1359 â seq4 730 â seq5 137 (the "are calls 3/4/5 a
waste" curve). Top collectors: Florentine $3.62M, Fuller $1.24M.

**Attribution coverage (tunable knob):** with the current taskâinvoice/recovery
window `[-15d, +45d]` on the same billing group, **59.9%** of AR-BG invoices and
**40.0%** of AR-BG cash applications attribute to a campaign task (the rest are
auto-pay on AR billing groups not tied to a specific dunning cycle). Campaign
rollups correctly use the attributed subset as the denominator. **93.1%** of
touches conform to a QTIP employee by email. The window is a per-report business
knob â widen if mgmt wants more spillover captured (â ï¸ confirm with mgmt per Â§6).

## 4b. Read API + frontend wiring (2026-09-07)

The five dashboards now read **live** warehouse data (sample-data module deleted):

- **Service:** `backend/src/services/insightsCollections.service.ts` â mysql2
  `pool.query` over the `ie_fact_collections_*` facts, mirroring the Call Activity
  read path (period via `resolvePeriod` + `toDateKey`, `ie_dim_employee`/
  `ie_dim_department`/`ie_dim_date` joins, freshness from `getReportSchedule
  ('collections_recovery')`, filter dropdowns from distinct conformed agents).
- **Controller/routes:** `insightsCollections.controller.ts` +
  `/api/insights/collections/{overview,campaign-touch,agent-performance,
  contact-frequency,channel-effectiveness}`. Access is resolved **per page**
  through `InsightsPermissionService.resolveAccess(pageKey)` â the same
  `ie_page_role_access` model as every other Insights page (no `authorizeManager`
  shortcut). The five pages are seeded in
  `20260907190000_seed_collections_pages` (`ie_page` + grants for Admin/Manager
  at `ALL`); nav visibility and direct-URL blocking flow from that, and admins
  manage roles/scopes from Insights â Page Management. SELF / DEPARTMENT scope is
  wired through `agentScope` (latent until an agent/dept role is granted).
- **Frontend:** `collectionsService.ts` GETs those endpoints; the industry
  benchmark curve stays single-sourced in `collectionsBenchmarks` and is layered
  onto the touch series client-side.
- **Subscription fact ACTIVATED** (`is_active=1` via migration
  `20260907180000_activate_collections_subscription`). Campaign Ã Touch now shows
  real subs/touch (distinct services) + a Subscription Outcomes section
  (retained / AR-terminated / reactivated, retained vs lost MRR, and "terminated
  at status"). Grain is task Ã service on the billing group.

## 4b-2. Data-validation pass â corrections applied (2026-09-07)

Validated the loaded facts against CRM ground truth for **Declined CC (1st)**, June
2026 cohort (341 tasks / 2,683 actions), then re-derived the logic from the **Tickets
& Tasks** report, which is the established source of truth for "an agent worked this
item" (`task_open.extract.sql`, `insightsTouchDetail.service.ts`). Four corrections:

1. **Open/closed now comes from `tblTaskStatus.Closed`**, not from parsing the status
   title â the same flag the legacy Task/Ticket report treats as authoritative
   (source bug: closed AR tasks often never get a `CompletedOn`, so the date can't be
   used). Title parsing had left `Non-Payment` and `Billing Cycle Change Cancelled`
   counted as OPEN. One documented source inconsistency is forced closed:
   `Credit Memo - No Contact` is `Closed = 0` while `Credit Memo - Contacted` is
   `Closed = 1`; both are a final non-cash disposition. Open tasks are now
   sub-bucketed (`OPEN_NEW` / `OPEN_TERM` / `OPEN_PROMISED` / `OPEN`) so the read
   layer tests `outcome LIKE 'OPEN%'` with no extra column.
2. **A touch is now a noted status move keyed on `CompletedBy` / `CompletedOn`.**
   Previously keyed on `CreatedBy` / `CreatedOn` with no note filter. In the
   validation cohort those disagree on 1,367 of 2,683 actions (51%) and land on a
   different day 944 times (35%), because the system opens the follow-up row and the
   agent completes it later â 628 actions carry no note at all. Touch #1 was
   undercounted 80 vs 231 real while later rungs were overcounted: the direct cause
   of the wrong marginal-recovery curve. Requiring a
   `Task Status Changed from [X] to [Y]` note also excludes logged dunning emails
   (`<html>`/`<div>` bodies), portal "invoice viewed" stamps, re-assignment stamps
   and bounce notices, and it is the same bracketed family
   `systemNoteClassifier.ts` deliberately keeps as human work. Every such note in
   the cohort resolved to a real agent, and none had a sentinel `CompletedOn`.
3. **`touch_seq` is one continuous rung across the cadence.** `Declined CC #3` and
   `Termd Non-Pay #3` both parsed to 3 and were summed into one bar. Term rungs are
   now offset by the length of that ladder's outreach leg and the final call sits one
   past the end, both derived per `TaskTypeID` from `tblTaskStatus` rather than
   hard-coded â the ladders differ (CC/ACH: 5 outreach + 5 term + final; Expiring CC:
   10 outreach, no term leg; Sales AR: 3 `Contact Attempt N`).
4. **Success is the triggering invoice's paid date.** The recurring run writes the
   invoice and charges the card the same day, so a declined invoice carries the
   task's own creation date: of 164 candidates at offset 0, **zero** were paid before
   the task existed and 103 were recovered afterwards (avg $113.80, ~2 days). The 201
   candidates a month earlier are the prior cycle's invoice and 168 were paid the day
   they were issued â attributing those produced a $13 "amount at risk" per task and
   a **negative** time-to-recovery. `ie_fact_collections_invoice.task_id` is now the
   FIRST AR task raised on that billing group on or after the invoice was written,
   and only when the invoice was still owed at that moment; earliest-task ownership
   keeps a long-unpaid invoice from being re-counted by every later cohort. Recovery
   rows inherit their task from their own invoice (exact, invoice-level) instead of a
   Â±45-day billing-group guess that handed June's cash to the July cohort.

**Result (CC 1st, June 2026):** amount at risk $19,306, cash recovered $11,381
(59.0%), 1.4 days to recovery, and a marginal curve of 75 / 33 / 32 / 16 / 6 payments
on touches 1-5 then 4 / 0 / 1 / 1 across the post-termination leg. Touches 1-4 produce
96% of the dollars; touch 5 returned $192 and the entire term-phase call sequence
(85 touches) returned $374 â the first hard evidence for the "are calls 5+ worth it"
question, and it does **not** show the expected post-termination spike.

### 4b-3. Note-stamp anchor â corrected 2026-09-08

An earlier read of this pass reported "CRM task activity ends 2026-08-27, so a
September view is legitimately near-empty." **That was wrong, and the cause was our
own filter.** Task 1112544 (Declined CC, created 2026-09-01) shows agent touches on
9/1, 9/2, 9/3 and 9/4 in the CRM, none of which reached the warehouse.

The CRM changed the status-change note format part-way through August 2026: the
stamp is now written as `{agent note} - Task Status Changed from [X] to [Y]`, so it
no longer starts the note. `collections_touch.extract.sql` matched it with an
anchored `LIKE 'Task Status Changed%'`, which silently dropped every touch from
2026-08-28 onward:

| Month | anchored (old) | contains (fixed) |
| --- | --- | --- |
| 2026-06 | 3,713 | 3,716 |
| 2026-07 | 3,995 | 3,995 |
| 2026-08 | 3,376 | 3,610 |
| 2026-09 | **0** | **726** |

The filter is now `LIKE '%Task Status Changed from %'` â matched anywhere, with
`from ` retained so it still binds to the transition stamp rather than a stray
mention. Over 13 months this also recovers 958 notes carrying the bare `' - '`
separator and 70 with real agent text ahead of the stamp; both are genuine touches.
History is effectively unchanged (June's CC-1st ladder still reads 231 / 149 / 108 /
62 / 41), so every conclusion in Â§4b-2 stands. **Lesson: never anchor a match to the
start of a CRM note.** A vanishing tail looks exactly like a dead source.

> Timezone note (not a bug, do not "fix"): the `crm` pool leaves `timezone` unset so
> CRM DATETIMEs are read as ET wall clock, and the UTC-pinned primary pool stores
> them as the corresponding UTC instant â a 12:33 ET touch persists as 16:33. That is
> the platform convention for the primary pool (see `insightsAgentActivity.service.ts`),
> and the frontend localizes it back. The ET calendar day is carried separately by
> `date_key`, computed as `DATE(...)` on the CRM side; every period filter and grouping
> in `insightsCollections.service.ts` uses `date_key`, and `created_on` is only ever
> compared instant-to-instant against values converted the same way.

### 4b-4. Billing cycle, MRR and the billed-price column â corrected 2026-09-08

**Billing cycle is a PART-level attribute.** An earlier pass estimated it from the
gap between a billing group's recurring invoices and concluded "96% monthly, no
annuals." That was measuring the wrong grain: a billing group is only a bag of
invoices settled on one card or check, and it bills monthly even when its parts do
not. The cycle lives on `tblParts.PartCycleMode`, reached
`tblTask â tblOrders â tblOrderParts.PartID â tblParts`:

| PartCycleMode | Meaning | Observed gap between invoices | Months |
| --- | --- | --- | --- |
| 1 | Monthly | 1.00 | 1 |
| 2 | Quarterly | 3.00 | 3 |
| 3 | Annually | annual | 12 |

Coverage is complete â 0 of 58,185 AR order parts fail to resolve a mode.
(`tblSaleParts` also carries the columns but does not join: `SalePartID` is empty on
recurring-generated order parts. Use `PartID` against `tblParts`.)

**Annual billing is a small share of LINES but a large share of DOLLARS**, which is
why a count-based estimate missed it (June, billed dollars):

| Campaign | Monthly | Quarterly | Annual | Annual % of $ |
| --- | --- | --- | --- | --- |
| Check | $1,350 | $47,033 | $327,095 | 86% |
| ACH | $1,132 | â | $1,680 | 60% |
| Expiring CC | $14,156 | â | $10,745 | 43% |
| Declined CC | $38,553 | â | $20,476 | 35% |
| Sales AR | $52,048 | $279 | $24,977 | 32% |

`mrr_amount` now divides the billed line by the part's months-per-cycle. Average MRR
per subscription lands at $25â32 across every campaign afterwards (Check $30.39 on
6,342 subs); unnormalized, Check would have read ~$360/sub and ~12Ã its real MRR.

**`UnitCost`, not `NormalPrice`, is the billed price.** On June's 15,367 paid
recurring invoices the applied cash equals the `UnitCost` line total on 15,354
(99.9%) but the `NormalPrice` total on only 12,763 (83%) â `NormalPrice` is blank on
~18% of parts. `collections_invoice.extract.sql` and the MRR calculation both read
`UnitCost` now; reading `NormalPrice` understated amount-at-risk and inflated the
recovery rate. Payment types were re-checked at the same time: the applied-payments
view exposes `Payment`, `Credit`, `Credit Memo`, `Warranty`, `Discount Order` and
`Forgiven` â there is no `Overpayment` type (an applied overpayment surfaces as
`Payment`), so the existing cash definition of Payment + Credit is correct as-is.

Corrected Declined CC (1st) cohort figures after the reload:

| Cohort | Tasks | Task rate | At risk | Collected | Dollar rate |
| --- | --- | --- | --- | --- | --- |
| 2026-05 | 325 | 86.5% | $28,585 | $19,450 | 68.0% |
| 2026-06 | 341 | 82.7% | $19,332 | $10,980 | 56.8% |
| 2026-07 | 343 | 83.4% | $24,893 | $13,179 | 52.9% |
| 2026-08 | 356 | 82.3% | $30,113 | $21,263 | 70.6% |

### 4b-5. Campaign Ã Touch is cohort-anchored (2026-09-08)

The report moved to `insightsCollectionsCampaign.service.ts` with shared scope
helpers in `insightsCollections.shared.ts` (the combined file had outgrown the
200-300 line guidance). Two changes to what it measures:

1. **Cohort, not calendar.** The period selects the tasks CREATED in the window and
   follows them for their whole life. Calendar scoping cut a campaign at the month
   boundary and, worse, mismatched numerator and denominator â payments dated in the
   month were divided by tasks created in the month, two different populations.
   (For Declined CC the ladder itself barely moves, since the cadence fits inside one
   month; it matters for Check, Sales AR, and for money landing the next month.)
2. **Rate is dollars-over-dollars against the cohort**, with the task rate as a
   companion, and each rung now reports dollars / tasks / subs plus the agent vs
   no-agent split. Recovery that never followed a numbered touch is reported as
   `cohort.noTouch` instead of being silently dropped from the numerator while its
   tasks stayed in the denominator â that omission plus Check's ladderless cadence is
   what made the blended "All Campaigns" rate read ~27%.

`CALL_LADDER_CAMPAIGNS` (Declined CC 1st/16th + ACH) gates the marginal-recovery
curve; Check and Expiring CC are flagged `hasCallLadder: false` pending their own
measures.

---

### 4b-6. Campaign start month + starting point on the page (2026-09-08)

The cohort anchoring of Â§4b-5 was invisible on screen â the filter still read
"Period", which implies activity dates. Three changes so the page says what it
measures:

1. **The period selector is now "Campaign Start"**, restricted to month-grain
   choices (`CAMPAIGN_START_OPTIONS`: month / quarter / year / custom). A week or
   a single day would cut a campaign mid-cadence and produce a partial lifecycle,
   which is the failure mode this report exists to avoid. `periodLabel` +
   `periodOptions` are plain overrides on the existing `InsightsFilterBar`; no new
   filter component.
2. **Starting Point tiles above the chart** â declined dollars, triggering
   invoices, tasks, and subscriptions â so every rung below reads as progress
   against a stated denominator. `loadCohortTotals` gained the invoice count and a
   subscription count; the latter goes through `cohortScope(..., { withEmployee:
   false })` because the subscription fact carries no `employee_key`.
   Sanity check, July 2026 cohort: 1,481 tasks / 639 invoices / $372,305 declined /
   8,788 subs. Subs-per-task ranges 1.0 (Declined CC 16th) to 14.5 (Sales AR),
   matching the expectation that multi-location accounts hold many services on one
   billing group â not a join fan-out.
3. **The chart carries its own numbers.** Bars are labelled with the dollars, the
   cumulative-rate line with its percentage, and subscriptions worked are plotted
   as a third series on a hidden axis (counts in the hundreds against dollars in
   the tens of thousands would otherwise flatline). The touch table gained a Tasks
   column, and the expand swapped the always-zero talk-time cells for the
   agent-processed vs self-service dollar split.

Invoice coverage is surfaced rather than buried: when fewer than 99% of cohort
tasks have a linked triggering invoice, the tiles carry an inline caveat naming
the covered count. July sits at 565/1,481 (38%), which is backlog item 9.

---

### 4b-7. Channel Effectiveness is a billing funnel â and a declined card usually has no invoice (2026-09-08)

The report was rebuilt from a channel league table into the funnel the business
actually asks for:

```
billed â processed on the run â into the campaign â recovered â still outstanding
```

with the recovered pool split into cash that arrived **before any agent touch**
(self-cure in the portal after the dunning email, or an inbound call) versus cash
that arrived **after at least one agent attempt**, then attributed to the person who
keyed it and the kind of call they were on.

**The finding that forced a new source.** CRM writes the recurring invoice when the
charge succeeds, so a failed cycle usually leaves no invoice behind. Billing group
9961 has recurring invoices for 2026-05-01, 06-01, 08-01 and 09-01 but nothing on
07-01, even though a Declined CC task was raised at 07:31:07 that morning â the
gateway declined the $34.95 charge at 07:31:06 and the run never wrote the order.
This is why trigger-invoice coverage sat near 38-47% no matter what: the rows do not
exist to link. Widening the invoice extract to the whole recurring run (below) moved
coverage only 38% â 39%.

Re-tested exhaustively on the 2026-08-01 run (2026-09-08) after the business pushed
back that "X invoices decline, they go into a task". Of the **277** accounts that
declined that day:

| | accounts | detail |
| --- | --- | --- |
| Invoice dated on the run day | 154 (56%) | amount equals the charge to the penny in **all 154**; 103 since paid, 51 still open |
| No invoice for that cycle at all | 123 (44%) | clean run of paid monthly invoices (05-01 P, 06-01 P, 07-01 P) that simply stops at the failed cycle |
| â¦of those, invoice appears later | 22 | in September, when money was finally taken |

> **WITHDRAWN 2026-09-10 â the "44% have no invoice" row above is wrong.** See
> Â§4b-8. Every one of those 277 declines does have a Recurring invoice dated
> 2026-08-01. The 123 were invisible because that analysis matched decline to
> invoice on `BillingGroupID`. The rest of this section â the funnel shape, the
> gateway as the source of `first_result`, the ERROR carve-out â still stands.

So the flow the business describes is right in every respect but one: the invoice is
a record of money taken, not of money owed. **Amount-at-risk therefore cannot come
from invoices** â it has to come from the charge attempt, which is safe precisely
because the two agree exactly wherever both exist. *(Superseded by Â§4b-8: amount at
risk can now come from the invoice, keyed on `PaymentOrderId`.)*

An earlier pass on this same question briefly concluded the triggering invoice was
dated one cycle *earlier* (a 7/1 invoice charged on 8/1). That was an artifact of a
scratch query sorting JavaScript `Date` objects as strings, and is **withdrawn** â
monthly subscriptions bill the same amount every cycle, so amount-matching alone
finds a false ancestor. Any future check here must confirm the candidate invoice was
still *unpaid*, which is what settled it.

`tblPaymentResponseLog` is the gateway's own attempt log and does reconcile. On the
2026-07-01 cycle, taking each billing group's first response of the day: **8,338
groups settled for $789,218 and 299 declined for $36,784**, against **318** "Ops
Accounts Receivable - CC" tasks created that day (the gap is ACH plus same-day
retries). New fact `ie_fact_collections_billing`, grain one billing group per attempt
day, migration `20260908150000_collections_billing_attempts`.

Watch-outs baked into that extract: every charge writes **two** rows (a request row
with a NULL `ProcessorResponseMessage`, then the answer) so unanswered rows must be
filtered or every attempt doubles; the amount lives in the varchar `Amount` column,
**not** `DMAmount`, which is near-zero on almost every row; and the "first result of
the day" `GROUP_CONCAT` must use a `||` separator, because processor messages contain
commas (`Suspected Card (Pick UP, Hot-Card)`) and a comma split truncates the reason.

**Scope: declined CC and declined ACH only.** Check and Expiring CC were tried in the
funnel and pulled back out. Neither is a failed charge â a check is a slow-pay chase
on an invoice we never attempted to run, and Expiring CC chases a card update *before*
anything declines â so neither has a billed â processed â declined run to funnel.
Including them produced two visibly wrong reads: Expiring CC showed $14,876 recovered
against a $0 billed base, and the Check path (sourced from invoices) double-counted,
because unlike a gateway attempt, which is either OK or DECLINED, a dunned check
invoice is usually *also* cash-paid in the end and landed in both stages. They need
their own measures; backlog item 12.

**Invoice extract widened.** It now pulls the whole recurring run (â15.6k rows/month,
223,256 over 13 months) instead of only billing groups that already had a task, and
carries `pm_type` from `tblBillingGroups.PMType` (1 Credit Card / 2 Check / 3 ACH).
With the cycle day that is what assigns a *non-declined* invoice to a campaign pool.

**Call-level attribution.** `ie_fact_call_activity` is a daily (agent Ã direction)
aggregate and cannot say which call a payment came off. New fact
`ie_fact_collections_call` (migration `20260908120000_collections_channel_funnel`),
one row per conversation per agent leg, source pool `phone`. Genesys stores the
caller in `ANI` and the dialed party in `Dnis`, so the customer's number depends on
direction â on outbound, ANI is our own `sip:` URI. The phone DB shares a MySQL
instance with the CRM, so the number resolves against `dmcms_prod` in the same pass
over customer `Phone1/2` and contact `Phone1/CellPhone`. Measured on July 2026
Billing/CS traffic: **77% of outbound and 71% of inbound calls resolve uniquely**,
~10% land on a number shared by several customers and are recorded `AMBIGUOUS` with a
NULL customer rather than guessed.

**Pre/post-agent uses the touch fact directly**, not the recovery fact's
`attributed_touch_seq`. That column only counts numbered ladder rungs, so a payment
following a disposition-only touch would be filed as "pre-agent". The report tests
`EXISTS (touch on the task before the cash landed)` instead.

**ACH returns lag; cards do not.** A declined card raises its task within seconds, so
the billingâtask link was originally matched same-day. ACH is a *return*: it posts
against the cycle date but the task appears 3-21 days later (median ~6), which left
`task_id` NULL on all but 1 of July 2026's 39 ACH tasks. The link is now "earliest
task on the same billing group **and the same campaign**, created on or after the
attempt, within 30 days", with a guard that hands the task to a later decline if one
falls in between (ACH groups do re-present â 112688 declined on both 07-20 and 07-21).
That took ACH linkage from ~0% to 74% and left CC unchanged at ~74%.

Validated end to end on July 2026: billed $1,465,863 â processed $1,366,342 (93.2%) â
into the campaign $99,521 (6.8%) â recovered $38,511 (38.7% of the pool), $11,358 of it
with no agent involved and $27,153 after an attempt. Declined CC (1st) alone recovers
44.3%, Declined CC (16th) 29.2%. `processed + campaign = billed` holds exactly for
every campaign, because `first_result` is one gateway answer per group per day.

**Open: the gateway log does not cover ACH.** Measured on July 2026, the share of
dunning tasks that have any gateway decline behind them within 30 days is 81.6% for
CC (1st) and 84.7% for CC (16th) â but only **46.2%** for ACH (18 of 39). ACH tasks
outnumber ACH declines every month (26/14 May, 28/24 Jun, 39/19 Jul, 26/19 Aug), so
some ACH returns reach CRM by a route other than `tblPaymentResponseLog`. Because the
recovery half counts all tasks in the cohort while the pool counts only logged
declines, ACH reads **132% recovered** â a denominator gap, not a recovery success.
CC is affected by the same gap but far less, so its rate is modestly overstated.

Rather than hide this, the report measures it: `poolCoverage` is the share of the
campaign's dunning tasks that carry a linked gateway decline (July 2026 â CC 1st
79.6%, CC 16th 82.7%, ACH 38.5%), and the page prints a warning under the funnel
whenever it drops below 95%. Per the business, ACH declines arrive a few days after
settlement and *disputes* arrive on no fixed schedule, which is the likely route for
the missing rows. Backlog item 13.

**Cadence.** A completed conversation never changes, so `collections_call` runs a
7-day re-look every 4 hours rather than the 45-day/hourly window the touch and
recovery facts use â the customerâtask resolution is one lookup per call against the
task fact and was the expensive step until `idx_fct_task_cust_created` landed
(backlog item 10). The 4-hour cadence is kept because a completed conversation never
changes, not because the lookup is still costly.

### 4b-8. One declined pool, shared by both reports (2026-09-08)

Channel Effectiveness and Campaign Ã Touch disagreed on the same campaign â August
Declined CC (1st) read $114,680 declined / $32,672 recovered on one page and $30,163
/ $21,263 on the other. Three separate causes, all now fixed:

1. **Our own submission failures were counted as customer declines.** Billing group
   112016 was submitted for **$53,540.93** and came back `Validation Error`; that
   account bills $30.95/month. That single malformed request was 54% of the day's
   declined dollars. The extract now classifies `Validation Error`, `System Error`,
   `Error on Host`, `Invalid Amount`, `Merchant (Account) configuration missing`,
   `CREATED` and `VOIDED` as **`ERROR`** â a third outcome, excluded from the funnel.
   August alone carried 61 Validation Errors and 155 System Errors.
2. **Retries double-counted the pool.** The fact's grain is billing group Ã day, so
   an agent re-keying a card mid-cycle wrote a second row for the same debt: 376
   decline rows across 302 accounts, $15,356 of double-count. Each account is now
   collapsed to its **first non-ERROR attempt** and classified on that, which is also
   what makes `billed = processed + campaign` exact. Filtering to declines *before*
   grouping is wrong â it readmits accounts that processed on the run and only failed
   a later re-key ($1,303 in August).
3. **The two pages measured different things.** Campaign Ã Touch summed at-risk from
   each task's trigger invoice, which per Â§4b-7 exists for ~56% of declines. It now
   calls the same `loadDeclinedPool` helper in `insightsCollections.shared.ts`, and
   takes collected from the recovery fact, so both reports open on one number.

Reconciled end to end against CRM for August Declined CC (1st):

| | CRM | warehouse |
| --- | --- | --- |
| Declined accounts | 280 | 280 |
| Declined dollars | $48,278.92 | $48,278.92 |
| `Ops Accounts Receivable - CC` tasks, Aug 1-15 | 356 | 356 |

Both pages now report **$48,279 declined / $32,672 recovered / $15,607 outstanding**
(67.7%), against the previous $114,680 and $82,008. The invoice link is retained for
the accounts that have one â it answers *how* a payment was made â but is no longer
the at-risk denominator.

---

### 4b-8. The invoice was always there â `PaymentOrderId` is the key (2026-09-10)

Â§4b-7 concluded that a declined card usually leaves no invoice. That is **wrong**,
and it was wrong for one reason: it matched decline to invoice on `BillingGroupID`.

Recurring charges the **site / `tblRecurringItems`** billing group. The invoice
**header** (`tblOrders.BillingGroupID`) is frequently rewritten later to whichever
group ended up paying. So by the time anyone queries, the header points somewhere the
decline never touched. Invoice **1923909** is the worked example: declined
2026-08-01 on group 98280, header now reads 109639, agent took payment 8/4. On the
2026-08-01 run, DECLINED rows matched the recurring-item group 274/281 but the
invoice header only 157/281.

`tblPaymentResponseLog.PaymentOrderId` carries the invoice on **both** the request
and the response, and it is near-universal:

| | answered rows | with order id | declines | declines with order id |
| --- | --- | --- | --- | --- |
| Card, 13 months | 204,620 | 99.5% | 11,669 | 99.7% |
| ACH, 13 months | 14,331 | 99.9% | 186 | 98.9% |
| 1st-of-month cycle | â | â | 4,305 | 100% |
| 16th cycle | â | â | 3,305 | 99.9% |

It resolves to a same-day Recurring invoice for 95-100% of cycle-day declines. All
277 of the 2026-08-01 first declines resolve; 123 of them sit on a different group
than the charge, which is exactly the population Â§4b-7 called missing.

**What changed as a result** (migration `20260910160000_collections_billing_order_id`):

- `ie_stg/ie_fact_collections_billing` gained `order_id` and `charge_last4`. Grain is
  unchanged â 99.92% of cycle-day billing-group-days charge exactly one invoice.
- `collections_invoice.transform.sql` derives `campaign_key` for a **recurring**
  invoice from its own `pm_type` + cycle day instead of inheriting it from a task on
  the same billing group. Inheriting meant a successfully-collected invoice, which
  never raises a task, had no campaign at all â so the denominator only ever
  contained declines. **`pm_type` was superseded the same day â see Â§4b-9.**
- `collections_recovery.extract.sql` gates relevance on the **customer** having an AR
  task, not the invoice header's billing group. The old gate discarded 125 of the 276
  declined 2026-08-01 invoices â every one marked `CASH_PAID` with a zero balance â
  because the header had been rewritten to a group with no task. Recovery rows over
  the 13-month window went from 22,128 to 38,931.
- `collections_recovery.transform.sql` only falls back to billing-group task
  attribution when the payment's order is not a known invoice. Previously the
  fallback fired whenever an invoice had no task, which is the normal state of an
  invoice that paid on time â so the next cycle's auto-payment was claimed by the
  previous cycle's still-open task. That is how September cash was reported as August
  recovery.

New page **Cycle Performance** (`collections_cycle`) reports the run at invoice
grain. Its spine was re-cut the same day â see Â§4b-9 for the figures that stand.

---

### 4b-9. The spine is the RUN, not the billing group's payment method (2026-09-10)

Â§4b-8 assigned a recurring invoice to a campaign using `bg.PMType` + cycle day.
`PMType` is the billing group's payment method **today**, and it drifts away from
what the run actually charged. On 2026-08-01 that misfiled 80 invoices: 75 from the
check run and 5 from the ACH run were counted as Declined CC (1st).

`tblRecurring` is the immutable record of each run:

| column | meaning |
| --- | --- |
| `RecurringID` | PK, one run per payment type per month |
| `StartedOn` | when the run executed (always the 1st) |
| `PaymentType` | 1 Credit Card, 2 Check, 3 ACH |

August 2026 is 520 (card), 521 (check), 522 (ACH); September is 523/524/525.

**A RecurringID is NOT the 1st vs the 16th.** Both passes share it â 520 wrote 7,942
invoices on 08-01 and a further 6,017 on 08-16. The campaign therefore needs the
run's payment type **and** the invoice's own day:

```
PaymentType 1 + day 1..15   -> CC_1_15     PaymentType 3 + day 1..15  -> ACH_1_15
PaymentType 1 + day 16..31  -> CC_16_31    PaymentType 3 + day 16..31 -> ACH_16_31
                                           PaymentType 2 -> CHECK
```

(ACH was a single `ACH` campaign until 2026-09-15; see 4b-13.)

Migration `20260910180000_collections_invoice_recurring_run` adds `recurring_id` and
`recurring_payment_type` to `ie_stg/ie_fact_collections_invoice` (plus
`idx_fci_recurring`), the extract joins `tblRecurring`, and the transform reads the
run. `cycleScope` now requires `recurring_id IS NOT NULL`, so only genuine run output
enters the page.

**Reconciled against `Aug1_2026_Recurring_invoice_review.xlsx` for RecurringID 520 /
2026-08-01:**

| | fact | workbook | |
| --- | --- | --- | --- |
| Invoices | 7,942 / $831,573.20 | 7,942 / $831,573.20 | exact |
| Processed | 7,620 | 7,615 (7,621 corrected) | see below |
| Declined | 270 | 276 (270 corrected) | see below |
| Submission error | 4 / $54,181.93 | 4 / $54,181.93 | exact |
| Never attempted | 48 | 47 | 1 known |

Two reconciliation findings, both resolved in favour of the fact:

- **The workbook over-counted declines by 6.** Invoices 1924327, 1926057, 1926319,
  1926320, 1927371 and 1927379 are recorded there as `first result = DECLINED` with
  `Decline reason = "APPROVED"`. The workbook's OK test matched `SETTLED` and
  `Approved` but not the uppercase `APPROVED` the gateway returns. All six are
  APPROVED in `tblPaymentResponseLog`. True declines are 270.
- **One invoice is lost to the billing fact's grain.** Invoice 1922179 SETTLED on
  2026-08-01, but billing group 111277 charged two invoices that day and
  `ie_fact_collections_billing` is billing-group grain, so only the first keeps its
  `order_id`. 1922179 therefore reads NO_CHARGE. This is the documented <0.1%
  multi-invoice case from Â§4b-8 â 1 row in 7,942 (0.013%). Tracked as backlog item 15.

**Invoice-grain dedupe.** The billing fact is billing-group grain, so an invoice
charged on two groups the same day fans out and a plain join double-counts it â on
2026-08-01 that was 8 invoices and it pushed the outcome rows to 7,950 against a
spine of 7,942. `BILLING_JOIN` picks one winner with a `NOT EXISTS`, and **DECLINED
beats OK**: all 8 declined on the original group and were rescued on a newly created
one the same day, so the run declined and the rescue belongs in stage 3.

**Stage 2 (task activity).** Tasks attach by `customer_id` within the invoice's own
pass â 1st-15th, or 16th to month end â earliest task wins. On the 2026-08-01 run all
270 declines had a task raised, and $37,782 of $45,063 came back (84%). The status
split also reproduces the workbook's "Paid with no cash" problem: 228 tasks closed as
Paid against $37,557 collected.

**Two joins had to be de-correlated to make the page load.** Neither changes a
number; both were verified to return identical results.

- *Task attachment.* Expressing the pass as `created_on BETWEEN order_date AND
  <computed end>` forces a per-invoice probe, and `ie_fact_collections_task` has no
  index on `customer_id` at the time (backlog item 10, fixed 2026-09-15) â it exceeded the statement timeout on one
  run day. Both sides now carry a half-month pass key and the 19k task rows are ranked
  once. Equivalent because a run only writes on the 1st or the 16th, so the invoice is
  always the first day of its own pass.
- *Card re-key detection.* `uq_fcb_bg` leads on `date_key`, so `billing_group_id`
  cannot be seeked and the correlated EXISTS scanned the billing fact once per result
  row â ~10s of an ~11s load. The 194,717 successful charges now pre-aggregate to
  28,877 `(billing group, last4)` pairs with `MAX(date_key)`, which answers "is there
  a later OK charge on a different card" exactly.

A full August (15,143 invoices) went from ~16s to ~3.3s, and recovery paths still
read 122 / 57 / 52 / 46 as in Â§4b-8.

**Grid dates are formatted in SQL.** mysql2 returns a `DATE` as local midnight, so
`String(row.order_date)` rendered an 08-01 invoice as `Fri Jul 31` in any timezone
behind UTC. `DATE_FORMAT(..., '%Y-%m-%d')` keeps the calendar day the DB stores, per
[.cursor/rules/date-handling.mdc](../.cursor/rules/date-handling.mdc).

---

### 4b-10. Repeat declines on "Why the Charges Failed" (2026-09-11)

**A repeat is the same BILLING GROUP declining again within twelve months.** The
billing group is the unit because the card lives there, so a repeat means the same
card is still on file and still failing. The first decline of a card is unavoidable;
every one after it is a failure we generated and then paid an agent to chase.

Implemented as `REPEAT_JOIN` / `IS_REPEAT` in
[cycle/scope.ts](../backend/src/services/insights/collections/cycle/scope.ts). Two
things to know before changing it:

- **Only the nearest prior decline matters.** If the closest earlier decline is more
  than a year back then none is inside the year, so a single `LAG(date_key) OVER
  (PARTITION BY billing_group_id ORDER BY date_key)` answers it. The obvious
  self-join pairs every decline with every earlier decline on the same group, and
  `uq_fcb_bg` leads on `date_key` so there is no index on `billing_group_id` to join
  through â it hit the statement timeout outright. Same root cause as the re-key
  join above.
- **`date_key - 10000` is exactly one year back**, because `date_key` is YYYYMMDD.
- **The fact holds a rolling 15 months**, so the earliest months in the warehouse
  have under a year of history behind them and under-report repeats.

August 2026, all declined campaigns: **181 of 536 declines (34%) worth $25,635** came
from a group that had already declined inside the year. The mix contradicts the
working assumption that insufficient funds is the bucket worth chasing:

| Reason | Declines | Repeats | Repeat rate |
| --- | ---: | ---: | ---: |
| Insufficient Funds | 119 | 61 | **51%** |
| Refer to Issuer | 19 | 13 | **68%** |
| Do not honor | 157 | 48 | 31% |
| Suspected Card (Pick UP, Hot-Card) | 63 | 17 | 27% |
| Invalid service | 42 | 10 | 24% |
| Closed Account | 60 | 14 | 23% |
| Invalid Card | 46 | 13 | 28% |
| Expired Card | 7 | 0 | 0% |

Insufficient funds is the most *chronic* reason, not the most recoverable one â over
half of it is the same groups failing over and over. That is a payment-date or
payment-method conversation, not another call on the same schedule. Expired Card, by
contrast, never repeats: the existing `EXP_CC` campaign is already clearing those.

---

### 4b-11. Who took the payment â self-service is the biggest channel (2026-09-11)

`ie_fact_collections_recovery.processor_crm_id` is `tblPaymentsCredits.CreatedBy`, and
it already identifies the payer â no schema change was needed to split it out. The ID
spaces decode it: `tblSalesPeople.UserID` tops out at **201**, so anything above that
is a `tblContacts.ContactID`, the customer's own portal login. `0` is the automated
recurring charge and `12` is the "Recurring Service" system account.

**Classified without a numeric threshold**, in `cycle/joins.ts` (`PROCESSOR_RANK`):
AGENT is already exact on `processor_kind` and 0/12 are exact, so everything left over
is self-service. A cut at "â¤ 201" would silently reclassify agent 202 as a customer the
day they are hired. The only impurity is non-AR staff (UserID 80 "Dealer User", 181,
29) landing in self-service â 175 of ~40,000 rows warehouse-wide and none on a declined
run. Dealer User is a portal login anyway.

Ranked rather than `MIN(processor_crm_id)`, which would let the system account (0)
outrank a real agent on a split payment. No invoice currently has payments from two
classes â verified zero across the warehouse â but the rank keeps it defensible.

August 2026, all declined campaigns (536 declines, $70,987 invoiced, $56,288 back):

| Who | Invoices | Cash | Share | Average |
| --- | ---: | ---: | ---: | ---: |
| Self-service (portal) | 218 | $34,233 | **61%** | $157 |
| Agent | 207 | $21,466 | 38% | $104 |
| System (auto) | 5 | $589 | 1% | $118 |
| Not recovered | 106 | â | â | â |

**The customer's own portal is the largest collections channel we have**, and at a
higher average ticket than the agents. Section 2 is titled "What AR Did About It", but
three-fifths of the money arrives without AR touching it.

By touch band (invoice counts):

| Touches | Total | Self-service | Agent | System | Unpaid | Recovery |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 0 | 138 | 75 | 61 | 2 | 0 | **100%** |
| 1 | 139 | 74 | 62 | 2 | 1 | 99% |
| 2 | 76 | 31 | 38 | 1 | 6 | 92% |
| 3+ | 182 | 38 | 46 | 0 | **98** | **46%** |

**Read the bands as a symptom, not a cause.** Extra touches do not lose the money â an
account that pays on the first notice is never touched again, and one that will not pay
keeps getting worked. What the split does show is where effort sits: the 3+ band holds
**92% of all failures** while returning 21% of the cash.

The per-status split also puts a number on the known "closed as Paid, no cash" problem:
of 446 invoices on tasks closed **Paid**, 217 were paid by the customer, 201 by an
agent, 5 by the system, and **23 had no cash applied by anyone**. That gap is the page's
"No cash" column.

---

### 4b-12. Stage 3 re-cut on what the customer had to do (2026-09-11)

Backlog items 16 and 17 applied. `PATH_CASE` now tests cash first, and the two
card paths are merged, because they were one business event split by a CRM
implementation detail. August 2026, all declined campaigns:

| Path | Invoices | Cash | Was |
| --- | ---: | ---: | --- |
| New card provided | 267 | $35,638 | 197 "New billing group" + 70 "Card re-keyed" |
| Original card retried | 111 | $13,291 | "Same group, same card" |
| Written off | 105 | $0 | "Credit memo" |
| Another card on file | 51 | $7,358 | part of "New billing group" |
| Still open | 2 | $0 | "Not recovered" |

**64% of recoveries needed a new card**, which is the number that ties stage 3 back to
the dead-card decline reasons in Â§4b-10. The stages now reconcile: stage 3's written
off plus still open is 107, and stage 2's Not recovered is 107. Recovered cash agrees
to $1, which is independent `Math.round` on two different groupings, not a data gap.

**The new-card split is a proxy.** `tblBillingGroups.CreatedOn` is not warehoused, so
"did this billing group have any charge before the decline" stands in for "was this
group created for this card". Measured against CRM's real `CreatedOn` on the 248
August cases it agrees on 239 (96%); the 9 differences are groups created in the few
days *before* the decline, which the proxy sees as pre-existing. Landing the real
creation date on the recovery fact would make it exact and needs sign-off.

Stage 2's processor split is also gated on `collected > 0` rather than on a recovery
row existing. One August invoice had payments netting to zero, which counted as
"processed by someone" and left the two stages one apart.

---

## 4c. Known issues backlog â work one-by-one (after reviewing live data)

Tracked so we can knock these out individually. Each is real-data-safe today
(nothing stubbed) but is an approximation or follow-up, not a bug. Tick as done.

0. [ ] **Tasks closed as "Paid" with no money behind them â task recovery rate is
   overstated.** Surfaced 2026-09-08 while validating the August Declined CC (1st)
   outstanding list. Of the 280 accounts in that campaign, **218 tasks were closed
   `Paid` but only 129 have any payment row in CRM since the run** â 89 tasks
   ($15,817 declined) have none at all, and only $1,315 of money of any kind moved
   on them. Cash-based measures are unaffected (`atRisk` / `collected` / the funnel
   all read the gateway log and the recovery fact), but `taskRate` and the
   `outcome = 'PAID'` counts treat all 218 as recoveries.
   Ruled out as causes: the recovery fact is **not** dropping cash by order type â
   every applied payment on these accounts sits on a counted type (Recurring
   $28,431, Order $3,467, Reactivation $791; nothing on the ignored types). So this
   is a CRM data-entry question, not an ETL gap. Needs a business answer on what
   CSRs mean by `Paid` when no payment exists (downgrade? cancelled? worked
   elsewhere?) before deciding whether to keep, re-label, or exclude those tasks.
1. [ ] **Calls are not tied out; the columns are hidden.** Superseded 2026-09-17 by
   4b-14: agent call effort now resolves to the *task* (invoice -> task -> call on
   `ie_fact_collections_call`), but only 37-64% of a collector's calls carry a task,
   so the figures are a floor and sit behind `CALL_LINKAGE_CONFIRMED`. Linking calls
   to tickets and tasks directly is the pending work; splitting effort by **rung**
   remains after that. Original entry, for context:
   **Per-touch calls / talk minutes = 0.** Call effort can't yet be split by
   touch (no touchâcall linkage). Agent-level calls/talk **are** live (from
   `ie_fact_call_activity`), and Channel Effectiveness now resolves calls to the
   *task* via `ie_fact_collections_call` (Â§4b-7) â attaching them to a specific
   **rung** is what remains.
2. [ ] **Subscription MRR is a proxy.** Uses the activating order-part price;
   counts are exact, MRR is best-effort until the recurring-charge join lands.
3. [ ] **`status_at_outcome` = task's final status**, not the exact status at the
   termination instant; noisy when a billing group has mixed per-sub outcomes.
4. [ ] **Overview `dollars_per_talk_hour`** uses collections-agents' **total**
   talk time (all calls), not collections-only calls.
5. [x] **Recoveryâtask attribution** â fixed 2026-09-07 (Â§4b-2.4): a payment now
   inherits its task from the invoice it was applied to. The remaining heuristic is
   only `attributed_touch_seq = MAX(touch_seq â¤ applied_on)`; tighten once
   invoice-level touch linkage (`tblActionOrder`) is loaded.
6. [ ] **Invoice / subscription facts are agent-agnostic**, so SELF/DEPARTMENT
   scope only narrows agent-keyed metrics (recovery/touch/task). Campaign-level
   tiles (recovery rate, open declines, sub outcomes) stay org-wide for a scoped
   viewer. Only matters if a non-ALL role is granted â Admin/Manager are ALL today.
7. [ ] **Disposition touches carry no rung.** Moves to a terminal/holding status
   (`Paid`, `Promised To Pay`, `Credit Memo - *`, `Duplicate`, `Reactivated`,
   `Not Reactivated - *`) are real agent work â 150 of 827 CC-1st touches in June â
   and they count toward agent totals and contact frequency, but they have
   `touch_seq = NULL` so they stay out of the numbered call ladder. Confirm with mgmt
   that the ladder should show only numbered rungs, or add a "disposition" bar.
8. [ ] **The Check campaign has almost no numbered ladder.** Its cadence is
   `Invoice Generated #1-10`, which is an invoice/email track rather than a call, so
   it is `phase = 'INVOICE'` with a NULL rung (1,271 of 1,332 June touches
   unnumbered). Decide whether Check's marginal-recovery view should plot the
   invoice track, or stay effort-only.
9. [x] **Trigger-invoice coverage is ~39-47% of tasks** â *explanation corrected*
   2026-09-10 (Â§4b-8). The 2026-09-08 conclusion below ("a declined card writes no
   invoice") was an artifact of joining on `BillingGroupID`; the invoices exist and
   are reachable via `PaymentOrderId`, now landed as `ie_fact_collections_billing.order_id`.
   Superseded text kept for history: ~~A declined card usually writes no
   invoice at all, so roughly half of dunning tasks have nothing to link to. Amount
   at risk for card campaigns should therefore be read from
   `ie_fact_collections_billing` (the declined charge amount), not from the invoice
   fact.~~ Campaign Ã Touch still sources `atRisk` from invoices â moving it onto the
   billing fact is the follow-up.
10. [x] **`ie_fact_collections_call` transform is slow** (~80s per 1,900 calls) —
   *resolved 2026-09-15* by migration `20260915160000_task_fact_customer_created_index`,
   applied with sign-off. Each call does one lookup for the latest AR task on that
   customer, and `ie_fact_collections_task` had no index on `customer_id` at all:
   `EXPLAIN` reported `possible_keys: NULL`, so both the outer join and its
   `NOT EXISTS` tie-break scanned every task row per staged call. With
   `idx_fct_task_cust_created (customer_id, created_on)` both collapse to
   `type: ref` / `rows: 1` with `Using index condition` — the 60-day lookback
   resolves inside the index, which is why the timestamp is the second column —
   and a full 5,480-call window now evaluates in 0.13s. Selectivity is ~11.5k
   distinct customers over ~22.8k rows. Prior mitigation, kept as the cadence but
   no longer load-bearing for performance: running a
   7-day window every 4 hours instead of 45 days hourly, so the steady state is fine;
   the one-off 13-month backfill took a couple of hours. Original note, which called
   the fix correctly: an additive index on
   `ie_fact_collections_task (customer_id, created_on)` would remove it â needs
   sign-off before altering the table.
   The same missing index bit Cycle Performance stage 2 on 2026-09-10: a correlated
   per-invoice task lookup exceeded the statement timeout on a single run day. Worked
   around without touching the schema by stamping both sides with a half-month pass
   key and ranking the 19k task rows once (`TASK_JOIN` in `cycle/scope.ts`). That
   workaround is correct and stays as-is — it is not worth unwinding a verified query
   — but with the index in place the simpler correlated form is viable should
   `TASK_JOIN` ever need to change.
11. [ ] **Ambiguous phone numbers are unattributed.** ~10% of collections calls hit a
   number held by more than one customer; they are stored `match_kind = 'AMBIGUOUS'`
   with a NULL customer and counted as effort but not credited to a campaign. A
   billing-group or contact-level tie-break would recover most of them.
12. [ ] **Check and Expiring CC have no funnel.** Both are out of Channel
   Effectiveness (Â§4b-7) because neither starts with a failed charge. Check needs an
   invoice-aged view (billed â cleared on the run â chased â cleared late); Expiring
   CC needs a card-update funnel (notified â card updated â next cycle processed).
   Until then they are measured only on Campaign Ã Touch and Agent Performance.
13. [ ] **ACH decline intake is only ~39% covered.** ACH dunning tasks outnumber the
   returns visible in `tblPaymentResponseLog` roughly 2:1, so the ACH campaign pool is
   understated and its recovery rate reads over 100%. Surfaced on the page via
   `poolCoverage` rather than hidden. Note (2026-09-10): the gap is *task volume*, not
   the log's order-id fill â ACH rows carry `PaymentOrderId` 99.9% of the time. ACH
   declines are simply rare: 186 in thirteen months, ~14/month, 134 on cycle days, so
   ACH cannot carry its own trend and works only as a filter.
   Business says returns post a few days after
   settlement and disputes arrive whenever they arrive â find where those land before
   trusting the ACH funnel. CC coverage is ~80-83%, mildly overstating CC rates too.
   Cycle Performance no longer hides this: an ACH invoice with no gateway row reports
   as `PENDING_ACH` ("the bank has not reported back yet") rather than sharing the
   card `NO_CHARGE` bucket. On 2026-09-10 the September run had 671 of 679 ACH
   invoices unanswered against 45 of 8,049 card, so folding them together made
   settlement lag look like the largest failure on the page.
14. [ ] **The other four Collections pages are on a different spine.** Channel
   Effectiveness, Campaign Ã Touch, Overview and Agent Performance still count
   **billing groups** and still derive campaign from `bg.PMType` + cycle day. Cycle
   Performance counts **invoices** off `tblRecurring` (Â§4b-9). The two will disagree â
   on 2026-08-01 the PMType rule misfiled 80 invoices â and Cycle Performance is the
   one that reconciles to CRM. Retarget the four onto `recurring_id` + the invoice
   pool; until then, treat their campaign splits as approximate.
15. [ ] **One invoice per run is lost to the billing fact's grain.**
   `ie_fact_collections_billing` is billing-group grain, so when a group charges two
   invoices on the same day only the first keeps its `order_id`; the second reads
   `NO_CHARGE` even though it settled. On the 2026-08-01 run that is invoice 1922179
   â 1 row in 7,942 (0.013%). Fixing it means either an invoice-grain billing fact or
   a second order-id column, both of which touch all five Collections pages, so it is
   deliberately deferred rather than patched in the read layer.
16. [x] **"New billing group" on stage 3 was mislabelled â it is a CARD change, not an
   account move.** *Fixed 2026-09-11, see Â§4b-12.* Verified against all 248 August cases: **248 of 248 are
   the same `CustomerID`. Zero are account-ownership changes**, which is what the path
   name and the section description both claim. What actually happens is that CRM
   creates a *new billing group row* to hold a replacement card rather than updating
   the existing one, then repoints the invoice header at it â 206 of the 248 paying
   groups were created on or after the decline date, and 235 of 248 carry a different
   `Last4`. The remaining 42 are a genuinely different event: the customer paid from
   another card already on file.
   So "New billing group" (248) and "Card re-keyed on same group" (70) are the same
   business event split by a CRM implementation detail, and the page tells operators
   they are "a card problem" versus "an account-ownership problem". They are both card
   problems. Note the payment's own `tblPaymentsCredits.BillingGroupID` is NOT the
   cause â it matches the order header 16,300 of 16,384 times in August; the header
   itself is what gets rewritten.
   Proposed re-cut, by what the customer actually had to do: gave us a different card
   (276 = 206 new group + 70 re-keyed), used another card already on file (42),
   original card eventually worked (111), written off (105), still open (2). The
   new-versus-pre-existing split needs the paying group's creation date, which is not
   in the warehouse â either proxy it by whether the group has prior rows in
   `ie_fact_collections_billing`, or land the date (needs sign-off).
17. [x] **Stage 3 hid a recovery behind a credit memo.** *Fixed 2026-09-11.* `PATH_CASE` tested
   `credit_memo_amount > 0` *before* it tests for cash, so an invoice that was both
   written off and partly paid reports as "Credit memo". In August that is 1 invoice,
   and it is why stage 3 shows "Not recovered" = 2 while stage 2 shows 106 (the other
   104 are memos). Reordering so cash wins makes the two stages reconcile: 104 written
   off + 2 still open = 106.
18. [x] **"Never attempted Â· other" was mostly a run defect, not a card problem.**
   *Fixed 2026-09-11.* Owner challenged the size of the August bucket â 25 invoices,
   every one settled later by hand â on the reasonable theory that they were expired
   cards we had failed to detect. Three of them were. The other 22 were not, and the
   real cause had never been measured. Validating the whole 2026-08-01 card run
   (`PaymentType = 1`, `OrderTypeID = 3`) against `tblRecurringItems`: **7,917 invoices
   had a payment request sent and confirmed, 23 had a request sent that was never
   confirmed, and 2 never had a request sent at all.** Nineteen of the 25 are in the
   unconfirmed group and their cards are in date, several for years (1922043 runs to
   07/2031); they are stamped between 04:03:57 and 04:04:10 â one run stumbling once,
   not twenty-three customers. `PayAuthStartedOn` / `PayAuthFinishedOn` are CRM's names
   for the request going out and the confirmation coming back and are **not** a card
   authorisation hold; that wording stays in SQL comments and out of the UI. Counted
   per invoice rather than MIN'd, since the table is per service item and a partially
   completed charge must not read as finished. Three changes shipped together:
   - `pay_request_state` on the invoice staging + fact. **Superseded 2026-09-13 by
     finding 19** â the first cut read only `tblRecurringItems`, which records CRM's
     intent and not what was actually submitted.
   - **The card-state UNKNOWN guard was too broad.** It refused to judge any billing
     group whose `CreatedOn` post-dated the invoice â but CRM *rewrites* `CreatedOn`
     when a card is re-keyed in place, so it fired on exactly the customers who fixed
     their card. Group 76262 reads `CreatedOn` 2026-08-03, the moment the same card
     (last4 5032 either side) had its expiry extended to 07/2029, while the archive
     shows it expired 07/2026 â dead on the 08-01 run. The guard now only applies when
     the extract fell back to the live group (`card_from_archive = 0`), which moves
     1921155, 1924984 and 1932443 into `EXPIRED`.
   - **`PATH_CASE` mislabelled new cards for this bucket.** Both group-comparison
     branches read `b.billing_group_id`, and `b` does not exist for a never-attempted
     invoice, so the comparison was skipped and every paid row fell to "Original card
     retried". It now falls back to `i.card_billing_group_id`. On 08-01 that is 5 of
     the 20 paid rows (1924392, 1921770, 1921949, 1924970, 1924658), each paid from a
     113xxx group created 2026-08-04 with no prior billing history.

   Migration `20260911200000_collections_invoice_pay_request_state`; `collections_invoice`
   reloaded 2025-06-01 â 2026-09-11 (256,061 rows, 0 errors).
19. [x] **"Never attempted" was claiming we skipped invoices we had demonstrably
   charged.** *Fixed 2026-09-13.* Owner pushed back on the label from finding 18: an
   invoice with a payment request outstanding **was** attempted, so filing it under
   "never attempted" is self-contradictory. Correct, and validating it exposed a second
   defect underneath. `pay_request_state` was derived purely from
   `tblRecurringItems.PayAuthStartedOn`, which only proves CRM's code entered the
   payment step â **not** that anything was submitted. `tblPaymentResponseLog` is the
   record of what actually went out: every charge writes a request row with a NULL
   `ProcessorResponseMessage` first, then the processor's answer. The two sources
   disagree, and the disagreement is the finding.
   - Invoice 1922467 (owner's test case) is **not** an expired card and never was.
     Group 78096 has carried the same card since 2023-10-13 â expiry 09/2028, last4
     1008 â in every archive snapshot bracketing the run (2026-03-21 and 2026-08-04)
     and in the live row today. Gateway request row 3454889 at 04:04:07 for $1,149.93
     on last4 1008, no answer; it settled untouched on that same card on 08-04 for the
     identical amount ($1,149.39 + $0.54).
   - **Of the 19 unconfirmed invoices on 08-01, 17 have a gateway request row and 2 do
     not.** 1923231 and 1924392 are stamped 04:04:10 and 04:04:09 â the two LATEST in
     the run â with no gateway row at all. The run wrote the CRM stamp, then wrote the
     gateway row, and died between the two on its last two invoices. Calling those an
     attempt would be false.
   - So the state splits four ways â `CONFIRMED`, `NO_RESPONSE` (submitted, unanswered),
     `UNSUBMITTED` (CRM started, nothing reached the gateway), `NOT_SENT` â all within
     the existing `VARCHAR(12)`, so **no migration**. `RESULT_CASE` promotes
     `NO_RESPONSE` to a first-class outcome beside `ERROR` (both are our failures) and
     tests it **before** the card, so the page can never claim we skipped an invoice we
     submitted. `EXPIRED` + `NO_RESPONSE` occurs zero times in 15 months, so the
     ordering changes no row today; it is there to keep the labels honest. The two
     remaining never-attempted buckets are expired card and no request sent, the latter
     folding in `UNSUBMITTED`, `NOT_SENT` and NULL â from the customer's side nothing
     went out either way, and the column keeps them apart for drill-down.

   08-01 CC_1_15 + ACH is now **8,283 OK / 277 declined / 4 error / 17 no response /
   27 expired / 4 no request sent**. Reconciliation, to the cent: buckets sum to 8,612
   invoices and $922,430.89, matching the spine; the fact ties to CRM exactly for the
   full day (9,131 invoices, $1,397,623.91 invoiced, $1,308,838.24 cash, distinct
   orders = row count, so no fan-out); and the reclassification is closed â $230.63
   left `NO_RESPONSE` (19/$2,394.27 â 17/$2,163.64) and $230.63 arrived in no-request-
   sent ($104.27 â $334.90). Twenty-one card invoices carry the `NO_RESPONSE` state
   that day; the four not in the bucket got an answer on a retry and correctly report
   it (1919544 and 1922534 Validation Error, 1924964 and 1924959 Approved, $54,180.68
   together â and $2,163.64 + $54,180.68 = $56,344.32, the full 21).

   **This has happened before.** Card invoices with a submitted, unanswered charge, by
   run day: 2025-07-16 (2), **2025-10-01 (5, $50,889.30)**, **2025-10-16 (14)**,
   2025-12-01 (2), 2026-04-16 (2), **2026-08-01 (21)**. October 2025 is a second
   incident of the same shape. The metric now exists to catch the next one on the day
   it happens. Note the 672 `UNSUBMITTED` in September 2026 are **all ACH**, which
   reports as `PENDING_ACH` before the request state is consulted, so they never reach
   a never-attempted bucket.

---

### 4b-13. ACH runs on the 1st and the 16th too (2026-09-15)

Card was split into two campaigns from the start. ACH never was: every ACH invoice,
attempt and task went into one `ACH` campaign whose `cycle` was recorded as `NA`. It
was the only instrument whose two cycles could not be compared with each other, and
the single bucket was averaging two genuinely different books of accounts.

**The 16th pass is not a rounding error.** ACH recurring invoices by pass, from
`ie_fact_collections_invoice`:

| run month | 1st pass | 16th pass |
| --- | --- | --- |
| 2026-06 | 656 / $72,312 | 504 / $22,892 |
| 2026-07 | 662 / $74,040 | 512 / $23,245 |
| 2026-08 | 670 / $90,858 | 514 / $23,120 |

The 16th is ~44% of ACH invoice count but only ~20% of ACH dollars, because its
average invoice is about a third the size of the 1st's ($45 vs $136 in August). That
ratio is the reason the blend was misleading rather than merely coarse.

**Where the day comes from, per fact.** Two of them are exact and two are inherited:

| fact | day source | exact? |
| --- | --- | --- |
| invoice | `order_date` | yes â it IS the run date |
| billing | `attempt_date` | yes â an ACH return posts against its cycle |
| task | the ACH run behind the task | 87.5%, else `CreatedOn` |
| touch / subscription | inherited from the task fact | n/a |

**A task cannot be split on its own created date, and this is the whole difficulty.**
A declined card raises its task in the same second, so `DAY(CreatedOn)` is the run day
for `TaskTypeID` 1. An ACH return does not behave that way. Measured over the 15 months
to 2026-09-15 (1,008 ACH tasks): the lag from run to task averages **11.8 days** and
reaches **26** â roughly double the ~6-day median recorded earlier in this doc. The two
passes' task windows therefore overlap, and no created-date rule can separate them: a
1st-run task raised on the 20th reads as the 16th, and a 16th-run task raised on the
3rd of the next month reads as the 1st.

So `collections_task.extract.sql` looks up the run instead, in two temporary tables:
the dates the ACH run billed each billing group (keyed on
`tblRecurringItems.BillingGroupID`, **not** the rewritten invoice header), then the
latest such run at or before each task. Measured:

- **87.5%** of ACH tasks (882 of 1,008) resolve to a run. Of those, the created-date
  rule would have misfiled **21** into the wrong pass.
- **30 days is where coverage plateaus**, not a guess: 21d â 86.6%, 30d â 87.5%,
  45d and 60d â 87.8% both. The remaining ~12% have no ACH run on their billing group
  at any lookback, so widening only risks reaching past a cycle boundary.
- **`MAX()` cannot pick the wrong pass.** A billing group belongs to one cycle: across
  1,669 distinct ACH groups over the window, only **3 group-months** were billed on
  both the 1st and the 16th.

The gateway log was considered as a second source and rejected. It would need the whole
of `tblPaymentResponseLog` joined to `tblBillingGroups`, and it would have to classify
ACH off `bg.PMType` â the billing group's method *today*, the exact drift 4b-9 removed.
The recurring run is authoritative and resolves a same-day invoice for 95-100% of
cycle-day declines, so it carries the attribution alone.

**One derivation, not three.** The touch and subscription facts used to re-derive the
campaign from `TaskTypeID` with their own copy of the rule. They now inherit
`campaign_key` from `ie_fact_collections_task` in their transforms (`task_id` is unique
there, so no fan-out), with the staging value surviving only as a fallback for a touch
on a task older than the task fact's window. That removes the triplication rather than
tripling the new lookup.

**Rollout.** `20260915140000_collections_ach_cycle_split` seeds `ACH_1_15` / `ACH_16_31`
and retires `ACH` to `sort_order` 99, keeping it as a decode only - it is not in
`DECLINED_CAMPAIGNS`, so no report scopes to it. The migration carries **no data
backfill**: re-deriving `campaign_key` in a migration would be a second copy of a rule
the SQL files own. **Until the facts are re-ingested, ACH reads as zero on every
declined-charge report**, so a rename like this is not complete at deploy time.

**Only re-extract the facts whose SQL actually changed.** Seven facts carry
`campaign_key`, and they do not all earn it the same way, so a blanket 15-month reload
of all seven is the wrong instrument - it re-derived ~800k rows from CRM and the phone
system to change one column on ~3% of them, and `collections_call` alone re-extracts
~243k call rows to correct a few hundred:

| fact | how it gets `campaign_key` | needs a re-extract? |
| --- | --- | --- |
| task | derived (the ACH run lookup) | **yes** - extract changed |
| billing | derived (`attempt_date`) | **yes** - extract changed |
| invoice | derived (`order_date`), task as last fallback | **yes** - transform changed |
| recovery | derived from its own joins | **yes** |
| touch | copies the task fact via `task_id` | no |
| subscription | copies the task fact via `task_id` | no |
| call | copies the task fact via `task_id` | no |

For the bottom three the link is already stored, so once the task fact is correct the
value can be carried across in one indexed statement per fact - which is what their
transforms do anyway, not a re-derivation:

```sql
UPDATE ie_fact_collections_touch f
  JOIN ie_fact_collections_task t ON t.task_id = f.task_id
   SET f.campaign_key = t.campaign_key
 WHERE f.campaign_key <> t.campaign_key;
```

Seconds instead of tens of minutes. Reserve the full chunked
`run-source-backfill` pass for a real historical rebuild - a changed extract, a new
column, or a first load on stage/prod - where the 15-day chunking is genuinely what
keeps each extract inside the statement timeout.

**Known consequence to watch.** `collections_billing.transform.sql` links a decline to
its task on matching `campaign_key`, so both sides had to split in the same release.
Where a task falls into the ~12% that use the created-date fallback and lands in the
wrong pass, its gateway decline can no longer link to it.

**Verified after the reload** (15 months, local warehouse). The task attribution holds
up against an independent source: of 861 ACH tasks that link to an invoice, the task's
campaign agrees with its linked invoice's campaign on **859 (99.8%)** - 788 on the 1st,
71 on the 16th - with the only two disagreements being `CHECK`, a payment-method
mismatch rather than a cycle one.

**The task split is far more lopsided than the billing split, and that is real.**
Invoices bill 58% / 42% across the two passes, but declines run **805 / 103** and tasks
**862 / 161** - roughly 85% on the 1st. The 1st pass is not bigger by much in volume, it
is bigger in ticket size ($136 average invoice vs $45), and the large-ticket ACH debits
are the ones that fail. Do not read the task skew as an attribution bug; it is the same
signal the dollar split shows.

---

### 4b-14. Overview, Channel Effectiveness and Contact Frequency retired; call columns parked (2026-09-17)

Three pages were removed and one set of columns was hidden. The Collections section is now
Cycle Performance, Cycle Invoices, Failed Charge Invoices, Campaign & Touch and Agent
Performance. Everything below the fold in sections 4b-7, 4b-8 and 4b-11 remains an accurate
record of why those reports were built the way they were - it is kept as history, not as a
description of the current UI.

**Overview is gone**, and with it the last of `insightsCollections.service.ts`, which had
already lost Campaign & Touch, Agent Performance and Contact Frequency to their own
modules. Its KPIs were calendar-scoped against `agentScope` rather than anchored to a
declined invoice set, so they never reconciled with the reports below them - the same
class of defect 4b-8 and the declined basis were introduced to fix. Cycle Performance is
the section's entry point now. Its `col_*` KPI definitions stay in the frontend catalog:
Campaign & Touch still reads `col_recovery_rate` and `col_first_touch_success` for metric
tooltips, and the catalog is looked up by code rather than enumerated as a page menu.

**Channel Effectiveness is gone**, and the gateway declined pool went with it. The pool
(`declinedPool.ts`) read the billing attempt log at BILLING GROUP grain to work around
CRM not writing an invoice for a failed charge. That stopped being true once the invoice
extract was fixed - of September's 358 declined pool groups, 358 have an invoice and zero
do not - so by the end it contributed only its own error, and survived purely because
this one page still read it. Its two still-useful pieces, the `SqlFragment` shape and
`scopedCampaignKey`, moved into `declinedBasis.ts`. The funnel's two genuinely reusable
measures - the pre/post-agent split and the processor breakdown - had already been
extracted to `recoveryAttribution.ts` and now serve Agent Performance alone.

**Contact Frequency is gone**, along with the `CONTACT_CAP` 7-in-7 constant. Nothing else
referenced it.

All three page rows are deactivated rather than deleted in `ie_page`
(`20260917140000_retire_collections_channels_contact` and
`20260917170000_retire_collections_overview`), because `ie_page_role_access` grants hang
off the page id and an admin may have added roles since the original seed. Restoring any
of them is a single `is_active` update rather than a re-grant.

**Call and talk-time columns are hidden, not removed** - see `CALL_LINKAGE_CONFIRMED` in
`CollectionsAgentPerformancePage.tsx`. Calls now reach a task through the invoice
(`invoice -> task -> call` on `ie_fact_collections_call.task_id`), which is the right
chain, but a call only attaches when its caller ID resolves to exactly one customer.
Measured over September, that covers 37-64% of a collector's calls depending on the
collector; the remainder hit numbers matching no customer or several. Talk time is
therefore a floor and $/talk-hour a ceiling, by a margin we cannot size. Linking calls to
tickets and tasks directly is the pending work that closes it; when it lands, flip the
flag. What stays visible is the part that reconciles to the invoices: cash, payments,
tasks and touches.

This also retires the old read of `ie_fact_call_activity` for agent call effort. That
daily roll-up carries no task, so it measured a whole month's phone work regardless of
which debt it served - and it had silently fallen four weeks behind, rendering the
columns as zeros for any September cycle.

---

### 4b-15. Pre-stage code review: findings and one open item (2026-09-17)

A full review of the Collections code against the project rules ahead of promotion.
Five violations were corrected in place: two hand-built `<table>` blocks in the
Campaign x Touch panels moved onto the shared `SortableTable` (they had no sort
affordance at all); `BarRow`'s tooltip lost its info-icon button so the row itself is
the trigger; the chart's hand-picked `#cbe9f7` became brand primary at 35% opacity;
Campaign x Touch and Agent Performance started passing `nextUpdate` /
`updateEveryMinutes` alongside `lastUpdated`, which the backend had been returning all
along; and the controller's private `resolveScope` was deleted in favour of the shared
`resolveAaScope` that Missed Opportunities and Call Length already import - two copies
of an authorization gate being the worst place to let drift happen.

`collections_subscription` was an active daily feed whose `ie_dataset_monitor` row sat
at `is_active = 0`, leaving Subscription Outcomes outside WARN/RED alerting. Flipped by
migration `20260917190000_activate_collections_subscription_monitor`.

**The campaign vocabulary is now database-owned.**
`ie_dim_collections_campaign` was seeded with all eight campaigns - label, instrument,
cycle, `success_kind`, colour, sort order - and no application code read it. The runtime
source was `CAMPAIGN_LABEL` / `DECLINED_CAMPAIGNS` in `insightsCollections.shared.ts`,
mirrored a third time by `DECLINED_CAMPAIGN_OPTIONS` in the frontend's
`insightsFilterOptions.ts`. Two of the three had already drifted: the dimension said
`EXP_CC` was "Expiring Credit Card" while the code said "Expiring CC". That class of
drift is silent - the label is the wire value, so one the backend does not recognise
resolves to `undefined` and widens the query to "all" rather than failing.

`insights/collections/campaignVocabulary.ts` now reads the dimension and is the only
source. **The declined set is derived, not listed:** `success_kind = 'RECOVERY_DOLLARS'
AND cycle <> 'NA'` returns exactly the four recurring runs, in the dimension's own sort
order, so the two exclusions fall out of the data - Check recovers dollars but bills on
no cycle, and Expiring CC bills on no cycle and is not measured in dollars at all.
Adding a campaign is a row rather than a release, per
[.cursor/rules/runtime-configuration.mdc](../.cursor/rules/runtime-configuration.mdc).

Shaped to keep the change small. The vocabulary is cached for the process on a 5-minute
TTL and loaded by `await loadCampaignVocabulary()` at each of the five report entry
points; everything below that reads it through synchronous accessors, so the SQL
builders did not have to become async. The accessors **throw** when the cache is empty
rather than returning a blank shape, because a blank one renders `campaign_key IN ()`
and turns every filter selection into "all campaigns" - wrong answers that look like
working reports. The three service test files answer the dimension read from one shared
fixture, `__tests__/collectionsCampaignDimension.ts`.

The frontend copy is gone: the four declined-charge pages take their choices from the
response, which is the same derived list. The fixed array existed for a real reason -
during a refetch or a filter change `data` is briefly undefined, and a `Select` whose
item list omits its own current value renders blank - so `useDeclinedCampaigns` holds
the last list the server sent across that gap instead of reinstating a hardcoded one.

---

## 5. Phasing

- **Phase 2a â core, CRM-only (no external deps):** the five facts + two seeded
  lookups + registry/monitor rows + 10 SQL files (no new workers), wired to the
  existing Overview / Campaign Ã Touch / Agent Performance / Contact Frequency
  pages. Answers the primary questions:
  collection rate by campaign & by touch, agent effectiveness/activity, "are
  calls 3/4/5 a waste", and the **post-term spike**. Portal-Agent vs
  Portal-No-Agent split included.
- **Phase 2b â channel/effort enrichment:** inbound/outbound call + talk-time
  (phone data joined to agents **by email**), dunning-email â self-service
  correlation, cross-agent assists. Enriches the Channel Effectiveness page.
  No schema change required (email match already exists for call counts).

---

## 6. Decisions (locked) & remaining confirms

**Locked (2026-09-07):**
- â **Warehouse tables approved** â create `ie_fact_collections_*` +
  `ie_dim_collections_*` via additive, idempotent migrations. Read-only CRM.
- â **Scope includes Sales AR** (type 9, dept 1) alongside CS types
  (1, 34, 33, 4, 32).
- â **Attribution is invoice-level** (not a fixed time window). Task resolved
  only when **all** linked invoices reach `balance <= 0`; balance computed from
  `Î£ order parts â Î£ approved applied payments`, ignoring `OrderStatusID`.
- â **Backfill 13 months.**
- â **Employee link = email** (`tblSalesPeople.email` â QTIP `User.email`);
  no schema change; enables talk-time / inbound-outbound now (not deferred).
- â **Agent-processed dept set** = 2 and 3 (and 1 for Sales AR).

**Locked (2026-09-07, round 2):**
- â **Amount at risk = the current cycle's uncollected due** â the invoice(s)
  that failed to auto-collect *this* recurring cycle, **not** prior open
  balances. Touches are counted **from task creation forward** (no credit for
  earlier collection efforts). â ï¸ *Note: owner wants to confirm with mgmt â leave
  this switchable so we can flip to "all open invoices on the billing group" if
  they decide the truer number is total owed.*
- â **Campaign = one full lifecycle cohort, keyed by origination cycle**
  (task type + the 1st-vs-16th start), tracked **across calendar-month
  boundaries**. The "prior month spilling into this month" (Check, Expiring) is
  the **same** campaign continuing â do **not** split by the calendar month the
  touch lands in. This shows the true campaign life cycle. So `campaign_key`
  binds to the *origination* cycle, and rollups follow the cohort, not the touch
  date's month.

**Locked (2026-09-07, round 3):**
- â **Recovery $ = real money = Payment (1) + Credit (2) + Overpayment (4)**,
  approved. Non-cash (Credit Memo, Forgiven, Uncollectibles, Warranty, Discount,
  refunds/returns/voids) **excluded** â see Â§2.3.
- â **Expiring CC success = card-update rate + retained MRR** (task status
  "Updated â Contacted"). Not a collected payment.
- â **Reactivated counts as a success**, shown **split from Paid**
  (`outcome=REACTIVATED` vs `PAID`).
- â **Collectible invoice types = Recurring (3) + Order (1) + Reactivation (6)**;
  adjustments (Labor 10, Date 11) fold into balance. **Termination (7) and
  Service Cycle (8) are OUT** â Service Cycle doesn't occur on AR billing groups
  at all; Termination is a churn marker handled by the subscription fact (Â§1.11,
  Â§1.12). Reactivation is the "term â collect" win the owner described.
- â **Access control = standard Insights page-key model** (not a hardcoded role
  gate). Five `ie_page` rows seeded (`20260907190000_seed_collections_pages`),
  granted Admin + Manager at `ALL`; backend resolves per page via
  `InsightsPermissionService.resolveAccess`, and roles/scopes are managed from
  Insights â Page Management like every other page (Â§4b).

---

## 7. Campaign catalog & per-campaign success definitions (13-mo discovery)

Only **five** task types are AR/collections campaigns (the rest â Ticket, Lead
Manager, Order Flow, Activation, etc. â are out of scope). Volumes are last 13
months. Success = the terminal task status the CSR sets when the goal is met.

| Campaign (task type) | ID | Tasks 13mo | 1st/16th? | Success status(es) | Success KPI | Fail / terminal-loss statuses |
| --- | --- | --- | --- | --- | --- | --- |
| Ops AR â CC (Declined Credit Card) | 1 | 8,327 | **Yes** (`DAY(CreatedOn)<=15`) | **Paid** (6); Reactivated (193) | Recovery $ (invoice-level) | Not Reactivated â No Contact (185) / Contacted (184); Termd Non-Pay #1â5; Credit Memo (164) |
| Ops AR â Check | 33 | 5,358 | 1st only | **Paid** (270); Reactivated (272) | Recovery $ (invoice-level) | Not Reactivated (268/269); Termd Non-Pay; Credit Memo (245) |
| Ops AR â ACH | 34 | 297 | 1st only | **Paid** (315); Reactivated (317) | Recovery $ (invoice-level) | Not Reactivated (313/314); Declined ACH #1â5 (292â300); Termd Non-Pay |
| Sales AR | 9 | 1,697 | n/a (order-driven) | **Paid** (12) | Recovery $ (invoice-level) | Cancelled (57); Contact Attempt 1â3 open |
| Expiring Credit Card | 4 | 2,705 | 1st only (monthly) | **Updated â Contacted** (10) | **Card-update rate** + retained MRR | Not Updated â Contacted (191) / No Contact (190); Cancelled Service (58) |

**Touch-sequence status families** (drive `touch_seq` / phase, `ActionTypeID=1`):
- **CC:** `Declined CC #1â¦#5` (+ `- 2nd Call` variants) â `Termd Non-Pay #1â¦#5`
  â `Termd Non-Pay - Final Call`. The Term line = the **post-term spike** phase.
- **ACH:** parallel `Declined ACH #1â¦#5` (292â300) â `Termd Non-Pay â¦` (320â329).
- **Check:** `Invoice Generated #1â¦#5 / -Final` â `Termd Non-Pay â¦` (275â284).
- **Expiring CC:** `Expiring CC #1â¦#10 (AM/PM)` outreach ladder â resolves to
  `Updated - Contacted` (win) or `Not Updated â¦` (loss).
- **Sales AR:** `Contact Attempt 1/2/3` ladder â `Paid`.

**Key modeling consequences**
1. **Two success types â two recovery measures.** Model a per-campaign
   `success_kind`: `RECOVERY_DOLLARS` (CC/Check/ACH/Sales) vs `CARD_UPDATE`
   (Expiring). Expiring CC's "value" is **retained recurring MRR** (the next
   invoice that will now auto-collect), reported separately from collected $ so
   it never inflates recovery dollars. UI: Expiring gets an "Update Rate" +
   "Retained MRR" KPI instead of "Collected".
2. **No card-on-file update-timestamp table exists** (`tblPaymentMethods` holds
   the card but no reliable audit ts). The CRM's own **task status = the
   authoritative "card updated" signal**, so we key retention success off status
   10, not a card diff.
3. **Sales AR has its own ladder** (`Contact Attempt 1â3`), not the Declined-CC
   ladder â normalize both into a shared `touch_seq` (1..N) + `phase`
   (`OUTREACH` / `TERM` / `FINAL`) in `ie_dim_collections_touch` so cross-campaign
   "marginal recovery by touch" stays comparable.
4. **"Reactivated" is a second win** for CC/Check/ACH (customer had lapsed, came
   back) â count it as success alongside "Paid" but tag `outcome=REACTIVATED` so
   it's separable from straight `PAID`.

**All resolved (see Â§6 "round 3"):** Expiring CC â card-update rate + retained
MRR; Reactivated â success, split from Paid; invoice types â Recurring (3) +
Order (1) + Reactivation (6), Termination/Service Cycle excluded.

---

## Finding 20  external audit corrections (2026-09-14)

An independent audit reconciled the warehouse against read-only `dmcms_prod`
extracts captured 2026-09-13. Seven of its findings were validated against source
and fixed; the reconciliation below is the evidence. Its frozen control table is a
snapshot, not a constant  do not hardcode these figures.

### 20.1 Currency was never carried, so CAD was summed into USD

`CurrencyTypeID` sits on `tblOrders`, `tblOrderParts`, `tblBillingGroups`,
`tblPaymentsCredits` and `tblPaymentResponseLog`, and `tblCurrencyType` maps
1 = US Dollar, 2 = Canadian Dollar. None of it was extracted. Every Cycle
Performance amount was a cross-currency sum rendered behind a `$`.

`currency_code` now lands on the invoice staging and fact, and `cycleScope` filters
on it, so each measure is single-currency by construction rather than by every
future aggregate remembering to group. `getCurrencyTotals` runs unscoped so the
currencies NOT on screen are disclosed instead of disappearing  silently dropping
them would be worse than mixing them. An invoice with no source currency matches no
selection and stays visibly unresolved rather than defaulting to USD.

### 20.2 A reversed sale was being reported as our own submission error

The billing extract listed `VOIDED` among the messages meaning ERROR, i.e. a
malformed request on our side. Invoice 1936494 shows what that hides: the 09-01
04:25:01 SALE answers VOIDED, a VOID at 15:13:35 answers Approved, two corrected
SALEs follow and it settles next morning at 3,182.75 against an original 3,248.60.
The gateway accepted the charge and someone reversed it to re-bill a corrected
amount. Nine September invoices worth 12,618.35 read as our defect on that basis,
and they are not even one outcome  1940478 ends VOID/VOIDED and never settles.

`transaction_type` (SALE / VOID) is now extracted and `VOIDED` is its own outcome:
not ERROR, because we did nothing wrong, and not OK, because no money stuck. It
ranks between them in BILLING_JOIN so a reversal is not hidden by a success on
another group. September ERROR falls from 11 to 2.

### 20.3 The repeat-decline join multiplied rows

`REPEAT_JOIN` joined `(order_id, date_key)` against a billing-group-grain subquery,
so an invoice declined on two groups the same day matched twice  the identical
fan-out `BILLING_JOIN` carries a NOT EXISTS to prevent. On 2026-09-01 the decline
reasons read 336 invoices / 59,043.40 against an intake of 333 / 58,603.60, the
439.80 gap being 1937202, 1941298 and 1943711 counted twice. Binding the join to
`(billing_group_id, date_key)`  the fact's unique key, and therefore to the row
BILLING_JOIN already chose  returns it to 333 / 58,603.60.

### 20.4 Money was rounded to whole dollars

Amounts were `Math.round()`ed in the service and formatted with
`maximumFractionDigits: 0`, so a 32.95 invoice was served AND displayed as 33 in an
invoice-level drill-down, and totals could not be reconciled because regrouping
changed how the rounding fell. The service now uses a shared `money()` that fixes
the scale at cents (the driver returns DECIMAL sums as floats, so some rounding is
needed for the sum of the parts to equal the whole). `fmtUSD` has five other callers
and is untouched; Cycle Performance formats its own money with the row's currency.

### 20.5 The payer was assembled from several different payments

`RECOVERY_JOIN` took independent `MIN()`s of `billing_group_id`, `applied_on`,
`processor_name` and `agent_email` over an invoice's payments, so a twice-paid
invoice reported a payer who never existed. The payments are now ranked once  first
by `applied_on`, tie-broken on `payment_credit_id`  and every identity field is read
off the winning row, so the person named is the person whose payment is described.
`PROCESSOR_RANK` still spans all payments, because "was an agent involved" has to see
a split payment.

### 20.6 "Original card retried" was the fall-through, decided by a group proxy

The recovery path compared the invoice header's billing group (which CRM rewrites
after payment) against the run's group, then fell back to a proxy asking whether any
later success existed on the group. Neither describes the payment that settled the
invoice, and `'Original card retried'` was the ELSE, so everything unplaceable landed
there. 1919833 declined 08-01 on group 68054 last4 1781 and was paid 08-03 on group
112957 last4 4587  reported as the original card being retried.

`payment_last4` now comes off the gateway row keyed on `PaymentCreditID`, so the
comparison is between the card the run tried and the card that actually paid. The
asymmetry matters: a DIFFERENT last four proves a different card, an IDENTICAL one
does not prove the same card (re-issues keep them), so only a difference concludes
and a match falls through to the group evidence. The fall-through is now
`'Card not identified'`  an unestablished instrument is no longer credited to the
original card. Across 2026-08/09, 567 declined invoices carry positive proof the
paying card differed.

The recovery fact's `billing_group_id` deliberately still reads `o.BillingGroupID`:
the transform links AR tasks on it, and a task is raised against the group that
DECLINED, not the one that paid. Repointing it would silently break task attribution,
which is being reworked separately.

### 20.7 The invoice grid truncated silently

The drill-down fetched a capped 500 rows with no total and no paging, so a larger
cohort simply ended. It now pages with `COUNT(*)` over the same predicate, a unique
`order_id` tie-breaker so a row cannot be served twice or skipped, and a footer
stating the range against the true total.

### Reconciliation (cycle scope: CC_1_15 + CC_16_31 + ACH, `recurring_id IS NOT NULL`)

| Month | Cur | Invoices | Invoiced | Cash | Memos | Open |
|---|---|---:|---:|---:|---:|---:|
| 2026-08 | USD | 15,131 | 1,238,666.90 | 1,219,116.42 | 18,738.13 | 777.40 |
| 2026-08 | CAD | 12 | 802.01 | 802.01 | 0.00 | 0.00 |
| 2026-09 | USD | 8,613 | 906,293.36 | 769,279.71 | 9,202.16 | 127,811.49 |
| 2026-09 | CAD | 9 | 586.16 | 586.16 | 0.00 | 0.00 |

Every figure matches the audit's independently captured control to the cent.
September's USD outcome mix sums to 906,293.36 exactly: OK 7,572 / 704,946.39,
PENDING_ACH 672 / 79,786.09, DECLINED 333 / 58,603.60, ERROR 2 / 44,981.89,
VOIDED 9 / 12,618.35, NO_CHARGE_EXPIRED 24 / 5,322.09, NO_CHARGE 1 / 34.95.

### Still outstanding at the time of writing (all now closed in Finding 21)

1. **Task linkage.** The customer/half-month earliest-task join is wrong for 21
   invoices. `tblTaskOrder` links and invoice-specific task-creation actions give
   explicit evidence for 934 of 985 exception invoices. Needs an "Existing task
   covers invoice" state distinct from "New task created" (invoice 1932164).
2. **Status and touches as of the payment.** Touches are counted over the task's
   lifetime, so activity AFTER the money arrived inflates pre-payment effort on at
   least 42 declined invoices (1919833, 1919497). 484 of 1,054 applications have
   same-second history boundaries and must return an explicit ambiguity state.
3. **Timestamp semantics.** Source events are Eastern and warehouse instants ran four
   hours ahead in these months  visible in recovery `applied_on`. Needs the existing
   date helpers and DST coverage, not a hardcoded offset.
4. **Population alignment.** Credit memos cover all cycle invoices while recovery
   paths cover declined only (August 18,738.13 vs 13,922.07).
5. **Pending ACH.** September's 672 are inferred from absent billing rows, which is
   not verified bank status.
6. **Freshness.** `ie_source_report.last_run_at` is NULL for all seven collection
   schedules, so the page cannot state real dependency freshness.

## Finding 21 - the rest of the audit (2026-09-14)

The six items Finding 20 left outstanding, plus one the work surfaced. All are now
fixed; the reconciliation at the end is the evidence.

### 21.1 Task linkage: CRM's own link first, inference second, and say which

The read path re-derived the task - earliest task for the same customer inside the
same half-month pass - which is a second, weaker copy of a rule the transform already
applies, and it disagreed with the fact on 21 invoices. Customer 122706 is the worked
example: three AR tasks opened 2026-08-01 on different billing groups, and "earliest
for the customer" gave every one of that customer's invoices the 15:48 task whatever
card was charged.

CRM records some links explicitly in `tblTaskOrder`. Restricted to the AR task types
this report uses (1, 33, 34, 4, 9) it yields 103 links over 88 invoices for
2026-08/09: it agrees with the inference on 35, disagrees on 13 worth 6,911.42, and
supplies 55 worth 8,741.62 the inference finds no task for at all. Invoice 1919833 is
the one no inference can reach - it declined on group 68054 and its AR task sits on
112957, the group that PAID.

So the explicit link wins outright and the inference only runs when CRM recorded
nothing. `crm_task_id` / `crm_task_count` land on the invoice STAGING (raw evidence
the transform resolves), and `task_link_source` on the fact, carrying four states the
page reports rather than flattening:

| State | Meaning |
|---|---|
| `EXPLICIT` | one AR task linked in `tblTaskOrder`. Authoritative. |
| `AMBIGUOUS` | several linked; earliest used, doubt reported not hidden. |
| `TRIGGERED` | inferred: raised on the charged group after the invoice. |
| `COVERED` | inferred: already open when the invoice landed (1932164). |
| `NULL` | no task. |

"A task CRM says chased this invoice" and "a task we believe chased it" are different
claims, and the coverage breakdown now says which. August's 536 declines resolve to
22 EXPLICIT, 513 TRIGGERED, 1 COVERED.

### 21.2 Timestamp semantics: a DST-aware Eastern helper, not an offset

CRM stores Eastern wall-clock and the warehouse stores the UTC instant, so every
comparison between an instant column and a calendar-day column was four (or five)
hours out. Named zones are not loaded in this MySQL, so `CONVERT_TZ` is unavailable,
and a hardcoded `- 4 HOUR` breaks in November.
`backend/src/services/insights/collections/easternTime.ts` derives the US rule in SQL
- second Sunday of March to first Sunday of November - and is the single place the
convention is undone. Instant-to-instant comparisons stay raw, because both sides
carry the same shift.

### 21.3 Touches: count the work that came BEFORE the money

Touches were counted over the task's whole life and presented as the effort that
recovered the invoice, so work logged afterwards was reported as work that brought the
money in. Invoice 1919497: 419.40 credit-memoed 08-06 at 15:07:40 Eastern, five
touches on task 1104623 - three precede it, two follow (Credit Memo - No Contact 53
seconds later, Not Reactivated - Contacted an hour after). The page claimed five.
Across 2026-08/09 that is 302 touches on 128 declined invoices, 17% of logged effort.

Closing the window needs the instant of the financial event, and the warehouse held
neither half. `first_cash_on` is MIN over cash applications - `paid_on` is the MAX,
i.e. when the balance was FULLY settled, a different date on any instalment - and
`credit_memo_on` was absent entirely, so a memoed invoice had no financial event at
all. Both are DATETIME, not DATE: 1919497's memo and its next touch are 53 seconds
apart. Reading first cash off the invoice also closes the 1,660.55 by which September's
sections 2 and 3 disagreed, since the recovery fact is gated to customers who had an AR
task and left 1936399, 1937195 and 1939578 out.

Touches now split three ways against that event - before, after, same-second. The
same-second case is returned as its own count and labelled unresolved rather than
guessed: CRM writes both from one workflow, so calling it "before" inflates effort and
"after" erases it. Lifetime activity stays available beside the bands, because "what
did this task cost in total" is a real question, just not the same one.

### 21.4 An invoice that owed nothing before its own run date

Seven invoices across the window, worth 8,209.40, were paid or written off BEFORE the
day they were raised, and were reported as failures. One read "never attempted -
expired card" for 415.17: the card had indeed lapsed, and it could not matter less on a
zero balance. `ALREADY_SETTLED` is tested first of the no-billing-row arms because it
is the only one that explains the absence rather than describing it - not attempting a
settled invoice is correct behaviour. Compared on the Eastern calendar day (21.2).

### 21.5 Population alignment: which memos, exactly

The memo note sat under stage 3, whose paths cover DECLINED invoices, but counted
memos across the whole cycle - August 18,738.13 against the 13,922.07 the section was
about. `getCreditMemos` now returns both populations separately, plus the part-paid
subset, so the note states the declined figure beside the paths and labels the
all-cycle figure as the wider one.

### 21.6 Pending ACH is inferred, and now says so

September's 672 are inferred from an absent billing row, not from any bank status we
hold. Relabelled "ACH - no result recorded", which is the claim the data supports.

### 21.7 Freshness: five schedules, five timestamps

`last_run_at` was NULL for every collections schedule because the backfill runner never
stamped the registry, so the header's single "last updated" was the only freshness
signal and it described one fact of five. The runner now stamps `last_run_at`,
`next_run_at` and `last_status`, and `dependencyFreshness.ts` returns a row per
dependency - including ones the registry has no row for, since a missing schedule is a
worse problem than a stale one. The page discloses it only when something is wrong or
the loads are over 24h apart; five green timestamps on every render teach people to
stop reading the banner.

### Reconciliation after 21.x (2026-08, USD, cycle scope)

Stage 1 intake, 15,131 invoices / 1,238,666.90:

| Outcome | Invoices | Amount |
|---|---:|---:|
| OK | 14,517 | 1,103,663.13 |
| DECLINED | 536 | 70,986.85 |
| NO_CHARGE_EXPIRED | 49 | 7,210.55 |
| NO_RESPONSE | 17 | 2,163.64 |
| ERROR | 8 | 54,307.83 |
| NO_CHARGE | 3 | 263.58 |
| ALREADY_SETTLED | 1 | 71.32 |

Stage 2 coverage totals 536 / 70,986.85 - the same population, no residual bucket.
Stage 3 paths total 536 / 70,986.85 and account for every penny of it:
56,287.38 collected + 13,951.02 written off + 748.45 still open. The 105 written-off
invoices are exactly the declined memo population (13,922.07 memoed; the 28.95
remainder is open balance on those invoices, not an unexplained gap).
