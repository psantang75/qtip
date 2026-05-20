/**
 * Consistency-refactor rubric regression tests (W2 + W3).
 *
 * Asserts against the in-tree seed data
 * (`backend/src/scripts/seedContactFormV3.data.ts`) rather than the
 * DB so this test stands alone (no Prisma, no warm cache) and the
 * applyContactFormV3Updates.ts script keeps the live forms in lockstep.
 *
 * W2 — Gate-exclusion: the shared ROLLUP_RUBRIC must explicitly tell
 * the model to ignore questions whose rubric begins with "Gate." when
 * computing the roll-up verdict. This is the structural fix that
 * stops q99292 ("Did the call require troubleshooting?" — a gate) from
 * cascading a NO into the K&PS roll-up.
 *
 * W3 — Phrasing-flexible rubrics: q99325 (first name), q99326 (verbal
 * ack), q99315 (DM brand thank) had phrasing-strict rubrics that
 * missed clear positive evidence on 99077. The new wording must
 * accept paraphrases / variants and explicitly name the disambiguation
 * (e.g. "the verified customer's first name").
 */

import { describe, it, expect } from 'vitest';
import { CATEGORIES } from '../../scripts/seedContactFormV3.data';

function findQuestionBySlug(slug: string) {
  for (const cat of CATEGORIES) {
    for (const q of cat.questions) {
      if (q.slug === slug) return q;
    }
  }
  return undefined;
}

describe('W2 — gate-exclusion in ROLLUP_RUBRIC (regression)', () => {
  // Rollups that consume the shared ROLLUP_RUBRIC (R8 appends a
  // critical-cap warning but is still based on ROLLUP_RUBRIC).
  // Skipped: R2 (Contact Mgmt) + R5 (Hold/Transfer) use deterministic
  // NA-gate guards with custom rubrics; R9 (WFH) uses
  // WFH_AUDIO_REQUIRED because grading depends on audio analysis.
  const sharedRollupSlugs = ['R1', 'R3', 'R4', 'R6', 'R7', 'R8'];

  it('every shared-rubric rollup carries the gate-exclusion language', () => {
    const rubrics = sharedRollupSlugs
      .map((s) => findQuestionBySlug(s)?.rubric_md ?? null)
      .filter((r): r is string => r != null);
    expect(rubrics.length).toBe(sharedRollupSlugs.length);
    // Each shared rollup begins with the same ROLLUP_RUBRIC body — a
    // few append critical-cap warnings, but the gate-exclusion rule
    // must appear in every one.
    for (const r of rubrics) {
      expect(r).toContain('IGNORE GATE QUESTIONS');
      expect(r).toContain('non-gate detail');
    }
  });

  it('ROLLUP_RUBRIC tells the model to IGNORE gate questions', () => {
    const r = findQuestionBySlug('R4')?.rubric_md ?? '';
    expect(r).toContain('IGNORE GATE QUESTIONS');
    expect(r).toMatch(/rubric begins with "Gate\."/i);
    expect(r).toContain('NOT quality criteria');
    // The fix names the canonical example so the model has a worked
    // case it can pattern-match against.
    expect(r).toMatch(/q4\.6.*troubleshooting/i);
  });

  it('ROLLUP_RUBRIC explicitly excludes gate verdicts from the YES/NO/NA tally', () => {
    const r = findQuestionBySlug('R4')?.rubric_md ?? '';
    // Each enumerated rule talks about "non-gate" details, not just
    // "visible details" — so a gate NO can't drive the rollup.
    expect(r).toContain('non-gate detail');
  });
});

describe('W3 — phrasing-flexible rubrics (regression)', () => {
  it('q7.7 (first name) names the verified-customer disambiguation', () => {
    const r = findQuestionBySlug('7.7')?.rubric_md ?? '';
    expect(r).toMatch(/customer's first name/i);
    // The fix explicitly tells the grader to ignore third-party names
    // (the 99077 miss was the agent saying "Alright, and Ben" after
    // Ben McCoy verified, but the model wanted a more formal address).
    expect(r).toMatch(/multiple proper names/i);
    expect(r).toMatch(/third party/i);
    expect(r).toContain('ONE qualifying use is sufficient for YES');
  });

  it('q7.10 (verbal acknowledgments) accepts paraphrase + empathetic confirmation as equivalents', () => {
    const r = findQuestionBySlug('7.10')?.rubric_md ?? '';
    expect(r).toContain('paraphrase');
    expect(r).toContain('empathetic');
    // The fix calls out the transcription-stripping caveat — Webex
    // commonly drops short backchannels and the grader was failing
    // because the literal "mm-hmm" wasn't in the transcript.
    expect(r).toMatch(/transcription often strips/i);
    expect(r).toContain('ACCEPT paraphrases');
  });

  it('q6.4 (Dynamic Media brand thank) accepts any DM-anchored thank variant', () => {
    const r = findQuestionBySlug('6.4')?.rubric_md ?? '';
    // The fix lists multiple anchored thank variants so the grader
    // doesn't need a literal "thank you for choosing Dynamic Media".
    expect(r).toMatch(/thank you for choosing Dynamic Media/);
    expect(r).toMatch(/thank you for calling Dynamic Media/);
    expect(r).toMatch(/thanks for being a Dynamic Media customer/);
    // Anti-pattern: a bare "thank you" must NOT count as YES.
    expect(r).toMatch(/NO.*generic.*thank you/);
  });
});
