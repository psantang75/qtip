/**
 * KB grounding builder tests. The one non-negotiable behavior: grounding is
 * OPTIONAL. An unconfigured KB, an empty anchor list, or a page that fails to
 * resolve must degrade to '' rather than throw — the nightly run must never fail
 * because the KB was down.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { isConfigured, getPageByUrl, getPageContent } = vi.hoisted(() => ({
  isConfigured: vi.fn(),
  getPageByUrl: vi.fn(),
  getPageContent: vi.fn(),
}));

vi.mock('../../../BookStackService', () => ({
  default: { isConfigured, getPageByUrl, getPageContent },
}));

import { buildGroundingBlock } from '../grounding';

beforeEach(() => {
  vi.clearAllMocks();
  isConfigured.mockReturnValue(true);
});

const URL_A = 'http://kb/books/job-account-executive/page/how-to-arp';
const URL_B = 'http://kb/books/job-account-executive/page/sales-closing-tips';

describe('buildGroundingBlock', () => {
  it('returns empty when the KB is not configured, without touching it', async () => {
    isConfigured.mockReturnValue(false);
    expect(await buildGroundingBlock([URL_A])).toBe('');
    expect(getPageByUrl).not.toHaveBeenCalled();
  });

  it('returns empty when no anchors are configured', async () => {
    expect(await buildGroundingBlock([])).toBe('');
    expect(getPageByUrl).not.toHaveBeenCalled();
  });

  it('renders each resolved page as a titled snippet', async () => {
    getPageByUrl.mockImplementation(async (url: string) =>
      url === URL_A
        ? { id: 1, name: 'How to ARP', slug: 'how-to-arp', url }
        : { id: 2, name: 'Sales Closing Tips', slug: 'sales-closing-tips', url },
    );
    getPageContent.mockImplementation(async (id: number) =>
      id === 1 ? 'Acknowledge, Reframe, Present.' : 'Ask for the order.',
    );

    const block = await buildGroundingBlock([URL_A, URL_B]);
    expect(block).toContain('# How to ARP');
    expect(block).toContain('Acknowledge, Reframe, Present.');
    expect(block).toContain('# Sales Closing Tips');
    expect(block).toContain('Ask for the order.');
  });

  it('skips a page that will not resolve or that throws, keeping the good ones', async () => {
    getPageByUrl.mockImplementation(async (url: string) => {
      if (url === URL_A) return null; // unresolved
      if (url === URL_B) return { id: 2, name: 'Sales Closing Tips', slug: 's', url };
      throw new Error('boom');
    });
    getPageContent.mockResolvedValue('Ask for the order.');

    const block = await buildGroundingBlock([URL_A, URL_B, 'http://kb/books/x/page/z']);
    expect(block).toContain('# Sales Closing Tips');
    expect(block).not.toContain('# How to ARP');
  });

  it('returns empty (never throws) when every page fails', async () => {
    getPageByUrl.mockRejectedValue(new Error('kb down'));
    expect(await buildGroundingBlock([URL_A, URL_B])).toBe('');
  });

  it('retains late policy exceptions on the configured sales pages', async () => {
    getPageByUrl.mockResolvedValue({ id: 1, name: 'Policy' });
    getPageContent.mockResolvedValue('x'.repeat(10000) + '\nEXCEPTION: customer requested a later callback.');
    const block = await buildGroundingBlock([URL_A]);
    expect(block).toContain(`Source: ${URL_A}`);
    expect(block).toContain('EXCEPTION: customer requested a later callback.');
    expect(block).not.toContain('TRUNCATED');
  });

  it('labels partial page content and unavailable sources so absence cannot imply policy', async () => {
    getPageByUrl.mockImplementation(async (url) => url === URL_A ? { id: 1, name: 'Policy' } : null);
    getPageContent.mockResolvedValue('x'.repeat(15000));
    const block = await buildGroundingBlock([URL_A, URL_B]);
    expect(block).toContain('PAGE TRUNCATED');
    expect(block).toContain('KB COVERAGE INCOMPLETE: 1');
  });

  it('bounds the entire prompt block and acknowledges pages omitted by the budget', async () => {
    getPageByUrl.mockResolvedValue({ id: 1, name: 'Policy' });
    getPageContent.mockResolvedValue('x'.repeat(15000));
    const block = await buildGroundingBlock(Array.from({ length: 20 }, (_, i) => `${URL_A}-${i}`));
    expect(block.length).toBeLessThanOrEqual(48000);
    expect(block).toContain('KB COVERAGE INCOMPLETE');
  });
});
