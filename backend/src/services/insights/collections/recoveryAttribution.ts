/**
 * How recovered money came back — the agent question, and the processor breakdown.
 *
 * Agent Performance is the only caller today. These were shared with Channel
 * Effectiveness, which is why `against` exists: the loaders take the invoice set as a
 * parameter rather than deciding it, so a second report can measure the same way without
 * a second copy of the query. Channel has since been retired; the parameter stays because
 * it is what keeps the measure and the population separable.
 */
import type { RowDataPacket } from 'mysql2';
import pool from '../../../config/database';
import { factTableExists } from '../../insightsAgentActivity.service';
import { num } from '../../insightsCollections.shared';
import type { SqlFragment } from './declinedBasis';

/** A `cohortScope`/`agentScope` result — joins, predicate and binds for alias `f`. */
export interface ActivityScope {
  joinSql: string;
  whereSql: string;
  params: Array<string | number>;
}

export interface SplitLeg { payments: number; accounts: number; amount: number }
export interface AgentSplit { preAgent: SplitLeg; postAgent: SplitLeg }

/**
 * Recovered dollars split on the question the business actually asks: did the money
 * come back on its own, or did it take an agent?
 *
 * "Post-agent" is EXISTS a touch on the task before the cash landed — not the recovery
 * fact's `attributed_touch_seq`, which only counts NUMBERED ladder rungs and would file
 * a payment that followed a disposition-only touch under "pre-agent".
 *
 * Deliberately NOT `processor_kind`. That records who KEYED the payment, which is a
 * different question: an agent can key cash that was already coming, and a customer can
 * self-serve in the portal after five calls. `loadProcessors` below answers the keying
 * question; this one answers whether the campaign had to intervene at all.
 */
export async function loadAgentSplit(
  scope: ActivityScope,
  against: SqlFragment,
): Promise<AgentSplit> {
  const empty: AgentSplit = {
    preAgent: { payments: 0, accounts: 0, amount: 0 },
    postAgent: { payments: 0, accounts: 0, amount: 0 },
  };
  if (!(await factTableExists('ie_fact_collections_recovery'))) return empty;

  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT CASE WHEN EXISTS (
              SELECT 1 FROM ie_fact_collections_touch tc
               WHERE tc.task_id = f.task_id AND tc.created_on <= f.applied_on
            ) THEN 'post' ELSE 'pre' END AS phase,
            COUNT(*)                          AS payments,
            COUNT(DISTINCT f.billing_group_id) AS accounts,
            SUM(f.amount)                     AS amount
       FROM ie_fact_collections_recovery f
       ${scope.joinSql}
       ${scope.whereSql} AND f.is_reversed = 0${against.sql}
       GROUP BY phase`,
    [...scope.params, ...against.params],
  );

  const out: AgentSplit = {
    preAgent: { ...empty.preAgent },
    postAgent: { ...empty.postAgent },
  };
  for (const r of rows) {
    const bucket = r.phase === 'post' ? out.postAgent : out.preAgent;
    bucket.payments = num(r.payments);
    bucket.accounts = num(r.accounts);
    // Left unrounded on purpose — the caller rounds once, at the edge. Rounding each leg
    // here and deriving the rate from the sum is what made a campaign read 83.8% on one
    // tab and 83.7% on Campaign × Touch for the same $680 of $812.
    bucket.amount = num(r.amount);
  }
  return out;
}

export interface ProcessorRow {
  processor: string;
  isAgent: boolean;
  collected: number;
  payments: number;
  inboundPayments: number;
  outboundPayments: number;
  noCallPayments: number;
  inboundCollected: number;
  outboundCollected: number;
}

/**
 * Who took the money, and what kind of call were they on.
 *
 * Direction is the LAST call that agent had on the same task at or before the payment,
 * inside a 7-day window. Outside that window there is no plausible causal link, so the
 * payment is reported as "no call" rather than credited to a stale conversation.
 * Payments with no agent at all are the portal self-service bucket and are listed as one
 * row so nobody reads them as an agent's production.
 */
export async function loadProcessors(
  scope: ActivityScope,
  against: SqlFragment,
): Promise<ProcessorRow[]> {
  if (!(await factTableExists('ie_fact_collections_recovery'))) return [];
  const hasCalls = await factTableExists('ie_fact_collections_call');

  const callDir = hasCalls
    ? `(SELECT c.direction FROM ie_fact_collections_call c
         WHERE c.task_id = f.task_id
           AND c.employee_key = f.employee_key
           AND c.started_on <= f.applied_on
           AND c.started_on >= DATE_SUB(f.applied_on, INTERVAL 7 DAY)
         ORDER BY c.started_on DESC LIMIT 1)`
    : 'NULL';

  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT x.processor,
            x.isAgent,
            COUNT(*)                                                        AS payments,
            SUM(x.amount)                                                   AS collected,
            SUM(CASE WHEN x.dir = 'Inbound'  THEN 1 ELSE 0 END)             AS inboundPayments,
            SUM(CASE WHEN x.dir = 'Outbound' THEN 1 ELSE 0 END)             AS outboundPayments,
            SUM(CASE WHEN x.dir IS NULL      THEN 1 ELSE 0 END)             AS noCallPayments,
            SUM(CASE WHEN x.dir = 'Inbound'  THEN x.amount ELSE 0 END)      AS inboundCollected,
            SUM(CASE WHEN x.dir = 'Outbound' THEN x.amount ELSE 0 END)      AS outboundCollected
       FROM (
         SELECT IFNULL(e.username, 'No agent — portal self-service') AS processor,
                CASE WHEN f.processor_kind = 'AGENT' THEN 1 ELSE 0 END AS isAgent,
                f.amount AS amount,
                ${callDir} AS dir
           FROM ie_fact_collections_recovery f
           ${scope.joinSql}
           ${scope.whereSql} AND f.is_reversed = 0${against.sql}
       ) x
      GROUP BY x.processor, x.isAgent
      ORDER BY collected DESC`,
    [...scope.params, ...against.params],
  );

  return rows.map((r) => ({
    processor: String(r.processor),
    isAgent: num(r.isAgent) === 1,
    collected: Math.round(num(r.collected)),
    payments: num(r.payments),
    inboundPayments: num(r.inboundPayments),
    outboundPayments: num(r.outboundPayments),
    noCallPayments: num(r.noCallPayments),
    inboundCollected: Math.round(num(r.inboundCollected)),
    outboundCollected: Math.round(num(r.outboundCollected)),
  }));
}
