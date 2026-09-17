/**
 * Insights → Collections: helpers shared by the read services.
 *
 * Split out of the original `insightsCollections.service.ts` as each report moved
 * to its own module past the 200-300 line guidance; that file is gone now, having
 * ended up holding nothing but the retired Overview. Nothing here runs a report on
 * its own — it is the scope/label/meta vocabulary the remaining services bind
 * against, so they stay on one definition of a campaign, a cohort and a viewer's
 * data scope.
 */
import type { RowDataPacket } from 'mysql2';
import pool from '../config/database';
import { getReportSchedule } from './insightsAgentActivity.service';
import { currentEmployeeJoin } from './insightsAgentScope';

export interface CollectionsFilters {
  period: string;
  customStart?: string;
  customEnd?: string;
  users?: string[];
  departments?: string[];
  campaign?: string;
  /**
   * Resolved viewer data scope from `InsightsPermissionService`:
   *   - `selfEmployeeKey` (non-null) → SELF scope: narrow agent-keyed facts to
   *     the viewer's own conformed employee row (no-agent rows drop out).
   *   - `departmentKeys` (non-empty) → DEPARTMENT/DIVISION scope: narrow to the
   *     viewer's department subtree (fail-closed sentinel when they manage none).
   * Both empty/null → ALL scope (Admin/Manager grants today).
   */
  selfEmployeeKey?: number | null;
  departmentKeys?: number[];
}

/**
 * The campaign vocabulary is READ FROM THE DATABASE — see
 * `insights/collections/campaignVocabulary.ts`. It used to be a hardcoded map here,
 * which is re-exported through this module only so the reports keep importing their
 * vocabulary from one place.
 *
 * Call `loadCampaignVocabulary()` once at a report's entry point; the accessors are
 * synchronous after that, so the SQL builders deeper down stay synchronous too.
 */
import { campaignKeyForLabel } from './insights/collections/campaignVocabulary';

export {
  loadCampaignVocabulary,
  campaignLabel,
  knownCampaignLabel,
  campaignKeyForLabel,
  declinedCampaigns,
  callLadderCampaigns,
} from './insights/collections/campaignVocabulary';

/**
 * The "no campaign filter" sentinel. A UI value rather than business content: it names
 * the absence of a selection, so it has no row in the dimension and never will.
 */
export const ALL_DECLINED = 'All Declined';

/**
 * Reporting currency. The declined-charge reports show one at a time, because their
 * measures are sums and USD plus CAD is not a number — there is no rate involved and
 * none is wanted. Defined here rather than per report so Cycle Performance and
 * Campaign × Touch cannot drift onto different defaults and disagree by a currency.
 */
export const DEFAULT_CURRENCY = 'USD';

/**
 * The declined basis — the invoices the recurring run declined on, and the tasks and
 * orders behind them — lives in `insights/collections/declinedBasis.ts`, so a rate's
 * numerator and denominator are built from one definition. Import it from there.
 */

export const toDateKey = (d: Date): number =>
  d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();

export const num = (v: unknown): number => (v == null ? 0 : Number(v));

/**
 * Money leaves the API with its cents intact.
 *
 * Every collections amount used to be Math.round()ed on the way out, which is
 * defensible for a KPI tile and indefensible for the invoice grid sitting underneath
 * it: a $32.95 invoice was served, and displayed, as $33. It also meant the totals
 * could not be reconciled against CRM, since regrouping changed how the rounding fell.
 *
 * Rounding to cents rather than not rounding at all is deliberate. The driver hands
 * DECIMAL columns back as strings and SUM() over them arrives as a float, so a plain
 * Number() leaves artefacts like 18738.129999999997 that then differ by grouping.
 * Fixing the scale at two decimals makes the sum of the parts equal the whole whichever
 * way the rows are cut, which is the property the reconciliation depends on.
 */
export const money = (v: unknown): number => Math.round(num(v) * 100) / 100;

/** Freshness stamp + filter dropdowns shared by every response. */
export async function baseMeta(fromKey: number, toKey: number) {
  const [userRows] = await pool.query<RowDataPacket[]>(
    `SELECT DISTINCT e.username AS name
       FROM ie_fact_collections_recovery f
       ${currentEmployeeJoin()}
      WHERE f.date_key BETWEEN ? AND ? AND f.processor_kind = 'AGENT'
      ORDER BY e.username`,
    [fromKey, toKey],
  );
  const [deptRows] = await pool.query<RowDataPacket[]>(
    `SELECT DISTINCT dpt.department_name AS name
       FROM ie_fact_collections_recovery f
       ${currentEmployeeJoin()}
       JOIN ie_dim_department dpt ON dpt.department_key = e.department_key
      WHERE f.date_key BETWEEN ? AND ? AND f.processor_kind = 'AGENT'
      ORDER BY dpt.department_name`,
    [fromKey, toKey],
  );
  const schedule = await getReportSchedule('collections_recovery');
  return {
    availableUsers: userRows.map((r) => r.name as string).filter(Boolean),
    availableDepartments: deptRows.map((r) => r.name as string).filter(Boolean),
    dataLastUpdated: schedule.dataLastUpdated,
    dataNextUpdate: schedule.dataNextUpdate,
    updateEveryMinutes: schedule.updateEveryMinutes,
  };
}

/**
 * The campaign key a filter selects, or undefined when it names an aggregate.
 *
 * Resolved by lookup alone, never by comparing against a sentinel string. The
 * aggregate is spelled differently per report — "All Declined" on the declined-charge
 * reports, "All Campaigns" on the org-wide ones — and a hardcoded comparison has to be
 * updated in every scope function each time one is renamed. A label that is not a
 * campaign is not a campaign filter, whatever it says.
 */
export const selectedCampaignKey = (filters: CollectionsFilters): string | undefined =>
  (filters.campaign ? campaignKeyForLabel(filters.campaign) : undefined);

/** The viewer/user/department predicates every scope shares, bound to alias `f`. */
function viewerPredicates(filters: CollectionsFilters) {
  const where: string[] = [];
  const params: Array<string | number> = [];
  if (filters.users?.length) {
    where.push(`e.username IN (${filters.users.map(() => '?').join(',')})`);
    params.push(...filters.users);
  }
  if (filters.departments?.length) {
    where.push(`dpt.department_name IN (${filters.departments.map(() => '?').join(',')})`);
    params.push(...filters.departments);
  }
  // Viewer data scope (same model as Agent Activity). SELF pins to the viewer's
  // own employee row; DEPARTMENT/DIVISION pins to their department subtree.
  // Both pin the CURRENT dimension row, never the fact's `employee_key`, which
  // is a superseded Type-2 key on anything loaded before the viewer last changed.
  if (filters.selfEmployeeKey != null) {
    where.push('e.employee_key = ?');
    params.push(filters.selfEmployeeKey);
  }
  if (filters.departmentKeys?.length) {
    where.push(`e.department_key IN (${filters.departmentKeys.map(() => '?').join(',')})`);
    params.push(...filters.departmentKeys);
  }
  return { where, params };
}

const EMP_JOINS = [
  currentEmployeeJoin({ left: true }),
  'LEFT JOIN ie_dim_department dpt ON dpt.department_key = e.department_key',
];

/**
 * CALENDAR scope for a fact aliased `f` carrying `employee_key` + `campaign_key`:
 * rows whose OWN `date_key` falls in the period. Right for "what happened this
 * month" reports (Overview trend, Agent Performance, Contact Frequency).
 *
 * `campaignKeys` bounds the aggregate case to a subset, for a report that only covers
 * some campaigns — same contract as `cohortScope`. Campaign × Touch counted its task
 * denominator across all seven campaigns while measuring dollars against four of them.
 */
export function agentScope(
  filters: CollectionsFilters,
  fromKey: number,
  toKey: number,
  campaignKeys?: readonly string[],
) {
  const where = ['f.date_key BETWEEN ? AND ?'];
  const params: Array<string | number> = [fromKey, toKey];

  const key = selectedCampaignKey(filters);
  if (key) { where.push('f.campaign_key = ?'); params.push(key); }
  else if (campaignKeys?.length) {
    where.push(`f.campaign_key IN (${campaignKeys.map(() => '?').join(',')})`);
    params.push(...campaignKeys);
  }

  const v = viewerPredicates(filters);
  where.push(...v.where);
  params.push(...v.params);
  return { joinSql: EMP_JOINS.join('\n'), whereSql: `WHERE ${where.join(' AND ')}`, params };
}

/**
 * BASIS scope for an activity fact aliased `f`: the employee joins and the viewer's
 * data scope, and DELIBERATELY NO PERIOD OR CAMPAIGN PREDICATE.
 *
 * For a report whose population is already pinned by an invoice restriction — the
 * declined basis — the window is expressed once, inside that restriction, and asserting
 * it a second time on the activity fact would silently narrow the answer. Cycle
 * Performance's "Collected to Date" is cash applied to the cycle's invoices HOWEVER LONG
 * it took, so a payment that lands on the 3rd of the next month belongs to the cycle that
 * declined it. Re-filtering on `f.date_key` would drop exactly that payment and put the
 * page a few thousand dollars under the report it is supposed to reconcile against.
 *
 * The viewer predicates stay, because "whose data may I see" is a different question
 * from "which invoices am I measuring" and the answer to it is never implied by a basis.
 */
export function basisScope(filters: CollectionsFilters) {
  const v = viewerPredicates(filters);
  return {
    joinSql: EMP_JOINS.join('\n'),
    // `1 = 1` keeps every caller's `${whereSql} AND ...` composition valid when the
    // viewer has ALL scope, which is the common case.
    whereSql: v.where.length ? `WHERE ${v.where.join(' AND ')}` : 'WHERE 1 = 1',
    params: v.params,
  };
}

/**
 * COHORT scope for an activity fact aliased `f` (touch / recovery / subscription).
 *
 * The period selects the campaign COHORT — the tasks CREATED in the window — and
 * then follows those tasks for their whole life, however long the activity takes
 * to land. Calendar scoping cuts a campaign at the month boundary and blends the
 * tail of the previous month's cadence into this month's curve, which is not a
 * lifecycle. It also mismatches numerator and denominator: payments dated in the
 * month were counted against tasks created in the month, two different populations.
 *
 * `joinTaskOn` is the activity fact's task column, e.g. `f.task_id`. Membership
 * (period + campaign) is asserted on the task fact `tk`; the user/department/viewer
 * predicates stay on the ACTIVITY fact, so filtering by agent still means "work
 * this agent did", not "tasks assigned to them".
 *
 * Set `withEmployee: false` for a fact that carries no `employee_key` — the
 * subscription fact is keyed by service, not by who worked it, so it can only be
 * scoped by cohort + campaign. A viewer on SELF/DEPARTMENT scope therefore still
 * sees org-wide subscription counts; that is tracked in the known-issues backlog
 * and is moot while the only grants are ALL.
 *
 * `campaignKeys` bounds the "All" case to a subset of campaigns, for a report that
 * only covers some of them. Without it, "All" would pull recovery from campaigns
 * the report's denominator excludes.
 */
export function cohortScope(
  filters: CollectionsFilters,
  fromKey: number,
  toKey: number,
  opts: { joinTaskOn?: string; withEmployee?: boolean; campaignKeys?: readonly string[] } = {},
) {
  const { joinTaskOn = 'f.task_id', withEmployee = true, campaignKeys } = opts;
  const joins = [`JOIN ie_fact_collections_task tk ON tk.task_id = ${joinTaskOn}`];
  if (withEmployee) joins.push(...EMP_JOINS);

  const where = ['tk.date_key BETWEEN ? AND ?'];
  const params: Array<string | number> = [fromKey, toKey];

  const key = selectedCampaignKey(filters);
  if (key) { where.push('tk.campaign_key = ?'); params.push(key); }
  else if (campaignKeys?.length) {
    where.push(`tk.campaign_key IN (${campaignKeys.map(() => '?').join(',')})`);
    params.push(...campaignKeys);
  }

  if (withEmployee) {
    const v = viewerPredicates(filters);
    where.push(...v.where);
    params.push(...v.params);
  }
  return { joinSql: joins.join('\n'), whereSql: `WHERE ${where.join(' AND ')}`, params };
}
