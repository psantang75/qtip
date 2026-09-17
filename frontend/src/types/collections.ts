/**
 * Response contracts for the Insights → Collections dashboards.
 *
 * These mirror the shapes the future `/api/insights/collections/*` endpoints
 * will return, so the Phase-1 mock (sample data) and the Phase-3 live wiring
 * are a one-line swap in `collectionsService.ts` — the pages never change.
 *
 * Grain reference (real source, built in Phase 2):
 *   - ie_fact_ar_touch   → one row per task status change (a "touch")
 *   - ie_fact_ar_payment → one qualifying payment, with processor vs no-agent
 *   - ie_fact_call_activity (existing) → agent effort (calls, talk minutes)
 */

/** Freshness metadata rendered by InsightsSection (all optional in the mock). */
export interface CollectionsMeta {
  dataLastUpdated?: string
  dataNextUpdate?: string
  updateEveryMinutes?: number | null
  /** Agent + department options for the filter bar dropdowns. */
  availableUsers?: string[]
  availableDepartments?: string[]
}

/* ── Overview ──────────────────────────────────────────────────────────────*/

/* ── Campaign × Touch ───────────────────────────────────────────────────────*/

/** One agent's slice of a single touch — powers the per-touch expand. */
export interface TouchAgentStat {
  agent: string
  /** Touch actions this agent logged at this touch. */
  touchesMade: number
  /** Distinct customers this agent worked at this touch. */
  customers: number
  /** Subscriptions this agent worked at this touch. */
  subs: number
  /** Accounts this agent collected at this touch. */
  payments: number
  /** Dollars this agent collected at this touch. */
  collected: number
}

export interface TouchStat {
  /** 1-based touch number within the dunning chain. */
  touchSeq: number
  /** Display label, e.g. "Touch 1", "Term", "Touch 6 (post-term)". */
  label: string
  /** Distinct customers (accounts) worked at this touch. */
  accountsReached: number
  /** Distinct tasks that reached this rung — the survivors still being worked. */
  tasksReached: number
  /**
   * Subscriptions RECOVERED at this touch, taken from the rung the recovery payment was
   * attributed to. Not subscriptions worked: a subscription touched at rungs 1, 2 and 3
   * counted in all three, so the column double-counted and could never foot against the
   * cohort total. Recovery belongs to one rung, so this partitions.
   */
  subs: number
  /** Touch actions logged at this touch (status changes) — the effort. */
  touchesMade: number
  /** Outbound call attempts placed at this touch. */
  calls: number
  /** Talk minutes spent at this touch. */
  talkMinutes: number
  /** Accounts that paid at this touch (before the next touch). */
  payments: number
  /**
   * Dollars collected on the DECLINED invoice between this touch and the next — a save.
   * Reactivation cash is deliberately not in here; see `reactivationDollars`.
   */
  incrementalDollars: number
  /**
   * Cash that came back on a NEW invoice after the original was written off, attributed
   * to the last numbered touch before that invoice was raised.
   *
   * Kept separate from `incrementalDollars` rather than added to it, for two reasons.
   * The original invoice stays at zero forever once memoed, so this money is invisible
   * to the recovery fact and to Cycle Performance's Collected to Date — folding it in
   * would break the tie to the validated report. And a save and a win-back are different
   * outcomes: one kept a service, the other lost it and bought it back.
   */
  reactivationDollars: number
  reactivationInvoices: number
  /**
   * Services that were shut off at this rung and later came back, counted from the
   * cohort's own subscriptions rather than from the reactivation invoice — most
   * win-backs are not billed on a new order inside the window, and that order is type 6,
   * which the subscription fact excludes. Placed at the termination, which is where the
   * cadence lost the service. The column sums to the Starting Point tile's reactivated
   * count, so the two can be read against each other.
   */
  reactivationSubs: number
  cumulativeReactivationDollars: number
  /** Cumulative reactivation as a share of declined dollars, on the save rate's scale. */
  cumulativeReactivationRate: number
  /** Of `incrementalDollars`, the share an agent processed. */
  agentDollars: number
  /** Of `incrementalDollars`, the share the customer self-served in the portal. */
  noAgentDollars: number
  /** Running total of dollars recovered through this touch. */
  cumulativeDollars: number
  /** Distinct tasks recovered at this touch. */
  tasksRecovered: number
  /** Running total of tasks recovered through this touch. */
  cumulativeTasksRecovered: number
  /** Cumulative collection rate through this touch (%), dollars over dollars at risk. */
  cumulativeRate: number
  /** Marginal collection-rate gain contributed by this touch (percentage points). */
  incrementalRate: number
  /** Cumulative share of cohort TASKS recovered through this touch (%). */
  cumulativeTaskRate: number
  /** Industry cumulative-recovery benchmark at this attempt (%), for the overlay. */
  benchmarkCumulative: number
  /** True for the termination / shut-off step. */
  isTerm: boolean
  /** Per-agent breakdown of this touch (shown when the row is expanded). */
  agents: TouchAgentStat[]
}

/** Count of AR-terminated subscriptions at a given task/touch status. */
export interface SubStatusCount {
  status: string
  count: number
}

/**
 * Subscription outcomes for the selected campaign/period — the sub-level twin of
 * marginal recovery: did the campaign keep, lose, or win back the subscription,
 * and (for churn) at what task status. Terminations are credited to the campaign
 * only for AR reasons; `terminatedOther` is non-AR churn shown for context.
 */
export interface SubscriptionOutcome {
  retained: number
  terminated: number
  terminatedOther: number
  reactivated: number
  retainedMrr: number
  lostMrr: number
  /** AR-terminated subscription counts by the task status they termed at. */
  terminatedByStatus: SubStatusCount[]
}

/** Recovery that arrived without any numbered touch preceding it. */
export interface NoTouchRecovery {
  payments: number
  dollars: number
  agentDollars: number
  noAgentDollars: number
  tasksRecovered: number
  /**
   * Subscriptions on the invoices this bucket recovered. Counted like every other
   * measure here — the first bar was reporting real cash against a blank sub count,
   * because the ladder query filtered the untouched rows out before counting services.
   */
  subsRecovered: number
  /** Win-backs that preceded any numbered touch, held here for the same reason. */
  reactivationDollars: number
  reactivationInvoices: number
  reactivationSubs: number
}

/**
 * The campaign's starting point — everything handed to it when the cohort was
 * raised — so the touch ladder reads as progress against a known denominator.
 */
/**
 * The declined basis, as every page that measures it opens on.
 *
 * ONE SHAPE FOR ONE POPULATION. Campaign × Touch and Agent Performance both start from
 * the invoices the recurring run declined — Cycle Performance's own rows — so they share
 * this contract and render it through the same `StartingPoint` panel. Two independent
 * shapes would let the two pages describe the same invoices with different fields, which
 * is the drift these reports have already been through once.
 *
 * Each report extends it with what only that report can say.
 */
export interface DeclinedBasisCohort {
  /** Dunning tasks raised in the selected campaign-start window. */
  tasks: number
  /** Triggering invoices behind those tasks. */
  invoices: number
  /**
   * Where those invoices ended up. Cash is tested before the credit memo, the same
   * precedence Cycle Performance's recovery paths use, so an invoice part-paid and
   * part-memoed is reported as paid on both. The three partition `invoices` exactly.
   */
  invoicesPaid: number
  invoicesCreditMemo: number
  invoicesOpen: number
  /**
   * Subscriptions carried on those INVOICES, linked by the invoice's billing group —
   * the same population the dollar measures use, so a task with no invoice behind it
   * contributes none. Inherits the invoice coverage caveat below.
   */
  subs: number
  /**
   * Where those subscriptions ended up, one state each so the three sum to `subs`.
   * A service holding rows under two outcomes resolves to its furthest state —
   * reactivated, then terminated, then retained — because the memo is raised when the
   * service is shut off and a reactivation is that same service returning on a new
   * invoice. Every termination counts, AR or not; `SubscriptionOutcome` keeps the AR
   * split for the panel that apportions blame.
   */
  subsRetained: number
  subsTerminated: number
  subsReactivated: number
  /**
   * Declined charge dollars that entered the campaign, or null for a campaign with no
   * failed charge behind it (Check, Expiring CC, Sales AR) — those have no pool, and
   * borrowing the recurring runs' pool is what made their rates meaningless.
   */
  atRisk: number | null
  /**
   * Cash applied to `atRisk`'s own invoices, read from the invoice fact — so this is
   * Cycle Performance's Collected to Date for the same cohort, and the two pages agree
   * by construction rather than by coincidence.
   */
  collected: number
  /**
   * Recovered cash the report's own attribution cannot account for — `collected` minus
   * whatever that report was able to name a source for (touch rungs on Campaign × Touch,
   * a processor on Agent Performance).
   *
   * Reported instead of being reconciled away. A non-zero value means cash landed on a
   * basis invoice with no matching row in the recovery fact, which is a real finding
   * about attribution coverage rather than a rounding artifact.
   */
  unattributed: number
  /** Tasks that ended recovered (paid / card updated / reactivated). */
  recovered: number
  /** Tasks still open today. */
  stillOpen: number
  /** Tasks with a linked invoice — traceability only; `atRisk` does not depend on it. */
  tasksWithInvoice: number
  /** Recovered tasks as a share of all cohort tasks (%). */
  taskRate: number | null
  /** Collected as a share of dollars at risk (%). */
  dollarRate: number | null
}

export interface CampaignCohort extends DeclinedBasisCohort {
  /**
   * What the touch rungs below actually add up to. `unattributed` is measured against
   * this: when it falls short of `collected`, cash landed on a cohort invoice that the
   * recovery fact never attributed to one of these tasks.
   */
  ladderCollected: number
  noTouch: NoTouchRecovery
}

/**
 * Recovery worked after a write-off. Shutting a service off is what raises the credit
 * memo, but the task stays open and keeps being worked, and some of those services come
 * back on a new invoice — effort and cash the touch ladder cannot show, because it ends
 * at the memo.
 */
export interface PostMemoRecovery {
  invoices: number
  dollars: number
  tasks: number
  tasksWorkedAfter: number
  touchesAfter: number
  reactivationInvoices: number
  reactivationCash: number
}

export interface CampaignTouchResponse extends CollectionsMeta {
  /** Campaign (task type) options for the selector. */
  campaigns: string[]
  /** Currently reflected campaign (or "All Declined"). */
  selectedCampaign: string
  /**
   * False for campaigns with no numbered call cadence (Check runs an invoice/email
   * track, Expiring CC chases a card update), where the marginal-recovery curve
   * does not apply and the page shows effort only.
   */
  hasCallLadder: boolean
  /**
   * Currency the dollar measures are denominated in. The report sums money against
   * Cycle Performance's population, so it is scoped to one currency for the same
   * reason that report is — amounts are never converted or combined.
   */
  currency: string
  /**
   * What happened after an invoice was written off: the memo does not close the task,
   * so this carries the effort logged afterwards and the cash that came back on a
   * reactivation invoice. Absent when the touch fact has not been built.
   */
  postMemo?: PostMemoRecovery
  /** Touch-level effort-and-recovery series for the selected campaign. */
  touches: TouchStat[]
  /** The campaign's starting point, for the header tiles. */
  cohort?: CampaignCohort
  /** Subscription retention/churn/reactivation for the selected campaign. */
  subscription?: SubscriptionOutcome
}

/* ── Agent Performance ──────────────────────────────────────────────────────*/

export interface AgentPerformanceRow {
  agent: string
  department: string
  /** Dollars this agent keyed against the basis invoices (`processor_kind = 'AGENT'`). */
  collected: number
  /** Count of agent-processed payments. */
  payments: number
  /** Touches the agent logged on the basis tasks. */
  touches: number
  /** Distinct basis tasks the agent touched — breadth, where `touches` is volume. */
  tasksWorked: number
  /**
   * Phone effort ON THE BASIS TASKS, reached by invoice → task → call. So this is time
   * spent on these accounts, not time spent on the phone, and it belongs to the same
   * population as the dollars beside it.
   *
   * Dials include attempts that never connected (~7% of outbound), which is why a row can
   * show calls against little talk time. Calls we cannot resolve to a customer carry no
   * task and are invisible here, so talk time is a FLOOR.
   */
  outboundCalls: number
  outboundTalkMinutes: number
  inboundCalls: number
  inboundTalkMinutes: number
  /** `outboundTalkMinutes + inboundTalkMinutes` — the parts sum to the whole. */
  talkMinutes: number
  /** Collected per hour of talk time. A ceiling, since talk time is a floor. */
  dollarsPerTalkHour: number
}

/**
 * The agent cohort: the declined basis, plus how much of its cash the recovery fact can
 * name a processor for. `unattributed` is `collected - attributed`.
 */
export interface AgentCohort extends DeclinedBasisCohort {
  attributed: number
}

export interface AgentPerformanceResponse extends CollectionsMeta {
  /** Campaign options for the selector, and the one currently reflected. */
  campaigns: string[]
  selectedCampaign: string
  /** Currency the dollar measures are denominated in — never converted or combined. */
  currency: string
  /** The cycle's starting point. Absent before the recovery fact has been built. */
  cohort?: AgentCohort
  /** Did it take an agent — measured on touch existence, not on who keyed the cash. */
  split: RecoverySplit
  /**
   * Who keyed the payment, and on what kind of call. PENDING — computed and returned,
   * but hidden on the page until calls link to tickets and tasks, since the inbound /
   * outbound columns are read off the call fact. See `CALL_LINKAGE_CONFIRMED`.
   */
  processors: ProcessorRow[]
  /** Collector leaderboard, measured against the same invoices. */
  rows: AgentPerformanceRow[]
}

/* ── Recovery attribution (shared by Agent Performance) ──────────────────────*/

/**
 * The recovered pool split on whether an agent had touched the account yet:
 *  - preAgent  → cash landed after the decline but BEFORE any agent attempt
 *                (self-cure in the portal after the dunning email, or an inbound call)
 *  - postAgent → cash landed after at least one agent attempt
 */
export interface RecoverySplit {
  preAgent: RecoverySplitLeg
  postAgent: RecoverySplitLeg
}

/** `accounts` is distinct billing groups; `payments` counts instalments, so it runs higher. */
export interface RecoverySplitLeg {
  payments: number
  accounts: number
  amount: number
}

/** Who keyed the payment, and what kind of call they were on when they did. */
export interface ProcessorRow {
  processor: string
  isAgent: boolean
  collected: number
  payments: number
  inboundPayments: number
  outboundPayments: number
  /** Payments with no call by that agent on the task within 7 days. */
  noCallPayments: number
  inboundCollected: number
  outboundCollected: number
}

/* ── Cycle Performance ─────────────────────────────────────────────────────── */

/**
 * What the recurring run did to each invoice. "Never attempted" means the run never
 * reached the gateway for that card invoice at all — a real operational bucket, not
 * a data gap: on 2026-08-01 all 47 of them were later handled by a person.
 * `PENDING_ACH` is the bank not having reported back yet, which is not the same
 * thing and must never share those buckets.
 *
 * `NO_RESPONSE` is a charge we submitted to the gateway that was never answered —
 * our failure, not the customer's, which is why it sits beside `ERROR` and not with
 * the never-attempted buckets it was originally filed under. Those are now just two:
 * `NO_CHARGE_EXPIRED`, where the card had lapsed by the run date read from the group
 * the run actually charged, and plain `NO_CHARGE`, where the charge never reached the
 * gateway at all.
 */
export type CycleResult =
  | 'OK'
  | 'DECLINED'
  | 'ERROR'
  /** Accepted by the gateway, then reversed. Neither our defect nor a collection. */
  | 'VOIDED'
  /**
   * Accepted and awaiting settlement — a captured card or an ACH debit in the network.
   * Distinct from `PENDING_ACH`, which is the absence of a gateway row; this one has an
   * answer, just not a final one. It used to fall through the extract's `ELSE 'DECLINED'`
   * and put $372,614 into September's declines on the morning after the 16th run.
   */
  | 'IN_FLIGHT'
  | 'NO_RESPONSE'
  | 'NO_CHARGE'
  | 'NO_CHARGE_EXPIRED'
  /** No gateway answer for an ACH invoice. Inferred from its absence, not a bank status. */
  | 'PENDING_ACH'
  /** Paid or written off before the run, so there was no debt left to charge. */
  | 'ALREADY_SETTLED'

export interface CycleOutcome {
  result: CycleResult | string
  invoices: number
  amount: number
}

/**
 * A decline reason plus how much of it we had already seen. A repeat is the same
 * billing group declining again within a year — the first failure is unavoidable,
 * every one after it is effort spent on a card we already knew was failing.
 */
export interface CycleReason {
  reason: string
  invoices: number
  amount: number
  repeatInvoices: number
  repeatAmount: number
}

/**
 * How a declined invoice was resolved, named for which card paid — not whether
 * the declined card was taken off file:
 * "New Card Provided", "Another Card on File", "Same Card Tried Again",
 * "Written Off", "Still Open".
 */
export interface CycleRecoveryPath {
  path: string
  invoices: number
  invoiced: number
  collected: number
  /** Paid with a different card, then the declined card was charged again. */
  originalStillCharged: number
}

/**
 * Declines that reached an AR task versus those nobody picked up.
 *
 * `bucket` distinguishes how the link was established, because "the task CRM recorded
 * against this invoice" and "the task we inferred from the charged card" are different
 * claims: "New Task Created", "Added to Existing Task", "No Task Created".
 */
export interface CycleCoverage {
  bucket: string
  invoices: number
  amount: number
  collected: number
}

/**
 * Who took the money, carried on every stage-2 breakdown.
 *
 * The three paid counts need not sum to the row's invoice count — the shortfall is the
 * invoices nobody applied cash to, which is what exposes a task closed as Paid with
 * no money behind it. That shortfall is split into the only two states it can hold,
 * so all five counts together do reconcile to the invoice count.
 */
export interface CycleProcessorSplit {
  selfInvoices: number
  selfCollected: number
  agentInvoices: number
  agentCollected: number
  systemInvoices: number
  systemCollected: number
  /** No cash applied, but a credit memo cleared the invoice. */
  memoInvoices: number
  memoAmount: number
  /** No cash and no memo — genuinely unresolved. */
  openInvoices: number
  openAmount: number
}

export interface CycleTaskStatus extends CycleProcessorSplit {
  status: string
  invoices: number
  amount: number
  collected: number
}

/**
 * Outreach banded by how much of it preceded the invoice being resolved.
 *
 * The band counts logged status moves between this invoice's decline and the moment it
 * was paid or written off. Work logged after that is real, but it is not what brought
 * the money in, so it is reported beside the band instead of inside it.
 */
export interface CycleTouchBand extends CycleProcessorSplit {
  band: string
  invoices: number
  amount: number
  collected: number
  /** Logged moves that happened after the invoice was already resolved. */
  touchesAfter: number
  /** Invoices with a move stamped at the same second as the payment, so unorderable. */
  unresolvedOrder: number
}

/** Self-Service / Agent / System / Not Recovered, for the whole run. */
export interface CycleProcessor {
  who: string
  invoices: number
  amount: number
  collected: number
}

export interface CycleInvoice {
  orderId: number
  /** CRM account behind the invoice — pairs with orderId for the Order/Detail link. */
  customerId: number | null
  orderDate: string
  campaign: string
  amount: number
  /** Per row, so a drill-down can never render one currency as another. */
  currency: string
  result: string
  declineReason: string | null
  /** This billing group declined again within a year — the same card still failing. */
  isRepeat: boolean
  chargeBillingGroupId: number | null
  chargeLast4: string | null
  taskId: number | null
  taskStatus: string | null
  taskAgent: string | null
  /** EXPLICIT | AMBIGUOUS | TRIGGERED | COVERED, or null when no task matched. */
  taskLinkSource: string | null
  /** Logged status moves between this invoice's decline and its financial event. */
  touches: number
  /** Every logged status move on the task, whenever it happened. */
  touchesLifetime: number
  /** Moves stamped at the financial event itself, which cannot be placed either side. */
  touchesSameSecond: number
  recoveryPath: string
  collected: number
  paidOn: string | null
  processor: string | null
  /** AGENT | PORTAL | SYSTEM for whoever `processor` names, null when nobody paid. */
  processorClass: string | null
  creditMemoAmount: number
  openBalance: number
}

/**
 * One currency's population in the selected period, including the ones not on screen.
 * The report shows a single currency at a time so its sums mean something; this is how
 * the others stay visible instead of silently vanishing.
 */
export interface CycleCurrencyTotal {
  currency: string
  invoices: number
  invoiced: number
  collected: number
}

export interface CyclePerformanceResponse extends CollectionsMeta {
  campaigns: string[]
  selectedCampaign: string
  /** Every amount in this response is denominated in this currency. */
  currency: string
  currencies: CycleCurrencyTotal[]
  invoiced: { invoices: number; amount: number }
  outcomes: CycleOutcome[]
  /** Declined invoices on this run that still have a balance due. */
  outstanding: { invoices: number; amount: number }
  declineReasons: CycleReason[]
  processors: CycleProcessor[]
  coverage: CycleCoverage[]
  taskStatuses: CycleTaskStatus[]
  touchBands: CycleTouchBand[]
  recoveryPaths: CycleRecoveryPath[]
  creditMemos: CycleCreditMemos
  freshness: CycleDependencyFreshness[]
  /** True while the one Cycle Performance job is still loading the five facts. */
  pipelineLoading: boolean
}

/**
 * Write-offs on both populations, plus the ones that were mostly collected.
 *
 * `declined` matches every other stage-3 measure; `allCycle` is the whole ledger. Both
 * are carried because the section used to show only the second while sitting beside
 * measures scoped to the first, inviting a comparison between two denominators.
 */
export interface CycleCreditMemos {
  declined: { invoices: number; amount: number }
  allCycle: { invoices: number; amount: number }
  /** Memos that cleared a remainder after cash came in — not an abandoned invoice. */
  partial: { invoices: number; memoAmount: number; cashAmount: number }
}

/** One step of the Cycle Performance load. The five share one schedule. */
export interface CycleDependencyFreshness {
  code: string
  label: string
  lastRunAt: string | null
  nextRunAt: string | null
  status: string | null
  isActive: boolean
}

/** A page of the invoice drill-down, with the size of the population behind it. */
export interface CycleInvoicesResponse extends CollectionsMeta {
  rows: CycleInvoice[]
  total: number
  currency: string
  campaigns: string[]
  selectedCampaign: string
  currencies: CycleCurrencyTotal[]
  freshness: CycleDependencyFreshness[]
  pipelineLoading: boolean
}

/**
 * Failed Charge Invoices — the declined slice of Cycle Invoices, sliced by decline
 * reason. Same rows as Cycle Invoices, plus the reason breakdown that drives the
 * filter buttons (one population per button, counts included).
 */
export interface FailedChargeInvoicesResponse extends CycleInvoicesResponse {
  declineReasons: CycleReason[]
}
