import { Request, Response } from 'express';
import prisma from '../config/prisma';
import { Prisma } from '../generated/prisma/client';
import { AuditLogFilters, AuditLogWithDetails } from '../types/auditLog.types';
import logger from '../config/logger';

/**
 * Get audit logs with pagination and optional filtering
 * @route GET /api/audit-logs
 */
export const getAuditLogs = async (req: Request, res: Response): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = (page - 1) * limit;

    const filters: AuditLogFilters = {
      user_id: req.query.user_id ? parseInt(req.query.user_id as string) : undefined,
      action: req.query.action as string,
      target_type: req.query.target_type as string,
      start_date: req.query.start_date as string,
      end_date: req.query.end_date as string,
      department_id: req.query.department_id ? parseInt(req.query.department_id as string) : undefined
    };

    const user_id = req.user!.user_id;
    const userInfo = await prisma.$queryRaw<{ role_name: string; department_id: number | null }[]>`
      SELECT r.role_name, u.department_id
      FROM users u
      JOIN roles r ON u.role_id = r.id
      WHERE u.id = ${user_id}
    `;

    if (userInfo.length === 0) {
      res.status(403).json({ message: 'User not found or access denied' });
      return;
    }

    const userRole = userInfo[0].role_name;
    const userDepartmentId = userInfo[0].department_id;

    const conditions: Prisma.Sql[] = [];

    if (userRole === 'Manager') {
      conditions.push(Prisma.sql`al.user_id IN (SELECT id FROM users WHERE department_id = ${userDepartmentId})`);
    } else if (userRole === 'Director') {
      conditions.push(Prisma.sql`al.user_id IN (
        SELECT u.id FROM users u
        JOIN departments d ON u.department_id = d.id
        JOIN department_managers dm ON d.id = dm.department_id
        WHERE dm.manager_id IN (SELECT id FROM users WHERE department_id = ${userDepartmentId})
      )`);
    } else if (!['Admin', 'QA', 'Trainer'].includes(userRole)) {
      res.status(403).json({ message: 'Access denied' });
      return;
    }

    if (filters.user_id) conditions.push(Prisma.sql`al.user_id = ${filters.user_id}`);
    if (filters.action) conditions.push(Prisma.sql`al.action LIKE ${'%' + filters.action + '%'}`);
    if (filters.target_type) conditions.push(Prisma.sql`al.target_type = ${filters.target_type}`);
    if (filters.start_date) conditions.push(Prisma.sql`al.created_at >= ${filters.start_date}`);
    if (filters.end_date) conditions.push(Prisma.sql`al.created_at <= ${filters.end_date}`);
    if (filters.department_id) {
      conditions.push(Prisma.sql`al.user_id IN (SELECT id FROM users WHERE department_id = ${filters.department_id})`);
    }

    const whereClause = conditions.length > 0
      ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`
      : Prisma.sql`WHERE 1=1`;

    const [rows, countResult] = await Promise.all([
      prisma.$queryRaw<AuditLogWithDetails[]>`
        SELECT al.*, u.username
        FROM audit_logs al
        JOIN users u ON al.user_id = u.id
        ${whereClause}
        ORDER BY al.created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `,
      prisma.$queryRaw<{ total: bigint }[]>`
        SELECT COUNT(*) as total
        FROM audit_logs al
        JOIN users u ON al.user_id = u.id
        ${whereClause}
      `
    ]);

    const total = Number(countResult[0]?.total || 0);
    const totalPages = Math.ceil(total / limit);

    res.status(200).json({
      data: rows as AuditLogWithDetails[],
      pagination: { total, page, limit, totalPages }
    });
  } catch (error) {
    logger.error('Error retrieving audit logs:', error);
    res.status(500).json({ message: 'Failed to retrieve audit logs' });
  }
};

/**
 * Get a single audit log by ID
 * @route GET /api/audit-logs/:id
 */
export const getAuditLogById = async (req: Request, res: Response): Promise<void> => {
  try {
    const logId = parseInt(req.params.id);

    const user_id = req.user!.user_id;
    const userInfo = await prisma.$queryRaw<{ role_name: string; department_id: number | null }[]>`
      SELECT r.role_name, u.department_id
      FROM users u
      JOIN roles r ON u.role_id = r.id
      WHERE u.id = ${user_id}
    `;

    if (userInfo.length === 0) {
      res.status(403).json({ message: 'User not found or access denied' });
      return;
    }

    const userRole = userInfo[0].role_name;
    const userDepartmentId = userInfo[0].department_id;

    const conditions: Prisma.Sql[] = [Prisma.sql`al.id = ${logId}`];

    if (userRole === 'Manager') {
      conditions.push(Prisma.sql`al.user_id IN (SELECT id FROM users WHERE department_id = ${userDepartmentId})`);
    } else if (userRole === 'Director') {
      conditions.push(Prisma.sql`al.user_id IN (
        SELECT u.id FROM users u
        JOIN departments d ON u.department_id = d.id
        JOIN department_managers dm ON d.id = dm.department_id
        WHERE dm.manager_id IN (SELECT id FROM users WHERE department_id = ${userDepartmentId})
      )`);
    } else if (!['Admin', 'QA', 'Trainer'].includes(userRole)) {
      res.status(403).json({ message: 'Access denied' });
      return;
    }

    const whereClause = Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`;

    const rows = await prisma.$queryRaw<AuditLogWithDetails[]>`
      SELECT al.*, u.username
      FROM audit_logs al
      JOIN users u ON al.user_id = u.id
      ${whereClause}
    `;

    if (rows.length === 0) {
      res.status(404).json({ message: 'Audit log not found or access denied' });
      return;
    }

    res.status(200).json({ log: rows[0] as AuditLogWithDetails });
  } catch (error) {
    logger.error('Error retrieving audit log:', error);
    res.status(500).json({ message: 'Failed to retrieve audit log' });
  }
};
