/**
 * Tier-1 trace voting (self-consistency K).
 *
 * The `voteOnTraces` helper takes K trace JSON strings, majority-votes
 * the structured fields, and returns merged JSON + agreement metrics.
 * These tests pin the rules from the plan:
 *   - playbook_steps: keyed by lowercased step name; majority-vote status;
 *     drop steps that don't appear in >= ceil(k/2) traces.
 *   - observations: dedupe by kind+normalize(message); keep ones in >=2/3.
 *   - extracted_claims: dedupe by normalize(claim); keep ones in >=2/3.
 *   - timeline: dedupe by (when, normalize(action)); keep ones in >=2/3.
 * Agreement composite = 0.5*playbook + 0.3*claims + 0.2*observations.
 */

import { describe, it, expect } from 'vitest';
import { voteOnTraces } from '../aiReviewerTraceVoting';

function trace(opts: {
  playbook?: Array<{ step: string; status: string; evidence_note_date?: string | null }>;
  observations?: Array<{ kind: string; message: string; severity?: string | number }>;
  claims?: Array<{ source?: string; claim: string }>;
  timeline?: Array<{ when: string; action: string }>;
}): string {
  return JSON.stringify({
    playbook_steps: opts.playbook ?? [],
    observations: opts.observations ?? [],
    extracted_claims: opts.claims ?? [],
    timeline: opts.timeline ?? [],
  });
}

describe('voteOnTraces', () => {
  it('returns agreement=1.0 when all 3 traces are unanimous', () => {
    const t = trace({
      playbook: [
        { step: 'Confirm power', status: 'done', evidence_note_date: 'Apr 28' },
        { step: 'Power cycle', status: 'done', evidence_note_date: 'Apr 28' },
      ],
      observations: [{ kind: 'process', message: 'Followed playbook end-to-end.', severity: 'low' }],
      claims: [{ source: 'agent', claim: 'Customer confirmed playback resumed.' }],
      timeline: [{ when: 'Apr 28 10:00', action: 'Reboot completed' }],
    });
    const { mergedTraceJson, agreement } = voteOnTraces([t, t, t]);
    expect(agreement.k).toBe(3);
    expect(agreement.playbookAgreement).toBe(1);
    expect(agreement.observationAgreement).toBe(1);
    expect(agreement.claimAgreement).toBe(1);
    expect(agreement.timelineAgreement).toBe(1);
    expect(agreement.composite).toBe(1);
    const merged = JSON.parse(mergedTraceJson);
    expect(merged.playbook_steps).toHaveLength(2);
    expect(merged.observations).toHaveLength(1);
    expect(merged.extracted_claims).toHaveLength(1);
    expect(merged.timeline).toHaveLength(1);
    expect(agreement.droppedItems).toEqual({ playbook: 0, observations: 0, claims: 0, timeline: 0 });
  });

  it('keeps items present in 2/3 traces and drops 1/3 outliers', () => {
    const a = trace({
      playbook: [
        { step: 'Confirm power', status: 'done', evidence_note_date: 'Apr 28' },
        { step: 'Power cycle', status: 'done', evidence_note_date: null },
      ],
      observations: [{ kind: 'process', message: 'Followed playbook.', severity: 'low' }],
      claims: [{ claim: 'Customer requested refund.' }],
      timeline: [{ when: 'Apr 28', action: 'Reboot' }],
    });
    const b = trace({
      playbook: [
        { step: 'confirm power', status: 'done', evidence_note_date: 'Apr 28' },
        { step: 'Hotspot test', status: 'missing', evidence_note_date: null },
      ],
      observations: [{ kind: 'process', message: 'Followed playbook.', severity: 'medium' }],
      claims: [{ claim: 'Customer requested refund.' }],
      timeline: [{ when: 'Apr 28', action: 'Reboot' }],
    });
    const c = trace({
      playbook: [
        { step: 'Confirm Power', status: 'done', evidence_note_date: null },
        { step: 'Power cycle', status: 'done', evidence_note_date: 'Apr 28' },
      ],
      observations: [{ kind: 'tone', message: 'Polite throughout.', severity: 'low' }],
      claims: [{ claim: 'Refund issued.' }],
      timeline: [{ when: 'Apr 28', action: 'Reboot' }],
    });
    const { mergedTraceJson, agreement } = voteOnTraces([a, b, c]);
    const merged = JSON.parse(mergedTraceJson);
    // Confirm power appears in 3/3 (case-insensitive). Power cycle in
    // 2/3, kept. Hotspot test in 1/3, dropped.
    const stepNames = merged.playbook_steps.map((s: { step: string }) => s.step.toLowerCase()).sort();
    expect(stepNames).toEqual(['confirm power', 'power cycle']);
    // First non-null evidence date wins.
    const confirm = merged.playbook_steps.find(
      (s: { step: string }) => s.step.toLowerCase() === 'confirm power'
    );
    expect(confirm.evidence_note_date).toBe('Apr 28');
    // The "Followed playbook" observation appears in 2/3 traces.
    // Severity is upgraded to "medium" (the strongest copy).
    expect(merged.observations).toHaveLength(1);
    expect(merged.observations[0].severity).toBe('medium');
    // "Customer requested refund" is in 2/3, "Refund issued" in 1/3.
    expect(merged.extracted_claims).toHaveLength(1);
    // The timeline event is in 3/3 traces.
    expect(merged.timeline).toHaveLength(1);
    // 1 dropped playbook step (Hotspot test), 1 dropped observation
    // (Polite throughout), 1 dropped claim (Refund issued).
    expect(agreement.droppedItems).toEqual({
      playbook: 1,
      observations: 1,
      claims: 1,
      timeline: 0,
    });
    // Agreement counts: 2/3 playbook unique survived (~0.67),
    // 1/2 observations (~0.50), 1/2 claims (~0.50), 1/1 timeline.
    expect(agreement.playbookAgreement).toBeCloseTo(2 / 3, 2);
    expect(agreement.observationAgreement).toBe(0.5);
    expect(agreement.claimAgreement).toBe(0.5);
    expect(agreement.timelineAgreement).toBe(1);
    // composite = 0.5 * 0.67 + 0.3 * 0.5 + 0.2 * 0.5 = 0.585
    expect(agreement.composite).toBeGreaterThan(0.55);
    expect(agreement.composite).toBeLessThan(0.65);
  });

  it('drops everything when all 3 traces disagree', () => {
    const a = trace({
      playbook: [{ step: 'A', status: 'done' }],
      observations: [{ kind: 'process', message: 'a', severity: 'low' }],
      claims: [{ claim: 'a happened' }],
      timeline: [{ when: 'Apr 28', action: 'a' }],
    });
    const b = trace({
      playbook: [{ step: 'B', status: 'done' }],
      observations: [{ kind: 'process', message: 'b', severity: 'low' }],
      claims: [{ claim: 'b happened' }],
      timeline: [{ when: 'Apr 28', action: 'b' }],
    });
    const c = trace({
      playbook: [{ step: 'C', status: 'done' }],
      observations: [{ kind: 'process', message: 'c', severity: 'low' }],
      claims: [{ claim: 'c happened' }],
      timeline: [{ when: 'Apr 28', action: 'c' }],
    });
    const { mergedTraceJson, agreement } = voteOnTraces([a, b, c]);
    const merged = JSON.parse(mergedTraceJson);
    expect(merged.playbook_steps).toEqual([]);
    expect(merged.observations).toEqual([]);
    expect(merged.extracted_claims).toEqual([]);
    expect(merged.timeline).toEqual([]);
    expect(agreement.composite).toBe(0);
    expect(agreement.droppedItems.playbook).toBe(3);
  });

  it('breaks playbook status ties toward "missing" so a missed step is never hidden by a tie', () => {
    const a = trace({ playbook: [{ step: 'Power cycle', status: 'missing' }] });
    const b = trace({ playbook: [{ step: 'Power cycle', status: 'done' }] });
    const { mergedTraceJson } = voteOnTraces([a, b]);
    const merged = JSON.parse(mergedTraceJson);
    // 1-and-1 tie between missing and done. Tiebreak preference is
    // "missing > out_of_order > done > not_applicable".
    expect(merged.playbook_steps[0].status).toBe('missing');
  });

  it('silently drops unparseable JSON inputs and reports k from the survivors', () => {
    const good = trace({ playbook: [{ step: 'A', status: 'done' }] });
    const bad = '{not actually json';
    const { agreement } = voteOnTraces([good, bad, good]);
    // 2 good traces voted; threshold ceil(2/2) = 1, so both surviving
    // step instances are kept.
    expect(agreement.k).toBe(2);
    expect(agreement.playbookAgreement).toBe(1);
  });

  it('returns empty merged trace + zero agreement when every input is unparseable', () => {
    const { mergedTraceJson, agreement } = voteOnTraces(['nope', '{', 'still no']);
    const merged = JSON.parse(mergedTraceJson);
    expect(merged.playbook_steps).toEqual([]);
    expect(agreement.k).toBe(0);
    expect(agreement.composite).toBe(0);
  });

  it('treats k=1 as a fail-open passthrough with composite=1.0', () => {
    const t = trace({
      playbook: [{ step: 'X', status: 'done' }],
      observations: [{ kind: 'process', message: 'm', severity: 'low' }],
      claims: [{ claim: 'c' }],
    });
    const { agreement } = voteOnTraces([t]);
    expect(agreement.k).toBe(1);
    expect(agreement.composite).toBe(1);
  });
});
