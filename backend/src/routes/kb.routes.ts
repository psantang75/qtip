import express, { Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import bookstackService, { type PageFormat } from '../services/BookStackService';
import logger from '../config/logger';

/**
 * BookStack KB lookup routes — read-only proxy in front of the internal
 * BookStack v26.03.x server. The qtip backend already holds the API
 * token, so callers (chat sessions, future review UI) hit qtip's own
 * auth boundary instead of needing direct BookStack credentials.
 *
 * Mirrors the structural pattern of `crm.routes.ts` (auth required,
 * inline handlers, defensive validation, consistent error shape) — no
 * write endpoints because qtip never modifies KB content.
 *
 * Health probe is intentionally placed under this route file rather
 * than in `monitoring.routes.ts` to follow the same pattern as
 * `phoneSystem.routes.ts` (each integration owns its own /health).
 */
const router = express.Router();

router.use(authenticate);

function parseId(raw: string): number | null {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

function parseFormat(raw: unknown): PageFormat {
  if (raw === 'html' || raw === 'markdown' || raw === 'plaintext') return raw;
  return 'plaintext';
}

router.get('/health', async (_req: Request, res: Response) => {
  try {
    if (!bookstackService.isConfigured()) {
      return res.status(503).json({
        status: 'not_configured',
        message: 'Set BOOKSTACK_BASE_URL, BOOKSTACK_TOKEN_ID, BOOKSTACK_TOKEN_SECRET in backend/.env.',
      });
    }
    const ping = await bookstackService.pingBookStack({ liveCheck: true });
    res.status(ping.ok ? 200 : 503).json({
      status: ping.ok ? 'ok' : 'unhealthy',
      baseUrl: ping.baseUrl,
      error: ping.error,
    });
  } catch (error) {
    logger.error('[KB ROUTE] health check failed', { error: (error as Error).message });
    res.status(500).json({ status: 'error', error: 'Health check failed' });
  }
});

router.get('/shelves', async (_req: Request, res: Response) => {
  try {
    const shelves = await bookstackService.listShelves();
    res.json(shelves);
  } catch (error) {
    logger.error('[KB ROUTE] list shelves failed', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to list shelves' });
  }
});

router.get('/books', async (req: Request, res: Response) => {
  try {
    let shelfId: number | undefined;
    if (typeof req.query.shelfId === 'string' && req.query.shelfId.length > 0) {
      const parsed = parseId(req.query.shelfId);
      if (parsed === null) {
        return res.status(400).json({ error: 'Invalid shelfId; must be a positive integer.' });
      }
      shelfId = parsed;
    }
    const books = await bookstackService.listBooks(shelfId);
    res.json(books);
  } catch (error) {
    logger.error('[KB ROUTE] list books failed', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to list books' });
  }
});

router.get('/chapters', async (req: Request, res: Response) => {
  try {
    let bookId: number | undefined;
    if (typeof req.query.bookId === 'string' && req.query.bookId.length > 0) {
      const parsed = parseId(req.query.bookId);
      if (parsed === null) {
        return res.status(400).json({ error: 'Invalid bookId; must be a positive integer.' });
      }
      bookId = parsed;
    }
    const chapters = await bookstackService.listChapters(bookId);
    res.json(chapters);
  } catch (error) {
    logger.error('[KB ROUTE] list chapters failed', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to list chapters' });
  }
});

router.get('/pages', async (req: Request, res: Response) => {
  try {
    const opts: { bookId?: number; chapterId?: number } = {};
    if (typeof req.query.bookId === 'string' && req.query.bookId.length > 0) {
      const parsed = parseId(req.query.bookId);
      if (parsed === null) {
        return res.status(400).json({ error: 'Invalid bookId; must be a positive integer.' });
      }
      opts.bookId = parsed;
    }
    if (typeof req.query.chapterId === 'string' && req.query.chapterId.length > 0) {
      const parsed = parseId(req.query.chapterId);
      if (parsed === null) {
        return res.status(400).json({ error: 'Invalid chapterId; must be a positive integer.' });
      }
      opts.chapterId = parsed;
    }
    const pages = await bookstackService.listPages(opts);
    res.json(pages);
  } catch (error) {
    logger.error('[KB ROUTE] list pages failed', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to list pages' });
  }
});

router.get('/pages/:id', async (req: Request, res: Response) => {
  try {
    const id = parseId(req.params.id);
    if (id === null) {
      return res.status(400).json({ error: 'Invalid page id; must be a positive integer.' });
    }
    const format = parseFormat(req.query.format);
    const content = await bookstackService.getPageContent(id, format);
    res.json({ id, format, content });
  } catch (error) {
    logger.error('[KB ROUTE] get page content failed', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to fetch page content' });
  }
});

router.get('/search', async (req: Request, res: Response) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (q.length === 0) {
      return res.status(400).json({ error: 'Query string `q` is required.' });
    }
    let count = 10;
    if (typeof req.query.count === 'string' && req.query.count.length > 0) {
      const n = Number(req.query.count);
      if (!Number.isInteger(n) || n < 1 || n > 100) {
        return res.status(400).json({ error: 'count must be an integer between 1 and 100.' });
      }
      count = n;
    }
    const hits = await bookstackService.searchByText(q, { count });
    res.json(hits);
  } catch (error) {
    logger.error('[KB ROUTE] search failed', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to search BookStack' });
  }
});

export default router;
