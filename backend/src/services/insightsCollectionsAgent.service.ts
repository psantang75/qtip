/**
 * Insights → Collections → Agent Performance.
 *
 * Reads top-down, as the question is actually asked about a billing run:
 *
 *   what the run declined  →  did it take an agent  →  who keyed it  →  who produced
 *
 * THE POPULATION IS CYCLE PERFORMANCE'S, NOT A CALENDAR SLICE. Every figure is measured
 * against `declinedBasis` — recurring invoices in the selected cycle, one campaign, one
 * currency, that declined on the run — which is the same predicate Cycle Performance
 * uses. The opening tiles are literally `loadCohortTotals`, the function Campaign × Touch
 * opens with, so the three pages state one set of facts about one set of invoices.
 *
 * WHAT THIS REPLACED, AND WHY IT COULD NEVER TIE OUT. The previous version measured
 * `ie_fact_collections_recovery` on `agentScope` — a CALENDAR scope — with no basis at
 * all. That meant:
 *   - every campaign at once, including Check, Expiring CC and Sales AR, which have no
 *     failed charge behind them;
 *   - every currency at once, adding CAD to USD behind a single "$";
 *   - ad-hoc, non-recurring invoices alongside the run's own output;
 *   - payments DATED in the month, which both swept in cash against invoices that
 *     declined in an earlier cycle and dropped this cycle's cash when it landed after
 *     month end.
 * Four leaks, all in the same direction as "the leaderboard total is not the collected
 * figure on any other page". No adjustment would have closed that gap, because the two
 * numbers were not describing the same invoices.
 *
 * The split and the processor table are the SAME loaders Channel Effectiveness uses
 * (`recoveryAttribution`), handed a different restriction. Phone effort follows the same
 * chain as everything else — invoice → task → call — so there is no calendar measure left
 * on the page; see `agent/leaderboard.ts` for what that still cannot see.
 *
 * Warehouse read path — raw mysql2 per `.cursor/rules/insights-data-warehouse.mdc`.
 * Response shape matches `frontend/src/types/collections.ts`.
 */
import { resolvePeriod } from '../utils/periodUtils';
import { factTableExists } from './insightsAgentActivity.service';
import {
  type CollectionsFilters,
  ALL_DECLINED,
  campaignLabel,
  declinedCampaigns,
  loadCampaignVocabulary,
  DEFAULT_CURRENCY,
  baseMeta,
  basisScope,
  selectedCampaignKey,
  toDateKey,
} from './insightsCollections.shared';
import { loadCohortTotals } from './insights/collections/campaign/cohort';
import {
  type SqlFragment,
  basisOrdersSql,
  basisTasksSql,
} from './insights/collections/declinedBasis';
import { loadAgentSplit, loadProcessors } from './insights/collections/recoveryAttribution';
import { loadLeaderboard } from './insights/collections/agent/leaderboard';

const EMPTY_SPLIT = {
  preAgent: { payments: 0, accounts: 0, amount: 0 },
  postAgent: { payments: 0, accounts: 0, amount: 0 },
};

export async function getAgentPerformance(
  filters: CollectionsFilters,
  campaign: string = ALL_DECLINED,
  currency: string = DEFAULT_CURRENCY,
) {
  // Campaign labels and the declined population come from ie_dim_collections_campaign.
  // Loaded here, once, so every synchronous resolver below reads the same vocabulary.
  await loadCampaignVocabulary();

  // A campaign this report cannot measure resolves to the aggregate rather than silently
  // filtering to one with no declined run behind it — the same guard Cycle Performance
  // uses, and the reason Check cannot be selected into a failed-charge page.
  const selected = selectedCampaignKey({ ...filters, campaign });
  const inScope =
    selected && declinedCampaigns().includes(selected)
      ? campaign
      : ALL_DECLINED;
  const scoped = { ...filters, campaign: inScope };

  const base = {
    campaigns: [ALL_DECLINED, ...declinedCampaigns().map(campaignLabel)],
    selectedCampaign: inScope,
    currency,
    cohort: undefined,
    split: EMPTY_SPLIT,
    processors: [],
    rows: [],
    availableUsers: [],
    availableDepartments: [],
  };
  if (!(await factTableExists('ie_fact_collections_recovery'))) return base;

  const { current } = resolvePeriod(filters.period, filters.customStart, filters.customEnd);
  const fromKey = toDateKey(current.start);
  const toKey = toDateKey(current.end);

  const orders = basisOrdersSql(scoped, fromKey, toKey, declinedCampaigns(), currency);
  const tasks = basisTasksSql(scoped, fromKey, toKey, declinedCampaigns(), currency);
  const against: SqlFragment = {
    sql: ` AND f.order_id IN (${orders.sql})`,
    params: orders.params,
  };
  const scope = basisScope(scoped);

  // `hasPool` is true by construction: every campaign this page offers is a declined run.
  const [cohort, split, processors, rows] = await Promise.all([
    loadCohortTotals(scoped, fromKey, toKey, true, currency),
    loadAgentSplit(scope, against),
    loadProcessors(scope, against),
    loadLeaderboard(scope, against, tasks),
  ]);

  // THE RECONCILIATION, STATED RATHER THAN HIDDEN. `collected` is the invoice fact's —
  // Cycle Performance's Collected to Date on these invoices. `attributed` is what the
  // recovery fact can name a processor for. A gap means cash landed on a basis invoice
  // with no recovery row behind it, which is a real finding about attribution coverage,
  // so it is published instead of being papered over by reporting whichever total makes
  // the sections agree. The rate stays on the invoice fact either way.
  const attributed = Math.round(split.preAgent.amount + split.postAgent.amount);
  const { atRisk, invoiceCollected } = cohort;

  const meta = await baseMeta(fromKey, toKey);
  return {
    ...base,
    cohort: {
      ...cohort,
      collected: invoiceCollected,
      attributed,
      unattributed: invoiceCollected - attributed,
      dollarRate: atRisk && atRisk > 0
        ? +((invoiceCollected / atRisk) * 100).toFixed(1)
        : null,
    },
    split: {
      preAgent: { ...split.preAgent, amount: Math.round(split.preAgent.amount) },
      postAgent: { ...split.postAgent, amount: Math.round(split.postAgent.amount) },
    },
    processors,
    rows,
    ...meta,
  };
}
