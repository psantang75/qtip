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
import { normalizeForMatch, quoteResolves } from '../evidence';

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
