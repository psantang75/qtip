/**
 * Pins the Word export's agent → customer → call grouping so a morning
 * printout matches the on-screen FindingsList, and so a category / recovery
 * block cannot silently drop out of the document.
 */
import { describe, it, expect } from 'vitest';
import {
  groupFindingsForExport,
  renderMissedOpportunitiesDoc,
} from '../insightsMissedOpportunities.export';
import type {
  MissedOpportunityFindingRow,
  MissedOpportunityResult,
} from '../insightsMissedOpportunities.service';

const finding = (over: Partial<MissedOpportunityFindingRow> = {}): MissedOpportunityFindingRow => ({
  findingId: '1',
  dateKey: 20260904,
  callDate: '2026-09-04T13:42:00.000Z',
  agentName: 'Jane Rep',
  conversationId: 'conv-am',
  talkSecs: 420,
  direction: 'inbound',
  customerName: 'Mabels Diner',
  crmRefKind: 'TASK',
  crmRefId: 12345,
  ruleKey: 'buying_signal_not_closed',
  ruleName: 'Buying signal not closed',
  category: 'Closing',
  severity: 'high',
  title: 'Did not ask for the order',
  whatHappened: 'Owner wanted install before the holidays.',
  evidenceQuote: 'I want this in before Thanksgiving',
  evidenceSpeaker: 'CUSTOMER',
  recommendedApproach: 'Ask for the order and offer Tuesday install.',
  recoveryAction: 'Call Mabels this morning and book Tuesday install.',
  estValueNote: '~$2,400 ARR',
  ...over,
});

const result = (findings: MissedOpportunityFindingRow[]): MissedOpportunityResult => ({
  totals: {
    findings: findings.length,
    high: findings.filter((f) => f.severity === 'high').length,
    agentsAffected: 1,
    callsWithFindings: 1,
    callsAnalyzed: 12,
    findingsPerCall: findings.length / 12,
    cleanCalls: 11,
    cleanCallRate: 91.7,
  },
  ratesUnavailableReason: null,
  agents: [{
    agentName: 'Jane Rep',
    findings: findings.length,
    high: findings.filter((f) => f.severity === 'high').length,
    medium: findings.filter((f) => f.severity === 'medium').length,
    low: findings.filter((f) => f.severity === 'low').length,
    callsWithFindings: 1,
    topRuleName: 'Buying signal not closed',
  }],
  byRule: [{
    ruleKey: 'buying_signal_not_closed',
    ruleName: 'Buying signal not closed',
    category: 'Closing',
    findings: findings.length,
  }],
  findings,
  run: {
    runDate: '2026-09-04',
    status: 'SUCCESS',
    callsConsidered: 14,
    callsAnalyzed: 12,
    callsFailed: 0,
    callsSkipped: 2,
    findingsCount: findings.length,
    usdCost: 0.42,
    errorText: null,
  },
  runWindow: { earliest: '2026-09-01', latest: '2026-09-04' },
  availableUsers: ['Jane Rep'],
  availableDepartments: ['Sales'],
  dateRange: { start: '2026-09-04', end: '2026-09-04' },
  dataLastUpdated: '2026-09-05T06:02:00.000Z',
});

describe('groupFindingsForExport', () => {
  it('orders customers by severity then keeps two calls chronological', () => {
    const groups = groupFindingsForExport([
      finding({
        findingId: 'pm',
        conversationId: 'conv-pm',
        callDate: '2026-09-04T18:15:00.000Z',
        customerName: 'Mabels Diner',
        severity: 'medium',
        category: 'Follow-through',
      }),
      finding({
        findingId: 'quiet',
        customerName: 'Quiet Shop',
        conversationId: 'conv-q',
        severity: 'low',
        category: 'Prospecting',
      }),
      finding({
        findingId: 'am',
        conversationId: 'conv-am',
        callDate: '2026-09-04T13:42:00.000Z',
        customerName: 'Mabels Diner',
        severity: 'high',
        category: 'Closing',
      }),
    ]);
    expect(groups.map((g) => g.name)).toEqual(['Mabels Diner', 'Quiet Shop']);
    expect(groups[0].interactions.map((i) => i.key)).toEqual(['conv-am', 'conv-pm']);
  });
});

describe('renderMissedOpportunitiesDoc', () => {
  it('nests customer then call facts then category, quote, approach, and recovery', () => {
    const html = renderMissedOpportunitiesDoc(result([
      finding(),
      finding({
        findingId: '2',
        conversationId: 'conv-pm',
        callDate: '2026-09-04T18:15:00.000Z',
        category: 'Follow-through',
        title: 'No dated next step',
        whatHappened: 'Left it as a vague callback.',
        evidenceQuote: 'Just give me a ring sometime',
        recommendedApproach: 'Put Friday 10am on the calendar.',
        recoveryAction: 'Text a calendar hold for Friday 10am.',
      }),
    ]), '2026-09-04');

    expect(html.indexOf('Jane Rep')).toBeGreaterThan(0);
    const block = html.slice(html.indexOf('Mabels Diner'));
    const call = block.indexOf('Call conv-am');
    const task = block.indexOf('Task 12345');
    const title = block.indexOf('Did not ask for the order');
    const quote = block.indexOf('I want this in before Thanksgiving');
    const approach = block.indexOf('Recommended approach');
    const recover = block.indexOf('Recover this account');
    expect(call).toBeGreaterThan(0);
    expect(task).toBeGreaterThan(0);
    expect(title).toBeGreaterThan(call);
    expect(quote).toBeGreaterThan(title);
    expect(approach).toBeGreaterThan(quote);
    expect(recover).toBeGreaterThan(approach);
    expect(block).toContain('Closing');
    expect(block).toContain('Follow-through');
    expect(block).toContain('Call conv-pm');
  });

  it('labels unnamed accounts as Unknown caller', () => {
    const html = renderMissedOpportunitiesDoc(
      result([finding({ customerName: null })]),
      '2026-09-04',
    );
    expect(html).toContain('Unknown caller');
  });

  it('leads the summary with the calls that came back clean', () => {
    const html = renderMissedOpportunitiesDoc(result([finding()]), '2026-09-04');
    expect(html).toContain('Clean Calls');
    expect(html).toContain('11 (91.7%)');
    expect(html.indexOf('Clean Calls')).toBeLessThan(html.indexOf('Total Misses'));
  });

  it('says so when the day was never graded rather than printing empty totals', () => {
    const html = renderMissedOpportunitiesDoc(
      { ...result([]), run: null, findings: [] },
      '2026-09-04',
    );
    expect(html).toContain('no graded run');
    expect(html).not.toContain('Total Misses');
  });
});
