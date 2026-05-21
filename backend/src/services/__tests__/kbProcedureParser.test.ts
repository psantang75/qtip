/**
 * Tests for the KB procedure parser.
 *
 * The Satellite Radio Music Intermittent page is the case that
 * triggered this whole change set, so it gets the most detailed
 * coverage: we want to lock in (a) all 5 Approaches are extracted,
 * (b) titles are captured, (c) the chain edges 1->3 and 2->4 (etc.)
 * are detected, and (d) the rendered KB PROCEDURE block carries the
 * conditional qualifier next to each gated Approach.
 *
 * The other tests pin smaller invariants:
 *   - Flat list with no chain language still parses cleanly.
 *   - Single-Approach page emits one entry and zero chain edges.
 *   - Prose page with no `Approach N` heading returns null so
 *     callers fall back to today's body-only rendering.
 */

import { describe, it, expect } from 'vitest';
import { parseKbApproaches, renderKbProcedureBlock } from '../kbProcedureParser';

// The body shape mirrors what stripHtmlToPlaintext now produces for
// this page: top-level "Approach N" lines, the title on the next
// line, and nested if/then bullets indented with two spaces (which
// arrived in yesterday's htmlText.ts list-nesting fix).
const SATELLITE_RADIO_PAGE = `
Approach 1
Qualify what the radio displays. If the radio displays artist and song title, move to the next approach.

  - If the radio displays "Acquiring or No Signal"
  - If the radio displays "Antenna Not Detected or No Antenna"

Approach 2
Verify that the player has 70% or higher signal strength.

  - If the player DOES NOT have higher than 70%, the antenna will need to be reaimed.
  - Follow the instructions for How to Aim a SiriusXM Antenna
  - If the player DOES have higher than 70%, go to approach 3.

If Approach 1 did not solve the issue, move to Approach 3.

Approach 3
Send a refresh signal to the player.

If Approach 2 did not solve the issue, move to Approach 4.

Approach 4
Power Cycle the Player

Unplug the player for 30 seconds. Then plug back in.

If Approach 3 did not solve the issue, move to Approach 5.

Approach 5
Follow the steps in the Audio Troubleshooting - Music is Distorted section
`;

describe('parseKbApproaches', () => {
  describe('Satellite Radio Music Intermittent page (the regression case)', () => {
    const parsed = parseKbApproaches(SATELLITE_RADIO_PAGE);

    it('extracts all five Approaches in order', () => {
      expect(parsed).not.toBeNull();
      expect(parsed!.approaches.map((a) => a.n)).toEqual([1, 2, 3, 4, 5]);
    });

    it('captures the title from each Approach', () => {
      const titles = parsed!.approaches.map((a) => a.title);
      expect(titles[0]).toContain('Qualify what the radio displays');
      expect(titles[1]).toContain('Verify that the player has 70% or higher signal strength');
      expect(titles[2]).toContain('Send a refresh signal');
      expect(titles[3]).toContain('Power Cycle');
      expect(titles[4]).toContain('Audio Troubleshooting');
    });

    it('detects the chain edges 1->3, 2->4, 3->5', () => {
      const edges = parsed!.chain.map((e) => `${e.from}->${e.to}`).sort();
      expect(edges).toEqual(['1->3', '2->4', '3->5']);
    });

    it('strips chain sentences from the captured body so they only live in chain[]', () => {
      // Approach 2's body should NOT include the "If Approach 1 did
      // not solve..." line that comes between Approach 2 and Approach 3.
      const a2 = parsed!.approaches.find((a) => a.n === 2)!;
      expect(a2.body).not.toMatch(/If Approach 1 did not solve/);
      // ...but it SHOULD retain its own inline sub-conditions.
      expect(a2.body).toMatch(/antenna will need to be reaimed/);
    });
  });

  describe('rendered KB PROCEDURE block', () => {
    const parsed = parseKbApproaches(SATELLITE_RADIO_PAGE)!;
    const rendered = renderKbProcedureBlock(
      parsed,
      'Satellite Radio Troubleshoot - Music Intermittent',
      'http://kb.example.com/page/satellite-music-intermittent'
    );

    it('emits the heading + authoritative disclaimer', () => {
      expect(rendered).toContain('KB PROCEDURE - Satellite Radio Troubleshoot - Music Intermittent');
      expect(rendered).toContain('authoritative');
    });

    it('attaches the conditional qualifier inline to each gated Approach', () => {
      // Approach 3 fires only if Approach 1 did not resolve.
      expect(rendered).toMatch(/Approach 3:[^\n]*only if Approach 1 did not resolve/);
      // Approach 4 fires only if Approach 2 did not resolve.
      expect(rendered).toMatch(/Approach 4:[^\n]*only if Approach 2 did not resolve/);
      // Approach 5 fires only if Approach 3 did not resolve.
      expect(rendered).toMatch(/Approach 5:[^\n]*only if Approach 3 did not resolve/);
    });

    it('does NOT attach a qualifier to Approaches that have no incoming chain edge', () => {
      // Approach 1 and Approach 2 are unconditional starts (no "only if" gate).
      const a1Line = rendered.split('\n').find((l) => /Approach 1:/.test(l))!;
      const a2Line = rendered.split('\n').find((l) => /Approach 2:/.test(l))!;
      expect(a1Line).not.toMatch(/only if/);
      expect(a2Line).not.toMatch(/only if/);
    });
  });

  describe('edge cases', () => {
    it('flat 3-Approach page with no chain language parses cleanly with empty chain[]', () => {
      const text = `
Approach 1
Do thing A.

Approach 2
Do thing B.

Approach 3
Do thing C.
`;
      const parsed = parseKbApproaches(text)!;
      expect(parsed.approaches.map((a) => a.n)).toEqual([1, 2, 3]);
      expect(parsed.chain).toEqual([]);
    });

    it('single-Approach page parses to one entry with zero chain edges', () => {
      const text = `
Approach 1
Power-cycle the modem and confirm a green LED.
`;
      const parsed = parseKbApproaches(text)!;
      expect(parsed.approaches).toHaveLength(1);
      expect(parsed.approaches[0].title).toContain('Power-cycle the modem');
      expect(parsed.chain).toEqual([]);
    });

    it('returns null for a prose page with no Approach heading', () => {
      const text = `
This page describes the customer escalation policy.

Always verify the customer's identity before discussing account details.
Document the call in the CRM and flag the ticket for supervisor review.
`;
      expect(parseKbApproaches(text)).toBeNull();
    });

    it('returns null for empty / blank input', () => {
      expect(parseKbApproaches('')).toBeNull();
      expect(parseKbApproaches('   \n\n\t')).toBeNull();
    });

    it('drops Approaches whose body is empty (heading with nothing under it)', () => {
      const text = `
Approach 1
Real step.

Approach 2

Approach 3
Another real step.
`;
      const parsed = parseKbApproaches(text)!;
      // Approach 2 has no title line → it gets skipped.
      expect(parsed.approaches.map((a) => a.n)).toEqual([1, 3]);
    });
  });
});
