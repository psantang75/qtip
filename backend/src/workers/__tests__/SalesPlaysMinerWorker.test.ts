/**
 * Miner orchestration tests. Everything below the worker is mocked, so these pin
 * the guardrails that keep the learning loop from running away:
 *
 *   - The enabled toggle, empty roster, and missing provider all short-circuit
 *     with zero spend and no candidate scan.
 *   - It only learns from WON/LOST calls (UNKNOWN skipped), WON first.
 *   - The incremental window resumes from the day AFTER lastMined.
 *   - The monthly USD cap stops spend mid-run and does NOT advance lastMined, so
 *     the leftover window is retried next month.
 *   - Already-mined conversations are skipped.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  poolQuery, poolExecute, getConnection,
  selectRangeMock, loadTranscriptMock, resolveProviderMock, resolveTierModelMock,
  getMoSettingsMock, getPlaysSettingsMock, setLastMinedMock,
  labelOutcomeMock, insertProposedMock, minedIdsMock, extractPlaysMock,
  consolidatePlaysMock,
  resolvePriorBusinessDayMock,
} = vi.hoisted(() => ({
  poolQuery: vi.fn(),
  poolExecute: vi.fn(),
  getConnection: vi.fn(),
  selectRangeMock: vi.fn(),
  loadTranscriptMock: vi.fn(),
  resolveProviderMock: vi.fn(),
  resolveTierModelMock: vi.fn(),
  getMoSettingsMock: vi.fn(),
  getPlaysSettingsMock: vi.fn(),
  setLastMinedMock: vi.fn(),
  labelOutcomeMock: vi.fn(),
  insertProposedMock: vi.fn(),
  minedIdsMock: vi.fn(),
  extractPlaysMock: vi.fn(),
  consolidatePlaysMock: vi.fn(),
  resolvePriorBusinessDayMock: vi.fn(),
}));

vi.mock('../../config/database', () => ({
  default: {
    query: (...a: unknown[]) => poolQuery(...a),
    execute: (...a: unknown[]) => poolExecute(...a),
    getConnection: () => getConnection(),
  },
}));

vi.mock('../../services/notifications/ingestionAlerts', () => ({
  notifyIngestionFailure: vi.fn(async () => {}),
}));

vi.mock('../MissedOpportunitiesWorker', () => ({
  resolvePriorBusinessDay: () => resolvePriorBusinessDayMock(),
}));

vi.mock('../../services/insights/missedOpportunities/candidates', () => ({
  selectCandidateCallsInRange: (...a: unknown[]) => selectRangeMock(...a),
  loadTranscript: (...a: unknown[]) => loadTranscriptMock(...a),
}));

vi.mock('../../services/insights/missedOpportunities/analyzer', () => ({
  resolveProvider: () => resolveProviderMock(),
  resolveTierModel: (...a: unknown[]) => resolveTierModelMock(...a),
}));

vi.mock('../../services/insights/missedOpportunities/settings', () => ({
  getMissedOpportunitySettings: () => getMoSettingsMock(),
}));

vi.mock('../../services/insights/missedOpportunities/salesPlays/settings', () => ({
  getSalesPlaysSettings: () => getPlaysSettingsMock(),
  setLastMined: (...a: unknown[]) => setLastMinedMock(...a),
}));

vi.mock('../../services/insights/missedOpportunities/salesPlays/outcome', () => ({
  labelCallOutcome: (...a: unknown[]) => labelOutcomeMock(...a),
}));

vi.mock('../../services/insights/missedOpportunities/salesPlays/plays.service', () => ({
  insertProposedPlays: (...a: unknown[]) => insertProposedMock(...a),
  minedConversationIds: () => minedIdsMock(),
}));

vi.mock('../../services/insights/missedOpportunities/salesPlays/consolidate', () => ({
  consolidatePlays: (...a: unknown[]) => consolidatePlaysMock(...a),
}));

vi.mock('../../services/insights/missedOpportunities/salesPlays/extractor', () => ({
  buildMinerSystemPrompt: () => 'system prompt',
  extractPlays: (...a: unknown[]) => extractPlaysMock(...a),
}));

import { SalesPlaysMinerWorker } from '../SalesPlaysMinerWorker';

const cand = (conversationId: string, agentName = 'Steven Selley') => ({
  conversationId,
  agentName,
  agentEmail: null,
  phoneUserId: null,
  startedAt: new Date('2026-09-05T13:00:00Z'),
  dateKey: 20260905,
  direction: 'inbound',
  talkSecs: 300,
  remoteParty: null,
  wrapUpCode: null,
});

const playsSettings = (over: Record<string, unknown> = {}) => ({
  enabled: true,
  roster: ['Steven Selley', 'Vince Deleon'],
  lastMined: null,
  seedDays: 90,
  monthlyUsdCap: 25,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  getConnection.mockResolvedValue({ execute: vi.fn(async () => [[]]), release: vi.fn() });
  poolExecute.mockResolvedValue([{ insertId: 1 }]);
  poolQuery.mockResolvedValue([[]]);

  resolveProviderMock.mockReturnValue('openai');
  resolveTierModelMock.mockReturnValue('gpt-5-mini');
  getMoSettingsMock.mockResolvedValue({
    minTalkSecs: 100, excludedAgents: [], dailyUsdCap: 25,
    modelTier: 'cheap', maxCallsPerRun: 400, systemPersona: 'persona', kbAnchorUrls: [],
  });
  getPlaysSettingsMock.mockResolvedValue(playsSettings());
  resolvePriorBusinessDayMock.mockResolvedValue('2026-09-08');
  minedIdsMock.mockResolvedValue(new Set<string>());
  loadTranscriptMock.mockResolvedValue({ text: 'Agent: hello\nCustomer: hi', unavailable: false });
  extractPlaysMock.mockResolvedValue({ plays: [], usdCost: 0.01 });
  insertProposedMock.mockResolvedValue(0);
  consolidatePlaysMock.mockResolvedValue({ proposedIn: 0, exemplars: 0, archived: 0, bumped: 0, skipped: false });
  setLastMinedMock.mockResolvedValue(undefined);
});

describe('SalesPlaysMinerWorker — gating', () => {
  it('does nothing when disabled', async () => {
    getPlaysSettingsMock.mockResolvedValue(playsSettings({ enabled: false }));
    await new SalesPlaysMinerWorker().run();
    expect(selectRangeMock).not.toHaveBeenCalled();
    expect(setLastMinedMock).not.toHaveBeenCalled();
  });

  it('does nothing with an empty roster', async () => {
    getPlaysSettingsMock.mockResolvedValue(playsSettings({ roster: [] }));
    await new SalesPlaysMinerWorker().run();
    expect(selectRangeMock).not.toHaveBeenCalled();
  });

  it('does nothing when no AI provider is configured', async () => {
    resolveProviderMock.mockReturnValue(null);
    await new SalesPlaysMinerWorker().run();
    expect(selectRangeMock).not.toHaveBeenCalled();
  });
});

describe('SalesPlaysMinerWorker — window', () => {
  it('seeds the first run from seedDays before the end date', async () => {
    selectRangeMock.mockResolvedValue([]);
    await new SalesPlaysMinerWorker().run();
    expect(selectRangeMock).toHaveBeenCalledWith(expect.objectContaining({
      startDate: '2026-06-11', // 2026-09-08 minus 89 days (inclusive of 90)
      endDate: '2026-09-08',
      roster: ['Steven Selley', 'Vince Deleon'],
    }));
  });

  it('resumes from the day AFTER lastMined on an incremental run', async () => {
    getPlaysSettingsMock.mockResolvedValue(playsSettings({ lastMined: '2026-09-01' }));
    selectRangeMock.mockResolvedValue([]);
    await new SalesPlaysMinerWorker().run();
    expect(selectRangeMock).toHaveBeenCalledWith(expect.objectContaining({
      startDate: '2026-09-02',
      endDate: '2026-09-08',
    }));
  });

  it('skips entirely when already up to date', async () => {
    getPlaysSettingsMock.mockResolvedValue(playsSettings({ lastMined: '2026-09-08' }));
    await new SalesPlaysMinerWorker().run();
    expect(selectRangeMock).not.toHaveBeenCalled();
    expect(setLastMinedMock).not.toHaveBeenCalled();
  });
});

describe('SalesPlaysMinerWorker — mining', () => {
  it('mines WON/LOST calls (WON first), skips UNKNOWN, and advances lastMined', async () => {
    selectRangeMock.mockResolvedValue([cand('lost-1'), cand('won-1'), cand('unknown-1')]);
    labelOutcomeMock.mockImplementation(async (id: string) =>
      id.startsWith('won') ? 'WON' : id.startsWith('lost') ? 'LOST' : 'UNKNOWN');
    extractPlaysMock.mockResolvedValue({
      plays: [{ category: 'closing', title: 't', bodyMd: 'b', sourceOutcome: 'WON' }],
      usdCost: 0.02,
    });
    insertProposedMock.mockResolvedValue(2);

    const out = await new SalesPlaysMinerWorker().run();

    // UNKNOWN never reaches the model.
    const minedIds = extractPlaysMock.mock.calls.map((c) => c[0].conversationId);
    expect(minedIds).toEqual(['won-1', 'lost-1']);
    expect(insertProposedMock).toHaveBeenCalledTimes(1);
    expect(setLastMinedMock).toHaveBeenCalledWith('2026-09-08');
    expect(out?.rowsLoaded).toBe(2);
  });

  it('skips conversations already mined', async () => {
    selectRangeMock.mockResolvedValue([cand('won-1'), cand('won-2')]);
    minedIdsMock.mockResolvedValue(new Set(['won-1']));
    labelOutcomeMock.mockResolvedValue('WON');

    await new SalesPlaysMinerWorker().run();

    const minedIds = extractPlaysMock.mock.calls.map((c) => c[0].conversationId);
    expect(minedIds).toEqual(['won-2']);
  });

  it('stops at the monthly cap and does NOT advance lastMined', async () => {
    selectRangeMock.mockResolvedValue(
      Array.from({ length: 10 }, (_, i) => cand(`won-${i}`)),
    );
    labelOutcomeMock.mockResolvedValue('WON');
    getPlaysSettingsMock.mockResolvedValue(playsSettings({ monthlyUsdCap: 1 }));
    extractPlaysMock.mockResolvedValue({ plays: [], usdCost: 0.4 });

    await new SalesPlaysMinerWorker().run();

    expect(extractPlaysMock.mock.calls.length).toBeLessThan(10);
    expect(setLastMinedMock).not.toHaveBeenCalled();
  });
});
