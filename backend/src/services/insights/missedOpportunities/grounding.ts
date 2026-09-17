/**
 * KB grounding for Missed Opportunities recommendations (Phase 1).
 *
 * Fetches a small, admin-curated set of BookStack "sales playbook" pages and
 * renders them into one text block the worker injects into the analyzer's system
 * prompt ONCE per run. The point is accuracy: the recommended approach follows
 * the company's own methods (ARP objection handling, one-call closing, the
 * inbound call flow) instead of generic advice — and, with the persona guardrail,
 * never invents free offers.
 *
 * Entirely optional and non-fatal. Returns '' when the KB is not configured
 * (dev/test, or a half-set prod), when no anchors are configured, or when every
 * page fails to resolve — so the review degrades to its pre-grounding behavior
 * rather than erroring. Read-only; QTIP never writes to BookStack.
 */
import bookstackService from '../../BookStackService';
import logger from '../../../config/logger';

/** Per-page and total caps: keep the once-per-run block from bloating the prompt budget. */
const PER_PAGE_CHARS = 12000;
const TOTAL_CHARS = 48000;

/**
 * Build the grounding block from the configured anchor URLs, or '' when grounding
 * is unavailable. Each page contributes its name and a capped plaintext snippet.
 */
export async function buildGroundingBlock(anchorUrls: string[]): Promise<string> {
  if (!anchorUrls?.length || !bookstackService.isConfigured()) return '';

  const sections: string[] = [];
  let total = 0;
  let missing = 0;
  let visited = 0;

  for (const url of anchorUrls) {
    if (total >= TOTAL_CHARS) break;
    visited += 1;
    try {
      const page = await bookstackService.getPageByUrl(url);
      if (!page) {
        logger.warn(`[missed-opps] KB grounding: could not resolve ${url}`);
        missing += 1;
        continue;
      }
      const text = (await bookstackService.getPageContent(page.id, 'plaintext')).trim();
      if (!text) { missing += 1; continue; }
      const header = `# ${page.name}\nSource: ${url}\n`;
      const budget = Math.max(0, Math.min(PER_PAGE_CHARS, TOTAL_CHARS - total - header.length - 400));
      if (!budget) { missing += 1; break; }
      const section = `${header}${text.slice(0, budget)}`
        + (text.length > budget ? '\n[PAGE TRUNCATED: later requirements or exceptions may be missing.]' : '');
      sections.push(section);
      total += section.length + 2;
    } catch (err) {
      logger.warn(`[missed-opps] KB grounding fetch failed for ${url}: ${(err as Error).message}`);
      missing += 1;
    }
  }

  if (sections.length === 0) return '';
  return sections.join('\n\n')
    + (missing || visited < anchorUrls.length
      ? `\n[KB COVERAGE INCOMPLETE: ${missing + anchorUrls.length - visited} configured page(s) unavailable or omitted. Do not infer their requirements.]`
      : '');
}
