/**
 * Insights ? Collections ? Campaign � Touch.
 *
 * Marginal recovery by touch for one dunning campaign, reported as a COHORT: the
 * period picks the tasks CREATED in the window and every touch, payment and
 * subscription outcome is followed for those tasks however long they take, so the
 * curve is one campaign's full lifecycle rather than a calendar slice of two.
 *
 * Each rung carries the three measures the business steers on � dollars, tasks and
 * subscriptions � plus the agent / no-agent split of the dollars, because roughly a
 * third of recovery arrives with no agent call at all (customer self-serves in the
 * portal after the dunning email) and crediting that to the call ladder, or
 * dropping it while keeping its tasks in the denominator, both misread the campaign.
 *
 * Read layer: raw mysql2 against the warehouse, exempt from the Prisma-only DAL
 * rule per `.cursor/rules/insights-data-warehouse.mdc`. Response shape matches
 * `frontend/src/types/collections.ts`.
 */
import type { RowDataPacket } from 'mysql2';
import pool from '../config/database';
import { resolvePeriod } from '../utils/periodUtils';
import { factTableExists } from './insightsAgentActivity.service';
import {
  type CollectionsFilters,
  ALL_DECLINED,
  knownCampaignLabel,
  callLadderCampaigns,
  loadCampaignVocabulary,
  DEFAULT_CURRENCY,
  baseMeta,
  cohortScope,
  num,
  selectedCampaignKey,
  toDateKey,
} from './insightsCollections.shared';
import {
  loadCohortTotals,
  loadSubscriptionSummary,
  recoveryAgainstBasis,
  withCollected,
} from './insights/collections/campaign/cohort';
import { basisTasksSql } from './insights/collections/declinedBasis';
import { loadAgentRungs } from './insights/collections/campaign/agentRungs';
import { loadPostMemo, loadReactivationRungs } from './insights/collections/campaign/postMemo';

/** Per-rung accumulator; `seq` is the continuous ladder rung from the touch fact. */
interface Rung {
  phase: string;
  touchesMade: number;
  tasksReached: number;
  accountsReached: number;
  subs: number;
  payments: number;
  dollars: number;
  agentDollars: number;
  noAgentDollars: number;
  tasksRecovered: number;
  /** Cash that came back on a NEW invoice after this rung — kept out of `dollars`. */
  reactivationDollars: number;
  reactivationInvoices: number;
  /** Services lost at this rung that later came back — kept out of `subs`. */
  reactivationSubs: number;
}

const emptyRung = (phase: string): Rung => ({
  phase,
  touchesMade: 0,
  tasksReached: 0,
  accountsReached: 0,
  subs: 0,
  payments: 0,
  dollars: 0,
  agentDollars: 0,
  noAgentDollars: 0,
  tasksRecovered: 0,
  reactivationDollars: 0,
  reactivationInvoices: 0,
  reactivationSubs: 0,
});

export async function getCampaignTouch(
  filters: CollectionsFilters,
  campaign = ALL_DECLINED,
  currency = DEFAULT_CURRENCY,
) {
  const scoped = { ...filters, campaign };
  const emptyMeta = { availableUsers: [], availableDepartments: [] };
  // Campaign labels and the declined population come from ie_dim_collections_campaign.
  // Loaded here, once, so every synchronous resolver below reads the same vocabulary.
  await loadCampaignVocabulary();
  if (!(await factTableExists('ie_fact_collections_touch'))) {
    // `hasCallLadder` is part of the contract, so the empty response carries it too �
    // the client types it as required and would read undefined as "effort only".
    return {
      campaigns: [ALL_DECLINED], selectedCampaign: campaign, hasCallLadder: true,
      currency,
      touches: [], subscription: undefined, cohort: undefined, postMemo: undefined,
      ...emptyMeta,
    };
  }

  const { current } = resolvePeriod(filters.period, filters.customStart, filters.customEnd);
  const fromKey = toDateKey(current.start);
  const toKey = toDateKey(current.end);

  const [campRows] = await pool.query<RowDataPacket[]>(
    `SELECT DISTINCT campaign_key AS k FROM ie_fact_collections_task
      WHERE date_key BETWEEN ? AND ?`,
    [fromKey, toKey],
  );
  // The aggregate is ALL DECLINED, not all campaigns. Every dollar measure on this page
  // is scored against the declined-charge pool, which covers the four recurring runs
  // only � so blending Check, Expiring CC and Sales AR into "all" put three quarters of
  // August's numerator ($357,583 of $478,650) against a denominator that excludes them,
  // and reported a 589.5% recovery rate. They stay individually selectable below.
  const campaigns = [ALL_DECLINED, ...campRows
    .map((r) => knownCampaignLabel(String(r.k)))
    .filter((label): label is string => Boolean(label))];

  const selectedKey = selectedCampaignKey(scoped);
  // Check (invoice/email cadence) and Expiring CC (chases a card update, not a
  // balance) have no numbered call ladder and no failed charge behind them, so neither
  // the marginal-recovery curve nor the dollar rate applies � the page renders their
  // effort and their cash, with no rate. See the shared module.
  const hasCallLadder = selectedKey
    ? callLadderCampaigns().includes(selectedKey)
    : true;
  // Bounds the aggregate to the campaigns the pool covers. A single non-ladder campaign
  // still scopes to itself, because its effort is real; only its denominator is absent.
  const ladder = { campaignKeys: callLadderCampaigns() } as const;
  const against = recoveryAgainstBasis(scoped, fromKey, toKey, hasCallLadder, currency);

  // EFFORT IS SCOPED TO THE SAME INVOICES THE DOLLARS ARE. A task is in this report
  // because it is chasing an invoice that declined on the run, not because it happened
  // to be raised in the window � 332 tasks here, against the 395 the task-anchored
  // scope returned, and the extra 63 were chasing debt the run never declined. Scoping
  // effort and money differently is what let `tasksReached` describe a wider population
  // than `tasksRecovered` could ever be drawn from.
  //
  // Composed ONTO `cohortScope` rather than replacing it, so the viewer's employee
  // predicates and the campaign bound stay exactly where they were.
  const basisTasks = hasCallLadder
    ? basisTasksSql(scoped, fromKey, toKey, callLadderCampaigns(), currency)
    : null;
  const ladderScope = () => {
    const s = cohortScope(scoped, fromKey, toKey, ladder);
    if (!basisTasks) return s;
    return {
      joinSql: s.joinSql,
      whereSql: `${s.whereSql} AND f.task_id IN (${basisTasks.sql})`,
      params: [...s.params, ...basisTasks.params],
    };
  };

  const rungs = new Map<number, Rung>();
  const rung = (seq: number, phase = 'OUTREACH'): Rung => {
    if (!rungs.has(seq)) rungs.set(seq, emptyRung(phase));
    return rungs.get(seq)!;
  };

  // -- Effort per rung: touches made, tasks and customers reached --------------
  const effort = ladderScope();
  const [effortRows] = await pool.query<RowDataPacket[]>(
    // Phase is counted, not MAX()ed. Rungs carry a mix � a rung reached by one account
    // on the termination leg and a hundred on ordinary outreach holds both � and MAX()
    // returns TERM because it sorts last, which flagged 7 of August's 9 rungs as
    // terminations and painted the whole chart red.
    `SELECT f.touch_seq AS seq,
            COUNT(*) AS touchesMade,
            SUM(f.phase = 'TERM')  AS termTouches,
            SUM(f.phase = 'FINAL') AS finalTouches,
            COUNT(DISTINCT f.task_id) AS tasksReached,
            COUNT(DISTINCT tk.customer_id) AS customers
       FROM ie_fact_collections_touch f
       ${effort.joinSql}
       ${effort.whereSql} AND f.touch_seq IS NOT NULL AND f.touch_seq > 0
       GROUP BY f.touch_seq
       ORDER BY f.touch_seq`,
    effort.params,
  );
  for (const r of effortRows) {
    const made = num(r.touchesMade);
    const fin = num(r.finalTouches);
    const term = num(r.termTouches);
    // Majority rule: a rung is named for what most of its touches actually were.
    const phase = fin * 2 > made ? 'FINAL' : (fin + term) * 2 > made ? 'TERM' : 'OUTREACH';
    const t = rung(Number(r.seq), phase);
    t.phase = phase;
    t.touchesMade = made;
    t.tasksReached = num(r.tasksReached);
    t.accountsReached = num(r.customers);
  }

  // -- Money per rung, split by who processed it -------------------------------
  // A payment is attributed to the last numbered touch that preceded it. Payments
  // with no preceding numbered touch (attributed_touch_seq IS NULL) are real
  // recovery but belong to no rung; they are reported separately as `noTouch` so
  // the ladder neither takes credit for them nor hides them.
  const money = ladderScope();
  const [moneyRows] = await pool.query<RowDataPacket[]>(
    `SELECT f.attributed_touch_seq AS seq,
            COUNT(*) AS payments,
            SUM(f.amount) AS dollars,
            SUM(CASE WHEN f.processor_kind = 'AGENT'    THEN f.amount ELSE 0 END) AS agentDollars,
            SUM(CASE WHEN f.processor_kind = 'NO_AGENT' THEN f.amount ELSE 0 END) AS noAgentDollars,
            COUNT(DISTINCT f.task_id) AS tasksRecovered
       FROM ie_fact_collections_recovery f
       ${money.joinSql}
       ${money.whereSql} AND f.is_reversed = 0${against.sql}
         AND f.attributed_touch_seq IS NOT NULL AND f.attributed_touch_seq > 0
       GROUP BY f.attributed_touch_seq`,
    [...money.params, ...against.params],
  );
  for (const r of moneyRows) {
    const t = rung(Number(r.seq));
    t.payments = num(r.payments);
    t.dollars = num(r.dollars);
    t.agentDollars = num(r.agentDollars);
    t.noAgentDollars = num(r.noAgentDollars);
    t.tasksRecovered = num(r.tasksRecovered);
  }

  // Recovery that never followed a numbered touch � self-service in the portal
  // after the dunning email, or a payment taken on a disposition-only task.
  const noTouchScope = ladderScope();
  const [[noTouchRow]] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS payments,
            SUM(f.amount) AS dollars,
            SUM(CASE WHEN f.processor_kind = 'AGENT'    THEN f.amount ELSE 0 END) AS agentDollars,
            SUM(CASE WHEN f.processor_kind = 'NO_AGENT' THEN f.amount ELSE 0 END) AS noAgentDollars,
            COUNT(DISTINCT f.task_id) AS tasksRecovered
       FROM ie_fact_collections_recovery f
       ${noTouchScope.joinSql}
       ${noTouchScope.whereSql} AND f.is_reversed = 0${against.sql}
         AND (f.attributed_touch_seq IS NULL OR f.attributed_touch_seq = 0)`,
    [...noTouchScope.params, ...against.params],
  );

  // -- Subscriptions RECOVERED per rung ----------------------------------------
  // Counted off the recovery fact's attributed rung, not off the touch fact. Read from
  // touches this counted every service WORKED at a rung, so a subscription touched at
  // rungs 1, 2 and 3 appeared in all three and the column could never sum to the cohort
  // � it was not a partition, which is why the rungs visibly did not add up. Recovery
  // is attributed to exactly one rung, so counting services behind the tasks it paid
  // gives each subscription one rung and makes the column foot against the tile above.
  // THE UNTOUCHED BUCKET IS COUNTED TOO, not filtered out. Every other measure on this
  // chart opens on the no-touch baseline — dollars, tasks, and now win-backs — because
  // that cash arrived before rung 1 by construction. Subscriptions alone were dropping
  // it, so the first bar reported real money against "0 subs" and read as though nothing
  // had been kept. The rung is derived in the SELECT rather than by a second query, so
  // the two buckets can only ever partition the same rows.
  const hasSubs = await factTableExists('ie_fact_collections_subscription');
  let noTouchSubs = 0;
  if (hasSubs) {
    const subScope = ladderScope();
    const [subRows] = await pool.query<RowDataPacket[]>(
      `SELECT CASE WHEN f.attributed_touch_seq > 0 THEN f.attributed_touch_seq END AS seq,
              COUNT(DISTINCT sub.service_id) AS subs
         FROM ie_fact_collections_recovery f
         JOIN ie_fact_collections_subscription sub ON sub.task_id = f.task_id
         ${subScope.joinSql}
         ${subScope.whereSql} AND f.is_reversed = 0${against.sql}
         GROUP BY 1`,
      [...subScope.params, ...against.params],
    );
    for (const r of subRows) {
      if (r.seq == null) noTouchSubs = num(r.subs);
      else rung(Number(r.seq)).subs = num(r.subs);
    }
  }

  const agentsBySeq = await loadAgentRungs(scoped, fromKey, toKey, against, hasSubs);

  const cohortBase = await loadCohortTotals(scoped, fromKey, toKey, hasCallLadder, currency);
  const subscription = hasSubs ? await loadSubscriptionSummary(scoped, fromKey, toKey) : undefined;
  const postMemo = await loadPostMemo(scoped, fromKey, toKey, currency);

  // Reactivation cash lands on a rung of its own accord, but only for campaigns that
  // have a declined run to be memoed in the first place.
  let reactivationNoTouch = { dollars: 0, invoices: 0, subs: 0 };
  if (hasCallLadder) {
    for (const r of await loadReactivationRungs(scoped, fromKey, toKey, currency)) {
      if (r.seq == null) {
        reactivationNoTouch = { dollars: r.dollars, invoices: r.invoices, subs: r.subs };
        continue;
      }
      const t = rung(r.seq);
      t.reactivationDollars = r.dollars;
      t.reactivationInvoices = r.invoices;
      t.reactivationSubs = r.subs;
    }
  }

  const noTouch = {
    payments: num(noTouchRow?.payments),
    dollars: Math.round(num(noTouchRow?.dollars)),
    agentDollars: Math.round(num(noTouchRow?.agentDollars)),
    noAgentDollars: Math.round(num(noTouchRow?.noAgentDollars)),
    tasksRecovered: num(noTouchRow?.tasksRecovered),
    subsRecovered: noTouchSubs,
    reactivationDollars: reactivationNoTouch.dollars,
    reactivationInvoices: reactivationNoTouch.invoices,
    reactivationSubs: reactivationNoTouch.subs,
  };

  // -- Shape the ladder --------------------------------------------------------
  // Rates are expressed against the cohort, so the denominator is the same population
  // the campaign actually worked: every task raised in the window, including the ones
  // that resolved before anyone dialled. The dollars above it are now restricted to
  // the same declined pool `atRisk` measures, so the curve can no longer pass 100%
  // by counting debt the denominator never contained.
  const poolTasks = cohortBase.tasks || 1;
  const poolDollars = cohortBase.atRisk ?? 0;
  // THE CURVE STARTS AT THE NO-TOUCH BASELINE, NOT AT ZERO. `attributed_touch_seq` is
  // NULL exactly when no numbered touch preceded the payment, so that cash arrived
  // before rung 1 by construction � it is the campaign's starting position, not a
  // separate pot. Starting at zero dropped it from the curve while the headline kept
  // it, so the two disagreed on the same page: 2026-09 Declined CC (16th) closed at
  // $1,954 / 5.4% against a cohort that recovered $7,797 / 21.4%, because 58 of its 73
  // payments were portal self-service after the dunning email. Cycle Performance
  // reports that same $7,797 as Collected to Date, and the curve now closes on it.
  //
  // Accumulating the PUBLISHED rounded figures rather than the raw sums is the same
  // rule `collected` follows below, and it is what makes the last rung's cumulative
  // equal the headline exactly instead of drifting a dollar from it.
  let cumDollars = noTouch.dollars;
  let cumTasks = noTouch.tasksRecovered;
  // Accumulated separately and never folded into `cumDollars`. A save is cash on the
  // declined invoice, which is what Cycle Performance's Collected to Date counts; a
  // reactivation is cash on a replacement invoice raised after that one was written off.
  // Adding them would make the curve stop tying to the validated report, and would also
  // credit the campaign twice for a service it first lost.
  let cumReactivation = noTouch.reactivationDollars;

  const touches = [...rungs.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([seq, t]) => {
      const incrementalDollars = Math.round(t.dollars);
      cumDollars += incrementalDollars;
      cumTasks += t.tasksRecovered;
      cumReactivation += t.reactivationDollars;
      return {
        touchSeq: seq,
        label: t.phase === 'FINAL' ? 'Final Call' : `Touch ${seq}`,
        accountsReached: t.accountsReached,
        tasksReached: t.tasksReached,
        // No `|| t.tasksReached` fallback. A rung whose accounts hold no service row
        // has no subscriptions, and substituting the task count there presented one
        // measure as another rather than reporting the absence.
        subs: t.subs,
        touchesMade: t.touchesMade,
        calls: 0,          // per-touch call linkage lands with Channel Effectiveness Phase 2b
        talkMinutes: 0,
        payments: t.payments,
        incrementalDollars,
        agentDollars: Math.round(t.agentDollars),
        noAgentDollars: Math.round(t.noAgentDollars),
        cumulativeDollars: cumDollars,
        reactivationDollars: t.reactivationDollars,
        reactivationInvoices: t.reactivationInvoices,
        reactivationSubs: t.reactivationSubs,
        cumulativeReactivationDollars: cumReactivation,
        // Scored on the same denominator the save rate uses, so the two lines on the
        // chart are directly comparable rather than two scales sharing an axis.
        cumulativeReactivationRate: poolDollars > 0
          ? +((cumReactivation / poolDollars) * 100).toFixed(1)
          : 0,
        tasksRecovered: t.tasksRecovered,
        cumulativeTasksRecovered: cumTasks,
        // A campaign with no failed charge (Check, Expiring CC, Sales AR) has no
        // at-risk dollars to divide by, so the curve falls back to the task rate
        // rather than divide by zero and render a flat line.
        cumulativeRate: poolDollars > 0
          ? +((cumDollars / poolDollars) * 100).toFixed(1)
          : +((cumTasks / poolTasks) * 100).toFixed(1),
        incrementalRate: poolDollars > 0
          ? +((t.dollars / poolDollars) * 100).toFixed(1)
          : +((t.tasksRecovered / poolTasks) * 100).toFixed(1),
        cumulativeTaskRate: +((cumTasks / poolTasks) * 100).toFixed(1),
        benchmarkCumulative: 0, // industry curve layered on the client (single source)
        isTerm: t.phase === 'TERM' || t.phase === 'FINAL',
        agents: [...(agentsBySeq.get(seq)?.values() ?? [])],
      };
    });

  // The rungs and the no-touch bucket partition the recovery rows exactly, so their
  // sum IS the cohort's cash � and totalling the published figures keeps the headline
  // equal to the bars a reader can add up themselves.
  const collected = touches.reduce((sum, t) => sum + t.incrementalDollars, noTouch.dollars);

  const meta = await baseMeta(fromKey, toKey);
  return {
    campaigns,
    selectedCampaign: campaign,
    hasCallLadder,
    // Echoed so the page can state what its figures are denominated in. Filtering a
    // currency out without saying so is the failure the Cycle Performance picker exists
    // to prevent, and this report has no picker of its own.
    currency,
    touches,
    subscription,
    cohort: { ...withCollected(cohortBase, collected), noTouch },
    postMemo,
    ...meta,
  };
}
