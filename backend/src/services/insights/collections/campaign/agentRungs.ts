/**
 * Campaign × Touch — the per-agent breakdown behind each rung's row expand.
 *
 * Three reads against the same cohort as the ladder itself (effort, cash, services),
 * folded into one map keyed by rung then agent. Split out of the service so that file
 * stays the ladder and this stays the drill-down.
 */
import type { RowDataPacket } from 'mysql2';
import pool from '../../../../config/database';
import {
  type CollectionsFilters,
  callLadderCampaigns,
  cohortScope,
  num,
} from '../../../insightsCollections.shared';
import type { SqlFragment } from '../declinedBasis';

export interface AgentRung {
  agent: string;
  touchesMade: number;
  customers: number;
  subs: number;
  payments: number;
  collected: number;
}

/**
 * Called rather than held: the campaign list is read from the database now, so a
 * module-level constant would be evaluated at import time, before any request has
 * loaded the vocabulary.
 */
const ladder = () => ({ campaignKeys: callLadderCampaigns() });

export async function loadAgentRungs(
  filters: CollectionsFilters,
  fromKey: number,
  toKey: number,
  against: SqlFragment,
  hasSubs: boolean,
): Promise<Map<number, Map<string, AgentRung>>> {
  const bySeq = new Map<number, Map<string, AgentRung>>();
  const ensure = (seq: number, agent: string): AgentRung => {
    if (!bySeq.has(seq)) bySeq.set(seq, new Map());
    const m = bySeq.get(seq)!;
    if (!m.has(agent)) {
      m.set(agent, { agent, touchesMade: 0, customers: 0, subs: 0, payments: 0, collected: 0 });
    }
    return m.get(agent)!;
  };

  const effort = cohortScope(filters, fromKey, toKey, ladder());
  const [effortRows] = await pool.query<RowDataPacket[]>(
    // No `subs` selected here. It used to select COUNT(DISTINCT f.task_id) under that
    // name and rely on the subscription read below to overwrite it, so whenever the
    // subscription fact was absent the column silently reported tasks as services.
    `SELECT f.touch_seq AS seq, COALESCE(e.username, f.agent_email) AS agent,
            COUNT(*) AS touchesMade,
            COUNT(DISTINCT tk.customer_id) AS customers
       FROM ie_fact_collections_touch f
       ${effort.joinSql}
       ${effort.whereSql} AND f.touch_seq IS NOT NULL AND f.touch_seq > 0
       GROUP BY f.touch_seq, agent`,
    effort.params,
  );
  for (const r of effortRows) {
    if (!r.agent) continue;
    const a = ensure(Number(r.seq), r.agent as string);
    a.touchesMade = num(r.touchesMade);
    a.customers = num(r.customers);
  }

  const money = cohortScope(filters, fromKey, toKey, ladder());
  const [moneyRows] = await pool.query<RowDataPacket[]>(
    `SELECT f.attributed_touch_seq AS seq, COALESCE(e.username, f.agent_email) AS agent,
            COUNT(*) AS payments, SUM(f.amount) AS collected
       FROM ie_fact_collections_recovery f
       ${money.joinSql}
       ${money.whereSql} AND f.processor_kind = 'AGENT'
         AND f.is_reversed = 0${against.sql}
         AND f.attributed_touch_seq IS NOT NULL AND f.attributed_touch_seq > 0
       GROUP BY f.attributed_touch_seq, agent`,
    [...money.params, ...against.params],
  );
  for (const r of moneyRows) {
    if (!r.agent) continue;
    const a = ensure(Number(r.seq), r.agent as string);
    a.payments = num(r.payments);
    a.collected = Math.round(num(r.collected));
  }

  if (hasSubs) {
    const sub = cohortScope(filters, fromKey, toKey, ladder());
    const [subRows] = await pool.query<RowDataPacket[]>(
      `SELECT f.touch_seq AS seq, COALESCE(e.username, f.agent_email) AS agent,
              COUNT(DISTINCT s.service_id) AS subs
         FROM ie_fact_collections_touch f
         JOIN ie_fact_collections_subscription s ON s.task_id = f.task_id
         ${sub.joinSql}
         ${sub.whereSql} AND f.touch_seq IS NOT NULL AND f.touch_seq > 0
         GROUP BY f.touch_seq, agent`,
      sub.params,
    );
    for (const r of subRows) {
      if (!r.agent) continue;
      ensure(Number(r.seq), r.agent as string).subs = num(r.subs);
    }
  }

  return bySeq;
}
