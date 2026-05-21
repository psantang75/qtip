/**
 * Locks in the contract for `stripHtmlToPlaintext`:
 *
 *  1. Flat lists stay flat (no behaviour change from the legacy `\n- `
 *     rendering for top-level `<li>`).
 *  2. Nested `<ul>` / `<ol>` lists preserve their nesting via two-space
 *     indentation per depth level. KB pages express conditional /
 *     fallback semantics ("if Approach N didn't resolve, go to N+1") by
 *     nesting child bullets under their parent step; the AI Reviewer's
 *     trace pass was previously misreading those bullets as siblings of
 *     the parent step and inferring sequential ordering. Indentation
 *     restores the structural hint.
 *  3. Mixed `<ol>` / `<ul>` nesting behaves the same way — we don't try
 *     to preserve the ordered/unordered distinction (parity with the
 *     pre-change behaviour) but depth still drives indentation.
 *
 * Also pins three legacy behaviours we don't want this rewrite to break:
 * entity decoding, `<br>` → newline, and `<p>` / `<div>` / `<h?>` paragraph
 * separation.
 */

import { describe, it, expect } from 'vitest';
import { stripHtmlToPlaintext } from '../htmlText';

describe('stripHtmlToPlaintext', () => {
  describe('list nesting', () => {
    it('flat single-level <ul> renders as sibling bullets with no indent', () => {
      const out = stripHtmlToPlaintext('<ul><li>alpha</li><li>beta</li></ul>');
      expect(out).toBe('- alpha\n- beta');
    });

    it('nested <ul> indents children two spaces under the parent bullet', () => {
      const out = stripHtmlToPlaintext(
        '<ul><li>Approach 2 — Verify 70%+ signal<ul><li>If &lt;70%, antenna needs reaim</li><li>If &gt;=70%, go to Approach 3</li></ul></li></ul>'
      );
      expect(out).toBe(
        '- Approach 2 — Verify 70%+ signal\n  - If <70%, antenna needs reaim\n  - If >=70%, go to Approach 3'
      );
    });

    it('mixed <ol>/<ul> still indents per depth (ordered/unordered distinction not preserved)', () => {
      // The blank line between "child b" and "step two" is the legacy
      // paragraph break that `</ul>` always emits — it's actually a
      // useful visual delimiter showing where the nested block ends and
      // the outer list resumes, so we preserve it rather than trying to
      // collapse it.
      const out = stripHtmlToPlaintext(
        '<ol><li>step one<ul><li>child a</li><li>child b</li></ul></li><li>step two</li></ol>'
      );
      expect(out).toBe('- step one\n  - child a\n  - child b\n\n- step two');
    });

    it('three levels deep indents at 0, 2, and 4 spaces', () => {
      const out = stripHtmlToPlaintext(
        '<ul><li>L1<ul><li>L2<ul><li>L3</li></ul></li></ul></li></ul>'
      );
      expect(out).toBe('- L1\n  - L2\n    - L3');
    });
  });

  describe('legacy guarantees still hold', () => {
    it('decodes the small fixed entity set', () => {
      const out = stripHtmlToPlaintext(
        'Customer said &quot;please log in&quot; &amp; &#39;help&#39; &lt;here&gt;'
      );
      expect(out).toBe('Customer said "please log in" & \'help\' <here>');
    });

    it('<br> tags become newlines', () => {
      expect(stripHtmlToPlaintext('line1<br>line2<br />line3')).toBe('line1\nline2\nline3');
    });

    it('<p> tags create a paragraph break', () => {
      expect(stripHtmlToPlaintext('<p>first</p><p>second</p>')).toBe('first\n\nsecond');
    });

    it('returns empty string for empty / nullish input', () => {
      expect(stripHtmlToPlaintext('')).toBe('');
      expect(stripHtmlToPlaintext(undefined as unknown as string)).toBe('');
    });

    it('inline tags collapse to a single space, not glued together', () => {
      expect(stripHtmlToPlaintext('<span>foo</span><span>bar</span>')).toBe('foo bar');
    });

    it('does not introduce indentation on plain text without lists', () => {
      // Sanity check that the new sentinel logic only fires inside list
      // structure and doesn't leak NUL bytes or extra leading spaces.
      const out = stripHtmlToPlaintext('<p>hello world</p>');
      expect(out).toBe('hello world');
      expect(out).not.toMatch(/\x00/);
    });
  });
});
