/**
 * Pins the NA-gate guard behaviour. Some parent "summary" questions on
 * the Contact Call Review Form (Contact Management R2, Hold/Transfer R5)
 * carry an N/A precondition: when none of their opportunity-gate
 * siblings fired, the parent is N/A — not NO. The model usually grades
 * this correctly when the rubric is in its prompt, but occasionally
 * defaults to NO and penalizes the agent for an event that never
 * happened. `applyNaGateGuards` post-processes the answers array to
 * deterministically flip those cases. These tests pin the flip
 * conditions so a future regression surfaces immediately instead of in
 * production-grade-output drift.
 */

import { describe, it, expect } from 'vitest';
import { _internal } from '../AIReviewerService';
import type { FormForPrompt } from '../aiReviewerPrompt';

const { applyNaGateGuards } = _internal;

function makeContactMgmtForm(): FormForPrompt {
  return {
    id: 99019,
    form_name: 'Contact Call Review Form',
    interaction_type: 'CALL',
    ai_review_guidance: null,
    categories: [{ id: 1, category_name: 'Contact Management' }],
    questions: [
      {
        id: 100,
        category_name: 'Contact Management',
        question_text: 'Were all required contact-management actions handled correctly?',
        question_type: 'YES_NO',
        yes_value: 1,
        no_value: 0,
        na_value: 0,
        is_na_allowed: true,
        radio_options: [],
      },
      {
        id: 101,
        category_name: 'Contact Management',
        question_text: 'Did the call provide an opportunity to confirm the current billing contact?',
        question_type: 'YES_NO',
        yes_value: 1,
        no_value: 0,
        na_value: 0,
        is_na_allowed: false,
        radio_options: [],
      },
      {
        id: 102,
        category_name: 'Contact Management',
        question_text: 'Did the customer reference a person not currently in the CRM?',
        question_type: 'YES_NO',
        yes_value: 1,
        no_value: 0,
        na_value: 0,
        is_na_allowed: false,
        radio_options: [],
      },
      {
        id: 103,
        category_name: 'Contact Management',
        question_text: 'Did the customer indicate someone has left the organization?',
        question_type: 'YES_NO',
        yes_value: 1,
        no_value: 0,
        na_value: 0,
        is_na_allowed: false,
        radio_options: [],
      },
      {
        id: 104,
        category_name: 'Contact Management',
        question_text: 'Did the call indicate a contact owner/role change is needed?',
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

function makeHoldTransferForm(): FormForPrompt {
  return {
    id: 99019,
    form_name: 'Contact Call Review Form',
    interaction_type: 'CALL',
    ai_review_guidance: null,
    categories: [{ id: 2, category_name: 'Hold / Transfer Policy' }],
    questions: [
      {
        id: 200,
        category_name: 'Hold / Transfer Policy',
        question_text: 'Were all hold and transfer procedures followed correctly?',
        question_type: 'YES_NO',
        yes_value: 1,
        no_value: 0,
        na_value: 0,
        is_na_allowed: true,
        radio_options: [],
      },
      {
        id: 201,
        category_name: 'Hold / Transfer Policy',
        question_text: 'Did the agent place the customer on hold at any point?',
        question_type: 'YES_NO',
        yes_value: 1,
        no_value: 0,
        na_value: 0,
        is_na_allowed: false,
        radio_options: [],
      },
      {
        id: 202,
        category_name: 'Hold / Transfer Policy',
        question_text: 'Did a call transfer take place?',
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

describe('applyNaGateGuards', () => {
  describe('Contact Management parent (R2)', () => {
    it('flips NO to NA when all four opportunity gates are NO', () => {
      const form = makeContactMgmtForm();
      const answers = [
        { question_id: 100, answer: 'no', ai_confidence: 0.5 },
        { question_id: 101, answer: 'no', ai_confidence: 0.9 },
        { question_id: 102, answer: 'no', ai_confidence: 0.9 },
        { question_id: 103, answer: 'no', ai_confidence: 0.9 },
        { question_id: 104, answer: 'no', ai_confidence: 0.9 },
      ];
      const flips = applyNaGateGuards(answers, form);
      expect(flips).toHaveLength(1);
      expect(flips[0].qid).toBe(100);
      const parent = answers.find((a) => a.question_id === 100);
      expect(parent?.answer).toBe('na');
      expect(parent?.ai_confidence).toBeGreaterThanOrEqual(0.95);
    });

    it('leaves NO intact when ANY opportunity gate is YES', () => {
      const form = makeContactMgmtForm();
      const answers = [
        { question_id: 100, answer: 'no', ai_confidence: 0.5 },
        { question_id: 101, answer: 'yes', ai_confidence: 0.9 },
        { question_id: 102, answer: 'no', ai_confidence: 0.9 },
        { question_id: 103, answer: 'no', ai_confidence: 0.9 },
        { question_id: 104, answer: 'no', ai_confidence: 0.9 },
      ];
      const flips = applyNaGateGuards(answers, form);
      expect(flips).toHaveLength(0);
      const parent = answers.find((a) => a.question_id === 100);
      expect(parent?.answer).toBe('no');
    });

    it('leaves YES verdicts intact (guard only fires on NO -> NA)', () => {
      const form = makeContactMgmtForm();
      const answers = [
        { question_id: 100, answer: 'yes', ai_confidence: 0.8 },
        { question_id: 101, answer: 'no', ai_confidence: 0.9 },
        { question_id: 102, answer: 'no', ai_confidence: 0.9 },
        { question_id: 103, answer: 'no', ai_confidence: 0.9 },
        { question_id: 104, answer: 'no', ai_confidence: 0.9 },
      ];
      const flips = applyNaGateGuards(answers, form);
      expect(flips).toHaveLength(0);
      expect(answers.find((a) => a.question_id === 100)?.answer).toBe('yes');
    });
  });

  describe('Clarifying-questions parent (Problem Solving)', () => {
    function makeClarifyingForm(): FormForPrompt {
      return {
        id: 99019,
        form_name: 'Contact Call Review Form',
        interaction_type: 'CALL',
        ai_review_guidance: null,
        categories: [{ id: 3, category_name: 'Knowledge & Problem Solving' }],
        questions: [
          {
            id: 300,
            category_name: 'Knowledge & Problem Solving',
            question_text: 'Did the agent ask clarifying questions before proposing a solution?',
            question_type: 'YES_NO',
            yes_value: 1,
            no_value: 0,
            na_value: 0,
            is_na_allowed: true,
            radio_options: [],
          },
          {
            id: 301,
            category_name: 'Knowledge & Problem Solving',
            question_text: 'Did the call require troubleshooting?',
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

    it('flips NO to NA when the troubleshooting gate is NO (direct-action call)', () => {
      const form = makeClarifyingForm();
      const answers = [
        { question_id: 300, answer: 'no', ai_confidence: 0.6 },
        { question_id: 301, answer: 'no', ai_confidence: 0.92 },
      ];
      const flips = applyNaGateGuards(answers, form);
      expect(flips).toHaveLength(1);
      expect(flips[0].qid).toBe(300);
      const parent = answers.find((a) => a.question_id === 300);
      expect(parent?.answer).toBe('na');
      expect(parent?.ai_confidence).toBeGreaterThanOrEqual(0.95);
    });

    it('leaves NO intact when the troubleshooting gate is YES', () => {
      const form = makeClarifyingForm();
      const answers = [
        { question_id: 300, answer: 'no', ai_confidence: 0.6 },
        { question_id: 301, answer: 'yes', ai_confidence: 0.92 },
      ];
      const flips = applyNaGateGuards(answers, form);
      expect(flips).toHaveLength(0);
      expect(answers.find((a) => a.question_id === 300)?.answer).toBe('no');
    });

    it('leaves YES intact (guard only fires on NO -> NA)', () => {
      const form = makeClarifyingForm();
      const answers = [
        { question_id: 300, answer: 'yes', ai_confidence: 0.85 },
        { question_id: 301, answer: 'no', ai_confidence: 0.92 },
      ];
      const flips = applyNaGateGuards(answers, form);
      expect(flips).toHaveLength(0);
      expect(answers.find((a) => a.question_id === 300)?.answer).toBe('yes');
    });
  });

  describe('Hold / Transfer parent (R5)', () => {
    it('flips NO to NA when both hold AND transfer gates are NO', () => {
      const form = makeHoldTransferForm();
      const answers = [
        { question_id: 200, answer: 'no', ai_confidence: 0.5 },
        { question_id: 201, answer: 'no', ai_confidence: 0.95 },
        { question_id: 202, answer: 'no', ai_confidence: 0.95 },
      ];
      const flips = applyNaGateGuards(answers, form);
      expect(flips).toHaveLength(1);
      expect(flips[0].qid).toBe(200);
      expect(answers.find((a) => a.question_id === 200)?.answer).toBe('na');
    });

    it('leaves NO intact when hold OR transfer fired', () => {
      const form = makeHoldTransferForm();
      const answers = [
        { question_id: 200, answer: 'no', ai_confidence: 0.5 },
        { question_id: 201, answer: 'yes', ai_confidence: 0.95 },
        { question_id: 202, answer: 'no', ai_confidence: 0.95 },
      ];
      const flips = applyNaGateGuards(answers, form);
      expect(flips).toHaveLength(0);
    });
  });

  it('returns empty flip list when form has no recognized NA-gate parents', () => {
    const form: FormForPrompt = {
      id: 1,
      form_name: 'Plain',
      interaction_type: 'TICKET',
      ai_review_guidance: null,
      categories: [{ id: 1, category_name: 'Other' }],
      questions: [
        {
          id: 1,
          category_name: 'Other',
          question_text: 'Was the agent friendly?',
          question_type: 'YES_NO',
          yes_value: 1,
          no_value: 0,
          na_value: 0,
          is_na_allowed: false,
          radio_options: [],
        },
      ],
    };
    const answers = [{ question_id: 1, answer: 'no', ai_confidence: 0.8 }];
    const flips = applyNaGateGuards(answers, form);
    expect(flips).toHaveLength(0);
  });
});
