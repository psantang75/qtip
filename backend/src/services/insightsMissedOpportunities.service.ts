/**
 * Insights → Missed Opportunities read service.
 *
 * Raw SQL over `ie_missed_opportunity_finding`, reusing `resolvePeriod` and the
 * same viewer-scope shape as the other Agent Activity reports so a SELF or
 * DEPARTMENT grant narrows this report exactly as it narrows Call Activity.
 *
 * Freshness comes from `ie_missed_opportunity_run.finished_at` rather than
 * `getReportSchedule`: this report is produced by a nightly LLM worker, not by
 * an `ie_source_report` registry row, so there is no registry cadence to read.
 */
import type { RowDataPacket } from 'mysql2';
import pool from '../config/database';
import { resolvePeriod } from '../utils/periodUtils';
import { resolveTaskCrmUrls } from './insights/missedOpportunities/crmLinkResolve';
import { buildCrmTicketUrl } from '../utils/crmLinks';
import { currentEmployeeJoin } from './insightsAgentScope';
import { MAX_FINDINGS, toDateKey, num, fmtYMD, fmtMDY, isoDate, dateOnly, buildScope, buildRunScope, EMP_JOINS } from './insights/missedOpportunities/reportSupport';
import type { MissedOpportunityFilters, MissedOpportunityResult, MissedOpportunityAgentRow } from './insights/missedOpportunities/reportTypes';
export type * from './insights/missedOpportunities/reportTypes';
export { getRunStatus } from './insights/missedOpportunities/reportSupport';

export async function getMissedOpportunities(
  filters: MissedOpportunityFilters,
): Promise<MissedOpportunityResult> {
  const { current } = resolvePeriod(filters.period, filters.customStart, filters.customEnd);
  const fromKey = toDateKey(current.start);
  const toKey = toDateKey(current.end);
  const { whereSql, params } = buildScope(filters, fromKey, toKey);
  const runScope = buildRunScope(filters, fromKey, toKey);

  const [findingRows] = await pool.query<RowDataPacket[]>(
    `SELECT f.finding_id, f.date_key, f.call_started_at, f.agent_name, f.conversation_id,
            f.talk_secs, f.direction, f.customer_name, f.crm_task_kind, f.crm_task_id,
            f.rule_key, f.severity, f.title,
            f.what_happened, f.evidence_quote, f.evidence_speaker,
            f.recommended_approach, f.recovery_action, f.est_value_note,
            r.rule_name, r.category
       FROM ie_missed_opportunity_finding f
       ${EMP_JOINS}
       ${whereSql}
      ORDER BY f.agent_name, f.call_started_at, f.finding_id
      LIMIT ${MAX_FINDINGS}`,
    params,
  );

  const [agentRows] = await pool.query<RowDataPacket[]>(
    `SELECT f.agent_name                                     AS agentName,
            COUNT(*)                                         AS findings,
            SUM(f.severity = 'high')                         AS high,
            SUM(f.severity = 'medium')                       AS medium,
            SUM(f.severity = 'low')                          AS low,
            COUNT(DISTINCT f.conversation_id)                AS callsWithFindings
       FROM ie_missed_opportunity_finding f
       ${EMP_JOINS}
       ${whereSql}
      GROUP BY f.agent_name
      ORDER BY findings DESC, f.agent_name`,
    params,
  );

  // The rule that fired MOST OFTEN per agent — the habit worth a coaching
  // conversation. Counted rather than ranked by severity: the column says "most
  // common", and one high-severity finding is not a pattern. Ties break toward
  // the rule with more high-severity findings, then alphabetically, so the
  // answer is stable across reloads.
  const [agentRuleRows] = await pool.query<RowDataPacket[]>(
    `SELECT f.agent_name                        AS agentName,
            COALESCE(r.rule_name, f.rule_key)   AS ruleName,
            COUNT(*)                            AS findings,
            SUM(f.severity = 'high')            AS high
       FROM ie_missed_opportunity_finding f
       ${EMP_JOINS}
       ${whereSql}
      GROUP BY f.agent_name, f.rule_key, r.rule_name
      ORDER BY f.agent_name, findings DESC, high DESC, ruleName`,
    params,
  );

  const [ruleRows] = await pool.query<RowDataPacket[]>(
    `SELECT f.rule_key AS ruleKey, r.rule_name AS ruleName, r.category AS category,
            COUNT(*) AS findings
       FROM ie_missed_opportunity_finding f
       ${EMP_JOINS}
       ${whereSql}
      GROUP BY f.rule_key, r.rule_name, r.category
      ORDER BY findings DESC, f.rule_key`,
    params,
  );

  // Run rows are the denominator: findings-per-call is only meaningful against
  // the calls that were actually analyzed, not against every call placed.
  const [[runTotals]] = await pool.query<RowDataPacket[]>(
    `SELECT COALESCE(SUM(calls_analyzed), 0) AS callsAnalyzed
       FROM ie_missed_opportunity_run
      WHERE run_date BETWEEN ? AND ?`,
    [fmtYMD(current.start), fmtYMD(current.end)],
  );

  // Calls carrying ANY finding, on the run's own basis — the complement of this
  // against calls_analyzed is what the rep actually did well. `runFindings` is
  // the numerator that belongs with `calls_analyzed`: the filtered total below
  // counts only what the page is showing, and dividing that by a day-wide
  // denominator produced a density that fell every time someone picked a rule.
  const [[flaggedTotals]] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(DISTINCT f.conversation_id) AS callsFlagged,
            COUNT(*)                          AS runFindings
       FROM ie_missed_opportunity_finding f
       ${EMP_JOINS}
       ${runScope.whereSql}`,
    runScope.params,
  );

  // Filtered basis, counted in SQL rather than from `findingRows` — that array
  // is subject to MAX_FINDINGS, so on a large window the page could report
  // fewer affected calls than it actually had.
  const [[filteredTotals]] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(DISTINCT f.conversation_id) AS callsWithFindings
       FROM ie_missed_opportunity_finding f
       ${EMP_JOINS}
       ${whereSql}`,
    params,
  );

  // Scoped to the selected window, not the newest run overall: on a day-scoped
  // report the banner and the freshness stamp must describe the day on screen.
  const [[selectedRun]] = await pool.query<RowDataPacket[]>(
    `SELECT run_date, status, calls_considered, calls_analyzed, calls_failed,
            calls_skipped, findings_count, usd_cost, error_text, finished_at
       FROM ie_missed_opportunity_run
      WHERE run_date BETWEEN ? AND ?
      ORDER BY run_date DESC LIMIT 1`,
    [fmtYMD(current.start), fmtYMD(current.end)],
  );

  const [[analyzedWindow]] = await pool.query<RowDataPacket[]>(
    `SELECT MIN(run_date) AS earliest, MAX(run_date) AS latest
       FROM ie_missed_opportunity_run WHERE status <> 'FAILED'`,
  );

  const [userRows] = await pool.query<RowDataPacket[]>(
    `SELECT DISTINCT agent_name AS name FROM ie_missed_opportunity_finding
      WHERE agent_name IS NOT NULL ORDER BY agent_name`,
  );
  const [deptRows] = await pool.query<RowDataPacket[]>(
    `SELECT DISTINCT dpt.department_name AS name
       FROM ie_missed_opportunity_finding f
       ${currentEmployeeJoin()}
       JOIN ie_dim_department dpt ON dpt.department_key = e.department_key
      ORDER BY dpt.department_name`,
  );

  // First row per agent is that agent's most-frequent rule: the query orders by
  // agent, then descending count.
  const topRuleByAgent = new Map<string, string>();
  for (const r of agentRuleRows) {
    const agent = (r.agentName as string) ?? 'Unattributed';
    if (!topRuleByAgent.has(agent)) topRuleByAgent.set(agent, r.ruleName as string);
  }

  const agents: MissedOpportunityAgentRow[] = agentRows.map((r) => {
    const agentName = (r.agentName as string) ?? 'Unattributed';
    return {
      agentName,
      findings: num(r.findings),
      high: num(r.high),
      medium: num(r.medium),
      low: num(r.low),
      callsWithFindings: num(r.callsWithFindings),
      topRuleName: topRuleByAgent.get(agentName) ?? null,
    };
  });

  const callsAnalyzed = num(runTotals?.callsAnalyzed);
  const totalFindings = agents.reduce((s, a) => s + a.findings, 0);

  // A rate needs a numerator and denominator drawn from the SAME population.
  // `calls_analyzed` is only recorded day-wide, so the moment the page is
  // narrowed to some agents or departments there is no denominator to match and
  // the honest answer is "not available for this view" rather than a number
  // built from two different populations.
  const narrowed = !!(
    filters.users?.length
    || filters.departments?.length
    || filters.selfEmployeeKey != null
    || filters.departmentKeys?.length
  );
  const ratesUnavailableReason = callsAnalyzed <= 0 ? 'no-run' : narrowed ? 'filtered' : null;

  // Clamped at zero: a re-graded day can briefly leave more flagged calls than
  // the run row's analyzed count, and a negative clean count would be nonsense.
  const cleanCalls = ratesUnavailableReason
    ? null
    : Math.max(0, callsAnalyzed - num(flaggedTotals?.callsFlagged));

  // Build the CRM deep link for every cited TASK from its task type's NewScreen
  // (one batched CRM read); tickets are deterministic. Resolved here so the page
  // and the Word export both render a correct URL instead of a hardcoded screen.
  const taskUrlById = await resolveTaskCrmUrls(
    findingRows
      .filter((r) => (r.crm_task_kind as string) === 'TASK' && r.crm_task_id != null)
      .map((r) => num(r.crm_task_id)),
  );
  const crmRefUrlOf = (kind: 'TASK' | 'TICKET' | null, id: number | null): string | null => {
    if (id == null) return null;
    if (kind === 'TASK') return taskUrlById.get(id) ?? null;
    if (kind === 'TICKET') return buildCrmTicketUrl(id);
    return null;
  };

  return {
    totals: {
      findings: totalFindings,
      high: agents.reduce((s, a) => s + a.high, 0),
      agentsAffected: agents.length,
      callsWithFindings: num(filteredTotals?.callsWithFindings),
      callsAnalyzed,
      findingsPerCall: ratesUnavailableReason
        ? null
        : Math.round((num(flaggedTotals?.runFindings) / callsAnalyzed) * 100) / 100,
      cleanCalls,
      cleanCallRate: cleanCalls == null
        ? null
        : Math.round((cleanCalls / callsAnalyzed) * 1000) / 10,
    },
    ratesUnavailableReason,
    agents,
    byRule: ruleRows.map((r) => ({
      ruleKey: r.ruleKey as string,
      ruleName: (r.ruleName as string) ?? null,
      category: (r.category as string) ?? null,
      findings: num(r.findings),
    })),
    findings: findingRows.map((r) => ({
      findingId: String(r.finding_id),
      dateKey: num(r.date_key),
      callDate: isoDate(r.call_started_at),
      agentName: (r.agent_name as string) ?? null,
      conversationId: (r.conversation_id as string) ?? null,
      talkSecs: r.talk_secs == null ? null : num(r.talk_secs),
      direction: (r.direction as string) ?? null,
      customerName: (r.customer_name as string) ?? null,
      crmRefKind: (r.crm_task_kind as 'TASK' | 'TICKET') ?? null,
      crmRefId: r.crm_task_id == null ? null : num(r.crm_task_id),
      crmRefUrl: crmRefUrlOf(
        (r.crm_task_kind as 'TASK' | 'TICKET') ?? null,
        r.crm_task_id == null ? null : num(r.crm_task_id),
      ),
      ruleKey: r.rule_key as string,
      ruleName: (r.rule_name as string) ?? null,
      category: (r.category as string) ?? null,
      severity: r.severity as string,
      title: r.title as string,
      whatHappened: r.what_happened as string,
      evidenceQuote: (r.evidence_quote as string) ?? null,
      evidenceSpeaker: (r.evidence_speaker as 'CUSTOMER' | 'AGENT') ?? null,
      recommendedApproach: r.recommended_approach as string,
      recoveryAction: (r.recovery_action as string) ?? null,
      estValueNote: (r.est_value_note as string) ?? null,
    })),
    run: selectedRun
      ? {
        runDate: dateOnly(selectedRun.run_date),
        status: (selectedRun.status as string) ?? null,
        callsConsidered: num(selectedRun.calls_considered),
        callsAnalyzed: num(selectedRun.calls_analyzed),
        callsFailed: num(selectedRun.calls_failed),
        callsSkipped: num(selectedRun.calls_skipped),
        findingsCount: num(selectedRun.findings_count),
        usdCost: num(selectedRun.usd_cost),
        errorText: (selectedRun.error_text as string) ?? null,
      }
      : null,
    runWindow: {
      earliest: dateOnly(analyzedWindow?.earliest),
      latest: dateOnly(analyzedWindow?.latest),
    },
    availableUsers: userRows.map((r) => r.name as string).filter(Boolean),
    availableDepartments: deptRows.map((r) => r.name as string).filter(Boolean),
    dateRange: { start: fmtMDY(current.start), end: fmtMDY(current.end) },
    dataLastUpdated: isoDate(selectedRun?.finished_at),
  };
}

