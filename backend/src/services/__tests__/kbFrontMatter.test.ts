/**
 * Phase D (D2/D3): unit tests for the KB front-matter parser.
 *
 * Covers:
 *   - Round-trip parsing of QTIP's tag set (qtip_role, qtip_applies_to,
 *     qtip_steps, qtip_authority).
 *   - Numbered + bulleted `Steps` extraction for D3 prefab steps.
 *   - Graceful handling of pages without a front-matter block.
 */

import { describe, it, expect } from 'vitest';
import { parseKbFrontMatter } from '../kbFrontMatter';

describe('parseKbFrontMatter', () => {
  it('parses scalar + flow-list tags', () => {
    const md = [
      '---',
      'qtip_role: agent',
      'qtip_applies_to: [TICKET, CALL]',
      'qtip_authority: official',
      '---',
      '',
      'Page body goes here.',
    ].join('\n');

    const out = parseKbFrontMatter(md);
    expect(out.meta).not.toBeNull();
    expect(out.meta?.qtip_role).toBe('agent');
    expect(out.meta?.qtip_applies_to).toEqual(['TICKET', 'CALL']);
    expect(out.meta?.qtip_authority).toBe('official');
    expect(out.body.trimStart().startsWith('Page body')).toBe(true);
  });

  it('extracts ordered numbered steps from a Steps section (D3)', () => {
    const md = [
      '---',
      'qtip_role: support',
      '---',
      '',
      '## Overview',
      'Some text about the issue.',
      '',
      '## Steps',
      '1. Greet the customer',
      '2. Verify identity',
      '3. Diagnose the problem',
      '',
      '## Notes',
      'Other content',
    ].join('\n');

    const out = parseKbFrontMatter(md);
    expect(out.playbook_steps).toEqual([
      'Greet the customer',
      'Verify identity',
      'Diagnose the problem',
    ]);
  });

  it('extracts bulleted Steps when no numbered list is present', () => {
    const md = [
      '## Steps',
      '- Greet',
      '- Probe',
      '* Diagnose',
    ].join('\n');

    const out = parseKbFrontMatter(md);
    expect(out.meta).toBeNull();
    expect(out.playbook_steps).toEqual(['Greet', 'Probe', 'Diagnose']);
  });

  it('prefers qtip_steps front-matter over body Steps section', () => {
    const md = [
      '---',
      'qtip_steps: [Front A, "Front B, with comma", Front C]',
      '---',
      '',
      '## Steps',
      '1. Body A',
      '2. Body B',
    ].join('\n');

    const out = parseKbFrontMatter(md);
    expect(out.meta?.qtip_steps).toEqual(['Front A', 'Front B, with comma', 'Front C']);
    expect(out.playbook_steps).toEqual(['Front A', 'Front B, with comma', 'Front C']);
  });

  it('returns null meta and empty steps when no front-matter and no Steps section', () => {
    const md = 'Just a page with paragraphs.\n\nMore content here.';
    const out = parseKbFrontMatter(md);
    expect(out.meta).toBeNull();
    expect(out.playbook_steps).toEqual([]);
    expect(out.body).toBe(md);
  });

  it('drops invalid qtip_applies_to values silently', () => {
    const md = [
      '---',
      'qtip_applies_to: [TICKET, FOOBAR, CALL]',
      '---',
      'body',
    ].join('\n');
    const out = parseKbFrontMatter(md);
    expect(out.meta?.qtip_applies_to).toEqual(['TICKET', 'CALL']);
  });
});
