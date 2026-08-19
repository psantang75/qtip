import express, { Request, Response, RequestHandler } from 'express';
import { authenticate, authorizeAdmin } from '../middleware/auth';
import prisma from '../config/prisma';
import { Prisma } from '../generated/prisma/client';
import { parsePagination } from '../validation/common';
import logger from '../config/logger';

const router = express.Router();

/**
 * Get audit logs with pagination and filtering.
 *
 * Built with `Prisma.sql` tagged templates so every dynamic value flows
 * through a real placeholder rather than string concatenation — see
 * pre-production review item #42 for why we moved this off
 * `$queryRawUnsafe`. Pagination (incl. the `MAX_PAGE_SIZE` cap, item #40) is
 * handled by the shared `parsePagination` helper in `validation/common.ts`.
 */
const getAuditLogsHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    logger.info('[AUDIT LOG SERVICE] Getting audit logs');

    const { page, limit } = parsePagination(req.query, { defaultLimit: 20 });
    const action = req.query.action as string;
    const user_id = req.query.user_id as string;
    const start_date = req.query.start_date as string;
    const end_date = req.query.end_date as string;

    const offset = (page - 1) * limit;

    // Compose individual SQL fragments — Prisma.join glues them with AND
    // and keeps every dynamic value bound through a placeholder.
    const conditions: Prisma.Sql[] = [];
    if (action) conditions.push(Prisma.sql`al.action = ${action}`);
    if (user_id) conditions.push(Prisma.sql`al.user_id = ${parseInt(user_id)}`);
    if (start_date && end_date) {
      conditions.push(Prisma.sql`DATE(al.created_at) BETWEEN ${start_date} AND ${end_date}`);
    }
    const whereClause = conditions.length
      ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`
      : Prisma.empty;

    const countResult = await prisma.$queryRaw<{ total: bigint }[]>(
      Prisma.sql`SELECT COUNT(*) as total FROM audit_logs al ${whereClause}`,
    );
    const total = Number(countResult[0]?.total || 0);

    const rows = await prisma.$queryRaw<any[]>(
      Prisma.sql`
        SELECT al.*, u.username, u.email
        FROM audit_logs al
        LEFT JOIN users u ON al.user_id = u.id
        ${whereClause}
        ORDER BY al.created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `,
    );

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

    logger.info(`[AUDIT LOG SERVICE] Found ${auditLogs.length} audit logs`);
    
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
    logger.error('[AUDIT LOG SERVICE] Error fetching audit logs:', error);
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

    logger.info(`[AUDIT LOG SERVICE] Getting audit log by ID: ${id}`);

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

    logger.info(`[AUDIT LOG SERVICE] Found audit log: ${auditLog.action}`);
    res.status(200).json(auditLog);
  } catch (error) {
    logger.error('[AUDIT LOG SERVICE] Error fetching audit log by ID:', error);
    res.status(500).json({ 
      message: 'Failed to fetch audit log',
      error: process.env.NODE_ENV === 'development' ? (error as Error).message : 'Internal server error'
    });
  }
};

// Admin only. These rows carry the justification text behind admin
// overrides (unlock reasons, legacy overrides), which must not be readable
// by the agents those overrides are about.
router.use(authenticate as unknown as RequestHandler);
router.use(authorizeAdmin as unknown as RequestHandler);

/**
 * @route GET /api/audit-logs
 * @desc Get audit logs with pagination and filtering
 * @access Private (Admin)
 */
router.get('/', getAuditLogsHandler as unknown as RequestHandler);

/**
 * @route GET /api/audit-logs/:id
 * @desc Get audit log by ID
 * @access Private (Admin)
 */
router.get('/:id', getAuditLogByIdHandler as unknown as RequestHandler);

export default router;
