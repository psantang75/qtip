import { Request, Response } from 'express';
import { z } from 'zod';
import pool from '../config/database';
import { RowDataPacket, ResultSetHeader } from 'mysql2';

const VALID_DATA_SCOPES = ['ALL', 'DIVISION', 'DEPARTMENT', 'SELF'] as const;

const pageAccessRoleSchema = z.object({
  role_id: z.number().int().positive(),
  can_access: z.boolean(),
  data_scope: z.enum(VALID_DATA_SCOPES).default('SELF'),
});

const updatePageAccessBodySchema = z.object({
  roles: z.array(pageAccessRoleSchema).min(1),
});

const createOverrideSchema = z.object({
  user_id: z.number().int().positive(),
  can_access: z.boolean(),
  data_scope: z.enum(VALID_DATA_SCOPES).nullish(),
  expires_at: z.string().nullish(),
  reason: z.string().nullish(),
});

/**
 * GET /api/insights/admin/pages
 */
export const listPages = async (_req: Request, res: Response): Promise<void> => {
  try {
    const [pages] = await pool.execute<RowDataPacket[]>(
      'SELECT * FROM ie_page ORDER BY category, sort_order'
    );

    const [access] = await pool.execute<RowDataPacket[]>(
      `SELECT a.*, r.role_name FROM ie_page_role_access a JOIN roles r ON a.role_id = r.id ORDER BY a.page_id, r.id`
    );

    const accessByPage = new Map<number, RowDataPacket[]>();
    for (const row of access) {
      if (!accessByPage.has(row.page_id)) accessByPage.set(row.page_id, []);
      accessByPage.get(row.page_id)!.push(row);
    }

    const result = pages.map((p) => ({
      ...p,
      role_access: accessByPage.get(p.id) ?? [],
    }));

    res.json(result);
  } catch (error) {
    console.error('listPages error:', error);
    res.status(500).json({ error: 'Failed to list pages' });
  }
};

/**
 * PUT /api/insights/admin/pages/:id/access
 * Body: { roles: [{ role_id, can_access, data_scope }] }
 */
export const updatePageAccess = async (req: Request, res: Response): Promise<void> => {
  try {
    const pageId = parseInt(req.params.id);
    if (isNaN(pageId)) { res.status(400).json({ error: 'Invalid page id' }); return; }

    const parsed = updatePageAccessBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation error', details: parsed.error.errors.map(e => ({ path: e.path.join('.'), message: e.message })) });
      return;
    }

    const { roles } = parsed.data;

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.execute('DELETE FROM ie_page_role_access WHERE page_id = ?', [pageId]);

      for (const r of roles) {
        await conn.execute(
          'INSERT INTO ie_page_role_access (page_id, role_id, can_access, data_scope) VALUES (?, ?, ?, ?)',
          [pageId, r.role_id, r.can_access ? 1 : 0, r.data_scope]
        );
      }
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }

    res.json({ success: true });
  } catch (error) {
    console.error('updatePageAccess error:', error);
    res.status(500).json({ error: 'Failed to update page access' });
  }
};

/**
 * GET /api/insights/admin/pages/:id/overrides
 */
export const listOverrides = async (req: Request, res: Response): Promise<void> => {
  try {
    const pageId = parseInt(req.params.id);
    if (isNaN(pageId)) { res.status(400).json({ error: 'Invalid page id' }); return; }

    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT o.*, u.username as user_name, g.username as granter_name
       FROM ie_page_user_override o
       JOIN users u ON o.user_id = u.id
       JOIN users g ON o.granted_by = g.id
       WHERE o.page_id = ?
       ORDER BY o.granted_at DESC`,
      [pageId]
    );
    res.json(rows);
  } catch (error) {
    console.error('listOverrides error:', error);
    res.status(500).json({ error: 'Failed to list overrides' });
  }
};

/**
 * POST /api/insights/admin/pages/:id/overrides
 */
export const createOverride = async (req: Request, res: Response): Promise<void> => {
  try {
    const pageId = parseInt(req.params.id);
    if (isNaN(pageId)) { res.status(400).json({ error: 'Invalid page id' }); return; }

    const parsed = createOverrideSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation error', details: parsed.error.errors.map(e => ({ path: e.path.join('.'), message: e.message })) });
      return;
    }

    const d = parsed.data;
    const [result] = await pool.execute<ResultSetHeader>(
      `INSERT INTO ie_page_user_override (page_id, user_id, can_access, data_scope, granted_by, expires_at, reason)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE can_access = VALUES(can_access), data_scope = VALUES(data_scope),
         granted_by = VALUES(granted_by), granted_at = NOW(), expires_at = VALUES(expires_at), reason = VALUES(reason)`,
      [pageId, d.user_id, d.can_access ? 1 : 0, d.data_scope ?? null, req.user?.user_id, d.expires_at ?? null, d.reason ?? null]
    );

    res.status(201).json({ id: result.insertId, page_id: pageId, user_id: d.user_id, can_access: d.can_access, data_scope: d.data_scope });
  } catch (error) {
    console.error('createOverride error:', error);
    res.status(500).json({ error: 'Failed to create override' });
  }
};

/**
 * DELETE /api/insights/admin/pages/:id/overrides/:overrideId
 */
export const deleteOverride = async (req: Request, res: Response): Promise<void> => {
  try {
    const overrideId = parseInt(req.params.overrideId);
    if (isNaN(overrideId)) { res.status(400).json({ error: 'Invalid override id' }); return; }

    const [result] = await pool.execute<ResultSetHeader>(
      'DELETE FROM ie_page_user_override WHERE id = ?', [overrideId]
    );

    if (result.affectedRows === 0) { res.status(404).json({ error: 'Override not found' }); return; }
    res.json({ success: true });
  } catch (error) {
    console.error('deleteOverride error:', error);
    res.status(500).json({ error: 'Failed to delete override' });
  }
};
