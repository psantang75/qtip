/**
 * Phase A self-consistency rule.
 *
 * The AI Reviewer's biggest "looks coherent but wrong" failure mode is
 * grading a Steps-Followed question "no" while leaving the playbook
 * trace empty. The post-parse self-consistency check catches that case
 * and routes the review to the verification pass. These tests pin the
 * rule's behavior so we don't accidentally regress it during prompt
 * version bumps.
 */

import { describe, it, expect } from 'vitest';
import { _internal } from '../AIReviewerService';
import type { FormForPrompt } from '../aiReviewerPrompt';
import type { AiPlaybookStep } from '../../models/Submission';

const {
  detectSelfConsistencyWarnings,
  parsePlaybookSteps,
  parseCoachingBlock,
  mapClaudeOutputToAnswers,
  enforceEvidenceFloor,
} = _internal;

function makeForm(): FormForPrompt {
  return {
    id: 1,
    form_name: 'Test',
    interaction_type: 'TICKET',
    ai_review_guidance: null,
    categories: [{ id: 1, category_name: 'Cat' }],
    questions: [
      {
        id: 1,
        category_name: 'Cat',
        question_text: 'Did the agent follow the documented steps?',
        question_type: 'YES_NO',
        yes_value: 1,
        no_value: 0,
        na_value: 0,
        is_na_allowed: false,
        radio_options: [],
      },
      {
        id: 2,
        category_name: 'Cat',
        question_text: 'Was the resolution well-documented?',
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

describe('detectSelfConsistencyWarnings', () => {
  it('flags when "Steps followed = no" but no playbook step is missing', () => {
    const form = makeForm();
    const warnings = detectSelfConsistencyWarnings(
      [
        { question_id: 1, answer: 'no', ai_confidence: 0.6 },
        { question_id: 2, answer: 'yes', ai_confidence: 0.9 },
      ],
      [
        { step: 'Confirm power', evidence_note_date: 'Apr 28', status: 'done' },
        { step: 'Power cycle', evidence_note_date: 'Apr 28', status: 'done' },
      ] as AiPlaybookStep[],
      form
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/playbook_steps/);
  });

  it('passes silently when playbook_steps[] has at least one missing row', () => {
    const form = makeForm();
    const warnings = detectSelfConsistencyWarnings(
      [
        { question_id: 1, answer: 'no', ai_confidence: 0.6 },
      ],
      [
        { step: 'Confirm power', evidence_note_date: 'Apr 28', status: 'done' },
        { step: 'Power cycle', evidence_note_date: null, status: 'missing' },
      ] as AiPlaybookStep[],
      form
    );
    expect(warnings).toEqual([]);
  });

  it('passes silently when an out_of_order step is recorded', () => {
    const form = makeForm();
    const warnings = detectSelfConsistencyWarnings(
      [{ question_id: 1, answer: 'no', ai_confidence: 0.6 }],
      [
        { step: 'Confirm power', evidence_note_date: 'Apr 28', status: 'done' },
        { step: 'Sound check', evidence_note_date: 'Apr 27', status: 'out_of_order' },
      ] as AiPlaybookStep[],
      form
    );
    expect(warnings).toEqual([]);
  });

  it('does not flag when no step-related question was answered', () => {
    const form = makeForm();
    const warnings = detectSelfConsistencyWarnings(
      [{ question_id: 2, answer: 'no', ai_confidence: 0.7 }],
      [],
      form
    );
    expect(warnings).toEqual([]);
  });

  it('does not flag when the step question was answered yes', () => {
    const form = makeForm();
    const warnings = detectSelfConsistencyWarnings(
      [{ question_id: 1, answer: 'yes', ai_confidence: 0.95 }],
      [],
      form
    );
    expect(warnings).toEqual([]);
  });
});

describe('parsePlaybookSteps', () => {
  it('drops rows missing a step name', () => {
    const out = parsePlaybookSteps([
      { step: '', status: 'done' },
      { step: 'Power cycle', status: 'missing' },
    ]);
    expect(out).toEqual([{ step: 'Power cycle', status: 'missing', evidence_note_date: null }]);
  });

  it('coerces unknown statuses to "done", then auto-corrects to "not_applicable" when no evidence_note_date is present', () => {
    const out = parsePlaybookSteps([{ step: 'X', status: 'partially' }]);
    expect(out[0].status).toBe('not_applicable');
    expect(out[0].evidence_note_date).toBeNull();
  });

  it('keeps "done" when evidence_note_date is supplied', () => {
    const out = parsePlaybookSteps([
      { step: 'Power cycle', status: 'done', evidence_note_date: 'Apr 28' },
    ]);
    expect(out[0].status).toBe('done');
    expect(out[0].evidence_note_date).toBe('Apr 28');
  });

  it('auto-corrects {status: "done", evidence_note_date: null} to "not_applicable"', () => {
    const out = parsePlaybookSteps([
      { step: 'External volume controls', status: 'done', evidence_note_date: null },
    ]);
    expect(out[0].status).toBe('not_applicable');
    expect(out[0].evidence_note_date).toBeNull();
  });

  it('preserves "not_applicable" when the model emits it directly', () => {
    const out = parsePlaybookSteps([
      { step: 'Hotspot test', status: 'not_applicable', evidence_note_date: null },
    ]);
    expect(out[0].status).toBe('not_applicable');
  });

  it('returns [] for non-array input', () => {
    expect(parsePlaybookSteps(null)).toEqual([]);
    expect(parsePlaybookSteps(undefined)).toEqual([]);
    expect(parsePlaybookSteps('nope')).toEqual([]);
  });
});

describe('parseCoachingBlock', () => {
  it('returns empty arrays when input is missing', () => {
    expect(parseCoachingBlock(null)).toEqual({ wins: [], gaps: [], next_actions: [] });
    expect(parseCoachingBlock(undefined)).toEqual({ wins: [], gaps: [], next_actions: [] });
  });

  it('strips empty strings and trims whitespace', () => {
    const out = parseCoachingBlock({
      wins: ['  Solid intro.  ', ''],
      gaps: ['  '],
      next_actions: ['Coach on subclass discipline'],
    });
    expect(out.wins).toEqual(['Solid intro.']);
    expect(out.gaps).toEqual([]);
    expect(out.next_actions).toEqual(['Coach on subclass discipline']);
  });
});

describe('mapClaudeOutputToAnswers — Phase A enrichment', () => {
  it('captures evidence_source / evidence_quote per answer', () => {
    const form = makeForm();
    const out = mapClaudeOutputToAnswers(
      {
        answers: [
          {
            question_id: 1,
            value: 'yes',
            confidence: 0.9,
            evidence_source: 'Apr 28 by Bethany',
            evidence_quote: 'Power cycled, customer confirmed playback resumed.',
          },
          {
            question_id: 2,
            value: 'no',
            confidence: 0.8,
            // no evidence fields — must be tolerated
          },
        ],
        playbook_steps: [],
        coaching: { wins: [], gaps: ['Note quality below standard'], next_actions: [] },
        narrative: 'Description: ok.',
        kb_citations: [],
        overall_confidence: 0.85,
      },
      form
    );
    expect(out.answerEvidence[1]).toEqual({
      evidence_source: 'Apr 28 by Bethany',
      evidence_quote: 'Power cycled, customer confirmed playback resumed.',
    });
    expect(out.answerEvidence[2]).toBeUndefined();
    expect(out.coaching.gaps).toEqual(['Note quality below standard']);
    expect(out.selfConsistencyWarnings).toEqual([]);
  });

  it('truncates evidence_quote longer than 240 chars', () => {
    const form = makeForm();
    const long = 'a'.repeat(300);
    const out = mapClaudeOutputToAnswers(
      {
        answers: [
          { question_id: 1, value: 'yes', confidence: 0.9, evidence_quote: long, evidence_source: 'note' },
          { question_id: 2, value: 'yes', confidence: 0.9 },
        ],
        narrative: 'ok',
      },
      form
    );
    const q = out.answerEvidence[1].evidence_quote ?? '';
    expect(q.length).toBeLessThanOrEqual(241); // 240 chars + ellipsis
    expect(q.endsWith('…')).toBe(true);
  });
});

describe('enforceEvidenceFloor', () => {
  it('caps a YES_NO "yes" with empty evidence to 0.5 and warns', () => {
    const form = makeForm();
    const answers = [
      { question_id: 1, answer: 'yes', ai_confidence: 0.92 },
      { question_id: 2, answer: 'no', ai_confidence: 0.7 },
    ];
    const evidence = {}; // no evidence at all
    const warnings = enforceEvidenceFloor(answers, evidence, form);
    expect(answers[0].ai_confidence).toBe(0.5);
    // negative verdict on q2 must be untouched
    expect(answers[1].ai_confidence).toBe(0.7);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/Q1 positive verdict/);
    expect(warnings[0]).toMatch(/0\.92.*0\.50/);
  });

  it('caps a YES_NO "yes" whose quote is too short and unanchored', () => {
    const form = makeForm();
    const answers = [{ question_id: 1, answer: 'yes', ai_confidence: 0.85 }];
    const evidence = { 1: { evidence_quote: 'looked good', evidence_source: 'note' } };
    const warnings = enforceEvidenceFloor(answers, evidence, form);
    expect(answers[0].ai_confidence).toBe(0.5);
    expect(warnings).toHaveLength(1);
  });

  it('passes a "yes" with a 20+ char quote that has a date anchor in the source', () => {
    const form = makeForm();
    const answers = [{ question_id: 1, answer: 'yes', ai_confidence: 0.92 }];
    const evidence = {
      1: {
        evidence_quote: 'Customer confirmed playback resumed after the reboot.',
        evidence_source: 'Apr 28 by Bethany',
      },
    };
    const warnings = enforceEvidenceFloor(answers, evidence, form);
    expect(answers[0].ai_confidence).toBe(0.92);
    expect(warnings).toEqual([]);
  });

  it('does not cap a negative verdict ("no") even with no evidence at all', () => {
    const form = makeForm();
    const answers = [{ question_id: 2, answer: 'no', ai_confidence: 0.9 }];
    const warnings = enforceEvidenceFloor(answers, {}, form);
    expect(answers[0].ai_confidence).toBe(0.9);
    expect(warnings).toEqual([]);
  });
});
