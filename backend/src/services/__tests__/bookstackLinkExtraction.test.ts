/**
 * Lock-in tests for the in-KB link extractor used by the AI Reviewer's
 * KB link-expansion layer. The extractor reads `<a href>` URLs out of
 * BookStack page HTML so we can follow back-links from leaf pages up
 * to their parent decision-flow guides (e.g. "SXBR2/SXBR3 Troubleshoot
 * - Not Connected to the Internet" → "SXBR2/SXBR3 Troubleshoot").
 *
 * These tests run without DB / network — pure regex behavior.
 */

import { describe, it, expect } from 'vitest';
import { __test_only__ } from '../BookStackService';

const { extractInKbLinksFromHtml } = __test_only__;

describe('BookStackService — in-KB link extractor', () => {
  it('returns the page URLs from <a href> anchors that point at /books/<book>/page/<slug>', () => {
    const html = `
      <p>If the device is online, see
        <a href="http://know.crm.dm-us.com/books/job-tech-support/page/sxbr-troubleshoot">SXBR Troubleshoot</a>.
      </p>
      <p>Otherwise, refer to
        <a href="http://know.crm.dm-us.com/books/job-tech-support/page/sxbr-not-connected">Not Connected guide</a>.
      </p>
    `;
    const links = extractInKbLinksFromHtml(html);
    expect(links).toContain('http://know.crm.dm-us.com/books/job-tech-support/page/sxbr-troubleshoot');
    expect(links).toContain('http://know.crm.dm-us.com/books/job-tech-support/page/sxbr-not-connected');
    expect(links).toHaveLength(2);
  });

  it('dedupes the same URL appearing multiple times in one page', () => {
    const html = `
      <a href="http://know.crm.dm-us.com/books/sat/page/foo">first</a>
      <a href="http://know.crm.dm-us.com/books/sat/page/foo">second</a>
      <a href="http://know.crm.dm-us.com/books/sat/page/foo#section">third (with fragment)</a>
    `;
    const links = extractInKbLinksFromHtml(html);
    expect(links).toEqual(['http://know.crm.dm-us.com/books/sat/page/foo']);
  });

  it('preserves document order so back-links at the top of a page get processed first', () => {
    const html = `
      <p><a href="http://know.crm.dm-us.com/books/sat/page/parent">Return to parent</a></p>
      <ol>
        <li><a href="http://know.crm.dm-us.com/books/sat/page/step-a">Step A</a></li>
        <li><a href="http://know.crm.dm-us.com/books/sat/page/step-b">Step B</a></li>
      </ol>
    `;
    const links = extractInKbLinksFromHtml(html);
    expect(links).toEqual([
      'http://know.crm.dm-us.com/books/sat/page/parent',
      'http://know.crm.dm-us.com/books/sat/page/step-a',
      'http://know.crm.dm-us.com/books/sat/page/step-b',
    ]);
  });

  it('rejects non-page anchors: external sites, image/file attachments, fragment-only links', () => {
    const html = `
      <a href="https://example.com/some/thing">external</a>
      <a href="#section-2">in-page anchor</a>
      <a href="http://know.crm.dm-us.com/uploads/images/foo.png">image</a>
      <a href="http://know.crm.dm-us.com/books/sat">a book, not a page</a>
      <a href="http://know.crm.dm-us.com/books/sat/page/legit">legit page</a>
    `;
    const links = extractInKbLinksFromHtml(html);
    expect(links).toEqual(['http://know.crm.dm-us.com/books/sat/page/legit']);
  });

  it('handles single-quoted hrefs alongside double-quoted ones', () => {
    const html = `
      <a href='http://know.crm.dm-us.com/books/sat/page/single-quoted'>single</a>
      <a href="http://know.crm.dm-us.com/books/sat/page/double-quoted">double</a>
    `;
    const links = extractInKbLinksFromHtml(html);
    expect(links).toEqual([
      'http://know.crm.dm-us.com/books/sat/page/single-quoted',
      'http://know.crm.dm-us.com/books/sat/page/double-quoted',
    ]);
  });

  it('returns an empty list on empty / non-HTML input', () => {
    expect(extractInKbLinksFromHtml('')).toEqual([]);
    expect(extractInKbLinksFromHtml('plain text with no html')).toEqual([]);
  });
});
