import { bookstackConfig } from '../config/environment';
import logger from '../config/logger';
import { stripHtmlToPlaintext } from '../utils/htmlText';

/**
 * BookStack KB service for read-only access to the internal knowledge base
 * (BookStack v26.03.x at `BOOKSTACK_BASE_URL`). Mirrors the structural
 * pattern of `CRMService.ts` / the AI client modules: a singleton class with
 * narrow, typed methods and a `pingBookStack()` health probe.
 *
 * Q-Tip never writes to BookStack. The service-account user behind the API
 * token only needs the "Access system API" role permission and View access
 * on the shelves we want to surface (Ops, Billing/CS, Tech Support, etc.).
 *
 * All methods short-circuit to a clear error when the integration is not
 * configured (token halves missing in `.env`), so a half-set environment
 * never produces a half-working caller.
 *
 * Implementation notes:
 *   - Uses Node's built-in `fetch` (Node 22+) — no new dependency.
 *   - Auth header format is BookStack's documented
 *       `Authorization: Token <id>:<secret>`
 *     (NOT a Bearer token).
 *   - BookStack's list endpoints return `{ data: [...], total: N }`. We
 *     unwrap to the inner array but expose `total` via a separate helper
 *     when callers need pagination.
 */

export interface KBShelf {
  id: number;
  name: string;
  slug: string;
  description?: string;
}

export interface KBBook {
  id: number;
  name: string;
  slug: string;
  description?: string;
}

export interface KBChapter {
  id: number;
  book_id: number;
  name: string;
  slug: string;
  description?: string;
}

export interface KBPage {
  id: number;
  book_id: number;
  chapter_id: number;
  name: string;
  slug: string;
  draft?: boolean;
  template?: boolean;
}

export interface KBSearchHit {
  id: number;
  name: string;
  slug: string;
  type: 'page' | 'chapter' | 'book' | 'bookshelf' | string;
  url: string;
  preview_html?: { name?: string; content?: string };
}

export type PageFormat = 'html' | 'markdown' | 'plaintext';

export interface PingResult {
  ok: boolean;
  baseUrl?: string;
  error?: string;
}

class BookStackService {
  private get cfg() {
    if (!bookstackConfig) {
      throw new Error(
        'BookStack is not configured (set BOOKSTACK_BASE_URL, BOOKSTACK_TOKEN_ID, BOOKSTACK_TOKEN_SECRET).'
      );
    }
    return bookstackConfig;
  }

  isConfigured(): boolean {
    return bookstackConfig !== null;
  }

  /**
   * Internal request helper. Adds the `Authorization: Token <id>:<secret>`
   * header, applies the configured timeout via `AbortController`, and
   * surfaces non-2xx responses as thrown errors so callers can `try/catch`
   * uniformly. Light retry on transient (5xx / network) failures only —
   * never on 4xx because those are configuration / permission problems
   * that won't fix themselves.
   */
  private async request<T>(path: string, query?: Record<string, string | number | undefined>): Promise<T> {
    const cfg = this.cfg;
    const url = new URL(`${cfg.baseUrl}${path}`);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
      }
    }

    const headers = {
      Authorization: `Token ${cfg.tokenId}:${cfg.tokenSecret}`,
      Accept: 'application/json',
    };

    let attempt = 0;
    const maxAttempts = cfg.maxRetries + 1;
    let lastError: Error | null = null;

    while (attempt < maxAttempts) {
      attempt++;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
      try {
        const res = await fetch(url.toString(), { headers, signal: controller.signal });
        clearTimeout(timer);

        if (!res.ok) {
          const bodySnippet = (await res.text()).slice(0, 500);
          const err = new Error(`BookStack ${res.status} ${res.statusText} on ${path} :: ${bodySnippet}`);
          // Retry only 5xx; bail immediately on 4xx (auth / permission / not-found).
          if (res.status >= 500 && attempt < maxAttempts) {
            lastError = err;
            continue;
          }
          throw err;
        }

        return (await res.json()) as T;
      } catch (err) {
        clearTimeout(timer);
        const error = err instanceof Error ? err : new Error('unknown');
        // AbortError or network blip — retry up to maxAttempts.
        if (attempt < maxAttempts && (error.name === 'AbortError' || (error as any).code === 'ECONNRESET')) {
          lastError = error;
          continue;
        }
        throw error;
      }
    }

    throw lastError ?? new Error(`BookStack request failed after ${maxAttempts} attempts: ${path}`);
  }

  /** List all shelves visible to the API token. */
  async listShelves(): Promise<KBShelf[]> {
    const r = await this.request<{ data: KBShelf[] }>('/api/shelves');
    return r.data ?? [];
  }

  /**
   * List books. When `shelfId` is provided, returns only the books that
   * belong to that shelf (BookStack exposes the membership via
   * `/api/shelves/{id}` rather than as a `?filter` on `/api/books`).
   */
  async listBooks(shelfId?: number): Promise<KBBook[]> {
    if (shelfId !== undefined) {
      const r = await this.request<{ books?: KBBook[] }>(`/api/shelves/${shelfId}`);
      return r.books ?? [];
    }
    const r = await this.request<{ data: KBBook[] }>('/api/books');
    return r.data ?? [];
  }

  /** List chapters, optionally narrowed to a single book. */
  async listChapters(bookId?: number): Promise<KBChapter[]> {
    const query: Record<string, string | number> = {};
    if (bookId !== undefined) query['filter[book_id]'] = bookId;
    const r = await this.request<{ data: KBChapter[] }>('/api/chapters', query);
    return r.data ?? [];
  }

  /**
   * List pages, optionally narrowed to a single book and/or chapter and/or
   * slug. count/offset support is for callers that need to paginate the
   * full corpus (e.g. KbIndexService crawl) — BookStack defaults to 50.
   */
  async listPages(opts: { bookId?: number; chapterId?: number; slug?: string; count?: number; offset?: number } = {}): Promise<KBPage[]> {
    const query: Record<string, string | number> = {};
    if (opts.bookId !== undefined) query['filter[book_id]'] = opts.bookId;
    if (opts.chapterId !== undefined) query['filter[chapter_id]'] = opts.chapterId;
    if (opts.slug !== undefined) query['filter[slug]'] = opts.slug;
    if (opts.count !== undefined) query['count'] = opts.count;
    if (opts.offset !== undefined) query['offset'] = opts.offset;
    const r = await this.request<{ data: KBPage[] }>('/api/pages', query);
    return r.data ?? [];
  }

  /**
   * Fetch the full content of a page in the requested format. `plaintext`
   * is the cheapest option for feeding into an LLM (no HTML noise) and is
   * the default for that reason. BookStack returns all three fields on
   * `GET /api/pages/{id}` so we just pick the requested one.
   */
  async getPageContent(pageId: number, format: PageFormat = 'plaintext'): Promise<string> {
    const r = await this.request<{
      html?: string;
      markdown?: string;
      raw_html?: string;
    } & Record<string, unknown>>(`/api/pages/${pageId}`);

    if (format === 'html') return r.html ?? r.raw_html ?? '';
    if (format === 'markdown') return r.markdown ?? '';
    // plaintext: BookStack v26 doesn't ship a dedicated plaintext field, so
    // we strip tags from the HTML. Cheap, deterministic, no extra dep.
    const html = r.html ?? r.raw_html ?? '';
    return stripHtmlToPlaintext(html);
  }

  /**
   * Fetch a page once and return BOTH its plaintext (for LLM context) and
   * the list of in-KB hyperlinks found in its HTML. The AI Reviewer
   * uses this for the link-expansion KB layer: a leaf troubleshoot page
   * (e.g. "Not Connected to the Internet") often back-links to its
   * parent decision-flow page (e.g. "SXBR2/SXBR3 Troubleshoot") which
   * documents the email-vs-phone branching the leaf doesn't cover.
   * Stripping HTML to plaintext loses the `<a href>` URLs, so we have
   * to read them off the HTML before stripping. Single API call;
   * deterministic.
   */
  async getPageContentWithLinks(
    pageId: number
  ): Promise<{ plaintext: string; links: string[] }> {
    const r = await this.request<{
      html?: string;
      raw_html?: string;
    } & Record<string, unknown>>(`/api/pages/${pageId}`);
    const html = r.html ?? r.raw_html ?? '';
    return {
      plaintext: stripHtmlToPlaintext(html),
      links: extractInKbLinksFromHtml(html),
    };
  }

  /**
   * Resolve a BookStack page URL (the kind stored in tblPlayBookLink.LinkURL,
   * e.g. `http://know.crm.dm-us.com/books/job-tech-support/page/sxbr2-...`)
   * into the underlying page record. Strategy:
   *   1. Extract the page slug from the URL.
   *   2. Look it up via /api/pages?filter[slug]=<slug>. Page slugs are
   *      unique within a book; if multiple books share a slug we narrow
   *      by the book slug from the URL.
   *   3. Fall back to BookStack full-text search — handles renamed
   *      pages whose slug changed.
   * Returns null when nothing matches (URL malformed, page deleted, etc.).
   */
  async getPageByUrl(
    url: string
  ): Promise<{ id: number; name: string; slug: string; url: string } | null> {
    if (!url) return null;
    const m = url.match(/\/books\/([A-Za-z0-9_-]+)\/page\/([A-Za-z0-9_-]+)\/?$/);
    if (!m) return null;
    const bookSlug = m[1];
    const pageSlug = m[2];

    try {
      const pages = await this.listPages({ slug: pageSlug });
      if (pages.length === 1) {
        const p = pages[0];
        return { id: p.id, name: p.name, slug: p.slug, url };
      }
      if (pages.length > 1) {
        // Narrow by book slug to disambiguate cross-book duplicates.
        const books = await this.listBooks();
        const book = books.find((b) => b.slug === bookSlug);
        if (book) {
          const p = pages.find((pg) => pg.book_id === book.id);
          if (p) return { id: p.id, name: p.name, slug: p.slug, url };
        }
      }
    } catch (err) {
      logger.warn(`[bookstack] getPageByUrl slug lookup failed for "${pageSlug}": ${(err as Error).message}`);
    }

    try {
      const hits = await this.searchByText(pageSlug, { count: 10 });
      const exact = hits.find((h) => h.type === 'page' && (h.url === url || h.slug === pageSlug));
      if (exact) return { id: exact.id, name: exact.name, slug: exact.slug, url: exact.url };
    } catch (err) {
      logger.warn(`[bookstack] getPageByUrl search fallback failed for "${pageSlug}": ${(err as Error).message}`);
    }

    return null;
  }

  /**
   * BookStack-native search. Pass the raw query string the way you would
   * type it in the BookStack UI — supports `{type:page}`, `{tag:foo}`,
   * `{updated_after:2024-01-01}`, etc.
   */
  async searchByText(query: string, opts: { count?: number; page?: number } = {}): Promise<KBSearchHit[]> {
    const r = await this.request<{ data: KBSearchHit[] }>('/api/search', {
      query,
      count: opts.count ?? 10,
      page: opts.page,
    });
    return r.data ?? [];
  }

  /**
   * Health probe. Default check only validates that the env vars are set
   * (cheap, no token spend). Pass `{ liveCheck: true }` to make a real
   * round-trip via `/api/docs.json`, which is the lightest authenticated
   * endpoint BookStack exposes.
   */
  async pingBookStack(opts: { liveCheck?: boolean } = {}): Promise<PingResult> {
    if (!bookstackConfig) return { ok: false, error: 'not_configured' };
    if (!opts.liveCheck) return { ok: true, baseUrl: bookstackConfig.baseUrl };

    try {
      await this.request<unknown>('/api/docs.json');
      return { ok: true, baseUrl: bookstackConfig.baseUrl };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown';
      logger.warn('[bookstack] live ping failed:', message);
      return { ok: false, baseUrl: bookstackConfig.baseUrl, error: message };
    }
  }
}

export const bookstackService = new BookStackService();
export default bookstackService;

// HTML → plaintext now lives in `utils/htmlText.ts` — same implementation, shared
// across CRM ticket descriptions / notes and BookStack KB bodies so HTML entities
// (`&quot;`, `&amp;`, etc.) decode consistently before reaching the AI prompt.

/**
 * Pull every BookStack page URL referenced from `<a href="...">`
 * anchors in a KB page's HTML body. Used by the AI Reviewer's KB
 * link-expansion layer to follow back-links and "see also" pointers
 * into parent / sibling pages.
 *
 * Filters strictly to URLs that look like BookStack pages on this
 * deployment's host. Returns deduped, in-document order so the BFS
 * processes top-of-page back-links (typically the "Return to ..."
 * pointers) before in-body cross-references.
 */
function extractInKbLinksFromHtml(html: string): string[] {
  if (!html) return [];
  const baseUrl = bookstackConfig?.baseUrl ?? '';
  const host = (() => {
    try {
      return baseUrl ? new URL(baseUrl).host : null;
    } catch {
      return null;
    }
  })();

  const out: string[] = [];
  const seen = new Set<string>();
  // Match href values on <a> tags. BookStack-rendered HTML uses double
  // quotes; we permit single quotes too for safety. The URL-shape
  // gate (must end in /books/<book>/page/<slug>) keeps anchor links
  // (#section), image attachments, and external sites out of scope.
  const re = /<a\b[^>]*?href\s*=\s*['"]([^'"]+)['"][^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const raw = (m[1] ?? '').trim();
    if (!raw) continue;
    if (!/\/books\/[A-Za-z0-9_-]+\/page\/[A-Za-z0-9_-]+\/?(?:[?#].*)?$/.test(raw)) continue;
    let absolute: string | null = null;
    try {
      absolute = baseUrl ? new URL(raw, baseUrl).toString() : raw;
    } catch {
      continue;
    }
    if (!absolute) continue;
    if (host) {
      try {
        const u = new URL(absolute);
        if (u.host !== host) continue;
      } catch {
        continue;
      }
    }
    // Drop fragment + query so dedup matches the canonical page URL.
    try {
      const u = new URL(absolute);
      u.hash = '';
      u.search = '';
      absolute = u.toString().replace(/\/$/, '');
    } catch {
      // keep as-is if URL constructor rejects it
    }
    if (!seen.has(absolute)) {
      seen.add(absolute);
      out.push(absolute);
    }
  }
  return out;
}

// Exported for unit tests so we can lock in the link extractor's
// behavior on real BookStack HTML fixtures.
export const __test_only__ = { stripHtmlToPlaintext, extractInKbLinksFromHtml };
