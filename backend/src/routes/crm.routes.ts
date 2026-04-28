import express, { Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import crmService from '../services/CRMService';
import logger from '../config/logger';

/**
 * CRM lookup routes — read-only access to the external CRM database
 * (`dmcms_prod`) for the Ticket/Task Details audit-form section.
 *
 * Q-Tip persists only the *reference* (which ticket/task is linked to a
 * submission) — these endpoints supply the live header + notes payload
 * every time the section is rendered. Mirrors the structural pattern of
 * `calls.routes.ts` (auth required, JSON in/out, defensive validation).
 */
const router = express.Router();

router.use(authenticate);

function parseId(raw: string): number | null {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

function parseAuditAt(raw: unknown): Date | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}

router.get('/task/:id', async (req: Request, res: Response) => {
  try {
    const id = parseId(req.params.id);
    if (id === null) {
      return res.status(400).json({ error: 'Invalid task id; must be a positive integer.' });
    }
    const header = await crmService.getTaskHeader(id);
    if (!header) return res.status(404).json({ error: 'Task not found' });
    res.json(header);
  } catch (error) {
    logger.error('[CRM ROUTE] task header failed', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to fetch task' });
  }
});

router.get('/task/:id/notes', async (req: Request, res: Response) => {
  try {
    const id = parseId(req.params.id);
    if (id === null) {
      return res.status(400).json({ error: 'Invalid task id; must be a positive integer.' });
    }
    const auditAt = parseAuditAt(req.query.auditAt);
    const notes = await crmService.getTaskNotes(id, auditAt);
    res.json(notes);
  } catch (error) {
    logger.error('[CRM ROUTE] task notes failed', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to fetch task notes' });
  }
});

router.get('/ticket/:id', async (req: Request, res: Response) => {
  try {
    const id = parseId(req.params.id);
    if (id === null) {
      return res.status(400).json({ error: 'Invalid ticket id; must be a positive integer.' });
    }
    const header = await crmService.getTicketHeader(id);
    if (!header) return res.status(404).json({ error: 'Ticket not found' });
    res.json(header);
  } catch (error) {
    logger.error('[CRM ROUTE] ticket header failed', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to fetch ticket' });
  }
});

router.get('/ticket/:id/notes', async (req: Request, res: Response) => {
  try {
    const id = parseId(req.params.id);
    if (id === null) {
      return res.status(400).json({ error: 'Invalid ticket id; must be a positive integer.' });
    }
    const auditAt = parseAuditAt(req.query.auditAt);
    const notes = await crmService.getTicketNotes(id, auditAt);
    res.json(notes);
  } catch (error) {
    logger.error('[CRM ROUTE] ticket notes failed', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to fetch ticket notes' });
  }
});

export default router;
