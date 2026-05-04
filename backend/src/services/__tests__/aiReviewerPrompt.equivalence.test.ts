/**
 * Byte-equivalence gate for the AI Reviewer prompt refactor (Phase 2).
 *
 * The new file-loaded buildAiReviewerPrompt(...) MUST produce a string
 * identical, byte-for-byte, to the legacy inline implementation
 * (_buildAiReviewerPromptInline). Any drift fails this test, which is
 * the safety net that lets us refactor the prompt out of code without
 * silently changing model behavior.
 *
 * This test runs as part of the regular vitest suite (no DB / LLM /
 * BookStack dependency) and is NOT gated on ENABLE_DB_TESTS or
 * RUN_AI_EVAL — every developer pulls this code through the gate.
 */

import { describe, it, expect } from 'vitest';
import {
  buildAiReviewerPrompt,
  _buildAiReviewerPromptInline,
  type PromptInput,
  type FormForPrompt,
} from '../aiReviewerPrompt';
import type { CRMNote } from '../CRMService';
import { clearPromptCache } from '../promptLoader';

function makeForm(overrides: Partial<FormForPrompt> = {}): FormForPrompt {
  return {
    id: 99016,
    form_name: 'Tech Ticket Review - Sub-classification, Resolution and Process',
    interaction_type: 'TICKET',
    ai_review_guidance: null,
    categories: [
      { id: 1, category_name: 'Ticket Review' },
      { id: 2, category_name: 'AI Reviewer' },
    ],
    questions: [
      {
        id: 99125,
        category_name: 'Ticket Review',
        question_text: 'Did the selected Subclass accurately reflect the customer\'s issue?',
        question_type: 'YES_NO',
        yes_value: 1,
        no_value: 0,
        na_value: 0,
        is_na_allowed: false,
        radio_options: [],
      },
      {
        id: 99129,
        category_name: 'Ticket Review',
        question_text: 'Ticket Review Feedback',
        question_type: 'TEXT',
        yes_value: 0,
        no_value: 0,
        na_value: 0,
        is_na_allowed: false,
        radio_options: [],
      },
      {
        id: 12345,
        category_name: 'Ticket Review',
        question_text: 'How would you rate the resolution?',
        question_type: 'RADIO',
        yes_value: 0,
        no_value: 0,
        na_value: 0,
        is_na_allowed: true,
        radio_options: [
          { value: 'great', text: 'Great', score: 5 },
          { value: 'ok', text: 'OK', score: 3 },
          { value: 'poor', text: 'Poor', score: 0 },
        ],
      },
    ],
    ...overrides,
  };
}

function makeNotes(): CRMNote[] {
  return [
    {
      id: 1001,
      note: 'Customer called back reporting playback resumed after firmware reboot.',
      created_on: '2026-04-28T13:14:00.000Z',
      created_by: 23,
      created_by_name: 'Bethany Smith',
      status_after: null,
      next_contact_date: null,
      is_after_audit: false,
    },
    {
      id: 1000,
      note: 'Initial troubleshooting: confirmed device powered, ran sound check, asked customer to power-cycle.',
      created_on: '2026-04-27T19:02:00.000Z',
      created_by: 23,
      created_by_name: 'Bethany Smith',
      status_after: null,
      next_contact_date: null,
      is_after_audit: false,
    },
  ];
}

function makeInput(overrides: Partial<PromptInput> = {}): PromptInput {
  return {
    form: makeForm(),
    adapterKind: 'TICKET',
    header: {
      ticket_id: '279060',
      classification: 'Tech Support / "Playback Stopped"',
      assigned_agent: 'Bethany Smith',
      status: 'Closed',
      closed_on: '2026-04-28 09:14',
    },
    notes: makeNotes(),
    kbHits: [
      {
        id: 42,
        name: 'Playback Stopped — SXBR2',
        url: 'http://know.crm.dm-us.com/books/job-tech-support/page/playback-stopped',
        content: 'Step 1: confirm power.\nStep 2: power cycle the unit.\nStep 3: rerun sound check.',
        is_playbook: true,
      },
      {
        id: 99,
        name: 'Generic Troubleshooting',
        url: 'http://know.crm.dm-us.com/books/job-tech-support/page/generic',
        content: 'Generic checklist for tech support tickets.',
        is_playbook: false,
      },
    ],
    ...overrides,
  };
}

describe('aiReviewerPrompt byte-equivalence (Phase 2 gate)', () => {
  it('file-loaded prompt matches legacy inline prompt — full fixture', () => {
    clearPromptCache();
    const input = makeInput();
    const fileBased = buildAiReviewerPrompt(input);
    const inline = _buildAiReviewerPromptInline(input);
    expect(fileBased.system).toBe(inline.system);
    expect(fileBased.user).toBe(inline.user);
  });

  it('matches when ai_review_guidance is set (system prompt gets appended block)', () => {
    clearPromptCache();
    const guidance = 'Only mark NA when an earlier note documents the issue resolved before that step.\nNever credit a step purely from playbook checkboxes — require corroborating evidence in notes.';
    const input = makeInput({ form: makeForm({ ai_review_guidance: guidance }) });
    const fileBased = buildAiReviewerPrompt(input);
    const inline = _buildAiReviewerPromptInline(input);
    expect(fileBased.system).toBe(inline.system);
    expect(fileBased.user).toBe(inline.user);
    expect(fileBased.system).toContain('ADDITIONAL FORM-SPECIFIC GRADING RULES');
  });

  it('matches when there are no notes and no KB pages', () => {
    clearPromptCache();
    const input = makeInput({ notes: [], kbHits: [] });
    const fileBased = buildAiReviewerPrompt(input);
    const inline = _buildAiReviewerPromptInline(input);
    expect(fileBased.system).toBe(inline.system);
    expect(fileBased.user).toBe(inline.user);
    expect(fileBased.user).toContain('(no notes)');
    expect(fileBased.user).toContain('(no KB pages matched');
  });

  it('matches when header is empty', () => {
    clearPromptCache();
    const input = makeInput({ header: {} });
    const fileBased = buildAiReviewerPrompt(input);
    const inline = _buildAiReviewerPromptInline(input);
    expect(fileBased.system).toBe(inline.system);
    expect(fileBased.user).toBe(inline.user);
    expect(fileBased.user).toContain('  (empty)');
  });
});
