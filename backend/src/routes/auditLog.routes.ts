import express, { Request, Response, RequestHandler } from 'express';
import { authenticate } from '../middleware/auth';
import prisma from '../config/prisma';
import { Prisma } from '../generated/prisma/client';

const router = express.Router();

/**
 * Get audit logs with pagination and filtering
 * Service-based implementation replacing controller
 */
const getAuditLogsHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    console.log('[AUDIT LOG SERVICE] Getting audit logs');

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const action = req.query.action as string;
    const user_id = req.query.user_id as string;
    const start_date = req.query.start_date as string;
    const end_date = req.query.end_date as string;

    const offset = (page - 1) * limit;

    // Build WHERE clause
    let whereClause = 'WHERE 1=1';
    const params: any[] = [];

    if (action) {
      whereClause += ' AND al.action = ?';
      params.push(action);
    }

    if (user_id) {
      whereClause += ' AND al.user_id = ?';
      params.push(parseInt(user_id));
    }

    if (start_date && end_date) {
      whereClause += ' AND DATE(al.created_at) BETWEEN ? AND ?';
      params.push(start_date, end_date);
    }

    // Count total records
    const countQuery = `
      SELECT COUNT(*) as total 
      FROM audit_logs al
      ${whereClause}
    `;

    const countResult = await prisma.$queryRawUnsafe<{ total: bigint }[]>(countQuery, ...params);
    const total = Number(countResult[0]?.total || 0);

    // Get paginated data
    const dataQuery = `
      SELECT 
        al.*,
        u.username,
        u.email
      FROM audit_logs al
      LEFT JOIN users u ON al.user_id = u.id
      ${whereClause}
      ORDER BY al.created_at DESC
      LIMIT ? OFFSET ?
    `;

    const rows = await prisma.$queryRawUnsafe<any[]>(dataQuery, ...params, limit, offset);

    const auditLogs = rows.map(row => ({
      id: row.id,
      user_id: row.user_id,
      username: row.username,
      email: row.email,
      action: row.action,
      entity_type: row.entity_type,
      entity_id: row.entity_id,
      old_values: row.old_values ? JSON.parse(row.old_values) : null,
      new_values: row.new_values ? JSON.parse(row.new_values) : null,
      ip_address: row.ip_address,
      user_agent: row.user_agent,
      created_at: row.created_at
    }));

    console.log(`[AUDIT LOG SERVICE] Found ${auditLogs.length} audit logs`);
    
    res.status(200).json({
      data: auditLogs,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('[AUDIT LOG SERVICE] Error fetching audit logs:', error);
    res.status(500).json({ 
      message: 'Failed to fetch audit logs',
      error: process.env.NODE_ENV === 'development' ? (error as Error).message : 'Internal server error'
    });
  }
};

/**
 * Get audit log by ID
 * Service-based implementation replacing controller
 */
const getAuditLogByIdHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id);
    
    if (!id || id <= 0) {
      res.status(400).json({ message: 'Invalid audit log ID' });
      return;
    }

    console.log(`[AUDIT LOG SERVICE] Getting audit log by ID: ${id}`);

    const rows = await prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT 
        al.*,
        u.username,
        u.email
      FROM audit_logs al
      LEFT JOIN users u ON al.user_id = u.id
      WHERE al.id = ${id}
    `);

    if (rows.length === 0) {
      res.status(404).json({ message: 'Audit log not found' });
      return;
    }

    const row = rows[0];
    const auditLog = {
      id: row.id,
      user_id: row.user_id,
      username: row.username,
      email: row.email,
      action: row.action,
      entity_type: row.entity_type,
      entity_id: row.entity_id,
      old_values: row.old_values ? JSON.parse(row.old_values) : null,
      new_values: row.new_values ? JSON.parse(row.new_values) : null,
      ip_address: row.ip_address,
      user_agent: row.user_agent,
      created_at: row.created_at
    };

    console.log(`[AUDIT LOG SERVICE] Found audit log: ${auditLog.action}`);
    res.status(200).json(auditLog);
  } catch (error) {
    console.error('[AUDIT LOG SERVICE] Error fetching audit log by ID:', error);
    res.status(500).json({ 
      message: 'Failed to fetch audit log',
      error: process.env.NODE_ENV === 'development' ? (error as Error).message : 'Internal server error'
    });
  }
};

// Apply authentication middleware
router.use(authenticate as unknown as RequestHandler);

/**
 * @route GET /api/audit-logs
 * @desc Get audit logs with pagination and filtering
 * @access Private
 */
router.get('/', getAuditLogsHandler as unknown as RequestHandler);

/**
 * @route GET /api/audit-logs/:id
 * @desc Get audit log by ID
 * @access Private
 */
router.get('/:id', getAuditLogByIdHandler as unknown as RequestHandler);

export default router;
