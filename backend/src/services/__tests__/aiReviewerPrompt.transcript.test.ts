/**
 * Phase B speaker-turn rendering.
 *
 * The Phase B transcript renderer recognises structured turn JSON from
 * the dominant call-center providers (Genesys, AWS Connect, Five9,
 * Twilio) and emits one `[mm:ss — Speaker] text` line per turn. Plain
 * text falls back to verbatim. These tests pin the rendering rules so
 * we don't accidentally re-collapse the prompt back to a wall-of-text.
 */

import { describe, it, expect, vi } from 'vitest';

// Mock basePromptService BEFORE importing aiReviewerPrompt so that the
// builder resolves the assembled Base prompt without needing a warmed
// cache or DB. The body content is not asserted here — only the user
// prompt rendering is.
vi.mock('../BasePromptService', () => {
  const stub = { id: 1, key: 'base.v1', version: 1, body: '<<MOCK ASSEMBLED BASE>>' };
  const service = {
    getAssembledPrompt: vi.fn(() => stub),
    // Trace pass reads the raw base (no addendum); both paths render
    // their own user prompts so we only need a non-empty body string.
    getBaseForKind: vi.fn(() => stub),
  };
  return { basePromptService: service, default: service };
});

vi.mock('../RulePackService', () => ({
  rulePackService: {
    renderPacksForPrompt: vi.fn(() => ''),
    getPacksForForm: vi.fn(() => []),
  },
  default: {
    renderPacksForPrompt: vi.fn(() => ''),
    getPacksForForm: vi.fn(() => []),
  },
}));

import { buildAiReviewerPrompt, type PromptInput, type FormForPrompt } from '../aiReviewerPrompt';
import type { CRMNote } from '../CRMService';

function makeForm(): FormForPrompt {
  return {
    id: 1,
    form_name: 'Call Review',
    interaction_type: 'CALL',
    ai_review_guidance: null,
    categories: [{ id: 1, category_name: 'Call' }],
    questions: [
      {
        id: 1,
        category_name: 'Call',
        question_text: 'Did the agent open with proper introduction?',
        question_type: 'YES_NO',
        yes_value: 1,
        no_value: 0,
        na_value: 0,
        is_na_allowed: false,
        radio_options: [],
      },
    ],
  };
}

function makeCallInput(transcriptRaw: string): PromptInput {
  const note: CRMNote = {
    id: 1,
    note: transcriptRaw,
    created_on: '2026-04-28T13:14:00.000Z',
    created_by: null,
    created_by_name: 'Call Transcript',
    status_after: null,
    next_contact_date: null,
    is_after_audit: false,
  };
  return {
    form: makeForm(),
    adapterKind: 'CALL',
    header: { conversation_id: 'abc-123' },
    notes: [note],
    kbHits: [],
  };
}

describe('renderTranscriptBlock — Phase B speaker turns', () => {
  it('renders a Genesys-style turn array as one line per speaker turn', () => {
    const transcript = JSON.stringify([
      { speaker: 'Agent', ts: 5, text: 'Thanks for calling, this is Bethany.' },
      { speaker: 'Customer', ts: 12, text: 'Hi, my receiver lost playback.' },
      { speaker: 'Agent', ts: 22, text: 'Let me get you to the right team.' },
    ]);
    const out = buildAiReviewerPrompt(makeCallInput(transcript));
    expect(out.user).toContain('[00:05 — Agent] Thanks for calling, this is Bethany.');
    expect(out.user).toContain('[00:12 — Customer] Hi, my receiver lost playback.');
    expect(out.user).toContain('[00:22 — Agent] Let me get you to the right team.');
    // No JSON pretty-printed brackets should leak through.
    expect(out.user).not.toContain('"speaker"');
  });

  it('handles AWS-Connect-style nested transcript object', () => {
    const transcript = JSON.stringify({
      segments: [
        { participant: 'AGENT', start_time: 0, content: 'Hello, this is technical support.' },
        { participant: 'CUSTOMER', start_time: 4, content: 'My device is not working.' },
      ],
    });
    const out = buildAiReviewerPrompt(makeCallInput(transcript));
    expect(out.user).toContain('[00:00 — AGENT] Hello, this is technical support.');
    expect(out.user).toContain('[00:04 — CUSTOMER] My device is not working.');
  });

  it('formats h:mm:ss.frac timestamps to mm:ss', () => {
    const transcript = JSON.stringify([
      { speaker: 'Agent', timestamp: '0:01:30.250', text: 'Hold on.' },
    ]);
    const out = buildAiReviewerPrompt(makeCallInput(transcript));
    expect(out.user).toContain('[01:30 — Agent] Hold on.');
  });

  it('falls back to verbatim text when content is not JSON', () => {
    const raw = 'Agent: Hello.\nCustomer: Hi there.';
    const out = buildAiReviewerPrompt(makeCallInput(raw));
    expect(out.user).toContain('Agent: Hello.');
    expect(out.user).toContain('Customer: Hi there.');
  });

  it('falls back to verbatim text on malformed JSON', () => {
    const raw = '[ { "speaker": "Agent" '; // missing close
    const out = buildAiReviewerPrompt(makeCallInput(raw));
    expect(out.user).toContain('"speaker": "Agent"');
  });

  it('drops turns with empty text but keeps the rest', () => {
    const transcript = JSON.stringify([
      { speaker: 'Agent', ts: 5, text: '' },
      { speaker: 'Customer', ts: 8, text: 'Hello?' },
    ]);
    const out = buildAiReviewerPrompt(makeCallInput(transcript));
    expect(out.user).toContain('[00:08 — Customer] Hello?');
    expect(out.user).not.toContain('[00:05 — Agent] '); // no orphan agent line
  });
});

// Workstream D1: trace pass and single-source pass MUST render the
// same CRMNote identically when the source is a CALL. Previously the
// trace builder dumped raw note text (the JSON turn array verbatim)
// while the single-source builder parsed it into speaker-flow lines —
// the SAME call graded differently depending on whether the case was
// multi-source or single-source.
import { buildTracePrompt } from '../aiReviewerTwoPassPrompts';
import { renderTranscriptBlock } from '../transcriptRender';

describe('trace pass CALL transcript parity (D1)', () => {
  it('buildTracePrompt renders a CALL transcript via the shared helper', () => {
    const turns = [
      { speaker: 'Agent', ts: 5, text: 'Thanks for calling, this is Bethany.' },
      { speaker: 'Customer', ts: 12, text: 'Hi, my receiver lost playback.' },
    ];
    const transcriptRaw = JSON.stringify(turns);
    const note: CRMNote = {
      id: 1,
      note: transcriptRaw,
      created_on: '2026-04-28T13:14:00.000Z',
      created_by: null,
      created_by_name: 'Call Transcript',
      status_after: null,
      next_contact_date: null,
      is_after_audit: false,
    };
    const trace = buildTracePrompt({
      sourceKind: 'CALL',
      sourceId: 'abc-123',
      header: { conversation_id: 'abc-123' },
      notes: [note],
      kbHits: [],
      form: makeForm(),
    });

    // Trace pass should now contain the same speaker-flow lines.
    expect(trace.user).toContain('[00:05 — Agent] Thanks for calling, this is Bethany.');
    expect(trace.user).toContain('[00:12 — Customer] Hi, my receiver lost playback.');
    // Raw JSON should NOT leak through any longer.
    expect(trace.user).not.toContain('"speaker"');
    // Trace pass renders the same block produced by the shared helper —
    // exact equivalence locks the two pipelines together.
    expect(trace.user).toContain(renderTranscriptBlock([note]));
  });

  it('trace pass keeps the simpler raw-text rendering for TICKET notes', () => {
    const note: CRMNote = {
      id: 99,
      note: 'Reset password per playbook step 3.',
      created_on: '2026-04-28T09:00:00.000Z',
      created_by: 7,
      created_by_name: 'Agent Beth',
      status_after: 'Closed',
      next_contact_date: null,
      is_after_audit: false,
    };
    const trace = buildTracePrompt({
      sourceKind: 'TICKET',
      sourceId: '12345',
      header: { Ticket: '12345' },
      notes: [note],
      kbHits: [],
      form: makeForm(),
    });
    expect(trace.user).toContain('Reset password per playbook step 3.');
    // Notes ordering label was fixed by D2.
    expect(trace.user).toContain('newest first');
    expect(trace.user).not.toContain('oldest first');
  });
});
