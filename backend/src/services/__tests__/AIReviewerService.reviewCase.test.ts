/**
 * Phase C (C6) — multi-source orchestrator integration test.
 *
 * Pins the `reviewCase()` contract:
 *   - One trace LLM call per source, in primary-first order.
 *   - Exactly one synthesis LLM call across all sources.
 *   - `checkBudget` invoked with `sourceCount = primary + attached.length`.
 *   - The persisted submission carries
 *       • `case_id = "<KIND>:<external_id>"` of the primary
 *       • `submission_ticket_tasks` rows for every TICKET/TASK source
 *       • `submission_calls` rows for every CALL source
 *     in a SINGLE submission (one row, not one per source).
 *
 * All upstream deps are stubbed at the module boundary so the test stays
 * hermetic. The Anthropic client is hand-rolled to return canned trace +
 * synthesis JSON keyed by call order.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Dev `.env` sets AI_REVIEWER_TRACE_SAMPLES=1 to keep local AI runs cheap.
// The multi-source orchestrator suite below was authored against the
// production default (K=3) — its mock sequences queue 3 traces per source
// before synthesis. We pin K=3 in beforeEach (capturing + restoring the
// prior value in afterEach) so the orchestrator behaves as the test
// fixtures expect, regardless of the developer's local .env override.
// Per-test overrides (verifier-band, high-confidence-skip, single-sample
// tests) still win because they wrap their own try/finally inside the
// test body.
const ORIGINAL_TRACE_SAMPLES = process.env.AI_REVIEWER_TRACE_SAMPLES;

const { messagesCreate, submitAuditMock, saveDraftMock, checkBudgetMock, detectPivotsMock } = vi.hoisted(() => ({
  messagesCreate: vi.fn(),
  submitAuditMock: vi.fn(),
  saveDraftMock: vi.fn(),
  checkBudgetMock: vi.fn(),
  // Phase E (pivot detector): mocked at the module boundary so every
  // existing test in this suite can keep its hand-counted Anthropic
  // mock sequence (the real detector would otherwise eat 1-2 calls
  // off the top of every sequence). Tests that exercise the pivot
  // path override the implementation per-case.
  detectPivotsMock: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../config/environment', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    aiReviewerConfig: { userId: 9999 },
  };
});

vi.mock('../../config/ai', () => ({
  aiConfig: {
    anthropic: { defaultModel: 'claude-opus-4-7' },
  },
}));

vi.mock('../ai/AnthropicClient', () => ({
  isAnthropicConfigured: () => true,
  getAnthropicClient: () => ({ messages: { create: messagesCreate } }),
}));

vi.mock('../ai/OpenAIClient', () => ({
  isOpenAIConfigured: () => false,
  getOpenAIClient: () => ({}),
}));

vi.mock('../BookStackService', () => ({
  default: {
    isConfigured: () => true,
    getPageByUrl: vi.fn().mockResolvedValue(null),
    listBooks: vi.fn().mockResolvedValue([]),
    getPageContentWithLinks: vi.fn().mockResolvedValue({ plaintext: '', links: [] }),
    searchByText: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('../KbIndexService', () => ({
  default: {
    isConfigured: () => false,
    semanticSearch: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('../CRMService', () => ({
  default: {
    getTicketHeader: vi.fn().mockResolvedValue({
      ticket_id: 42,
      class_name: 'Tech',
      subclass_name: 'Audio',
      classification_id: 165,
      status: 'Closed',
      resolution: 'Resolved',
      assigned_to_id: 1,
      assigned_to_name: 'Agent A',
      customer_id: 100,
      created_on: new Date('2026-05-01T12:00:00Z'),
      modified_on: new Date('2026-05-02T12:00:00Z'),
      description: 'No audio on TV.',
      site_id: null,
      site_name: null,
      site_address: null,
      site_city: null,
      site_state: null,
      contact_id: null,
      contact_first_name: null,
      contact_last_name: null,
      contact_email: null,
      job_id: null,
      job_partner_number: null,
      order_id: null,
      order_number: null,
      po_number: null,
      device_type_id: null,
      device_type_name: null,
      device_id: null,
    }),
    getTicketNotes: vi.fn().mockResolvedValue([
      { id: 1, note: 'Customer reports no audio.', created_on: '2026-05-01', created_by: 1, created_by_name: 'Agent A', status_after: 'Open', next_contact_date: null, is_after_audit: false },
    ]),
    getTicketPlaybookLinks: vi.fn().mockResolvedValue([]),
    getTaskHeader: vi.fn(),
    getTaskNotes: vi.fn(),
  },
}));

vi.mock('../PhoneSystemService', () => ({
  default: {
    getTranscriptByConversationId: vi.fn().mockResolvedValue([
      { transcript: 'Agent: Hi, how can I help?\nCustomer: My TV has no sound.' },
    ]),
    getConversationMetaByConversationId: vi.fn().mockResolvedValue({
      start_et: new Date('2026-05-01T13:00:00Z'),
      end_et: new Date('2026-05-01T13:10:00Z'),
      duration_seconds: 600,
    }),
  },
}));

vi.mock('../AICalibrationService', () => ({
  default: {
    getRecentCorrections: vi.fn().mockResolvedValue([]),
  },
}));

// Stub basePromptService so the trace + synthesis prompt builders
// resolve a Base body without needing a warmed cache or DB. The actual
// content is irrelevant to the orchestrator-routing assertions in this
// suite.
vi.mock('../BasePromptService', () => {
  const stub = {
    getAssembledPrompt: vi.fn(() => ({
      id: 1,
      key: 'base.v1',
      version: 1,
      body: '<<MOCK ASSEMBLED BASE>>',
    })),
    getBaseForKind: vi.fn(() => ({
      id: 2,
      key: 'trace.v1',
      version: 1,
      body: '<<MOCK TRACE>>',
    })),
    listBases: vi.fn().mockResolvedValue([]),
  };
  return {
    basePromptService: stub,
    default: stub,
    BasePromptError: class extends Error {},
  };
});

vi.mock('../RulePackService', () => {
  const stub = {
    getAlwaysIncludeUrlsForForm: () => [],
    renderPacksForPrompt: () => '',
  };
  return {
    default: stub,
    rulePackService: stub,
    RulePackError: class extends Error {},
  };
});

vi.mock('../AIReviewerCostGuard', () => ({
  checkBudget: checkBudgetMock,
}));

vi.mock('../ConfidenceCalibrator', () => ({
  applyCalibration: vi.fn(async (_formId: number, c: number | null) => c),
  // Tier-1 Item 3: identity passthrough by default so existing
  // confidence-number assertions stay stable.
  applyAnswerCalibration: vi.fn(async (_formId: number, _qid: number, c: number | null) => c),
}));

vi.mock('../CallTicketLinkerService', () => ({
  linkCallToTicket: vi.fn().mockResolvedValue(null),
}));

vi.mock('../SubmissionService', () => ({
  SubmissionService: class {
    submitAudit = submitAuditMock;
    saveDraft = saveDraftMock;
  },
  SubmissionServiceError: class extends Error {},
}));

vi.mock('../../repositories/MySQLSubmissionRepository', () => ({
  MySQLSubmissionRepository: class {},
}));

const { findUniqueMock, formMetadataFindMany, userFindFirst } = vi.hoisted(() => ({
  findUniqueMock: vi.fn(),
  formMetadataFindMany: vi.fn().mockResolvedValue([]),
  userFindFirst: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../config/prisma', () => ({
  default: {
    form: { findUnique: findUniqueMock },
    formMetadataField: { findMany: formMetadataFindMany },
    user: { findFirst: userFindFirst },
    aiCallLog: { create: vi.fn().mockResolvedValue({}) },
  },
}));

vi.mock('../aiCallLogger', () => ({
  withCallLog: async (
    _meta: unknown,
    _prompt: { system: string; user: string },
    fn: () => Promise<{ result: unknown }>
  ) => {
    const r = await fn();
    return r.result;
  },
}));

vi.mock('../aiReviewerPivotDetector', () => ({
  detectCasePivots: detectPivotsMock,
  _clearPivotCache: vi.fn(),
}));

// Auto-managed AI Reviewer Feedback question text + constants used by
// the per-category feedback router (composeCategoryFeedback). Must
// match the production exports — the orchestrator uses them when
// composing the final answers payload.
vi.mock('../../repositories/MySQLFormRepository', () => ({
  AI_REVIEWER_FEEDBACK_QUESTION_TEXT: 'AI Reviewer Feedback',
  CATEGORY_FEEDBACK_TEXT_PREFIX_RE: /^feedback\s*[\u2014-]\s*/i,
  AI_REVIEW_NOTES_PREFIX: 'AI Review Notes - ',
}));
const AI_FEEDBACK_TEXT = 'AI Reviewer Feedback';

// Stub out the synthesis-side answer mapping just enough — buildAiReviewerPrompt
// is unused in reviewCase, but the import is shared, so we leave it real.

import { AIReviewerService, _clearCallTopicCache } from '../AIReviewerService';
import type { Case } from '../AIReviewerService';

const FORM_FIXTURE = {
  id: 7,
  form_name: 'Tech Ticket QA',
  ai_enabled: true,
  ai_review_guidance: null,
  ai_submit_as_draft: false,
  interaction_type: 'TICKET',
  form_categories: [
    {
      id: 1,
      category_name: 'Process',
      sort_order: 0,
      form_questions: [
        {
          id: 101,
          category_name: 'Process',
          question_text: 'Did the agent follow the documented steps?',
          question_type: 'YES_NO',
          yes_value: 1,
          no_value: 0,
          na_value: 0,
          is_na_allowed: false,
          radio_options: [],
        },
        {
          id: 102,
          category_name: 'Process',
          question_text: AI_FEEDBACK_TEXT,
          question_type: 'TEXT',
          yes_value: 1,
          no_value: 0,
          na_value: 0,
          is_na_allowed: false,
          radio_options: [],
        },
      ],
    },
  ],
};

function makeTraceJson(sourceLabel: string): string {
  return JSON.stringify({
    playbook_steps: [],
    timeline: [],
    observations: [],
    extracted_claims: [{ source: sourceLabel, claim: 'placeholder' }],
  });
}

function makeSynthesisJson(): string {
  return JSON.stringify({
    answers: [
      {
        question_id: 101,
        value: 'yes',
        confidence: 0.9,
        // Anchored evidence is required by the Tier-2 evidence-floor
        // enforcement: a "yes" verdict without a date/timestamp-anchored
        // quote would be capped to 0.5 and trigger the verification pass.
        evidence_quote: 'Customer confirmed playback resumed after the reboot.',
        evidence_source: 'Apr 28 by Bethany',
      },
    ],
    narrative: 'Description: Accurate.\nSteps followed: Followed.',
    kb_citations: [],
    overall_confidence: 0.9,
    timeline: [],
    observations: [],
    playbook_steps: [],
    coaching: { wins: [], gaps: [], next_actions: [] },
  });
}

function aiTextResponse(text: string) {
  return {
    content: [{ type: 'text', text }],
    usage: { input_tokens: 100, output_tokens: 50 },
  };
}

/**
 * Synthesis-side variant of aiTextResponse: emits BOTH a text block
 * (carrying the narrative + reasoning artefacts) AND a tool_use block
 * (carrying the structured answers via the submit_answers tool). The
 * monolithic synthesis path now forces a tool call; tests that mock
 * the Anthropic client for that path must provide the tool_use payload
 * or callClaude throws "no tool_use block for submit_answers".
 *
 * The `synthesisJson` argument is the same JSON object the legacy
 * text-only mock returned; we parse out its `answers[]` field for the
 * tool_use input and the rest goes in the text block.
 */
function aiSynthesisResponse(synthesisJson: string) {
  const parsed = JSON.parse(synthesisJson);
  const answers = Array.isArray(parsed.answers) ? parsed.answers : [];
  const textBlockPayload = { ...parsed };
  delete textBlockPayload.answers;
  return {
    content: [
      { type: 'text', text: JSON.stringify(textBlockPayload) },
      {
        type: 'tool_use',
        id: 'toolu_test',
        name: 'submit_answers',
        input: { answers },
      },
    ],
    usage: { input_tokens: 100, output_tokens: 50 },
  };
}

describe('AIReviewerService.reviewCase — multi-source orchestrator', () => {
  beforeEach(() => {
    process.env.AI_REVIEWER_TRACE_SAMPLES = '3';
    messagesCreate.mockReset();
    submitAuditMock.mockReset();
    saveDraftMock.mockReset();
    checkBudgetMock.mockReset();
    findUniqueMock.mockReset();
    formMetadataFindMany.mockReset();
    formMetadataFindMany.mockResolvedValue([]);
    userFindFirst.mockReset();
    userFindFirst.mockResolvedValue(null);
    // Default: detector returns no pivots so the legacy classifier
    // path runs (matches the call sequences these tests pre-date).
    detectPivotsMock.mockReset();
    detectPivotsMock.mockResolvedValue([]);
    // classifyCallTopic memoizes by conversation_id, so consecutive
    // it() blocks that reuse the same id would short-circuit the
    // classifier and silently throw off the mocked LLM call order.
    _clearCallTopicCache();

    findUniqueMock.mockResolvedValue(FORM_FIXTURE);
    checkBudgetMock.mockResolvedValue({
      allowed: true,
      warn: false,
      mtdUsd: 0,
      budgetUsd: null,
      reason: '',
    });
    submitAuditMock.mockResolvedValue({
      submission_id: 555,
      total_score: 100,
      message: 'Submitted',
    });
  });

  afterEach(() => {
    if (ORIGINAL_TRACE_SAMPLES === undefined) {
      delete process.env.AI_REVIEWER_TRACE_SAMPLES;
    } else {
      process.env.AI_REVIEWER_TRACE_SAMPLES = ORIGINAL_TRACE_SAMPLES;
    }
  });

  it('runs trace x N + synthesis x 1, persists merged links, sets case_id from primary', async () => {
    // Order of LLM calls for {primary: TICKET, attached: [CALL]} with
    // K=3 trace voting (default AI_REVIEWER_TRACE_SAMPLES):
    //   1-3. Trace x3 for the ticket (parallel, K samples).
    //   4.   Classifier mini-call for the call (CALL has no
    //        classification field today).
    //   5-7. Trace x3 for the call.
    //   8.   Synthesis.
    messagesCreate
      .mockResolvedValueOnce(aiTextResponse(makeTraceJson('TICKET:42')))
      .mockResolvedValueOnce(aiTextResponse(makeTraceJson('TICKET:42')))
      .mockResolvedValueOnce(aiTextResponse(makeTraceJson('TICKET:42')))
      .mockResolvedValueOnce(aiTextResponse(JSON.stringify({ class: 'Tech', subclass: 'Audio' })))
      .mockResolvedValueOnce(aiTextResponse(makeTraceJson('CALL:abc-123')))
      .mockResolvedValueOnce(aiTextResponse(makeTraceJson('CALL:abc-123')))
      .mockResolvedValueOnce(aiTextResponse(makeTraceJson('CALL:abc-123')))
      .mockResolvedValueOnce(aiSynthesisResponse(makeSynthesisJson()));

    const svc = new AIReviewerService();
    const c: Case = {
      id: 'TICKET:42',
      primary: { kind: 'TICKET', external_id: 42 },
      attached: [{ kind: 'CALL', external_id: 'abc-123' }],
    };
    const result = await svc.reviewCase(c, { formId: 7 });

    expect(result.submission_id).toBe(555);
    expect(result.status).toBe('SUBMITTED');

    expect(checkBudgetMock).toHaveBeenCalledTimes(1);
    expect(checkBudgetMock.mock.calls[0][1]).toEqual(
      expect.objectContaining({ sourceCount: 2, willClassify: true, expectVerification: false })
    );

    // 6 traces (K=3 per source) + 1 classifier + 1 synthesis = 8.
    // Verification is NOT triggered (synthesis output had
    // overall_confidence=0.9 with no self-consistency warnings).
    expect(messagesCreate).toHaveBeenCalledTimes(8);

    expect(submitAuditMock).toHaveBeenCalledTimes(1);
    const [payload, qaId] = submitAuditMock.mock.calls[0];
    expect(qaId).toBe(9999);
    expect(payload.case_id).toBe('TICKET:42');
    expect(payload.form_id).toBe(7);
    expect(payload.ticket_tasks).toEqual([{ kind: 'TICKET', external_id: 42 }]);
    // The CALL adapter emits a virtual-call upsert (call_ids: [-1] +
    // call_data[0].call_id = the conversation id).
    expect(payload.call_ids).toEqual([-1]);
    expect(payload.call_data).toHaveLength(1);
    expect(payload.call_data[0].call_id).toBe('abc-123');
    // Auto-managed feedback question is added by the orchestrator.
    const feedbackAnswer = payload.answers.find(
      (a: { question_id: number }) => a.question_id === 102
    );
    expect(feedbackAnswer).toBeDefined();
    expect(typeof feedbackAnswer.answer).toBe('string');
  });

  it('routes through saveDraft when ai_submit_as_draft is true', async () => {
    findUniqueMock.mockResolvedValue({ ...FORM_FIXTURE, ai_submit_as_draft: true });
    saveDraftMock.mockResolvedValue({ submission_id: 777, message: 'Saved as draft' });

    // K=3 trace voting: 3 trace calls + 1 synthesis = 4 LLM calls.
    messagesCreate
      .mockResolvedValueOnce(aiTextResponse(makeTraceJson('TICKET:42')))
      .mockResolvedValueOnce(aiTextResponse(makeTraceJson('TICKET:42')))
      .mockResolvedValueOnce(aiTextResponse(makeTraceJson('TICKET:42')))
      .mockResolvedValueOnce(aiSynthesisResponse(makeSynthesisJson()));

    const svc = new AIReviewerService();
    const c: Case = {
      id: 'TICKET:42',
      primary: { kind: 'TICKET', external_id: 42 },
      attached: [],
    };
    const result = await svc.reviewCase(c, { formId: 7 });

    expect(result.status).toBe('DRAFT');
    expect(result.submission_id).toBe(777);
    expect(saveDraftMock).toHaveBeenCalledTimes(1);
    expect(submitAuditMock).not.toHaveBeenCalled();
    expect(checkBudgetMock.mock.calls[0][1]).toEqual(
      expect.objectContaining({ sourceCount: 1, willClassify: false })
    );
  });

  it('falls back to an attached source for the CSR dropdown when the primary lacks agentDisplayName (CALL-primary + TICKET-attached)', async () => {
    // CALL adapter (Genesys) never knows the agent display name —
    // agentDisplayName is hard-coded to null in the adapter. Before
    // this fix, buildSubmissionMetadata received `null` for a
    // CALL-primary case and the CSR dropdown stayed empty on the
    // draft. The fix walks `allMaterials` for the first attached
    // source that does supply an agentDisplayName (the TICKET's
    // assigned_to_name).
    formMetadataFindMany.mockResolvedValue([
      {
        id: 901,
        form_id: 7,
        field_name: 'CSR',
        field_type: 'DROPDOWN',
        dropdown_source: null,
        sort_order: 0,
      },
    ]);
    // Username match for the TICKET's assigned_to_name ("Agent A").
    userFindFirst.mockResolvedValue({ id: 4242 });

    // {primary: CALL, attached: [TICKET]} call sequence with K=3
    // trace voting:
    //   1.   Classifier mini-call for the CALL (legacy fallback path).
    //   2-4. Trace x3 for the CALL.
    //   5-7. Trace x3 for the TICKET.
    //   8.   Synthesis.
    messagesCreate
      .mockResolvedValueOnce(aiTextResponse(JSON.stringify({ class: 'Tech', subclass: 'Audio' })))
      .mockResolvedValueOnce(aiTextResponse(makeTraceJson('CALL:abc-123')))
      .mockResolvedValueOnce(aiTextResponse(makeTraceJson('CALL:abc-123')))
      .mockResolvedValueOnce(aiTextResponse(makeTraceJson('CALL:abc-123')))
      .mockResolvedValueOnce(aiTextResponse(makeTraceJson('TICKET:42')))
      .mockResolvedValueOnce(aiTextResponse(makeTraceJson('TICKET:42')))
      .mockResolvedValueOnce(aiTextResponse(makeTraceJson('TICKET:42')))
      .mockResolvedValueOnce(aiSynthesisResponse(makeSynthesisJson()));

    const svc = new AIReviewerService();
    const c: Case = {
      id: 'CALL:abc-123',
      primary: { kind: 'CALL', external_id: 'abc-123' },
      attached: [{ kind: 'TICKET', external_id: 42 }],
    };
    await svc.reviewCase(c, { formId: 7 });

    expect(userFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ username: 'Agent A', is_active: true }),
      })
    );
    const [payload] = submitAuditMock.mock.calls[0];
    const csrMeta = payload.metadata.find((m: { field_id: number }) => m.field_id === 901);
    expect(csrMeta).toBeDefined();
    expect(csrMeta.value).toBe('4242');
  });

  it('rejects when checkBudget denies the run, before any LLM call', async () => {
    checkBudgetMock.mockResolvedValue({
      allowed: false,
      warn: false,
      mtdUsd: 100,
      budgetUsd: 50,
      reason: 'Budget exhausted',
    });

    const svc = new AIReviewerService();
    const c: Case = {
      id: 'TICKET:42',
      primary: { kind: 'TICKET', external_id: 42 },
      attached: [],
    };
    await expect(svc.reviewCase(c, { formId: 7 })).rejects.toThrow(/Budget exhausted/);
    expect(messagesCreate).not.toHaveBeenCalled();
    expect(submitAuditMock).not.toHaveBeenCalled();
  });

  // ── Phase E (pivot detector) coverage ─────────────────────────────────
  // Pivot detector returns a real list ⇒ classifier is BYPASSED, every
  // trace + the synthesis prompt see the pivot labels, and the
  // synthesis user message carries the CASE PIVOTS block. This is the
  // path that fixes the "install refund treated like plain refund" bug.
  it('skips per-source classifier when pivots are returned and threads pivot labels into the synthesis prompt', async () => {
    detectPivotsMock.mockResolvedValue([
      { label: 'Install Refund', query: 'install refund process', rationale: 'Refund tied to incomplete install.' },
      { label: 'Activation Failure', query: 'STB activation playbook', rationale: 'STB never activated post-install.' },
    ]);

    // CALL+TICKET (CALL primary) call sequence with pivots present
    // and K=3 trace voting:
    //   1-3. trace x3 for CALL  (classifier SKIPPED — pivots replaced it)
    //   4-6. trace x3 for TICKET
    //   7.   synthesis
    messagesCreate
      .mockResolvedValueOnce(aiTextResponse(makeTraceJson('CALL:abc-123')))
      .mockResolvedValueOnce(aiTextResponse(makeTraceJson('CALL:abc-123')))
      .mockResolvedValueOnce(aiTextResponse(makeTraceJson('CALL:abc-123')))
      .mockResolvedValueOnce(aiTextResponse(makeTraceJson('TICKET:42')))
      .mockResolvedValueOnce(aiTextResponse(makeTraceJson('TICKET:42')))
      .mockResolvedValueOnce(aiTextResponse(makeTraceJson('TICKET:42')))
      .mockResolvedValueOnce(aiSynthesisResponse(makeSynthesisJson()));

    const svc = new AIReviewerService();
    const c: Case = {
      id: 'CALL:abc-123',
      primary: { kind: 'CALL', external_id: 'abc-123' },
      attached: [{ kind: 'TICKET', external_id: 42 }],
    };
    const result = await svc.reviewCase(c, { formId: 7 });

    expect(result.status).toBe('SUBMITTED');
    expect(detectPivotsMock).toHaveBeenCalledTimes(1);
    expect(detectPivotsMock.mock.calls[0][0]).toHaveLength(2);
    expect(detectPivotsMock.mock.calls[0][1]).toMatchObject({ caseId: 'CALL:abc-123', formId: 7 });

    // 6 traces (K=3 per source) + 1 synthesis = 7. Crucially NOT 8:
    // the classifier mini-call that the legacy CALL-primary path
    // would have made is skipped because the pivot detector covers
    // KB grounding now.
    expect(messagesCreate).toHaveBeenCalledTimes(7);

    // The synthesis call is the LAST one — assert its user message
    // includes the CASE PIVOTS block and both pivot labels so the
    // grading model uses them as lenses.
    const synthesisCall = messagesCreate.mock.calls.at(-1)![0];
    const userMsg = synthesisCall.messages[0].content as string;
    expect(userMsg).toContain('CASE PIVOTS');
    expect(userMsg).toContain('Install Refund');
    expect(userMsg).toContain('Activation Failure');
  });

  // Detector returns [] (Anthropic down, bad JSON, etc.) ⇒ legacy
  // classifier-driven KB grounding kicks back in. This is the
  // fail-open guarantee that lets us roll the detector out without
  // risking a regression on cases the detector can't handle.
  it('falls back to the per-source classifier path when the detector returns no pivots', async () => {
    detectPivotsMock.mockResolvedValue([]);

    // Legacy CALL+TICKET (CALL primary) sequence with K=3 trace
    // voting — same shape as the "falls back to attached source for
    // CSR" test above:
    //   1.   classifier for the CALL (legacy path)
    //   2-4. trace x3 for the CALL
    //   5-7. trace x3 for the TICKET
    //   8.   synthesis
    messagesCreate
      .mockResolvedValueOnce(aiTextResponse(JSON.stringify({ class: 'Tech', subclass: 'Audio' })))
      .mockResolvedValueOnce(aiTextResponse(makeTraceJson('CALL:abc-123')))
      .mockResolvedValueOnce(aiTextResponse(makeTraceJson('CALL:abc-123')))
      .mockResolvedValueOnce(aiTextResponse(makeTraceJson('CALL:abc-123')))
      .mockResolvedValueOnce(aiTextResponse(makeTraceJson('TICKET:42')))
      .mockResolvedValueOnce(aiTextResponse(makeTraceJson('TICKET:42')))
      .mockResolvedValueOnce(aiTextResponse(makeTraceJson('TICKET:42')))
      .mockResolvedValueOnce(aiSynthesisResponse(makeSynthesisJson()));

    const svc = new AIReviewerService();
    const c: Case = {
      id: 'CALL:abc-123',
      primary: { kind: 'CALL', external_id: 'abc-123' },
      attached: [{ kind: 'TICKET', external_id: 42 }],
    };
    await svc.reviewCase(c, { formId: 7 });

    expect(detectPivotsMock).toHaveBeenCalledTimes(1);
    // 8 calls (1 classifier + 6 traces (K=3 per source) + 1 synthesis)
    // = classifier ran (legacy fallback). If the detector had skipped
    // it incorrectly, this would be 7 and the synthesis call would
    // have consumed the trace mock instead.
    expect(messagesCreate).toHaveBeenCalledTimes(8);

    // No pivots means no CASE PIVOTS block in the synthesis prompt.
    const synthesisCall = messagesCreate.mock.calls.at(-1)![0];
    const userMsg = synthesisCall.messages[0].content as string;
    expect(userMsg).not.toContain('CASE PIVOTS');
  });

  // ── Tier-1 N-sample trace voting (Item 1) ────────────────────────────
  // The synthesis prompt MUST receive the cross-run agreement metrics
  // for each source so the model anchors `overall_confidence` against
  // them ("you cannot exceed min(composite) + 0.10"). This test pins
  // the wiring: K=3 trace samples per source, voted, and rendered as
  // a TRACE AGREEMENT block in the synthesis user message.
  it('threads TRACE AGREEMENT into the synthesis prompt when K-sample voting runs (K=3)', async () => {
    detectPivotsMock.mockResolvedValue([]);
    messagesCreate
      .mockResolvedValueOnce(aiTextResponse(makeTraceJson('TICKET:42')))
      .mockResolvedValueOnce(aiTextResponse(makeTraceJson('TICKET:42')))
      .mockResolvedValueOnce(aiTextResponse(makeTraceJson('TICKET:42')))
      .mockResolvedValueOnce(aiSynthesisResponse(makeSynthesisJson()));

    const svc = new AIReviewerService();
    const c: Case = {
      id: 'TICKET:42',
      primary: { kind: 'TICKET', external_id: 42 },
      attached: [],
    };
    await svc.reviewCase(c, { formId: 7 });

    // K=3 single-source: 3 traces + 1 synthesis = 4 LLM calls.
    expect(messagesCreate).toHaveBeenCalledTimes(4);

    const synthesisCall = messagesCreate.mock.calls.at(-1)![0];
    const userMsg = synthesisCall.messages[0].content as string;
    expect(userMsg).toContain('TRACE AGREEMENT');
    // The single-source line should mention TICKET:42 + composite +
    // playbook agreement so the model sees a concrete ceiling.
    expect(userMsg).toMatch(/TICKET:42 -> composite=\d\.\d{2}/);
    expect(userMsg).toMatch(/k=3/);
    expect(userMsg).toMatch(/playbook=\d\.\d{2}/);
  });

  // ── Tier-1 verification deltas (Item 2) ──────────────────────────────
  // The verifier returns asymmetric deltas the orchestrator applies
  // before persistence. This pins the wiring: verifier triggers in the
  // 0.40-0.85 band, deltas are clamped to [-0.20, +0.10] (overall) /
  // [-0.20, +0.05] (per-answer), and the persisted submission carries
  // the post-delta confidence + a verification block with the deltas.
  it('triggers verifier in the 0.40-0.85 band, applies deltas, persists post-delta confidence', async () => {
    const original = process.env.AI_REVIEWER_TRACE_SAMPLES;
    process.env.AI_REVIEWER_TRACE_SAMPLES = '1';
    try {
      detectPivotsMock.mockResolvedValue([]);
      // Synthesis returns nominal=0.7 (in the ambiguous band).
      const ambiguousSynthesis = JSON.stringify({
        answers: [
          {
            question_id: 101,
            value: 'yes',
            confidence: 0.8,
            evidence_quote: 'Customer confirmed playback resumed after the reboot.',
            evidence_source: 'Apr 28 by Bethany',
          },
        ],
        narrative: 'Description: Accurate.\nSteps followed: Followed.',
        kb_citations: [],
        overall_confidence: 0.7,
        timeline: [],
        observations: [],
        playbook_steps: [],
        coaching: { wins: [], gaps: [], next_actions: [] },
      });
      // Verifier emits both an overall delta and a per-answer delta —
      // both within bounds so they should land verbatim. Also asks for
      // a +0.50 (out-of-bounds) value to verify the clamp truly clamps.
      const verifierResp = JSON.stringify({
        warnings: ['answer 101: trace only weakly supports yes verdict'],
        overall_delta: -0.15,
        per_answer_deltas: { 101: -0.5 },
      });
      messagesCreate
        .mockResolvedValueOnce(aiTextResponse(makeTraceJson('TICKET:42')))
        .mockResolvedValueOnce(aiSynthesisResponse(ambiguousSynthesis))
        .mockResolvedValueOnce(aiTextResponse(verifierResp));

      const svc = new AIReviewerService();
      const c: Case = {
        id: 'TICKET:42',
        primary: { kind: 'TICKET', external_id: 42 },
        attached: [],
      };
      await svc.reviewCase(c, { formId: 7 });

      // 1 trace + 1 synthesis + 1 verifier = 3.
      expect(messagesCreate).toHaveBeenCalledTimes(3);

      const [payload] = submitAuditMock.mock.calls[0];
      // Overall confidence: 0.7 + (-0.15) = 0.55, persisted post-delta.
      expect(payload.ai_overall_confidence).toBeCloseTo(0.55, 2);
      // The submission's verification block carries the delta payload
      // so the audit UI / downstream dashboards can surface "the
      // verifier moved confidence by X".
      expect(payload.ai_extras.verification.overall_delta).toBe(-0.15);
      // Per-answer delta: requested -0.50, clamped to -0.20.
      expect(payload.ai_extras.verification.per_answer_deltas).toEqual({ 101: -0.2 });
      expect(payload.ai_extras.verification.trigger).toContain('ambiguous_confidence');
      // Per-answer ai_confidence reflects the (clamped) delta:
      // 0.80 + (-0.20) = 0.60.
      const a101 = payload.answers.find((a: { question_id: number }) => a.question_id === 101);
      expect(a101.ai_confidence).toBeCloseTo(0.6, 2);
    } finally {
      if (original === undefined) delete process.env.AI_REVIEWER_TRACE_SAMPLES;
      else process.env.AI_REVIEWER_TRACE_SAMPLES = original;
    }
  });

  // High-confidence (>= 0.85) cases skip verification entirely — no
  // extra LLM call, no verification block on the submission.
  it('skips verifier for high-confidence runs (overall >= 0.85)', async () => {
    const original = process.env.AI_REVIEWER_TRACE_SAMPLES;
    process.env.AI_REVIEWER_TRACE_SAMPLES = '1';
    try {
      detectPivotsMock.mockResolvedValue([]);
      messagesCreate
        .mockResolvedValueOnce(aiTextResponse(makeTraceJson('TICKET:42')))
        .mockResolvedValueOnce(aiSynthesisResponse(makeSynthesisJson())); // overall=0.9
      const svc = new AIReviewerService();
      await svc.reviewCase(
        { id: 'TICKET:42', primary: { kind: 'TICKET', external_id: 42 }, attached: [] },
        { formId: 7 }
      );
      expect(messagesCreate).toHaveBeenCalledTimes(2);
      const [payload] = submitAuditMock.mock.calls[0];
      expect(payload.ai_extras.verification).toBeUndefined();
    } finally {
      if (original === undefined) delete process.env.AI_REVIEWER_TRACE_SAMPLES;
      else process.env.AI_REVIEWER_TRACE_SAMPLES = original;
    }
  });

  // Sanity check: AI_REVIEWER_TRACE_SAMPLES=1 disables the K-sample
  // path entirely (legacy single-trace behaviour, no agreement block).
  // Useful as a kill switch if Sonnet pricing pinches and we need to
  // back the cost out without a code change.
  it('reverts to single-sample behaviour when AI_REVIEWER_TRACE_SAMPLES=1', async () => {
    const original = process.env.AI_REVIEWER_TRACE_SAMPLES;
    process.env.AI_REVIEWER_TRACE_SAMPLES = '1';
    try {
      detectPivotsMock.mockResolvedValue([]);
      messagesCreate
        .mockResolvedValueOnce(aiTextResponse(makeTraceJson('TICKET:42')))
        .mockResolvedValueOnce(aiSynthesisResponse(makeSynthesisJson()));

      const svc = new AIReviewerService();
      const c: Case = {
        id: 'TICKET:42',
        primary: { kind: 'TICKET', external_id: 42 },
        attached: [],
      };
      await svc.reviewCase(c, { formId: 7 });

      expect(messagesCreate).toHaveBeenCalledTimes(2);
      const synthesisCall = messagesCreate.mock.calls.at(-1)![0];
      const userMsg = synthesisCall.messages[0].content as string;
      expect(userMsg).not.toContain('TRACE AGREEMENT');
    } finally {
      if (original === undefined) delete process.env.AI_REVIEWER_TRACE_SAMPLES;
      else process.env.AI_REVIEWER_TRACE_SAMPLES = original;
    }
  });
});

describe('mergeSubmissionLinks helper', () => {
  it('dedupes ticket refs and preserves call virtual-upsert pairing', async () => {
    const { _internal } = await import('../AIReviewerService');
    const merged = _internal.mergeSubmissionLinks([
      { ticket_tasks: [{ kind: 'TICKET', external_id: 42 }] },
      { ticket_tasks: [{ kind: 'TICKET', external_id: 42 }] }, // duplicate
      {
        call_ids: [-1],
        call_data: [{ call_id: 'abc', call_date: '2026-05-01', duration: 60, recording_url: null, transcript: 'x' }],
      },
      {
        call_ids: [-1],
        call_data: [{ call_id: 'xyz', call_date: '2026-05-02', duration: 120, recording_url: null, transcript: 'y' }],
      },
    ]);

    expect(merged.ticket_tasks).toEqual([{ kind: 'TICKET', external_id: 42 }]);
    expect(merged.call_ids).toEqual([-1, -1]);
    expect(merged.call_data).toHaveLength(2);
    expect(merged.call_data?.[0].call_id).toBe('abc');
    expect(merged.call_data?.[1].call_id).toBe('xyz');
  });

  it('returns an empty payload for empty input', async () => {
    const { _internal } = await import('../AIReviewerService');
    expect(_internal.mergeSubmissionLinks([])).toEqual({});
  });
});
