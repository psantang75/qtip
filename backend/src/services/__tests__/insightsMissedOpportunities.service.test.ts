/**
 * Read-service scoping tests.
 *
 * The security-relevant contract is that a SELF or DEPARTMENT grant narrows the
 * SQL itself, not the rendered page: an agent viewing this report must not be
 * able to see another rep's misses, and the report is per-agent by design, so
 * the predicate is the only thing standing between them.
 *
 * Also pinned: findings-per-call divides by *analyzed* calls (short dials and
 * calls without a transcript are never graded, so counting them would
 * understate density), and freshness comes from the run row rather than an
 * `ie_source_report` cadence this worker doesn't have.
 *
 * The pool is mocked; queries are inspected rather than executed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { poolQuery } = vi.hoisted(() => ({ poolQuery: vi.fn() }));

vi.mock('../../config/database', () => ({
  default: { query: (...a: unknown[]) => poolQuery(...a) },
}));

import { getMissedOpportunities } from '../insightsMissedOpportunities.service';

/**
 * The service fires eleven queries in order: findings, agent rollup, per-agent
 * rule counts, rule totals, run totals, run-basis flagged/findings counts,
 * filtered flagged count, the selected day's run, the analyzed-day window,
 * distinct users, distinct departments.
 */
const CALL = {
  findings: 0, agents: 1, agentRules: 2, rules: 3, runTotals: 4, flagged: 5,
  filtered: 6, selectedRun: 7, runWindow: 8, users: 9, depts: 10,
} as const;

const findingRow = (over: Record<string, unknown> = {}) => ({
  finding_id: 1n,
  date_key: 20260904,
  call_started_at: new Date('2026-09-04T13:15:00Z'),
  agent_name: 'Jane Rep',
  conversation_id: 'conv-1',
  talk_secs: 420,
  direction: 'outbound',
  customer_name: 'Mabels Diner',
  crm_task_kind: 'TASK',
  crm_task_id: 12345,
  rule_key: 'buying_signal_not_closed',
  severity: 'high',
  title: 'Did not ask for the order',
  what_happened: 'Owner wanted install before the holidays.',
  evidence_quote: 'I want this in before Thanksgiving',
  recommended_approach: 'Ask for the order and offer Tuesday install.',
  recovery_action: 'Call Mabels this morning and book Tuesday install.',
  est_value_note: '~$2,400 ARR',
  rule_name: 'Buying signal not closed',
  category: 'Closing',
  ...over,
});

const agentRow = (over: Record<string, unknown> = {}) => ({
  agentName: 'Jane Rep',
  findings: 3, high: 2, medium: 1, low: 0,
  callsWithFindings: 2,
  ...over,
});

/** One (agent, rule) count row, as the top-rule query returns them. */
const agentRuleRow = (over: Record<string, unknown> = {}) => ({
  agentName: 'Jane Rep',
  ruleName: 'Buying signal not closed',
  findings: 3,
  high: 2,
  ...over,
});

/** Default responses for all eleven queries; individual tests override by index. */
function stubQueries(over: Partial<Record<number, unknown[]>> = {}) {
  const defaults: unknown[][] = [
    [findingRow()],
    [agentRow()],
    [agentRuleRow()],
    [{ ruleKey: 'buying_signal_not_closed', ruleName: 'Buying signal not closed', category: 'Closing', findings: 3 }],
    [{ callsAnalyzed: 60 }],
    [{ callsFlagged: 2, runFindings: 3 }],
    [{ callsWithFindings: 2 }],
    [{
      run_date: new Date('2026-09-04T00:00:00Z'),
      status: 'SUCCESS',
      calls_considered: 64, calls_analyzed: 60, calls_failed: 0, calls_skipped: 4,
      findings_count: 3, usd_cost: '0.4200', error_text: null,
      finished_at: new Date('2026-09-05T06:02:00Z'),
    }],
    [{ earliest: new Date('2026-09-04T00:00:00Z'), latest: new Date('2026-09-08T00:00:00Z') }],
    [{ name: 'Jane Rep' }],
    [{ name: 'Sales Inbound' }],
  ];
  let i = 0;
  poolQuery.mockImplementation(async () => {
    const idx = i++;
    return [over[idx] ?? defaults[idx] ?? []];
  });
}

/** SQL + bound params for one of the nine queries. */
const queryAt = (index: number) => {
  const [sql, params] = poolQuery.mock.calls[index];
  return { sql: String(sql), params: (params ?? []) as unknown[] };
};

const base = { period: 'custom', customStart: '2026-09-04', customEnd: '2026-09-04' };

beforeEach(() => {
  vi.clearAllMocks();
  stubQueries();
});

it('renders QA findings and rollups from database rule labels', async () => {
  const key = 'sales_qa_v8_discovery';
  stubQueries({
    [CALL.findings]: [findingRow({ rule_key: key, rule_name: 'QA step: Discovery and needs', category: 'Required sales step' })],
    [CALL.agentRules]: [agentRuleRow({ ruleName: 'QA step: Discovery and needs' })],
    [CALL.rules]: [{ ruleKey: key, ruleName: 'QA step: Discovery and needs', category: 'Required sales step', findings: 1 }],
  });
  const result = await getMissedOpportunities(base);
  expect(result.findings[0].ruleName).toBe('QA step: Discovery and needs');
  expect(result.findings[0].category).toBe('Required sales step');
  expect(result.byRule[0].ruleName).toBe('QA step: Discovery and needs');
  expect(result.agents[0].topRuleName).toBe('QA step: Discovery and needs');
});

describe('viewer scope', () => {
  it('ALL scope adds no employee or department predicate', async () => {
    await getMissedOpportunities({ ...base });
    const { sql, params } = queryAt(CALL.findings);
    expect(sql).not.toContain('e.employee_key = ?');
    expect(sql).not.toContain('e.department_key IN');
    expect(params).toEqual([20260904, 20260904]);
  });

  it('SELF scope pins the viewer on their CURRENT employee row, not the fact', async () => {
    // ie_dim_employee is Type-2: findings loaded before the viewer's last
    // record change carry a superseded employee_key, so pinning f.employee_key
    // would hide the viewer's own older findings from them.
    await getMissedOpportunities({ ...base, selfEmployeeKey: 77 });
    const { sql, params } = queryAt(CALL.findings);
    expect(sql).toContain('e.employee_key = ?');
    expect(sql).not.toContain('f.employee_key = ?');
    expect(params).toEqual([20260904, 20260904, 77]);
  });

  it('DEPARTMENT scope pins the department subtree on the joined employee row', async () => {
    await getMissedOpportunities({ ...base, departmentKeys: [4, 9] });
    const { sql, params } = queryAt(CALL.findings);
    expect(sql).toContain('e.department_key IN (?,?)');
    expect(params).toEqual([20260904, 20260904, 4, 9]);
  });

  it('applies the same predicate to the rollup and rule queries, not just the detail list', async () => {
    await getMissedOpportunities({ ...base, selfEmployeeKey: 77 });
    for (const index of [CALL.findings, CALL.agents, CALL.agentRules, CALL.rules]) {
      expect(queryAt(index).sql).toContain('e.employee_key = ?');
      expect(queryAt(index).params).toContain(77);
    }
  });

  it('combines requested filters with the viewer scope rather than replacing it', async () => {
    await getMissedOpportunities({
      ...base,
      users: ['Jane Rep'],
      departments: ['Sales Inbound'],
      ruleKeys: ['no_dated_next_step'],
      severities: ['high'],
      selfEmployeeKey: 77,
    });
    const { sql, params } = queryAt(CALL.findings);
    expect(sql).toContain('f.agent_name IN (?)');
    expect(sql).toContain('dpt.department_name IN (?)');
    expect(sql).toContain('f.rule_key IN (?)');
    expect(sql).toContain('f.severity IN (?)');
    expect(sql).toContain('e.employee_key = ?');
    expect(params).toEqual([
      20260904, 20260904, 'Jane Rep', 'Sales Inbound', 'no_dated_next_step', 'high', 77,
    ]);
  });

  it('windows every query by date_key from the resolved period', async () => {
    await getMissedOpportunities({ period: 'custom', customStart: '2026-09-01', customEnd: '2026-09-04' });
    const { sql, params } = queryAt(CALL.findings);
    expect(sql).toContain('f.date_key BETWEEN ? AND ?');
    expect(params.slice(0, 2)).toEqual([20260901, 20260904]);
  });

  it('compares run_date as a YYYY-MM-DD string so a UTC-pinned pool cannot shift the day', async () => {
    await getMissedOpportunities({ period: 'custom', customStart: '2026-09-01', customEnd: '2026-09-04' });
    expect(queryAt(CALL.runTotals).params).toEqual(['2026-09-01', '2026-09-04']);
  });
});

describe('response shape', () => {
  it('divides findings by analyzed calls, not by every call placed', async () => {
    const { totals } = await getMissedOpportunities({ ...base });
    expect(totals.callsAnalyzed).toBe(60);
    expect(totals.findings).toBe(3);
    expect(totals.findingsPerCall).toBe(0.05);
  });

  it('reports findings-per-call as null when nothing was analyzed, never as zero', async () => {
    stubQueries({ [CALL.runTotals]: [{ callsAnalyzed: 0 }] });
    const { totals } = await getMissedOpportunities({ ...base });
    expect(totals.findingsPerCall).toBeNull();
  });

  it('counts the calls that came back clean as analyzed minus flagged', async () => {
    const { totals } = await getMissedOpportunities({ ...base });
    expect(totals.cleanCalls).toBe(58);
    expect(totals.cleanCallRate).toBe(96.7);
  });

  it('clamps clean calls at zero when a re-grade leaves more flagged calls than analyzed', async () => {
    stubQueries({ [CALL.runTotals]: [{ callsAnalyzed: 2 }], [CALL.flagged]: [{ callsFlagged: 5 }] });
    const { totals } = await getMissedOpportunities({ ...base });
    expect(totals.cleanCalls).toBe(0);
    expect(totals.cleanCallRate).toBe(0);
  });

  it('reports the clean-call rate as null when nothing was analyzed', async () => {
    stubQueries({ [CALL.runTotals]: [{ callsAnalyzed: 0 }] });
    expect((await getMissedOpportunities({ ...base })).totals.cleanCallRate).toBeNull();
  });

  it('keeps the flagged-call count off the report filters, so filtering cannot inflate the clean rate', async () => {
    await getMissedOpportunities({
      ...base,
      users: ['Jane Rep'],
      ruleKeys: ['no_dated_next_step'],
      severities: ['high'],
      selfEmployeeKey: 77,
    });
    const { sql, params } = queryAt(CALL.flagged);
    expect(sql).toContain('COUNT(DISTINCT f.conversation_id)');
    expect(sql).not.toContain('f.rule_key IN');
    expect(sql).not.toContain('f.severity IN');
    expect(sql).not.toContain('f.agent_name IN');
    // Viewer scope is a permission boundary, so it survives.
    expect(sql).toContain('e.employee_key = ?');
    expect(params).toEqual([20260904, 20260904, 77]);
  });

  it('rolls totals up from the per-agent rows so the table and the tiles agree', async () => {
    stubQueries({
      [CALL.agents]: [
        agentRow({ agentName: 'Jane Rep', findings: 3, high: 2 }),
        agentRow({ agentName: 'Sam Rep', findings: 1, high: 0 }),
      ],
    });
    const { totals } = await getMissedOpportunities({ ...base });
    expect(totals.findings).toBe(4);
    expect(totals.high).toBe(2);
    expect(totals.agentsAffected).toBe(2);
  });

  it('sources freshness from the run row, since this worker has no registry cadence', async () => {
    const res = await getMissedOpportunities({ ...base });
    expect(res.dataLastUpdated).toBe('2026-09-05T06:02:00.000Z');
    expect(res.run).toMatchObject({ runDate: '2026-09-04', status: 'SUCCESS', usdCost: 0.42 });
  });

  it('carries the CRM citation through so the finding can deep-link', async () => {
    const res = await getMissedOpportunities({ ...base });
    expect(res.findings[0]).toMatchObject({ crmRefKind: 'TASK', crmRefId: 12345 });
  });

  it('reports no citation as null rather than 0, which would link to a bad record', async () => {
    stubQueries({ [CALL.findings]: [findingRow({ crm_task_kind: null, crm_task_id: null })] });
    const res = await getMissedOpportunities({ ...base });
    expect(res.findings[0].crmRefKind).toBeNull();
    expect(res.findings[0].crmRefId).toBeNull();
  });

  it('scopes the run row to the selected day, not the newest run overall', async () => {
    await getMissedOpportunities({ period: 'custom', customStart: '2026-09-04', customEnd: '2026-09-04' });
    const { sql, params } = queryAt(CALL.selectedRun);
    expect(sql).toContain('run_date BETWEEN ? AND ?');
    expect(params).toEqual(['2026-09-04', '2026-09-04']);
  });

  it('returns a null run for a day that was never graded, so the page can say so', async () => {
    stubQueries({ [CALL.selectedRun]: [] });
    const res = await getMissedOpportunities({ ...base });
    expect(res.run).toBeNull();
    expect(res.dataLastUpdated).toBeNull();
  });

  it('reports the analyzed-day window so the picker cannot offer an ungraded day', async () => {
    const res = await getMissedOpportunities({ ...base });
    expect(res.runWindow).toEqual({ earliest: '2026-09-04', latest: '2026-09-08' });
  });

  it('excludes FAILED runs from the window — a failed day has no data to show', async () => {
    await getMissedOpportunities({ ...base });
    expect(queryAt(CALL.runWindow).sql).toContain("status <> 'FAILED'");
  });

  it('returns a null window before the worker has ever produced a day', async () => {
    stubQueries({ [CALL.runWindow]: [{ earliest: null, latest: null }] });
    const res = await getMissedOpportunities({ ...base });
    expect(res.runWindow).toEqual({ earliest: null, latest: null });
  });

  it('maps a finding onto the camelCase contract the page consumes', async () => {
    const [only] = (await getMissedOpportunities({ ...base })).findings;
    expect(only).toMatchObject({
      findingId: '1',
      ruleName: 'Buying signal not closed',
      category: 'Closing',
      severity: 'high',
      recommendedApproach: 'Ask for the order and offer Tuesday install.',
      recoveryAction: 'Call Mabels this morning and book Tuesday install.',
    });
    expect(only.callDate).toBe('2026-09-04T13:15:00.000Z');
  });

  it('labels an unattributed agent rather than emitting an empty row name', async () => {
    stubQueries({ [CALL.agents]: [agentRow({ agentName: null })] });
    const { agents } = await getMissedOpportunities({ ...base });
    expect(agents[0].agentName).toBe('Unattributed');
  });

  it('surfaces the skipped-call count, so a thin day cannot read as a clean one', async () => {
    expect((await getMissedOpportunities({ ...base })).run?.callsSkipped).toBe(4);
  });
});

describe('most common miss', () => {
  // The column says "Most Common Miss" but was ordered by severity, so one
  // high-severity finding outranked four repeats of another rule — naming the
  // wrong habit to coach.
  it('names the rule that fired most often, not the most severe one', async () => {
    stubQueries({
      [CALL.agentRules]: [
        agentRuleRow({ ruleName: 'No dated next step', findings: 4, high: 0 }),
        agentRuleRow({ ruleName: 'Buying signal not closed', findings: 1, high: 1 }),
      ],
    });
    const { agents } = await getMissedOpportunities({ ...base });
    expect(agents[0].topRuleName).toBe('No dated next step');
  });

  it('orders the query by count so the first row per agent is the answer', async () => {
    await getMissedOpportunities({ ...base });
    const { sql } = queryAt(CALL.agentRules);
    expect(sql).toContain('ORDER BY f.agent_name, findings DESC');
    expect(sql).not.toContain('GROUP_CONCAT');
  });

  it('keeps each agent on their own top rule', async () => {
    stubQueries({
      [CALL.agents]: [agentRow({ agentName: 'Jane Rep' }), agentRow({ agentName: 'Sam Rep' })],
      [CALL.agentRules]: [
        agentRuleRow({ agentName: 'Jane Rep', ruleName: 'No dated next step', findings: 4 }),
        agentRuleRow({ agentName: 'Jane Rep', ruleName: 'Warranty not offered', findings: 1 }),
        agentRuleRow({ agentName: 'Sam Rep', ruleName: 'Warranty not offered', findings: 2 }),
      ],
    });
    const { agents } = await getMissedOpportunities({ ...base });
    expect(agents.map((a) => a.topRuleName)).toEqual(['No dated next step', 'Warranty not offered']);
  });

  it('leaves the rule null for an agent with no counted rules', async () => {
    stubQueries({ [CALL.agentRules]: [] });
    expect((await getMissedOpportunities({ ...base })).agents[0].topRuleName).toBeNull();
  });
});

describe('rate populations', () => {
  // `calls_analyzed` is recorded day-wide only. Dividing a numerator narrowed
  // to one agent by that denominator reported the whole floor's clean rate on
  // a single rep's page.
  it.each([
    ['a user filter', { users: ['Jane Rep'] }],
    ['a department filter', { departments: ['Sales Inbound'] }],
    ['a SELF viewer scope', { selfEmployeeKey: 77 }],
    ['a DEPARTMENT viewer scope', { departmentKeys: [4] }],
  ])('withholds the run-basis rates under %s', async (_label, narrowing) => {
    const res = await getMissedOpportunities({ ...base, ...narrowing });
    expect(res.ratesUnavailableReason).toBe('filtered');
    expect(res.totals.findingsPerCall).toBeNull();
    expect(res.totals.cleanCalls).toBeNull();
    expect(res.totals.cleanCallRate).toBeNull();
  });

  it('still reports the filtered counts the table is built from', async () => {
    const res = await getMissedOpportunities({ ...base, users: ['Jane Rep'] });
    expect(res.totals.findings).toBe(3);
    expect(res.totals.callsWithFindings).toBe(2);
  });

  it('reports the rates when the page shows the whole run', async () => {
    const res = await getMissedOpportunities({ ...base });
    expect(res.ratesUnavailableReason).toBeNull();
    expect(res.totals.findingsPerCall).toBe(0.05);
  });

  it('says no-run rather than filtered when the window was never graded', async () => {
    stubQueries({ [CALL.runTotals]: [{ callsAnalyzed: 0 }] });
    expect((await getMissedOpportunities({ ...base })).ratesUnavailableReason).toBe('no-run');
  });

  // A rule filter cuts the findings list but not the denominator, so the
  // numerator has to come from the run-basis query rather than the table.
  it('divides by the run-basis finding count, not the filtered one', async () => {
    stubQueries({
      [CALL.agents]: [agentRow({ findings: 1 })],
      [CALL.flagged]: [{ callsFlagged: 2, runFindings: 3 }],
    });
    const res = await getMissedOpportunities({ ...base, ruleKeys: ['no_dated_next_step'] });
    expect(res.totals.findings).toBe(1);
    expect(res.totals.findingsPerCall).toBe(0.05);
  });

  it('counts affected calls in SQL rather than from the capped findings list', async () => {
    stubQueries({ [CALL.filtered]: [{ callsWithFindings: 37 }] });
    const res = await getMissedOpportunities({ ...base });
    expect(res.totals.callsWithFindings).toBe(37);
  });
});
