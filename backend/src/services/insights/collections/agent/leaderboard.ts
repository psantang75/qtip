/**
 * Agent Performance — the collector leaderboard.
 *
 * Split out of `insightsCollectionsAgent.service.ts` on the measure boundary, the same
 * way Campaign × Touch split its cohort out: that file owns the page's argument (what the
 * run declined, whether it took an agent, who keyed it), this owns the per-agent rows.
 *
 * BUILT FROM TWO LEGS, NOT ONE. Cash and effort are separate queries merged by agent, so
 * an agent who worked forty of the cycle's tasks and closed none still gets a row. A
 * recovery-anchored query cannot show that — they have no row in it to be found by, and
 * the board silently read as though they had done nothing.
 */
import type { RowDataPacket } from 'mysql2';
import pool from '../../../../config/database';
import { factTableExists } from '../../../insightsAgentActivity.service';
import { basisScope, num } from '../../../insightsCollections.shared';
import type { SqlFragment } from '../declinedBasis';

type BasisScope = ReturnType<typeof basisScope>;

export interface AgentRow {
  agent: string;
  department: string;
  /** The four measures the board stands behind — all anchored to the cycle's invoices. */
  collected: number;
  payments: number;
  touches: number;
  tasksWorked: number;
  /** PENDING — computed but hidden until calls link to tickets and tasks. See below. */
  outboundCalls: number;
  outboundTalkMinutes: number;
  /** Calls the customer placed that landed on a basis task. */
  inboundCalls: number;
  inboundTalkMinutes: number;
  /** `outboundTalkMinutes + inboundTalkMinutes`, so the parts sum to the whole. */
  talkMinutes: number;
  dollarsPerTalkHour: number;
}

type Accumulator = Omit<AgentRow, 'talkMinutes' | 'dollarsPerTalkHour'>;

const emptyAgent = (agent: string, department: string): Accumulator => ({
  agent,
  department,
  collected: 0,
  payments: 0,
  touches: 0,
  tasksWorked: 0,
  outboundCalls: 0,
  outboundTalkMinutes: 0,
  inboundCalls: 0,
  inboundTalkMinutes: 0,
});

/**
 * Cash each agent keyed against the basis invoices.
 *
 * `processor_kind = 'AGENT'` is the credit test: it names who took the payment, which is
 * what a leaderboard is for. Whether the campaign had to intervene at all is the separate
 * question the pre/post-agent split answers, and conflating the two would let an agent's
 * row absorb portal self-service that happened to be recorded under their session.
 */
async function loadAgentCash(scope: BasisScope, against: SqlFragment) {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT COALESCE(e.username, f.agent_email) AS \`agent\`,
            COALESCE(dpt.department_name, '—')  AS \`department\`,
            SUM(f.amount)                       AS \`collected\`,
            COUNT(*)                            AS \`payments\`
       FROM ie_fact_collections_recovery f
       ${scope.joinSql}
       ${scope.whereSql} AND f.is_reversed = 0 AND f.processor_kind = 'AGENT'${against.sql}
      GROUP BY \`agent\`, \`department\``,
    [...scope.params, ...against.params],
  );
  return rows;
}

/**
 * Effort each agent spent on the basis tasks.
 *
 * Restricted to the basis tasks, not to tasks raised in the window, for the same reason
 * the dollars are: a task belongs to this page because it is chasing an invoice the run
 * declined. Scoping effort wider than money is what lets a denominator describe a
 * population its numerator could never be drawn from.
 */
async function loadAgentEffort(scope: BasisScope, tasks: SqlFragment) {
  if (!(await factTableExists('ie_fact_collections_touch'))) return [];
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT COALESCE(e.username, f.agent_email) AS \`agent\`,
            COALESCE(dpt.department_name, '—')  AS \`department\`,
            COUNT(*)                            AS \`touches\`,
            COUNT(DISTINCT f.task_id)           AS \`tasksWorked\`
       FROM ie_fact_collections_touch f
       ${scope.joinSql}
       ${scope.whereSql} AND f.task_id IN (${tasks.sql})
      GROUP BY \`agent\`, \`department\``,
    [...scope.params, ...tasks.params],
  );
  return rows;
}

/**
 * Phone effort on the basis tasks, split by who placed the call.
 *
 * ── PENDING: NOT CURRENTLY SHOWN ──────────────────────────────────────────────────────
 * This still runs and still returns, but the page hides every column it feeds
 * (`CALL_LINKAGE_CONFIRMED` in `CollectionsAgentPerformancePage.tsx`) because the figures
 * cannot yet be tied out. A call reaches a task only when its caller ID resolves to
 * exactly one customer; about a third of a collector's calls hit a number that matches no
 * customer or several, so they carry no task and are invisible here. Talk time is
 * therefore a FLOOR and `dollarsPerTalkHour` a ceiling, by an unknown margin.
 *
 * Linking calls to tickets and tasks directly is planned. When that lands, the margin
 * closes, the flag flips, and nothing here needs rewriting.
 * ──────────────────────────────────────────────────────────────────────────────────────
 *
 * INVOICE → TASK → CALL. `ie_fact_collections_call` carries `task_id`, so a call can be
 * bound to the cycle's own debt rather than to a calendar month, and the column means
 * "time this agent spent on THESE accounts" instead of "time they spent on the phone".
 *
 * This replaced a read of `ie_fact_call_activity`, the daily per-agent roll-up, which
 * carries no task at all. Two things were wrong with it: the population was the whole
 * month's phone work regardless of which debt it served, and the feed sat four weeks
 * behind, so the columns rendered as zeros for any recent cycle.
 *
 * `direction` is an exhaustive two-value domain on this fact (Outbound / Inbound, NOT
 * NULL), so the two legs sum to the agent's total with no third bucket to lose rows in.
 * Outbound CALLS count dials, including the ~7% that never connect; outbound TALK counts
 * only what was answered, which is why a row can show dials against little talk time.
 */
async function loadCallEffort(scope: BasisScope, tasks: SqlFragment) {
  if (!(await factTableExists('ie_fact_collections_call'))) return [];
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT COALESCE(e.username, f.agent_email) AS \`agent\`,
            COALESCE(dpt.department_name, '—')  AS \`department\`,
            SUM(f.direction = 'Outbound')       AS \`outboundCalls\`,
            SUM(f.direction = 'Inbound')        AS \`inboundCalls\`,
            SUM(CASE WHEN f.direction = 'Outbound' THEN f.talk_secs ELSE 0 END) AS \`outboundSecs\`,
            SUM(CASE WHEN f.direction = 'Inbound'  THEN f.talk_secs ELSE 0 END) AS \`inboundSecs\`
       FROM ie_fact_collections_call f
       ${scope.joinSql}
       ${scope.whereSql} AND f.task_id IN (${tasks.sql})
      GROUP BY \`agent\`, \`department\``,
    [...scope.params, ...tasks.params],
  );
  return rows;
}

/**
 * Cash, effort and phone time merged by agent, closed with the derived ratios.
 *
 * THREE LEGS, ONE IDENTITY EXPRESSION. Each query resolves the agent through the same
 * `COALESCE(e.username, f.agent_email)`, so the legs merge on one key; naming an agent
 * differently in one of them would split them into two rows that each look half-idle.
 *
 * Every leg is restricted to the basis, so an agent appears here because they worked THIS
 * cycle's debt — whether they closed it, touched it, or only dialled it.
 */
export async function loadLeaderboard(
  scope: BasisScope,
  against: SqlFragment,
  tasks: SqlFragment,
): Promise<AgentRow[]> {
  const [cash, effort, calls] = await Promise.all([
    loadAgentCash(scope, against),
    loadAgentEffort(scope, tasks),
    loadCallEffort(scope, tasks),
  ]);

  const byAgent = new Map<string, Accumulator>();
  const at = (r: RowDataPacket): Accumulator | null => {
    const agent = r.agent ? String(r.agent) : '';
    if (!agent) return null;
    if (!byAgent.has(agent)) byAgent.set(agent, emptyAgent(agent, String(r.department ?? '—')));
    return byAgent.get(agent)!;
  };

  for (const r of cash) {
    const a = at(r);
    if (!a) continue;
    a.collected = Math.round(num(r.collected));
    a.payments = num(r.payments);
  }
  for (const r of effort) {
    const a = at(r);
    if (!a) continue;
    a.touches = num(r.touches);
    a.tasksWorked = num(r.tasksWorked);
  }
  for (const r of calls) {
    const a = at(r);
    if (!a) continue;
    a.outboundCalls = num(r.outboundCalls);
    a.inboundCalls = num(r.inboundCalls);
    // Rounded per leg, then summed — so the two columns a reader adds up equal the total
    // beside them. Rounding the combined seconds instead can leave them a minute apart.
    a.outboundTalkMinutes = Math.round(num(r.outboundSecs) / 60);
    a.inboundTalkMinutes = Math.round(num(r.inboundSecs) / 60);
  }

  return [...byAgent.values()]
    .map((a) => {
      const talkMinutes = a.outboundTalkMinutes + a.inboundTalkMinutes;
      return {
        ...a,
        talkMinutes,
        dollarsPerTalkHour:
          talkMinutes > 0 ? Math.round(a.collected / (talkMinutes / 60)) : 0,
      };
    })
    .sort((x, y) => y.collected - x.collected || y.touches - x.touches);
}
