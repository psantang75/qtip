/**
 * Insights → Collections → Cycle Performance.
 *
 * The recurring billing run, counted BY INVOICE, walked in the order the AR review
 * asks about it: what the run billed, what AR did about the failures, and what came
 * back. Every other Collections report counts billing groups, which cannot be
 * reconciled against CRM — a billing group is not a thing anyone can open and look
 * at. RecurringID 520 on 2026-08-01 is 7,942 invoices / $831,573.20, and an operator
 * can confirm that figure by hand.
 *
 * THE SPINE IS THE RUN, not the billing group's current payment method. See
 * `insights/collections/cycle/scope.ts` for why and for the row types, and
 * `joins.ts` for the invoice-grain rules (one billing row per invoice, declines beat
 * same-day rescues) that every stage shares. The three stages live in `run.ts`,
 * `taskActivity.ts` and `collection.ts`.
 *
 * Warehouse read path — raw mysql2 per `.cursor/rules/insights-data-warehouse.mdc`.
 */
import { resolvePeriod } from '../utils/periodUtils';
import {
  type CollectionsFilters,
  campaignLabel,
  loadCampaignVocabulary,
  toDateKey,
} from './insightsCollections.shared';
import {
  ALL_DECLINED, declinedCampaigns, DEFAULT_CURRENCY, cycleScope, scopedLabel,
} from './insights/collections/cycle/scope';
import { getRunOutcomes, getDeclineReasons } from './insights/collections/cycle/run';
import type { ReasonRow } from './insights/collections/cycle/scope';
import {
  getTaskCoverage, getTaskStatuses, getTouchBands, getProcessorSplit,
} from './insights/collections/cycle/taskActivity';
import {
  getRecoveryPaths, getCreditMemos, getCycleInvoiceRows, getCurrencyTotals,
} from './insights/collections/cycle/collection';
import { getCycleFreshness } from './insights/collections/dependencyFreshness';
import { cachedCycleRead, cachedFreshness } from './insights/collections/cycle/cache';

export type { CycleInvoiceRow } from './insights/collections/cycle/scope';

function scopeFor(filters: CollectionsFilters, currency?: string | null) {
  const { current } = resolvePeriod(filters.period, filters.customStart, filters.customEnd);
  return cycleScope(filters, toDateKey(current.start), toDateKey(current.end), currency);
}

/**
 * The campaign dropdown for all three reports here.
 *
 * "All Declined" must lead the list — it is each page's default selection, and omitting
 * it leaves the dropdown showing a value it does not contain. The rest come from
 * ie_dim_collections_campaign, in the dimension's own sort order.
 */
const declinedCampaignChoices = () => [ALL_DECLINED, ...declinedCampaigns().map(campaignLabel)];

export async function getCyclePerformance(
  filters: CollectionsFilters,
  opts: { currency?: string } = {},
) {
  const currency = opts.currency ?? DEFAULT_CURRENCY;
  // Before scopeFor: the scope resolves the selected campaign label to a key through
  // the vocabulary, and it is read from ie_dim_collections_campaign.
  await loadCampaignVocabulary();
  const scope = scopeFor(filters, currency);

  // Read first, so the pipeline's last run can key the cache below. It is two
  // queries and every endpoint wants it, so it is cached on a short TTL of its own.
  const freshness = await cachedFreshness(getCycleFreshness);

  const {
    outcomes, declineReasons, activity, statuses, touchBands, recoveryPaths, creditMemos,
    processors, currencies,
  } = await cachedCycleRead('cycle-performance', scope, {}, freshness, async () => {
    // Order is load-bearing for the service tests, which assert each stage's SQL by
    // its position here. Append new stages at the end rather than inserting.
    const [
      outcomes, declineReasons, activity, statuses, touchBands, recoveryPaths, creditMemos,
      processors, currencies,
    ] = await Promise.all([
      getRunOutcomes(scope),
      getDeclineReasons(scope),
      getTaskCoverage(scope),
      getTaskStatuses(scope),
      getTouchBands(scope),
      getRecoveryPaths(scope),
      getCreditMemos(scope),
      getProcessorSplit(scope),
      getCurrencyTotals(scopeFor(filters, null)),
    ]);
    return {
      outcomes, declineReasons, activity, statuses, touchBands, recoveryPaths, creditMemos,
      processors, currencies,
    };
  });

  return {
    // Everything the run billed, including ACH still awaiting an answer — this is
    // the denominator, so no outcome is allowed to fall out of it.
    invoiced: {
      invoices: outcomes.reduce((a, o) => a + o.invoices, 0),
      amount: outcomes.reduce((a, o) => a + o.amount, 0),
    },
    outcomes,
    declineReasons,
    coverage: activity.coverage,
    outstanding: activity.outstanding,
    processors,
    taskStatuses: statuses,
    touchBands,
    recoveryPaths,
    creditMemos,
    campaigns: declinedCampaignChoices(),
    selectedCampaign: scopedLabel(filters),
    // Every measure above is denominated in `currency`; `currencies` is what else is in
    // the period, so a non-selected currency is disclosed rather than dropped.
    currency,
    currencies,
    dataLastUpdated: freshness.lastRunAt ?? undefined,
    dataNextUpdate: freshness.nextRunAt ?? undefined,
    updateEveryMinutes: freshness.updateEveryMinutes,
    freshness: freshness.items,
    pipelineLoading: freshness.loading,
  };
}

/**
 * The response tail both invoice lists share: what campaign/currency is in view, the
 * other currencies in the period, and the pipeline's freshness. Factored so the two
 * lists cannot drift on the meta they both report.
 */
async function invoiceListMeta(filters: CollectionsFilters, currency: string) {
  const allCurrencies = scopeFor(filters, null);
  const freshness = await cachedFreshness(getCycleFreshness);
  const currencies = await cachedCycleRead(
    'currency-totals', allCurrencies, {}, freshness,
    () => getCurrencyTotals(allCurrencies),
  );
  return {
    currency,
    campaigns: declinedCampaignChoices(),
    selectedCampaign: scopedLabel(filters),
    currencies,
    dataLastUpdated: freshness.lastRunAt ?? undefined,
    dataNextUpdate: freshness.nextRunAt ?? undefined,
    updateEveryMinutes: freshness.updateEveryMinutes,
    freshness: freshness.items,
    pipelineLoading: freshness.loading,
  };
}

export async function getCycleInvoices(
  filters: CollectionsFilters,
  opts: { result?: string; limit?: number; offset?: number; currency?: string } = {},
) {
  const currency = opts.currency ?? DEFAULT_CURRENCY;
  await loadCampaignVocabulary();
  const scope = scopeFor(filters, currency);
  const freshness = await cachedFreshness(getCycleFreshness);
  const { rows, total } = await cachedCycleRead(
    'cycle-invoices', scope,
    { result: opts.result, limit: opts.limit, offset: opts.offset }, freshness,
    () => getCycleInvoiceRows(scope, opts),
  );
  return { rows, total, ...(await invoiceListMeta(filters, currency)) };
}

/**
 * Insights → Collections → Failed Charge Invoices.
 *
 * The declined slice of Cycle Invoices, sliced by why the charge failed. Same invoice
 * grain and columns as Cycle Invoices — it reuses `getCycleInvoiceRows`, pinned to
 * DECLINED — but the filter is the decline reason rather than the run outcome. The
 * reason list is the same `getDeclineReasons` breakdown Cycle Performance shows, so the
 * button counts and the rows they open are one population.
 */
export async function getFailedChargeInvoices(
  filters: CollectionsFilters,
  opts: { reason?: string; limit?: number; offset?: number; currency?: string } = {},
): Promise<{ rows: unknown; total: number; declineReasons: ReasonRow[] } & Record<string, unknown>> {
  const currency = opts.currency ?? DEFAULT_CURRENCY;
  await loadCampaignVocabulary();
  const scope = scopeFor(filters, currency);
  const freshness = await cachedFreshness(getCycleFreshness);
  const { rows, total, declineReasons } = await cachedCycleRead(
    'failed-charge-invoices', scope,
    { reason: opts.reason, limit: opts.limit, offset: opts.offset }, freshness,
    async () => {
      const [page, reasons] = await Promise.all([
        getCycleInvoiceRows(scope, {
          result: 'DECLINED',
          reason: opts.reason,
          limit: opts.limit,
          offset: opts.offset,
        }),
        getDeclineReasons(scope),
      ]);
      return { ...page, declineReasons: reasons };
    },
  );
  return { rows, total, declineReasons, ...(await invoiceListMeta(filters, currency)) };
}
