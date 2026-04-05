import { Request, Response } from 'express';
import pool from '../config/database';
import { RowDataPacket, ResultSetHeader } from 'mysql2';

/**
 * GET /api/insights/admin/kpis
 */
export const listKpis = async (_req: Request, res: Response): Promise<void> => {
  try {
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT k.*, 
        (SELECT COUNT(*) FROM ie_kpi_threshold t WHERE t.kpi_id = k.id) as threshold_count
       FROM ie_kpi k ORDER BY k.category, k.sort_order`
    );
    res.json(rows);
  } catch (error) {
    console.error('listKpis error:', error);
    res.status(500).json({ error: 'Failed to list KPIs' });
  }
};

/**
 * POST /api/insights/admin/kpis
 */
export const createKpi = async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      kpi_code, kpi_name, description, category, formula_type, formula,
      source_table, format_type, decimal_places, direction, unit_label,
      is_active, sort_order,
    } = req.body;

    if (!kpi_code || !kpi_name || !category || !formula || !format_type || !direction) {
      res.status(400).json({ error: 'Missing required fields: kpi_code, kpi_name, category, formula, format_type, direction' });
      return;
    }

    const [result] = await pool.execute<ResultSetHeader>(
      `INSERT INTO ie_kpi (kpi_code, kpi_name, description, category, formula_type, formula,
        source_table, format_type, decimal_places, direction, unit_label, is_active, sort_order, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        kpi_code, kpi_name, description ?? null, category,
        formula_type ?? 'SQL', formula, source_table ?? null,
        format_type, decimal_places ?? 1, direction, unit_label ?? null,
        is_active !== false ? 1 : 0, sort_order ?? 0, req.user?.user_id ?? null,
      ]
    );

    const [newRow] = await pool.execute<RowDataPacket[]>('SELECT * FROM ie_kpi WHERE id = ?', [result.insertId]);
    res.status(201).json(newRow[0]);
  } catch (error: any) {
    if (error.code === 'ER_DUP_ENTRY') {
      res.status(409).json({ error: 'A KPI with this code already exists' });
      return;
    }
    console.error('createKpi error:', error);
    res.status(500).json({ error: 'Failed to create KPI' });
  }
};

/**
 * PUT /api/insights/admin/kpis/:id
 */
export const updateKpi = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid KPI id' }); return; }

    const fields: string[] = [];
    const values: any[] = [];

    const allowedFields = [
      'kpi_code', 'kpi_name', 'description', 'category', 'formula_type', 'formula',
      'source_table', 'format_type', 'decimal_places', 'direction', 'unit_label',
      'is_active', 'sort_order',
    ];

    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        fields.push(`${field} = ?`);
        values.push(field === 'is_active' ? (req.body[field] ? 1 : 0) : req.body[field]);
      }
    }

    if (fields.length === 0) { res.status(400).json({ error: 'No fields to update' }); return; }

    values.push(id);
    await pool.execute(`UPDATE ie_kpi SET ${fields.join(', ')} WHERE id = ?`, values);

    const [updated] = await pool.execute<RowDataPacket[]>('SELECT * FROM ie_kpi WHERE id = ?', [id]);
    if (updated.length === 0) { res.status(404).json({ error: 'KPI not found' }); return; }
    res.json(updated[0]);
  } catch (error) {
    console.error('updateKpi error:', error);
    res.status(500).json({ error: 'Failed to update KPI' });
  }
};

/**
 * GET /api/insights/admin/kpis/:id/thresholds
 */
export const getThresholds = async (req: Request, res: Response): Promise<void> => {
  try {
    const kpiId = parseInt(req.params.id);
    if (isNaN(kpiId)) { res.status(400).json({ error: 'Invalid KPI id' }); return; }

    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT t.*, d.department_name
       FROM ie_kpi_threshold t
       LEFT JOIN ie_dim_department d ON t.department_key = d.department_key AND d.is_current = 1
       WHERE t.kpi_id = ?
       ORDER BY t.effective_from DESC`,
      [kpiId]
    );
    res.json(rows);
  } catch (error) {
    console.error('getThresholds error:', error);
    res.status(500).json({ error: 'Failed to get thresholds' });
  }
};

/**
 * POST /api/insights/admin/kpis/:id/thresholds
 */
export const setThreshold = async (req: Request, res: Response): Promise<void> => {
  try {
    const kpiId = parseInt(req.params.id);
    if (isNaN(kpiId)) { res.status(400).json({ error: 'Invalid KPI id' }); return; }

    const { department_key, goal_value, warning_value, critical_value, effective_from, effective_to } = req.body;

    if (!effective_from) {
      res.status(400).json({ error: 'effective_from is required' });
      return;
    }

    const [result] = await pool.execute<ResultSetHeader>(
      `INSERT INTO ie_kpi_threshold (kpi_id, department_key, goal_value, warning_value, critical_value, effective_from, effective_to)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE goal_value = VALUES(goal_value), warning_value = VALUES(warning_value),
         critical_value = VALUES(critical_value), effective_to = VALUES(effective_to)`,
      [kpiId, department_key ?? null, goal_value ?? null, warning_value ?? null, critical_value ?? null, effective_from, effective_to ?? null]
    );

    const [newRow] = await pool.execute<RowDataPacket[]>('SELECT * FROM ie_kpi_threshold WHERE id = ?', [result.insertId || result.insertId]);
    res.status(201).json(newRow[0] ?? { kpi_id: kpiId, message: 'Threshold upserted' });
  } catch (error) {
    console.error('setThreshold error:', error);
    res.status(500).json({ error: 'Failed to set threshold' });
  }
};

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

    const { roles } = req.body;
    if (!Array.isArray(roles)) { res.status(400).json({ error: 'roles array is required' }); return; }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.execute('DELETE FROM ie_page_role_access WHERE page_id = ?', [pageId]);

      for (const r of roles) {
        await conn.execute(
          'INSERT INTO ie_page_role_access (page_id, role_id, can_access, data_scope) VALUES (?, ?, ?, ?)',
          [pageId, r.role_id, r.can_access ? 1 : 0, r.data_scope ?? 'SELF']
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

    const { user_id, can_access, data_scope, expires_at, reason } = req.body;
    if (user_id == null || can_access == null) {
      res.status(400).json({ error: 'user_id and can_access are required' });
      return;
    }

    const [result] = await pool.execute<ResultSetHeader>(
      `INSERT INTO ie_page_user_override (page_id, user_id, can_access, data_scope, granted_by, expires_at, reason)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE can_access = VALUES(can_access), data_scope = VALUES(data_scope),
         granted_by = VALUES(granted_by), granted_at = NOW(), expires_at = VALUES(expires_at), reason = VALUES(reason)`,
      [pageId, user_id, can_access ? 1 : 0, data_scope ?? null, req.user?.user_id, expires_at ?? null, reason ?? null]
    );

    res.status(201).json({ id: result.insertId, page_id: pageId, user_id, can_access, data_scope });
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

/**
 * GET /api/insights/admin/ingestion-log
 */
export const getIngestionLog = async (req: Request, res: Response): Promise<void> => {
  try {
    const conditions: string[] = ['1=1'];
    const params: any[] = [];

    if (req.query.worker && req.query.worker !== 'all') {
      conditions.push('worker_name = ?');
      params.push(req.query.worker);
    }
    if (req.query.status && req.query.status !== 'all') {
      conditions.push('status = ?');
      params.push(req.query.status);
    }

    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT * FROM ie_ingestion_log WHERE ${conditions.join(' AND ')} ORDER BY run_started_at DESC LIMIT 200`,
      params
    );
    res.json(rows);
  } catch (error) {
    console.error('getIngestionLog error:', error);
    res.status(500).json({ error: 'Failed to load ingestion log' });
  }
};
