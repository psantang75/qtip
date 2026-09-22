/**
 * Quote resolution is the only deterministic check on a model's citation, and
 * it has to be wrong in a specific direction.
 *
 * A FALSE REJECT costs a real finding, because the caller drops it. ASR
 * rendering disagrees with however the model retypes a line — case, smart
 * quotes, hyphens, and the line break the speaker label sits on — so anything
 * that only differs in those ways must still resolve, and a quote too short to
 * be distinctive resolves by definition.
 *
 * A FALSE ACCEPT lets fabricated evidence through, which is the failure this
 * exists to stop. Words that appear nowhere in the material must not pass.
 */
import { describe, it, expect } from 'vitest';
import {
  isSamePerson, normalizeForMatch, quoteAuthors, quoteResolves,
  quoteResolvesAsCustomer, quoteResolvesAsInternalSpeaker,
} from '../evidence';

const TRANSCRIPT = [
  'Agent: Thanks for calling, how can I help?',
  'Customer: I want this installed before Thanksgiving if you can manage it.',
  'Agent: I can take the card right now if you have it handy.',
  'Customer: I am with a client, just email me the link.',
].join('\n');

const CRM_NOTES = '[TASK 12345 · 9:42 AM — Call / Quote Sent / Mabels Diner] Sent pricing and a follow-up date.';

describe('normalizeForMatch', () => {
  it('folds case, punctuation, and whitespace to a comparable form', () => {
    expect(normalizeForMatch('  I WANT this —  installed!  ')).toBe('i want this installed');
  });

  it('folds the smart quotes a model emits into the ASCII the transcript has', () => {
    expect(normalizeForMatch('\u201Cdon\u2019t wait\u201D')).toBe(normalizeForMatch('"don\'t wait"'));
  });
});

describe('quoteResolves — accepts real evidence', () => {
  it('accepts an exact span', () => {
    expect(quoteResolves('I can take the card right now', TRANSCRIPT)).toBe(true);
  });

  it('accepts a span differing only in case and punctuation', () => {
    expect(quoteResolves('i can TAKE the card, right now!', TRANSCRIPT)).toBe(true);
  });

  it('accepts a span that crosses a line break in the rendered transcript', () => {
    expect(quoteResolves(
      'just email me the link.',
      'Customer: I am with a client, just email\nme the link.',
    )).toBe(true);
  });

  it('resolves against the CRM notes when the transcript does not contain it', () => {
    expect(quoteResolves('Sent pricing and a follow-up date', TRANSCRIPT, CRM_NOTES)).toBe(true);
  });

  it('accepts a stitched quote when both halves are in the same source', () => {
    expect(quoteResolves(
      'I want this installed before Thanksgiving ... I am with a client',
      TRANSCRIPT,
    )).toBe(true);
  });
});

describe('quoteResolves — rejects invented evidence', () => {
  it('rejects words that appear nowhere in the material', () => {
    expect(quoteResolves('we can do the whole chain for twelve hundred', TRANSCRIPT, CRM_NOTES)).toBe(false);
  });

  it('rejects a plausible paraphrase of something that was said', () => {
    // The most likely hallucination: the gist is right, the words are not.
    expect(quoteResolves('I would like it put in ahead of the Thanksgiving holiday', TRANSCRIPT)).toBe(false);
  });

  it('rejects a stitched quote when one half is invented', () => {
    expect(quoteResolves(
      'I can take the card right now ... and I will waive the install fee',
      TRANSCRIPT,
    )).toBe(false);
  });

  it('does not let two separate sources satisfy one stitched quote', () => {
    // Each half is real, but in different documents — joined they assert a
    // continuity neither source shows.
    expect(quoteResolves(
      'I can take the card right now ... Sent pricing and a follow-up date',
      TRANSCRIPT,
      CRM_NOTES,
    )).toBe(false);
  });
});

describe('quoteResolves — transcripts rendered one line per turn', () => {
  // The shape formatTranscriptContent actually produces. A phrase-level provider
  // splits one sentence across turns, so a real quote is interrupted in the
  // source by a speaker label and by the other party's acknowledgement. Every
  // case here was a genuine finding dropped against production material.
  const RENDERED = [
    '[00:00:03 — AGENT] Thanks for calling, how can I help you today?',
    "[00:01:24 — CUSTOMER] yeah, yeah, so there's 5 dealerships. It's Parkway,",
    '[00:01:26 — AGENT] mm-hmm',
    '[00:01:28 — CUSTOMER] C D R J, Ford Chevrolet, Mazda and Kia.',
    '[00:01:35 — AGENT] Got it, I will send the quote over.',
  ].join('\n');

  it('accepts a quote spanning consecutive turns by the same speaker', () => {
    expect(quoteResolves("so there's 5 dealerships. It's Parkway, C D R J, Ford Chevrolet", RENDERED)).toBe(true);
  });

  it('accepts a quote spanning the other party interjecting mid-sentence', () => {
    expect(quoteResolves(
      "yeah, yeah, so there's 5 dealerships. It's Parkway, C D R J, Ford Chevrolet, Mazda and Kia.",
      RENDERED,
    )).toBe(true);
  });

  it('accepts a quote that crosses a normal turn boundary between speakers', () => {
    expect(quoteResolves('Mazda and Kia. Got it, I will send the quote over', RENDERED)).toBe(true);
  });

  it('still rejects invented words in a rendered transcript', () => {
    expect(quoteResolves('we also run 4 more stores over in Jersey', RENDERED)).toBe(false);
  });

  it('does not let the speaker label itself supply the missing words', () => {
    // The label is normalised into the rendered haystack, so a quote built from
    // it would otherwise resolve without anyone having said it.
    expect(quoteResolves('CUSTOMER C D R J, Ford Chevrolet, and 00:01:35 AGENT', RENDERED)).toBe(false);
  });
});

describe('quoteResolves — fails open where it cannot know', () => {
  it('accepts a quote too short to be distinctive', () => {
    expect(quoteResolves('okay', TRANSCRIPT)).toBe(true);
  });

  it('accepts anything when there is no material to compare against', () => {
    expect(quoteResolves('some words that were never said')).toBe(true);
    expect(quoteResolves('some words that were never said', '', null)).toBe(true);
  });

  it('treats an empty or null quote as nothing to disprove', () => {
    expect(quoteResolves(null, TRANSCRIPT)).toBe(true);
    expect(quoteResolves('', TRANSCRIPT)).toBe(true);
  });
});

/**
 * The mirror image of `quoteResolves`, and deliberately biased the other way.
 * This one is used to DELETE a finding on the grounds that the salesperson
 * already did the thing, so every ambiguity has to answer no — a false accept
 * here silently removes a real miss, which is what happened to Jason's warranty
 * finding when Customer Service's explanation was read as his offer.
 */
describe('quoteResolvesAsInternalSpeaker', () => {
  const RENDERED = [
    '[00:00:03 — AGENT] Thanks for calling, I can add the extended warranty for you.',
    '[00:01:24 — CUSTOMER] does the replacement player come with a warranty?',
    '[00:01:40 — Unknown] your call may be recorded for quality.',
  ].join('\n');

  it('accepts a line our side of the call actually said', () => {
    expect(quoteResolvesAsInternalSpeaker('I can add the extended warranty for you', RENDERED)).toBe(true);
  });

  it('accepts the older Agent: line form, so plain-text providers still work', () => {
    // formatTranscriptContent passes an already-plain payload through verbatim.
    // Without this the check would go silent on those calls and the
    // false-positive control would stop working entirely.
    expect(quoteResolvesAsInternalSpeaker(
      'I can take the card right now',
      'Agent: I can take the card right now if you have it handy.',
    )).toBe(true);
  });

  it('rejects the customer\'s own question, however much it names the topic', () => {
    expect(quoteResolvesAsInternalSpeaker('does the replacement player come with a warranty', RENDERED)).toBe(false);
  });

  it('rejects a turn whose speaker could not be identified', () => {
    expect(quoteResolvesAsInternalSpeaker('your call may be recorded for quality', RENDERED)).toBe(false);
  });

  it('rejects everything when the transcript has no speaker labels at all', () => {
    expect(quoteResolvesAsInternalSpeaker(
      'I can add the extended warranty for you',
      'I can add the extended warranty for you, no problem.',
    )).toBe(false);
  });

  it('rejects a quote too short to attribute, where quoteResolves fails open', () => {
    expect(quoteResolves('okay', RENDERED)).toBe(true);
    expect(quoteResolvesAsInternalSpeaker('okay', RENDERED)).toBe(false);
  });

  it('rejects a null quote and an empty transcript', () => {
    expect(quoteResolvesAsInternalSpeaker(null, RENDERED)).toBe(false);
    expect(quoteResolvesAsInternalSpeaker('I can add the extended warranty', '')).toBe(false);
  });

  it('accepts a sentence a phrase-level provider split across the speaker\'s turns', () => {
    const split = [
      '[00:01:24 — AGENT] so we can add the five year coverage',
      '[00:01:26 — AGENT] for another eighty nine dollars.',
    ].join('\n');
    expect(quoteResolvesAsInternalSpeaker(
      'add the five year coverage for another eighty nine dollars',
      split,
    )).toBe(true);
  });
});

/**
 * The mirror image, for a rule's own exclusions. Those turn on what the CUSTOMER
 * said — "email me the link", "we'll come back to you" — which the internal test
 * can never see. It stays scoped to the far end rather than to any speaker,
 * because a positive result here also deletes a finding and an internal turn
 * identifies the company rather than a person.
 */
describe('quoteResolvesAsCustomer', () => {
  const RENDERED = [
    '[00:00:03 — AGENT] I can put that order through right now.',
    '[00:01:24 — CUSTOMER] Just email me the link, I need to run it past my partner.',
    '[00:01:40 — Unknown] your call may be recorded for quality.',
  ].join('\n');

  it('accepts the customer line a rule exclusion turns on', () => {
    expect(quoteResolvesAsCustomer('I need to run it past my partner', RENDERED)).toBe(true);
  });

  it('accepts the plain Customer: form as well as the rendered one', () => {
    expect(quoteResolvesAsCustomer(
      'just email me the link',
      'Customer: I am with a client, just email me the link.',
    )).toBe(true);
  });

  // The Jason warranty case, arriving through the exclusion question instead of
  // the attempt question: on a transferred call this line is Customer Service's.
  it('rejects an internal turn, so a colleague cannot satisfy an exclusion', () => {
    expect(quoteResolvesAsCustomer('I can put that order through right now', RENDERED)).toBe(false);
  });

  it('rejects a turn whose speaker could not be identified', () => {
    expect(quoteResolvesAsCustomer('your call may be recorded for quality', RENDERED)).toBe(false);
  });

  it('rejects everything when the transcript carries no speaker labels', () => {
    expect(quoteResolvesAsCustomer(
      'just email me the link',
      'I am with a client, just email me the link.',
    )).toBe(false);
  });

  it('rejects a quote too short to be distinctive', () => {
    expect(quoteResolvesAsCustomer('okay', RENDERED)).toBe(false);
  });

  it('rejects a null quote and an empty transcript', () => {
    expect(quoteResolvesAsCustomer(null, RENDERED)).toBe(false);
    expect(quoteResolvesAsCustomer('just email me the link', '')).toBe(false);
  });

  it('is the complement of the internal test on the same transcript', () => {
    // Neither accepts the other's speaker, which is what makes combining them a
    // deliberate decision at the call site rather than an accident.
    const customerLine = 'I need to run it past my partner';
    const agentLine = 'I can put that order through right now';
    expect(quoteResolvesAsCustomer(customerLine, RENDERED)).toBe(true);
    expect(quoteResolvesAsInternalSpeaker(customerLine, RENDERED)).toBe(false);
    expect(quoteResolvesAsCustomer(agentLine, RENDERED)).toBe(false);
    expect(quoteResolvesAsInternalSpeaker(agentLine, RENDERED)).toBe(true);
  });
});

/**
 * A record's history legitimately contains other employees' notes. "The quote is
 * somewhere in the CRM block" therefore says nothing about who wrote it, and the
 * rendered `by <author>` header is the only thing that does.
 */
describe('quoteAuthors', () => {
  const NOTES = [
    '[TASK 1120497 · action 8561828 · 2026-09-17 14:05 · by Jason Spangler · Lead Manager] Ordered the replacement unit.',
    '[TASK 1120497 · action 8561900 · 2026-09-17 15:20 · by Dana Fields · Lead Manager] Confirmed the shipping address.',
    '[TASK 1120497 · action 8561950 · 2026-09-17 16:00 · author unknown · Lead Manager] Status synced from the portal.',
  ].join('\n');

  it('names the author of the line the quote is in', () => {
    expect(quoteAuthors('Ordered the replacement unit', NOTES)).toEqual(['Jason Spangler']);
  });

  it('does not credit one author with another\'s note on the same record', () => {
    expect(quoteAuthors('Confirmed the shipping address', NOTES)).toEqual(['Dana Fields']);
  });

  it('returns nothing for a line with no author, rather than guessing', () => {
    expect(quoteAuthors('Status synced from the portal', NOTES)).toEqual([]);
  });

  it('returns nothing when the quote spans lines, so authorship stays unproven', () => {
    expect(quoteAuthors('Ordered the replacement unit Confirmed the shipping address', NOTES)).toEqual([]);
  });

  it('returns nothing for a quote too short to attribute', () => {
    expect(quoteAuthors('the', NOTES)).toEqual([]);
  });

  it('compares people on their normalised name', () => {
    expect(isSamePerson(['Jason  SPANGLER'], 'Jason Spangler')).toBe(true);
    expect(isSamePerson(['Jason Spangler'], 'Jason Spangle')).toBe(false);
    expect(isSamePerson([], 'Jason Spangler')).toBe(false);
    expect(isSamePerson(['Jason Spangler'], '')).toBe(false);
  });
});
