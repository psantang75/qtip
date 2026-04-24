import { Request, Response } from 'express';
import { z } from 'zod';
import pool from '../config/database';
import { RowDataPacket, ResultSetHeader } from 'mysql2';
import logger from '../config/logger';

const VALID_DIRECTIONS = ['UP_IS_GOOD', 'DOWN_IS_GOOD', 'NEUTRAL'] as const;
const VALID_FORMAT_TYPES = ['PERCENT', 'NUMBER'] as const;

const createKpiSchema = z.object({
  kpi_code: z.string().min(1),
  kpi_name: z.string().min(1),
  description: z.string().nullish(),
  category: z.string().min(1),
  formula_type: z.string().default('SQL'),
  formula: z.string().min(1),
  source_table: z.string().nullish(),
  format_type: z.enum(VALID_FORMAT_TYPES),
  decimal_places: z.number().int().min(0).default(1),
  direction: z.enum(VALID_DIRECTIONS),
  unit_label: z.string().nullish(),
  is_active: z.boolean().default(true),
  sort_order: z.number().int().default(0),
});

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
    logger.error('listKpis error:', error);
    res.status(500).json({ error: 'Failed to list KPIs' });
  }
};

/**
 * POST /api/insights/admin/kpis
 */
export const createKpi = async (req: Request, res: Response): Promise<void> => {
  try {
    const parsed = createKpiSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation error', details: parsed.error.errors.map(e => ({ path: e.path.join('.'), message: e.message })) });
      return;
    }

    const d = parsed.data;
    const [result] = await pool.execute<ResultSetHeader>(
      `INSERT INTO ie_kpi (kpi_code, kpi_name, description, category, formula_type, formula,
        source_table, format_type, decimal_places, direction, unit_label, is_active, sort_order, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        d.kpi_code, d.kpi_name, d.description ?? null, d.category,
        d.formula_type, d.formula, d.source_table ?? null,
        d.format_type, d.decimal_places, d.direction, d.unit_label ?? null,
        d.is_active ? 1 : 0, d.sort_order, req.user?.user_id ?? null,
      ]
    );

    const [newRow] = await pool.execute<RowDataPacket[]>('SELECT * FROM ie_kpi WHERE id = ?', [result.insertId]);
    res.status(201).json(newRow[0]);
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && (error as { code: string }).code === 'ER_DUP_ENTRY') {
      res.status(409).json({ error: 'A KPI with this code already exists' });
      return;
    }
    logger.error('createKpi error:', error);
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
    const values: unknown[] = [];

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
    logger.error('updateKpi error:', error);
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
      `SELECT t.id, t.kpi_id, t.department_key, t.goal_value, t.warning_value, t.critical_value,
              DATE_FORMAT(t.effective_from, '%Y-%m-%d') AS effective_from,
              DATE_FORMAT(t.effective_to,   '%Y-%m-%d') AS effective_to,
              t.created_at, t.updated_at, d.department_name
       FROM ie_kpi_threshold t
       LEFT JOIN ie_dim_department d ON t.department_key = d.department_key AND d.is_current = 1
       WHERE t.kpi_id = ?
       ORDER BY t.effective_from DESC`,
      [kpiId]
    );
    res.json(rows);
  } catch (error) {
    logger.error('getThresholds error:', error);
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

    const deptKey = department_key ?? null
    await pool.execute<ResultSetHeader>(
      `INSERT INTO ie_kpi_threshold (kpi_id, department_key, goal_value, warning_value, critical_value, effective_from, effective_to)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE goal_value = VALUES(goal_value), warning_value = VALUES(warning_value),
         critical_value = VALUES(critical_value), effective_to = VALUES(effective_to)`,
      [kpiId, deptKey, goal_value ?? null, warning_value ?? null, critical_value ?? null, effective_from, effective_to ?? null]
    );

    const [newRow] = await pool.execute<RowDataPacket[]>(
      `SELECT * FROM ie_kpi_threshold
       WHERE kpi_id = ? AND effective_from = ? AND (department_key <=> ?)`,
      [kpiId, effective_from, deptKey]
    );
    if (newRow.length === 0) { res.status(404).json({ error: 'Threshold not found after upsert' }); return; }
    res.status(201).json(newRow[0]);
  } catch (error) {
    logger.error('setThreshold error:', error);
    res.status(500).json({ error: 'Failed to set threshold' });
  }
};

/**
 * PUT /api/insights/admin/kpis/:id/thresholds/:thresholdId
 */
export const updateThreshold = async (req: Request, res: Response): Promise<void> => {
  try {
    const kpiId      = parseInt(req.params.id);
    const thresholdId = parseInt(req.params.thresholdId);
    if (isNaN(kpiId) || isNaN(thresholdId)) {
      res.status(400).json({ error: 'Invalid id' }); return;
    }

    const { goal_value, warning_value, critical_value, effective_from, effective_to } = req.body;
    if (!effective_from) {
      res.status(400).json({ error: 'effective_from is required' }); return;
    }

    await pool.execute(
      `UPDATE ie_kpi_threshold
       SET goal_value = ?, warning_value = ?, critical_value = ?, effective_from = ?, effective_to = ?
       WHERE id = ? AND kpi_id = ?`,
      [goal_value ?? null, warning_value ?? null, critical_value ?? null,
       effective_from, effective_to ?? null, thresholdId, kpiId],
    );

    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT t.id, t.kpi_id, t.department_key, t.goal_value, t.warning_value, t.critical_value,
              DATE_FORMAT(t.effective_from, '%Y-%m-%d') AS effective_from,
              DATE_FORMAT(t.effective_to,   '%Y-%m-%d') AS effective_to,
              t.created_at, t.updated_at
       FROM ie_kpi_threshold t WHERE t.id = ?`,
      [thresholdId],
    );
    if (rows.length === 0) { res.status(404).json({ error: 'Threshold not found' }); return; }
    res.json(rows[0]);
  } catch (error) {
    logger.error('updateThreshold error:', error);
    res.status(500).json({ error: 'Failed to update threshold' });
  }
};

/**
 * DELETE /api/insights/admin/kpis/:id/thresholds/:thresholdId
 */
export const deleteThreshold = async (req: Request, res: Response): Promise<void> => {
  try {
    const kpiId       = parseInt(req.params.id);
    const thresholdId = parseInt(req.params.thresholdId);
    if (isNaN(kpiId) || isNaN(thresholdId)) {
      res.status(400).json({ error: 'Invalid id' }); return;
    }

    const [result] = await pool.execute<ResultSetHeader>(
      'DELETE FROM ie_kpi_threshold WHERE id = ? AND kpi_id = ?',
      [thresholdId, kpiId],
    );
    if (result.affectedRows === 0) {
      res.status(404).json({ error: 'Threshold not found' }); return;
    }
    res.json({ success: true });
  } catch (error) {
    logger.error('deleteThreshold error:', error);
    res.status(500).json({ error: 'Failed to delete threshold' });
  }
};
