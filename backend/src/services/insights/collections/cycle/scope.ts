/**
 * Shared spine for Insights → Collections → Cycle Performance.
 *
 * THE SPINE IS THE RUN. `tblRecurring` is the immutable record of each recurring
 * run — RecurringID, StartedOn, PaymentType (1 Credit Card, 2 Check, 3 ACH) — and
 * there is one run per payment type per month. August 2026 is 520 (card), 521
 * (check), 522 (ACH). Both passes share a RecurringID: 520 wrote 7,942 invoices on
 * 08-01 and a further 6,017 on 08-16, so the campaign needs the run's payment type
 * AND the invoice's own day. That pairing is landed on the fact by
 * collections_invoice.transform.sql; here we only require `recurring_id IS NOT NULL`
 * so nothing but genuine run output enters the spine.
 *
 * Requiring the run is also what keeps this page reconcilable: RecurringID 520 on
 * 2026-08-01 is exactly 7,942 invoices / $831,573.20, matching the hand-built
 * August review to the cent.
 */
import {
  type CollectionsFilters,
  ALL_DECLINED,
  campaignLabel,
  campaignKeyForLabel,
  declinedCampaigns,
  DEFAULT_CURRENCY,
} from '../../../insightsCollections.shared';

export { ALL_DECLINED, declinedCampaigns, DEFAULT_CURRENCY };

export type Param = string | number;

/**
 * A SQL fragment and the values its `?` placeholders consume.
 *
 * Join fragments used to be bare strings with no parameters, so every query could
 * bind `scope.params` alone. Now that the derived tables are scoped (see below)
 * the joins carry placeholders too, and mysql2 binds `?` strictly by position —
 * a fragment's params must be concatenated in the same order its SQL appears.
 * Getting that wrong does not throw, it silently scopes a report to the wrong
 * window, so composition goes through `parts()` rather than by hand.
 */
export interface SqlPart { sql: string; params: Param[] }

/**
 * Concatenate join fragments, keeping SQL and bind params in the same order.
 *
 * Plain strings are fragments that take no parameters (BILLING_JOIN, TASK_JOIN),
 * so they can be mixed in freely.
 */
export function parts(...items: Array<SqlPart | string>): SqlPart {
  return items.reduce<SqlPart>((acc, item) => {
    const part = typeof item === 'string' ? { sql: item, params: [] } : item;
    return { sql: `${acc.sql} ${part.sql}`, params: [...acc.params, ...part.params] };
  }, { sql: '', params: [] });
}

/**
 * The window a cycle report is asking about, plus the means to restrict a derived
 * table to it.
 *
 * WHY `keySet` / `rowSet` EXIST. Every aggregate on this page joins to a derived
 * table — touches per task, cash per order, first charge per billing group — and
 * each of those used to `GROUP BY` an entire fact table regardless of the window
 * selected. One billing cycle is ~8.6k invoices against ~253k billing rows, and
 * the nine queries the page fires in parallel each built their own copy, so the
 * cost of the report was set by the size of the warehouse rather than by the size
 * of the question. These let a derived table name the rows it can actually be
 * asked about.
 */
export interface CycleScope {
  whereSql: string;
  params: Param[];
  /** Window bounds as YYYYMMDD keys — the floor/ceiling for history-aware joins. */
  fromKey: number;
  toKey: number;
  /** The scoped invoices' `order_id`/`task_id`, for an `IN (...)` restriction. */
  keySet(column: 'order_id' | 'task_id'): SqlPart;
  /** The scope predicate against another alias, for a derived table over the invoice fact. */
  rowSet(alias: string): SqlPart;
}

export interface OutcomeRow { result: string; invoices: number; amount: number }
export interface ReasonRow {
  reason: string;
  invoices: number;
  amount: number;
  /** Of those, the ones where this billing group had already declined within a year. */
  repeatInvoices: number;
  repeatAmount: number;
}
export interface PathRow {
  path: string
  invoices: number
  invoiced: number
  collected: number
  /**
   * Of this path, how many were paid with a DIFFERENT card and then had the
   * declined card charged again. That is the repeat risk: CRM left the old card
   * on file. Zero on paths that are not a different-card recovery.
   */
  originalStillCharged: number
}
export interface CoverageRow { bucket: string; invoices: number; amount: number; collected: number }

/**
 * Who took the money, carried alongside every stage-2 measure.
 *
 * Present on both breakdowns so "how much outreach did this take" and "where did the
 * task land" can each be read against the channel that actually collected. The three
 * counts do not have to sum to the row's invoice count — the shortfall is the
 * invoices where nobody applied cash at all, which is how a task closed as Paid with
 * no money behind it becomes visible.
 */
export interface ProcessorSplit {
  selfInvoices: number;
  selfCollected: number;
  agentInvoices: number;
  agentCollected: number;
  systemInvoices: number;
  systemCollected: number;
  /** No cash applied, but a credit memo cleared it. See PROCESSOR_SPLIT_SELECT. */
  memoInvoices: number;
  memoAmount: number;
  /** No cash and no memo — still unresolved. Carries the extract-gap rows. */
  openInvoices: number;
  openAmount: number;
}

export interface StatusRow extends ProcessorSplit {
  status: string; invoices: number; amount: number; collected: number;
}
export interface TouchBandRow extends ProcessorSplit {
  band: string; invoices: number; amount: number; collected: number;
  /**
   * Touches logged after the invoice was already settled or written off. Reported
   * beside the band rather than inside it: it is real work on the task, but it is not
   * what resolved the invoice, and folding it in is the defect the band was fixing.
   */
  touchesAfter: number;
  /**
   * Invoices with at least one touch stamped at the same second as the financial
   * event, whose order therefore cannot be established. Their band is computed from
   * the touches that CAN be placed, and this count says how many rows carry that doubt.
   */
  unresolvedOrder: number;
}
export interface ProcessorRow {
  who: string; invoices: number; amount: number; collected: number;
}
export interface CycleInvoiceRow {
  orderId: number;
  /** CRM account behind the invoice — pairs with orderId for the Order/Detail deep link. */
  customerId: number | null;
  orderDate: string;
  campaign: string;
  amount: number;
  /** Carried per row so a drill-down can never render one currency as another. */
  currency: string;
  result: string;
  declineReason: string | null;
  /** This billing group declined again within a year — the same card still failing. */
  isRepeat: boolean;
  chargeBillingGroupId: number | null;
  chargeLast4: string | null;
  taskId: number | null;
  taskStatus: string | null;
  taskAgent: string | null;
  /** EXPLICIT | AMBIGUOUS | TRIGGERED | COVERED, or null when no task matched. */
  taskLinkSource: string | null;
  /** Logged status moves between this invoice's decline and its financial event. */
  touches: number;
  /** Every logged status move on the task, whenever it happened. */
  touchesLifetime: number;
  /** Moves stamped at the financial event itself, which cannot be placed either side. */
  touchesSameSecond: number;
  recoveryPath: string;
  collected: number;
  paidOn: string | null;
  processor: string | null;
  /** AGENT | PORTAL | SYSTEM for whoever `processor` names, null when nobody paid. */
  processorClass: string | null;
  creditMemoAmount: number;
  openBalance: number;
}

/**
 * Resolve the selected campaign to a key this report can measure, or undefined for
 * "All Declined". A label outside scope (Check, Expiring CC) resolves to undefined
 * rather than filtering to a campaign with no run behind it.
 */
export function scopedKey(filters: CollectionsFilters): string | undefined {
  const key = filters.campaign ? campaignKeyForLabel(filters.campaign) : undefined;
  return key && declinedCampaigns().includes(key) ? key : undefined;
}

export function scopedLabel(filters: CollectionsFilters): string {
  const key = scopedKey(filters);
  return key ? campaignLabel(key) : ALL_DECLINED;
}

/** Per-currency population, so a currency is never invisible just because it is not selected. */
export interface CurrencyTotal {
  currency: string;
  invoices: number;
  invoiced: number;
  collected: number;
}

/**
 * Scope predicate shared by every query here: run invoices inside the window, in ONE
 * currency.
 *
 * THE CURRENCY FILTER IS WHAT MAKES THE TOTALS MEAN ANYTHING. Every amount on this page
 * was summed across currencies and rendered behind a "$": August 2026 carries 17
 * Canadian invoices and September 13, and their dollars were being added straight into
 * the USD figures. There is no exchange rate involved and none is wanted — the two are
 * different units. Filtering at the spine rather than patching each aggregate means
 * every measure on the page is denominated in the selected currency by construction,
 * and no future measure can reintroduce the mixing by forgetting to group.
 *
 * Invoices whose currency the source never recorded are NOT swept into USD. They match
 * no currency and stay out of the totals, surfacing in the currency breakdown as their
 * own unresolved population rather than quietly inflating the default.
 */
export function cycleScope(
  filters: CollectionsFilters,
  fromKey: number,
  toKey: number,
  currency: string | null = DEFAULT_CURRENCY,
): CycleScope {
  const scoped = scopedKey(filters);

  /** The predicate against an arbitrary alias, so a derived table can reuse it. */
  const predicate = (alias: string) => {
    const where = [`${alias}.date_key BETWEEN ? AND ?`, `${alias}.recurring_id IS NOT NULL`];
    const params: Param[] = [fromKey, toKey];
    if (scoped) { where.push(`${alias}.campaign_key = ?`); params.push(scoped); }
    else {
      const declined = declinedCampaigns();
      where.push(`${alias}.campaign_key IN (${declined.map(() => '?').join(',')})`);
      params.push(...declined);
    }
    // `null` means every currency, which only the currency breakdown itself asks for.
    if (currency !== null) { where.push(`${alias}.currency_code = ?`); params.push(currency); }
    return { sql: where.join(' AND '), params };
  };

  const outer = predicate('i');
  return {
    whereSql: `WHERE ${outer.sql}`,
    params: outer.params,
    fromKey,
    toKey,
    keySet: (column) => {
      const inner = predicate('sv');
      return {
        sql: `SELECT sv.${column} FROM ie_fact_collections_invoice sv
                WHERE ${inner.sql} AND sv.${column} IS NOT NULL`,
        params: inner.params,
      };
    },
    rowSet: (alias) => predicate(alias),
  };
}

