/**
 * Prompt-assembly regression gate.
 *
 * Snapshots the assembled system prompts (Base body + addendum) for
 * every runtime pass:
 *   - single_source: one-LLM-call review path
 *   - synthesis:     Pass 2 of the legacy two-pass multi-source path
 *   - reasoning:     Pass 2A of the chunked synthesis pipeline
 *   - answers_chunk: Pass 2B of the chunked synthesis pipeline
 *
 * Snapshot mismatch === intentional prompt change. When that happens,
 * update the snapshot deliberately, run the golden-set eval before
 * merging, and confirm the kappa diff is acceptable.
 *
 * The Base body is mocked to a known stub so this test stands alone —
 * no warmCache, no Prisma, no migrations required. The real Base body
 * lives in the `ai_base_prompt` table (seeded by migration
 * `20260526150000_seed_default_base_prompts`); changes to that body
 * are exercised by the golden-set eval, not by this snapshot test.
 * What this test still guards is the in-code addendum constants and
 * the order they're concatenated with the (mocked) base.
 */

import { describe, it, expect, vi } from 'vitest';

// The KB anchors tests below exercise the prompt builders, which read
// the (DB-backed) Base prompt at call time. Stub the service so this
// test file remains DB-free. The body literal must be inlined here
// because vi.mock is hoisted above any top-level `const` declarations.
vi.mock('../BasePromptService', () => {
  const stub = { id: 1, key: 'base.v1', version: 1, body: '<<MOCK ASSEMBLED BASE>>' };
  const service = {
    getAssembledPrompt: vi.fn(() => stub),
    getBaseForKind: vi.fn(() => stub),
  };
  return { basePromptService: service, default: service };
});

const MOCK_BASE_BODY = '<<MOCK ASSEMBLED BASE>>';

vi.mock('../RulePackService', () => {
  const service = {
    renderPacksForPrompt: vi.fn(() => ''),
    getPacksForForm: vi.fn(() => []),
    getAlwaysIncludeUrlsForForm: vi.fn(() => []),
  };
  return { rulePackService: service, default: service };
});
import {
  SINGLE_SOURCE_ADDENDUM,
  SYNTHESIS_ADDENDUM,
  REASONING_ADDENDUM,
  ANSWERS_CHUNK_ADDENDUM,
  SINGLE_SOURCE_MARKER,
  SYNTHESIS_MARKER,
  REASONING_MARKER,
  ANSWERS_CHUNK_MARKER,
  addendumForKind,
} from '../aiReviewerPromptAddenda';

describe('aiReviewerPromptAssembly', () => {
  it('addendum dispatcher returns the matching constant for each kind', () => {
    expect(addendumForKind('single_source')).toBe(SINGLE_SOURCE_ADDENDUM);
    expect(addendumForKind('synthesis')).toBe(SYNTHESIS_ADDENDUM);
    expect(addendumForKind('reasoning')).toBe(REASONING_ADDENDUM);
    expect(addendumForKind('answers_chunk')).toBe(ANSWERS_CHUNK_ADDENDUM);
  });

  it('SINGLE_SOURCE_ADDENDUM contains the documented single-source markers', () => {
    // Output schema marker — proves the schema section is present.
    expect(SINGLE_SOURCE_ADDENDUM).toContain(SINGLE_SOURCE_MARKER);
    // Single-source pipeline does NOT carry cross-source attribution.
    expect(SINGLE_SOURCE_ADDENDUM).not.toContain('evidence_source_kind');
    // Single-source pipeline does NOT emit the faithfulness block.
    expect(SINGLE_SOURCE_ADDENDUM).not.toContain('faithfulness');
    // Single-source pipeline does NOT carry per-trace separators (the
    // multi-source addendum's distinctive "--- SOURCE TRACE ---" marker).
    expect(SINGLE_SOURCE_ADDENDUM).not.toContain('--- SOURCE TRACE ---');
  });

  it('SYNTHESIS_ADDENDUM contains the documented multi-source markers', () => {
    expect(SYNTHESIS_ADDENDUM).toContain(SYNTHESIS_MARKER);
    // Cross-source attribution lives in the synthesis schema.
    expect(SYNTHESIS_ADDENDUM).toContain('evidence_source_kind');
    expect(SYNTHESIS_ADDENDUM).toContain('evidence_source_id');
    // Faithfulness rubric is unique to the synthesis pass.
    expect(SYNTHESIS_ADDENDUM).toContain('faithfulness');
    expect(SYNTHESIS_ADDENDUM).toContain('TRACE AGREEMENT');
  });

  it('snapshots the assembled single-source prompt', () => {
    const assembled = MOCK_BASE_BODY + addendumForKind('single_source');
    expect(assembled).toMatchSnapshot('single_source-assembled');
  });

  it('snapshots the assembled synthesis prompt', () => {
    const assembled = MOCK_BASE_BODY + addendumForKind('synthesis');
    expect(assembled).toMatchSnapshot('synthesis-assembled');
  });

  it('REASONING_ADDENDUM emits draft_answers (source-of-truth verdicts) and forbids answers[]', () => {
    expect(REASONING_ADDENDUM).toContain(REASONING_MARKER);
    // The reasoning pass MUST NOT include the answers[] schema — that
    // schema lives in the answers-chunk addendum so the model can't
    // even see it on the reasoning pass.
    expect(REASONING_ADDENDUM).not.toContain('"answers": [');
    // CONSISTENCY REFACTOR (W1.1): reasoning pass IS the source of
    // truth for verdicts. It MUST emit draft_answers[] for every
    // gradeable question.
    expect(REASONING_ADDENDUM).toContain('"draft_answers": [');
    expect(REASONING_ADDENDUM).toContain('DRAFT VERDICTS DISCIPLINE');
    expect(REASONING_ADDENDUM).toContain('single source of truth');
    // Cross-source reasoning artefacts ARE present (same shape as the
    // monolithic synthesis pass).
    expect(REASONING_ADDENDUM).toContain('playbook_steps');
    expect(REASONING_ADDENDUM).toContain('faithfulness');
    expect(REASONING_ADDENDUM).toContain('TRACE AGREEMENT');
    // Hard rule: the model is explicitly told NOT to emit the legacy
    // answers[] field; drafts go in draft_answers[] instead.
    expect(REASONING_ADDENDUM).toContain('DO NOT emit the "answers" field');
  });

  it('ANSWERS_CHUNK_ADDENDUM consumes draft verdicts and supports dissent flagging', () => {
    expect(ANSWERS_CHUNK_ADDENDUM).toContain(ANSWERS_CHUNK_MARKER);
    // The chunk pass emits answers via the submit_answers tool now;
    // per-answer fields still describe cross-source attribution so the
    // model knows which fields to populate.
    expect(ANSWERS_CHUNK_ADDENDUM).toContain('submit_answers');
    expect(ANSWERS_CHUNK_ADDENDUM).toContain('evidence_source_kind');
    expect(ANSWERS_CHUNK_ADDENDUM).toContain('evidence_source_id');
    // CONSISTENCY REFACTOR (W1.2): chunk MUST reference the draft
    // verdicts as source of truth and support dissent flagging.
    expect(ANSWERS_CHUNK_ADDENDUM).toContain('DRAFT VERDICTS FROM REASONING');
    expect(ANSWERS_CHUNK_ADDENDUM).toContain('dissent');
    expect(ANSWERS_CHUNK_ADDENDUM).toContain('dissent_reason');
    expect(ANSWERS_CHUNK_ADDENDUM).toContain('DEFAULT BEHAVIOUR');
    expect(ANSWERS_CHUNK_ADDENDUM).toContain('DISSENT BEHAVIOUR');
    // Reasoning artefacts (playbook, timeline, faithfulness, narrative,
    // category_notes, coaching, kb_citations, overall_confidence) are
    // forbidden — they belong to Pass 2A.
    expect(ANSWERS_CHUNK_ADDENDUM).toContain('"playbook_steps"');
    expect(ANSWERS_CHUNK_ADDENDUM).toContain('"category_notes"');
    // The chunk MUST reference the reasoning artefacts as context.
    expect(ANSWERS_CHUNK_ADDENDUM).toContain('REASONING ARTEFACTS');
  });

  it('snapshots the assembled reasoning prompt', () => {
    const assembled = MOCK_BASE_BODY + addendumForKind('reasoning');
    expect(assembled).toMatchSnapshot('reasoning-assembled');
  });

  it('snapshots the assembled answers_chunk prompt', () => {
    const assembled = MOCK_BASE_BODY + addendumForKind('answers_chunk');
    expect(assembled).toMatchSnapshot('answers_chunk-assembled');
  });

  // Workstream B3: every multi-source pass must carry the KB grounding
  // discipline so the empty `KB PAGES LOADED FOR THIS CASE` block
  // deterministically routes KB-following questions to N/A. Pinning
  // these sentinels prevents accidental removal of the rule via a
  // future addendum edit.
  it('SYNTHESIS_ADDENDUM carries the KB grounding discipline rule', () => {
    expect(SYNTHESIS_ADDENDUM).toContain('KB grounding discipline');
    expect(SYNTHESIS_ADDENDUM).toContain('KB PAGES LOADED FOR THIS CASE');
    expect(SYNTHESIS_ADDENDUM).toContain('kb_gap');
    expect(SYNTHESIS_ADDENDUM).toContain('Do NOT substitute ticket notes');
  });

  it('REASONING_ADDENDUM carries the KB grounding discipline rule', () => {
    expect(REASONING_ADDENDUM).toContain('KB grounding discipline');
    expect(REASONING_ADDENDUM).toContain('KB PAGES LOADED FOR THIS CASE');
    expect(REASONING_ADDENDUM).toContain('kb_gap');
    expect(REASONING_ADDENDUM).toContain('Do NOT substitute ticket notes');
  });
});

// Workstream B2: the user-prompt KB anchors block is rendered by the
// two-pass builder, not by the system-prompt addenda. Cover both the
// populated and empty paths so callers can rely on the
// always-present block being a deterministic signal.
import {
  buildSynthesisPrompt,
  buildReasoningPrompt,
  buildAnswerChunkPrompt,
  groupGradeableQuestionsByCategory,
} from '../aiReviewerTwoPassPrompts';
import { buildAiReviewerPrompt, type FormForPrompt } from '../aiReviewerPrompt';

function makeMinimalForm(): FormForPrompt {
  return {
    id: 99019,
    form_name: 'Test Form',
    interaction_type: 'CALL',
    ai_review_guidance: null,
    categories: [{ id: 1, category_name: 'KB' }],
    questions: [
      {
        id: 500,
        category_name: 'KB',
        question_text: 'Did the agent follow the KB article applicable to this issue?',
        question_type: 'YES_NO',
        yes_value: 1,
        no_value: 0,
        na_value: 0,
        is_na_allowed: true,
        radio_options: [],
      },
    ],
  };
}

describe('KB PAGES LOADED FOR THIS CASE block (B2)', () => {
  it('renders populated anchors with playbook ordering across all three builders', () => {
    const form = makeMinimalForm();
    const kbAnchors = [
      { url: 'https://kb.example/zebra', name: 'Zebra Page', is_playbook: false },
      { url: 'https://kb.example/playbook', name: 'Player Setup Playbook', is_playbook: true },
      { url: 'https://kb.example/alpha', name: 'Alpha Page', is_playbook: false },
    ];

    const synth = buildSynthesisPrompt({
      form,
      traces: [
        { sourceKind: 'CALL', sourceId: 'call-1', traceJson: '{}', header: { Agent: 'Alex' } },
      ],
      kbAnchors,
    });
    expect(synth.user).toContain('KB PAGES LOADED FOR THIS CASE');
    expect(synth.user).toContain('ASSIGNED PLAYBOOK PAGE: "Player Setup Playbook"');
    expect(synth.user).toContain('KB PAGE: "Alpha Page"');
    expect(synth.user).toContain('KB PAGE: "Zebra Page"');
    // Playbook page must appear before non-playbook pages (sorted block).
    const playbookIdx = synth.user.indexOf('Player Setup Playbook');
    const alphaIdx = synth.user.indexOf('Alpha Page');
    expect(playbookIdx).toBeGreaterThan(0);
    expect(playbookIdx).toBeLessThan(alphaIdx);
    // Alpha (non-playbook) sorted alphabetically before Zebra (non-playbook).
    const zebraIdx = synth.user.indexOf('Zebra Page');
    expect(alphaIdx).toBeLessThan(zebraIdx);

    const reasoning = buildReasoningPrompt({
      form,
      traces: [
        { sourceKind: 'CALL', sourceId: 'call-1', traceJson: '{}', header: { Agent: 'Alex' } },
      ],
      kbAnchors,
    });
    expect(reasoning.user).toContain('KB PAGES LOADED FOR THIS CASE');
    expect(reasoning.user).toContain('ASSIGNED PLAYBOOK PAGE: "Player Setup Playbook"');

    const chunk = buildAnswerChunkPrompt({
      form,
      categoryName: 'KB',
      questionIds: [500],
      reasoning: { reasoningJson: '{}' },
      traces: [
        { sourceKind: 'CALL', sourceId: 'call-1', traceJson: '{}', header: { Agent: 'Alex' } },
      ],
      kbAnchors,
    });
    expect(chunk.user).toContain('KB PAGES LOADED FOR THIS CASE');
    expect(chunk.user).toContain('ASSIGNED PLAYBOOK PAGE: "Player Setup Playbook"');
  });

  it('renders the explicit empty marker when no anchors are present (KB-NA signal)', () => {
    const form = makeMinimalForm();
    const synth = buildSynthesisPrompt({
      form,
      traces: [
        { sourceKind: 'CALL', sourceId: 'call-1', traceJson: '{}', header: { Agent: 'Alex' } },
      ],
      kbAnchors: [],
    });
    expect(synth.user).toContain('KB PAGES LOADED FOR THIS CASE');
    expect(synth.user).toContain('(none — no playbook page assigned');
    expect(synth.user).toContain('KB-following questions MUST be answered N/A');
  });
});

// Workstream 1.2: chunk prompt must surface the DRAFT VERDICTS FROM
// REASONING block to the model — that block is the single source of
// truth for the verdict the chunk attaches evidence to (or dissents on).
describe('DRAFT VERDICTS FROM REASONING block (W1.2)', () => {
  it('renders the drafts list when buildAnswerChunkPrompt receives draftAnswers', () => {
    const form = makeMinimalForm();
    const chunk = buildAnswerChunkPrompt({
      form,
      categoryName: 'KB',
      questionIds: [500],
      reasoning: { reasoningJson: '{}' },
      draftAnswers: [
        {
          question_id: 500,
          verdict: 'yes',
          brief_rationale: 'Agent followed KB step at [01:24].',
          evidence_pointer: { source_kind: 'CALL', source_id: 'call-1', where: '[01:24]' },
        },
      ],
      traces: [
        { sourceKind: 'CALL', sourceId: 'call-1', traceJson: '{}', header: { Agent: 'Alex' } },
      ],
    });
    expect(chunk.user).toContain('DRAFT VERDICTS FROM REASONING');
    expect(chunk.user).toContain('single source of truth');
    // Each allowed id must appear in the rendered drafts block.
    expect(chunk.user).toMatch(/- q500 -> YES @ \[01:24\]: Agent followed KB step at \[01:24\]\./);
  });

  it('renders MISSING for allowed ids that the reasoning pass omitted', () => {
    const form = makeMinimalForm();
    const chunk = buildAnswerChunkPrompt({
      form,
      categoryName: 'KB',
      questionIds: [500],
      reasoning: { reasoningJson: '{}' },
      // No draftAnswers entry for q500 — chunk should see MISSING and
      // fall back to its rubric reading.
      draftAnswers: [],
      traces: [
        { sourceKind: 'CALL', sourceId: 'call-1', traceJson: '{}', header: { Agent: 'Alex' } },
      ],
    });
    expect(chunk.user).toContain('DRAFT VERDICTS FROM REASONING');
    expect(chunk.user).toContain('q500 -> MISSING');
  });

  it('renders the (no drafts available) sentinel when draftAnswers is omitted entirely', () => {
    const form = makeMinimalForm();
    const chunk = buildAnswerChunkPrompt({
      form,
      categoryName: 'KB',
      questionIds: [500],
      reasoning: { reasoningJson: '{}' },
      traces: [
        { sourceKind: 'CALL', sourceId: 'call-1', traceJson: '{}', header: { Agent: 'Alex' } },
      ],
    });
    expect(chunk.user).toContain('DRAFT VERDICTS FROM REASONING');
    expect(chunk.user).toContain('(no drafts available');
  });
});

// Rollup engine integration: role=ROLLUP questions are auto-derived by
// backend/src/utils/rollupEngine.ts and overwritten on persist by
// SubmissionService.applyRollupEngineToAnswers, so the prompt builders
// MUST skip them. This block pins that contract across all three of the
// gradeable-question rendering paths (single-pass, chunked grouper, and
// chunked spec renderer).
describe('ROLLUP exclusion from AI prompts', () => {
  function makeFormWithRollup(): FormForPrompt {
    return {
      id: 99020,
      form_name: 'v3 Form with Rollup',
      interaction_type: 'CALL',
      ai_review_guidance: null,
      categories: [{ id: 1, category_name: 'Contact Management' }],
      questions: [
        {
          id: 800,
          category_name: 'Contact Management',
          question_text: 'Did the agent confirm the billing contact?',
          question_type: 'YES_NO',
          yes_value: 1,
          no_value: 0,
          na_value: 0,
          is_na_allowed: true,
          radio_options: [],
          role: 'DETAIL',
        },
        {
          id: 801,
          category_name: 'Contact Management',
          question_text: 'Were all required contact-management actions handled correctly?',
          question_type: 'YES_NO',
          yes_value: 1,
          no_value: 0,
          na_value: 0,
          is_na_allowed: true,
          radio_options: [],
          role: 'ROLLUP',
        },
      ],
    };
  }

  it('renderFormForPrompt (single-pass) omits ROLLUP rows and keeps DETAIL rows', () => {
    const built = buildAiReviewerPrompt({
      form: makeFormWithRollup(),
      adapterKind: 'CALL',
      header: { case_id: '12345' },
      notes: [],
      kbHits: [],
    });
    expect(built.user).toContain('question_id=800');
    expect(built.user).toContain('Did the agent confirm the billing contact?');
    expect(built.user).not.toContain('question_id=801');
    expect(built.user).not.toContain('Were all required contact-management actions handled correctly?');
  });

  it('groupGradeableQuestionsByCategory (chunked) excludes ROLLUP ids from every chunk', () => {
    const groups = groupGradeableQuestionsByCategory(makeFormWithRollup());
    expect(groups).toEqual([{ category: 'Contact Management', questionIds: [800] }]);
  });

  it('buildAnswerChunkPrompt (chunked) does not render the ROLLUP question line in the CATEGORY FORM SPEC', () => {
    const chunk = buildAnswerChunkPrompt({
      form: makeFormWithRollup(),
      categoryName: 'Contact Management',
      // Use only the DETAIL id; the grouper would have produced this.
      questionIds: [800],
      reasoning: { reasoningJson: '{}' },
      traces: [
        { sourceKind: 'CALL', sourceId: 'call-1', traceJson: '{}', header: {} },
      ],
    });
    expect(chunk.user).toContain('q800 [YES_NO');
    expect(chunk.user).not.toContain('q801 [YES_NO');
    expect(chunk.user).not.toContain('Were all required contact-management actions handled correctly?');
  });

  it('buildAnswerChunkPrompt defends against a stale ROLLUP id sneaking into questionIds', () => {
    // Even if a caller mistakenly passes the ROLLUP id, renderFormSpec
    // filters it out so the model never sees it. This is the
    // belt-and-suspenders behaviour mirroring the renderer.
    const chunk = buildAnswerChunkPrompt({
      form: makeFormWithRollup(),
      categoryName: 'Contact Management',
      questionIds: [800, 801],
      reasoning: { reasoningJson: '{}' },
      traces: [
        { sourceKind: 'CALL', sourceId: 'call-1', traceJson: '{}', header: {} },
      ],
    });
    expect(chunk.user).toContain('q800 [YES_NO');
    expect(chunk.user).not.toContain('q801 [YES_NO');
  });
});
